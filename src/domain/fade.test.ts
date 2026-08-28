import { describe, expect, it } from 'vitest';
import { createFadeCurve } from './fade';

/** 本編と同じ形（39.07 秒の区間に 3 拍 / 2 拍） */
const LENGTH = 39.07;
const SPANS = { in: 2.254, out: 1.503 };

describe('createFadeCurve', () => {
  const level = createFadeCurve(LENGTH, SPANS);

  it('頭は隠れている', () => {
    expect(level(0)).toBe(0);
  });

  it('頭のフェードが明けたら素の画', () => {
    expect(level(SPANS.in)).toBe(1);
    expect(level(LENGTH / 2)).toBe(1);
  });

  it('頭のフェードの途中は単調に増える', () => {
    const samples = [0.2, 0.6, 1.2, 1.8, 2.2].map(level);

    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
    expect(Math.max(...samples)).toBeLessThan(1);
  });

  it('終わりに向かって単調に減り、終端で 0 になる', () => {
    const samples = [LENGTH - 1.2, LENGTH - 0.8, LENGTH - 0.3].map(level);

    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeLessThan(samples[i - 1]);
    }
    expect(level(LENGTH - SPANS.out)).toBe(1);
    expect(level(LENGTH)).toBe(0);
  });

  it('区間の外へ出ても 0〜1 から外れない', () => {
    // 終端で止め損ねたときに音量が負になる（＝要素への代入が例外になる）のを防ぐ
    for (const time of [-5, -0.001, LENGTH + 0.5, LENGTH * 3]) {
      expect(level(time)).toBe(0);
    }
  });

  it('時刻が数でなくても隠れている側に落とす', () => {
    // NaN は比較をすべてすり抜けるので、素通りさせると「画は明るいまま・
    // 音は鳴りっぱなし」で貼り付く
    expect(level(NaN)).toBe(0);
  });

  it('曲を丸ごと流す区間（長さが無限）でも頭のフェードは働く', () => {
    // ?lyrics=sample は WHOLE_SONG で見る。尻のフェードは終わりが無いので効かない
    const whole = createFadeCurve(Infinity, SPANS);

    expect(whole(0)).toBe(0);
    expect(whole(SPANS.in / 2)).toBeCloseTo(0.5);
    expect(whole(SPANS.in)).toBe(1);
    expect(whole(100_000)).toBe(1);
  });

  it('書かない側（長さ 0）は素の画のまま', () => {
    const onlyOut = createFadeCurve(LENGTH, { in: 0, out: 1.5 });

    // 0 除算で NaN を作らないこと。頭から素の画で始まる。
    // **時刻 0 も含めて見る**（レビュー指摘 🟡）— 0 は再生前にずっと居座る状態なので、
    // ここだけ隠れた側に落ちると「読み込み中は真っ暗 → 1 フレーム目に突然明るくなる」
    expect(onlyOut(0)).toBe(1);
    expect(onlyOut(0.001)).toBe(1);
    expect(onlyOut(LENGTH)).toBe(0);
  });

  it('区間に収まらない長さは組み立てた瞬間に落ちる', () => {
    // 明ける前に暮れ始める＝素の画がどこにも無い作品。値の書き間違いでしか
    // 起きないので、画を見て気付くより起動時に落ちる方がよい
    expect(() => createFadeCurve(3, { in: 2, out: 2 })).toThrow();
    expect(() => createFadeCurve(0, { in: 0, out: 0 })).toThrow();
    expect(() => createFadeCurve(LENGTH, { in: -1, out: 1 })).toThrow();
    expect(() => createFadeCurve(LENGTH, { in: 1, out: NaN })).toThrow();
    // 長さが無限の区間では in + out の比較を素通りするので、別に締める
    expect(() => createFadeCurve(Infinity, { in: Infinity, out: 1 })).toThrow();
  });
});
