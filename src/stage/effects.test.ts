import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EFFECT, effects, MAX_STAGGER_SPAN, resolveEffect, staggerFor } from './effects';

/**
 * 文字要素の代わりに渡すダミー。gsap は要素でなくただのオブジェクトも
 * トゥイーンできるので、ブラウザ無しでタイムラインの長さを検証できる。
 *
 * ただしダミーには CSS プラグインが働かないため、**ここで検証できるのは
 * 時間の組み立てだけ**。yPercent の綴りを間違えても、この検証は通ってしまう。
 * 見た目そのものは effect-preview.html を目で見て確かめる。
 */
function dummyChars(count: number): Element[] {
  return Array.from({ length: count }, () => ({ opacity: 1 }) as unknown as Element);
}

describe('staggerFor', () => {
  it('文字が 1 つ以下なら遅延は無い', () => {
    expect(staggerFor(0, 0.08)).toBe(0);
    expect(staggerFor(1, 0.08)).toBe(0);
  });

  it('短い行では希望どおりの間隔を使う', () => {
    expect(staggerFor(5, 0.08)).toBeCloseTo(0.08);
  });

  it('長い行では合計が頭打ちになる', () => {
    const count = 40;
    const stagger = staggerFor(count, 0.08);

    expect(stagger).toBeLessThan(0.08);
    expect(stagger * (count - 1)).toBeCloseTo(0.8);
  });
});

describe('effects', () => {
  // 演出を足すと自動でこの検査の対象になる（Object.entries で引いているため）。
  // 実際の行間隔に間に合うかどうかは、歌詞シートの実データと突き合わせて
  // src/lyric-sheets.test.ts で見る。ここでは演出単体の性質だけを押さえる。
  it.each(Object.entries(effects))('%s は文字数が増えても総時間が頭打ちになる', (_name, effect) => {
    // 文字が 1 つなら staggerFor は 0 を返すので、文字送りが一切乗らない。
    // ＝トゥイーン単体の長さそのもの。2 つにすると希望の間隔が丸ごと 1 回分
    // 混ざり、そのぶん下の上限が緩んでしまう
    const single = effect(dummyChars(1));
    const huge = effect(dummyChars(500));
    // 500 で頭打ちなら、その 4 倍でも変わらないはず
    const huger = effect(dummyChars(2000));

    expect(single.duration()).toBeGreaterThan(0);

    // (1) 文字送りの合計には上限があるので、文字が何個あっても
    //     総時間は「トゥイーン単体の長さ + 上限」を超えない。
    //     「長い行と短い行の総時間が一致すること」で確かめると、希望の間隔が狭い演出
    //     （短い行では上限に届かない）を足したときに、作りは正しいのに落ちてしまう
    expect(huge.duration()).toBeLessThanOrEqual(single.duration() + MAX_STAGGER_SPAN + 0.001);

    // (2) 上限を「超えない」だけだと、希望の間隔を極端に狭く書いた演出
    //     （staggerFor を通し忘れた実装など）が素通りしてしまう。文字数を増やしても
    //     総時間が変わらない＝本当に頭打ちになっていることまで確かめる
    expect(huger.duration()).toBeCloseTo(huge.duration());

    // 作りっぱなしにすると gsap のグローバルなタイムラインに残り続ける
    single.kill();
    huge.kill();
    huger.kill();
  });
});

describe('resolveEffect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('名前が無ければ既定の演出を返す', () => {
    // undefined 同士で通ってしまわないよう、関数が返ることも確かめる
    expect(typeof resolveEffect(undefined)).toBe('function');
    expect(resolveEffect(undefined)).toBe(effects[DEFAULT_EFFECT]);
  });

  it('登録済みの名前はその演出を返す', () => {
    expect(resolveEffect('typewriter')).toBe(effects.typewriter);
    expect(resolveEffect('bounce')).toBe(effects.bounce);
  });

  it('未知の名前は警告して既定の演出に落とす', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(resolveEffect('存在しない演出')).toBe(effects[DEFAULT_EFFECT]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('Object.prototype 由来の名前を演出として拾わない', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 外部 JSON にこう書かれても、関数でないものを呼び出さないこと
    for (const name of ['__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
      expect(resolveEffect(name)).toBe(effects[DEFAULT_EFFECT]);
    }
  });
});
