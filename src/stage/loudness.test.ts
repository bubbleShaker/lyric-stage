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
  // 幅そのもの（本編は 0.85〜0.98）は曲ごとの実測値で src/work.ts が持つ。
  // ここで検査するのは曲に依らない性質だけ
  const range = { quiet: 0.2, loud: 0.8 };

  it('静かな側は 0 に張り付く', () => {
    expect(toIntensity(0, range)).toBe(0);
    expect(toIntensity(0.2, range)).toBe(0);
  });

  it('大きい側は 1 で頭打ちになる', () => {
    expect(toIntensity(0.8, range)).toBe(1);
    expect(toIntensity(1, range)).toBe(1);
  });

  it('間は単調に増える', () => {
    const middle = toIntensity(0.5, range);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
    expect(toIntensity(0.6, range)).toBeGreaterThan(middle);
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

  it('静かになれば **厳密に 0** へ戻る', () => {
    // 指数の減衰は 0 に漸近するだけなので、そのままだと「前回と違う強さ」が
    // 何分も続き、止まった絵を毎フレーム描き直すことになる
    let value = 1;
    for (let i = 0; i < 300; i += 1) value = smoothLevel(value, 0);

    expect(value).toBe(0);
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

/** 音量つまみ（M12-2）。value を控えるだけ */
class FakeGain extends FakeNode {
  readonly gain = { value: 1 };
}

function fakeAudio() {
  const source = new FakeNode();
  const analyser = new FakeAnalyser();
  const gain = new FakeGain();
  const destination = { name: 'destination' };
  const resume = vi.fn();
  let created = 0;

  let attachedTo: unknown = null;
  const close = vi.fn();

  const context = {
    sampleRate: 44100,
    destination,
    resume,
    close,
    createMediaElementSource: (el: unknown) => {
      attachedTo = el;
      return source;
    },
    createAnalyser: () => analyser,
    createGain: () => gain,
  };

  return {
    source,
    analyser,
    gain,
    destination,
    resume,
    close,
    get attachedTo() {
      return attachedTo;
    },
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

/** 検査ごとに新しい要素を使う（volume を書き換えるので使い回せない） */
const freshMedia = () => ({ volume: 1 }) as HTMLMediaElement;

/** 偽の解析器は低音を 0 か 255 で返すので、幅は 0〜1 をそのまま使う */
const RANGE = { quiet: 0, loud: 1 };

describe('createLoudness', () => {
  it('解析を挿しても音が消えない（destination まで繋ぐ）', () => {
    const audio = fakeAudio();
    createLoudness(media, audio.factory, RANGE).start();

    // 解析 → 音量つまみ → destination（M12-2 でつまみが 1 段入った）
    expect(audio.source.connectedTo).toEqual([audio.analyser]);
    expect(audio.analyser.connectedTo).toEqual([audio.gain]);
    expect(audio.gain.connectedTo).toEqual([audio.destination]);
  });

  it('渡された要素そのものを解析する', () => {
    const audio = fakeAudio();
    createLoudness(media, audio.factory, RANGE).start();

    expect(audio.attachedTo).toBe(media);
  });

  it('始めるまでは静かなまま', () => {
    const audio = fakeAudio();
    const loudness = createLoudness(media, audio.factory, RANGE);

    loudness.sample();
    expect(loudness.level()).toBe(0);
    expect(audio.created).toBe(0);
  });

  it('2 回目の start では作り直さず、再開だけする', () => {
    const audio = fakeAudio();
    const loudness = createLoudness(media, audio.factory, RANGE);

    loudness.start();
    loudness.start();

    expect(audio.created).toBe(1);
    expect(audio.resume).toHaveBeenCalledTimes(2);
  });

  it('鳴っている間は強さが上がり、止めば戻る', () => {
    const audio = fakeAudio();
    const loudness = createLoudness(media, audio.factory, RANGE);
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
    const loudness = createLoudness(
      media,
      () => {
        throw new Error('AudioContext は使えません');
      },
      RANGE,
    );

    expect(() => {
      loudness.start();
    }).not.toThrow();

    loudness.sample();
    expect(loudness.level()).toBe(0);
  });

  it('一度失敗したら作り直さない（押すたびに AudioContext を作らない）', () => {
    let attempts = 0;
    const loudness = createLoudness(
      media,
      () => {
        attempts += 1;
        throw new Error('AudioContext は使えません');
      },
      RANGE,
    );

    loudness.start();
    loudness.start();
    loudness.start();

    // Chrome はページあたり数個で new AudioContext() 自体が投げるようになる
    expect(attempts).toBe(1);
  });

  it('途中で失敗したら、作りかけの AudioContext を閉じる', () => {
    const audio = fakeAudio();
    const broken = {
      ...audio,
      factory: () => {
        const context = audio.factory();
        return {
          ...context,
          createMediaElementSource: () => {
            throw new Error('この要素は既に別の AudioContext に繋がっています');
          },
        } as unknown as AudioContext;
      },
    };

    createLoudness(media, broken.factory, RANGE).start();

    expect(audio.close).toHaveBeenCalledTimes(1);
  });
});

/**
 * 音量（M12-2 / Issue #70）。**出口がどちらに在るかを吸収するのがこの口の仕事。**
 *
 * `createMediaElementSource` を呼んだ時点で音の出口はグラフ側へ移り、要素の
 * `volume` が効くかどうかはブラウザ任せになる。**耳でしか分からない壊れ方**
 * （フェードが掛からない／二重に掛かる）なので、配線と同じく検査で守る。
 */
describe('createLoudness の音量', () => {
  it('グラフが立つ前は要素の volume が出口', () => {
    const el = freshMedia();
    const audio = fakeAudio();

    createLoudness(el, audio.factory, RANGE).setVolume(0.25);

    expect(el.volume).toBe(0.25);
  });

  it('グラフが立ったら、つまみで掛けて要素は素に戻す（二重に掛けない）', () => {
    const el = freshMedia();
    const audio = fakeAudio();
    const loudness = createLoudness(el, audio.factory, RANGE);

    loudness.start();
    loudness.setVolume(0.4);

    expect(audio.gain.gain.value).toBe(0.4);
    // 要素の volume が効くブラウザで二重に掛かると、フェードの形が変わる
    expect(el.volume).toBe(1);
  });

  it('フェードの途中で再生ボタンが押されても音が飛び出さない', () => {
    // 頭のフェードは止まっている間から始まっている（膜は組み立て直後に 0 を書く）。
    // start() でつまみを作る時に今の音量を引き継がないと、**押した瞬間だけ全開**になる
    const el = freshMedia();
    const audio = fakeAudio();
    const loudness = createLoudness(el, audio.factory, RANGE);

    loudness.setVolume(0);
    loudness.start();

    expect(audio.gain.gain.value).toBe(0);
  });

  it('範囲の外や数でない値は締める', () => {
    // 要素の volume は範囲外の代入が例外になる。NaN は比較をすり抜けるので別に落とす
    const el = freshMedia();
    const audio = fakeAudio();
    const loudness = createLoudness(el, audio.factory, RANGE);

    loudness.setVolume(-1);
    expect(el.volume).toBe(0);
    loudness.setVolume(3);
    expect(el.volume).toBe(1);
    loudness.setVolume(NaN);
    expect(el.volume).toBe(0);
  });

  it('解析を始められない環境でも音量は効く', () => {
    // フェードは作品の閉じ方なので、解析（装飾）の失敗に巻き込まれてはいけない
    const el = freshMedia();
    const loudness = createLoudness(el, () => {
      throw new Error('AudioContext は使えません');
    }, RANGE);

    loudness.start();
    loudness.setVolume(0.5);

    expect(el.volume).toBe(0.5);
  });
});
