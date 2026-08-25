import { describe, expect, it } from 'vitest';
import {
  createBeatPulse,
  createFlashPulse,
  flashInterval,
  MIN_FLASH_INTERVAL,
  pulseAt,
  pulseIndexAt,
  pulseInterval,
  secondsPerBeat,
  shiftBeatGrid,
  type BeatGrid,
  type FlashPulse,
} from './beat';

/** 本編の曲の格子（work.ts の BEAT_GRID と同じ値。ここでは起点 0 で見る） */
const GRID: BeatGrid = { bpm: 79.85, origin: 0 };

describe('拍の長さ', () => {
  it('BPM から 1 拍の長さが出る', () => {
    expect(secondsPerBeat(GRID)).toBeCloseTo(0.7514, 4);
  });

  it('拍ごと・8 分ごとの刻みが取れる', () => {
    expect(pulseInterval(GRID, 1)).toBeCloseTo(0.7514, 4);
    expect(pulseInterval(GRID, 2)).toBeCloseTo(0.3757, 4);
  });
});

describe('明滅の安全（間隔の下限）', () => {
  // この検査が M8-4 で一番重い。**値ではなく仕組みで守れているか**を見る
  it('どんな BPM・分割を渡しても、光るものの間隔は下限を下回らない', () => {
    for (const bpm of [60, 79.85, 120, 174, 300, 1000]) {
      for (const division of [1, 2, 4, 8, 16]) {
        const grid = { bpm, origin: 0 };

        expect(flashInterval(grid, division)).toBeGreaterThanOrEqual(MIN_FLASH_INTERVAL);
        expect(createFlashPulse(grid, { division, decay: 0.5 }).interval).toBeGreaterThanOrEqual(
          MIN_FLASH_INTERVAL,
        );
      }
    }
  });

  it('下限は 3Hz より粗い（WCAG 2.3.1 の閾値に余裕がある）', () => {
    expect(1 / MIN_FLASH_INTERVAL).toBeLessThan(3);
  });

  it('細かすぎる刻みは倍にして落とす（拍の格子の上に載ったまま）', () => {
    const fine = flashInterval(GRID, 8);

    expect(fine).toBeGreaterThanOrEqual(MIN_FLASH_INTERVAL);
    // 元の刻み（0.0939 秒）の 2 の冪。丸めた値ではないので格子から滑らない
    expect(fine / pulseInterval(GRID, 8)).toBeCloseTo(8, 10);
  });

  it('この曲では、光るのは拍ごと・揺れは 8 分ごと', () => {
    // 8 分（0.3757 秒 = 2.66Hz）は下限に当たるので、光る側だけが拍ごとへ落ちる。
    // 揺れは明滅ではないので落ちない（前庭系への配慮は prefers-reduced-motion）
    expect(flashInterval(GRID, 2)).toBeCloseTo(0.7514, 4);
    expect(pulseInterval(GRID, 2)).toBeCloseTo(0.3757, 4);
  });

  it('叩けない BPM・分割は受け付けない（無限に倍にし続けない）', () => {
    expect(() => flashInterval({ bpm: 0, origin: 0 }, 1)).toThrow(RangeError);
    expect(() => flashInterval({ bpm: -120, origin: 0 }, 1)).toThrow(RangeError);
    expect(() => flashInterval({ bpm: Number.NaN, origin: 0 }, 1)).toThrow(RangeError);
    expect(() => flashInterval(GRID, 0)).toThrow(RangeError);
    expect(() => flashInterval(GRID, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('刻みが 0 に潰れる指定も受け付けない（レビュー指摘 🟡）', () => {
    // 有限性だけを見ていると届かない経路。bpm と分割が両方とも極端に大きいと
    // 非正規化数の下方あふれで 0 になり、**0 を倍にし続けてタブが固まる**
    expect(() => flashInterval({ bpm: 1e308, origin: 0 }, 1e308)).toThrow(RangeError);
    expect(() => pulseInterval({ bpm: 1e308, origin: 0 }, 1e308)).toThrow(RangeError);
  });

  it('下限を通していない刻みは光る側へ渡せない', () => {
    // 印（unique symbol）は createFlashPulse の中でしか打てない。**素の真偽値では
    // 印にならない**（構造的部分型なので手で書き写せてしまう。レビュー指摘 🔴）。
    // 下の指示子は「型検査が実際に止めること」そのものを検査している —
    // 止まらなくなった瞬間、指示子が余るのでコンパイルエラーになる
    // @ts-expect-error 印を持たないオブジェクトは FlashPulse ではない
    const forged: FlashPulse = { origin: 0, interval: 0.05, decay: 0.5 };

    expect(forged.interval).toBe(0.05);
  });
});

describe('衝撃の強さ', () => {
  const pulse = createBeatPulse(GRID, { division: 1, decay: 0.5 });

  it('拍の頭で振り切る', () => {
    expect(pulseAt(pulse, 0)).toBe(1);
    expect(pulseAt(pulse, pulse.interval)).toBe(1);
  });

  it('余韻の間は下がり続け、終わったら 0', () => {
    const half = pulse.interval * pulse.decay;

    expect(pulseAt(pulse, half * 0.25)).toBeGreaterThan(pulseAt(pulse, half * 0.75));
    expect(pulseAt(pulse, half)).toBe(0);
    // 次の拍の直前まで静か
    expect(pulseAt(pulse, pulse.interval * 0.99)).toBe(0);
  });

  it('起点より前でも拍を刻む（区間の手前は時刻が負になる）', () => {
    expect(pulseAt(pulse, -pulse.interval)).toBe(1);
    expect(pulseAt(pulse, -pulse.interval * 0.5)).toBe(0);
  });

  it('余韻は間隔に対する割合なので、刻みが落ちても間延びしない', () => {
    // 分割 8 は下限に当たって拍ごとへ落ちる。それでも余韻は間隔の半分のまま
    const dropped = createFlashPulse(GRID, { division: 8, decay: 0.5 });

    expect(pulseAt(dropped, dropped.interval * 0.49)).toBeGreaterThan(0);
    expect(pulseAt(dropped, dropped.interval * 0.5)).toBe(0);
  });

  it('余韻の割合は 0 より大きく 1 以下', () => {
    expect(() => createBeatPulse(GRID, { division: 1, decay: 0 })).toThrow(RangeError);
    expect(() => createBeatPulse(GRID, { division: 1, decay: 1.5 })).toThrow(RangeError);
    expect(() => createBeatPulse(GRID, { division: 1, decay: Number.NaN })).toThrow(RangeError);
  });
});

describe('何回目の打拍か', () => {
  const pulse = createBeatPulse(GRID, { division: 2, decay: 0.6 });

  it('起点から数え、前は負になる', () => {
    expect(pulseIndexAt(pulse, 0)).toBe(0);
    expect(pulseIndexAt(pulse, pulse.interval * 0.9)).toBe(0);
    expect(pulseIndexAt(pulse, pulse.interval)).toBe(1);
    expect(pulseIndexAt(pulse, -0.01)).toBe(-1);
  });

  it('打拍が変わるたびに 1 つ進む', () => {
    const indices = [0, 1, 2, 3].map((n) => pulseIndexAt(pulse, pulse.interval * n));

    expect(indices).toEqual([0, 1, 2, 3]);
  });
});

describe('格子の起点の付け替え', () => {
  it('区間の先頭が 0 になる時間軸へ移せる', () => {
    const shifted = shiftBeatGrid({ bpm: 79.85, origin: 176.77 }, 176.77);

    expect(shifted).toEqual({ bpm: 79.85, origin: 0 });
  });

  it('区間を切らない（WHOLE_SONG）なら素通し', () => {
    const grid = { bpm: 79.85, origin: 176.77 };

    expect(shiftBeatGrid(grid, 0)).toEqual(grid);
  });
});
