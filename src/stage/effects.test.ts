import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EFFECT, effects, resolveEffect, staggerFor } from './effects';

/**
 * 演出は gsap のタイムラインを組み立てるだけで DOM を触らないので、
 * ブラウザ無しで検証できる。gsap は要素でなくただのオブジェクトも
 * トゥイーンできるため、文字要素の代わりにダミーを渡している。
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
  // 本編の行間隔は最短 2.25 秒。どの演出も、文字数が最も多い行（28 文字）で
  // それより短く終わらないと、出揃う前に次の行へ切り替わってしまう。
  const SHORTEST_LINE_INTERVAL = 2.25;

  it.each(Object.keys(effects))('%s は最長の行でも行間隔より早く終わる', (name) => {
    const timeline = effects[name](dummyChars(28));

    expect(timeline.duration()).toBeGreaterThan(0);
    expect(timeline.duration()).toBeLessThan(SHORTEST_LINE_INTERVAL);

    // 作りっぱなしにすると gsap のグローバルなタイムラインに残り続ける
    timeline.kill();
  });
});

describe('resolveEffect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('名前が無ければ既定の演出を返す', () => {
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
