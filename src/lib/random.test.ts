import { describe, expect, it } from 'vitest';
import { seededRandom } from './random';

describe('seededRandom', () => {
  /**
   * mulberry32 の既知の出力と突き合わせる。
   *
   * 「同じ種なら同じ結果」だけを見ると、定数を 1 文字打ち間違えても検査は通り、
   * 星空だけが静かに別物になる。参照実装と一致することを押さえておく。
   */
  it('既知の実装と同じ数列を返す', () => {
    const random = seededRandom(42);
    const first = [random(), random(), random()];

    expect(first.map((value) => value.toFixed(10))).toEqual([
      '0.6011037519',
      '0.4482905590',
      '0.8524657935',
    ]);
  });

  it('0 以上 1 未満を返す', () => {
    const random = seededRandom(2026);
    for (let i = 0; i < 5000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('種が違えば別の数列になる', () => {
    expect(seededRandom(1)()).not.toBe(seededRandom(2)());
  });
});
