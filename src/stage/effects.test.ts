import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EFFECT, effects, resolveEffect, staggerFor } from './effects';

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
  it.each(Object.entries(effects))('%s は文字数が増えても総時間が伸びない', (_name, effect) => {
    const short = effect(dummyChars(30));
    const long = effect(dummyChars(500));

    expect(short.duration()).toBeGreaterThan(0);
    // 文字送りに上限があるので、長い行でも総時間は変わらない
    expect(long.duration()).toBeCloseTo(short.duration());

    // 作りっぱなしにすると gsap のグローバルなタイムラインに残り続ける
    short.kill();
    long.kill();
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
