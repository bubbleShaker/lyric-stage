import { describe, expect, it, vi } from 'vitest';
import { bassLevel, createLoudness, smoothLevel, toIntensity } from './loudness';

/** getByteFrequencyData の結果に見立てた配列（0〜255） */
function bins(values: number[], length = 512): number[] {
  return Array.from({ length }, (_, i) => values[i] ?? 0);
}

describe('bassLevel', () => {
  // 44.1kHz / fftSize 1024 なら 1 ビン ≒ 43Hz。200Hz までは 5 本
  const SAMPLE_RATE = 44100;
  const FFT_SIZE = 1024;

  it('低音域だけを見る（高い方が鳴っていても上がらない）', () => {
    const highOnly = bins(Array.from({ length: 512 }, (_, i) => (i < 5 ? 0 : 255)));
    expect(bassLevel(highOnly, SAMPLE_RATE, FFT_SIZE)).toBe(0);
  });

  it('低音域が振り切っていれば 1 になる', () => {
    const bassOnly = bins([255, 255, 255, 255, 255]);
    expect(bassLevel(bassOnly, SAMPLE_RATE, FFT_SIZE)).toBe(1);
  });

  it('無音なら 0', () => {
    expect(bassLevel(bins([]), SAMPLE_RATE, FFT_SIZE)).toBe(0);
  });

  it('解析の細かさが変わっても、見る帯域は同じ（本数で数えない）', () => {
    // fftSize が倍ならビンの幅は半分。同じ 200Hz までなら本数は倍になる
    const coarse = bins([255, 255, 255, 255, 255]);
    const fine = bins([255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);

    expect(bassLevel(coarse, SAMPLE_RATE, 1024)).toBe(1);
    expect(bassLevel(fine, SAMPLE_RATE, 2048)).toBe(1);
    // 細かい方で低い 5 本しか鳴っていなければ、9 本のうち 5 本ぶん
    expect(bassLevel(coarse, SAMPLE_RATE, 2048)).toBeCloseTo(5 / 9);
  });
});

describe('toIntensity', () => {
  // 窓の位置は本編の mp3 の実測に合わせてある（イントロ 0.73 / サビ 0.91 / ラスサビ 0.95）
  it('静かな側は 0 に張り付く', () => {
    expect(toIntensity(0)).toBe(0);
    // イントロの生の値。低音は鳴っているが、この曲の中では静かな側
    expect(toIntensity(0.73)).toBe(0);
  });

  it('大きい側は 1 で頭打ちになる', () => {
    expect(toIntensity(0.98)).toBe(1);
    expect(toIntensity(1)).toBe(1);
  });

  it('間は単調に増える', () => {
    const middle = toIntensity(0.91);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
    expect(toIntensity(0.95)).toBeGreaterThan(middle);
  });
});

describe('smoothLevel', () => {
  it('上がる時は速く、下がる時はゆっくり', () => {
    const rise = smoothLevel(0, 1);
    const fall = 1 - smoothLevel(1, 0);

    expect(rise).toBeGreaterThan(fall);
  });

  it('目標を追い越さない', () => {
    let value = 0;
    for (let i = 0; i < 200; i += 1) value = smoothLevel(value, 1);

    expect(value).toBeLessThanOrEqual(1);
    expect(value).toBeGreaterThan(0.99);
  });

  it('静かになれば 0 へ戻る', () => {
    let value = 1;
    for (let i = 0; i < 300; i += 1) value = smoothLevel(value, 0);

    expect(value).toBeLessThan(0.01);
    expect(value).toBeGreaterThanOrEqual(0);
  });

  it('拍の合間の一瞬の落ち込みでは暗転しない', () => {
    // 60fps で 5 フレーム（約 83ms）だけ無音になっても、半分より下には落ちない
    let value = 1;
    for (let i = 0; i < 5; i += 1) value = smoothLevel(value, 0);

    expect(value).toBeGreaterThan(0.5);
  });
});

/**
 * Web Audio の偽物。**繋ぎ先を記録する**のが主目的。
 *
 * `createMediaElementSource` に繋いだ時点で音の出口が AudioContext 側へ移るので、
 * destination まで繋がないと音が消える。目でも耳でも気づきにくい（解析は動くので
 * 背景は正しく反応する）ぶん、検査で守る価値が大きい不変条件。
 */
class FakeNode {
  readonly connectedTo: unknown[] = [];
  connect(destination: unknown): void {
    this.connectedTo.push(destination);
  }
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  /** 低音域だけ鳴っていることにする値 */
  bass = 0;

  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }

  getByteFrequencyData(bins: Uint8Array): void {
    bins.fill(0);
    // 44.1kHz / 1024 なら 200Hz までは 5 本
    for (let i = 0; i < 5; i += 1) bins[i] = this.bass;
  }
}

function fakeAudio() {
  const source = new FakeNode();
  const analyser = new FakeAnalyser();
  const destination = { name: 'destination' };
  const resume = vi.fn();
  let created = 0;

  const context = {
    sampleRate: 44100,
    destination,
    resume,
    createMediaElementSource: () => source,
    createAnalyser: () => analyser,
  };

  return {
    source,
    analyser,
    destination,
    resume,
    get created() {
      return created;
    },
    factory: () => {
      created += 1;
      return context as unknown as AudioContext;
    },
  };
}

const media = {} as HTMLMediaElement;

describe('createLoudness', () => {
  it('解析を挿しても音が消えない（destination まで繋ぐ）', () => {
    const audio = fakeAudio();
    createLoudness(media, audio.factory).start();

    expect(audio.source.connectedTo).toEqual([audio.analyser]);
    expect(audio.analyser.connectedTo).toEqual([audio.destination]);
  });

  it('始めるまでは静かなまま', () => {
    const audio = fakeAudio();
    const loudness = createLoudness(media, audio.factory);

    loudness.sample();
    expect(loudness.level()).toBe(0);
    expect(audio.created).toBe(0);
  });

  it('2 回目の start では作り直さず、再開だけする', () => {
    const audio = fakeAudio();
    const loudness = createLoudness(media, audio.factory);

    loudness.start();
    loudness.start();

    expect(audio.created).toBe(1);
    expect(audio.resume).toHaveBeenCalledTimes(2);
  });

  it('鳴っている間は強さが上がり、止めば戻る', () => {
    const audio = fakeAudio();
    const loudness = createLoudness(media, audio.factory);
    loudness.start();

    audio.analyser.bass = 255;
    for (let i = 0; i < 30; i += 1) loudness.sample();
    const loud = loudness.level();
    expect(loud).toBeGreaterThan(0.9);

    audio.analyser.bass = 0;
    for (let i = 0; i < 120; i += 1) loudness.sample();
    expect(loudness.level()).toBeLessThan(0.05);
  });

  it('AudioContext を作れない環境でも落ちず、静かなままになる', () => {
    const loudness = createLoudness(media, () => {
      throw new Error('AudioContext は使えません');
    });

    expect(() => {
      loudness.start();
    }).not.toThrow();

    loudness.sample();
    expect(loudness.level()).toBe(0);
  });
});
