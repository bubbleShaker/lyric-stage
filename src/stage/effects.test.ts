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
    // 文字が 2 つなら staggerFor は希望どおりの間隔を返すが、掛かる回数が 1 回なので
    // 文字送りはほぼ効かない。ここを「トゥイーン単体の長さ」の目安として使う
    const minimal = effect(dummyChars(2));
    const huge = effect(dummyChars(500));

    expect(minimal.duration()).toBeGreaterThan(0);
    // 文字送りの合計には上限があるので、文字が何個あっても
    // 総時間は「トゥイーン単体の長さ + 上限」を超えない。
    // 「長い行と短い行の総時間が一致すること」で確かめると、希望の間隔が狭い演出
    // （短い行では上限に届かない）を足したときに、作りは正しいのに落ちてしまう
    expect(huge.duration()).toBeLessThanOrEqual(minimal.duration() + MAX_STAGGER_SPAN + 0.001);

    // 作りっぱなしにすると gsap のグローバルなタイムラインに残り続ける
    minimal.kill();
    huge.kill();
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
