import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EFFECT,
  effects,
  LAYOUT_CLASS,
  MAX_STAGGER_SPAN,
  REDUCED_MOTION_EFFECT,
  resolveEffect,
  staggerFor,
} from './effects';

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

/**
 * 演出に渡す一式。文字数だけ指定すれば足りる。
 *
 * root がただの空オブジェクトで済むのは、演出が DOM を触らないため
 * （レイアウトの切り替えは EffectDef の layout で宣言し、当てるのは LyricStage）。
 * gsap は要素でなくただのオブジェクトもトゥイーンできるので、これで長さは測れる。
 */
function dummyTarget(count: number) {
  return { root: {} as HTMLElement, chars: dummyChars(count) };
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
  it.each(Object.keys(effects))('%s は文字数が増えても総時間が頭打ちになる', (name) => {
    // レジストリには関数と { layout, build } の 2 通りが書けるので、
    // 表を直接引かず resolveEffect で形を揃えてから取り出す
    const { build } = resolveEffect(name);

    // 文字が 1 つなら staggerFor は 0 を返すので、文字送りが一切乗らない。
    // ＝トゥイーン単体の長さそのもの。2 つにすると希望の間隔が丸ごと 1 回分
    // 混ざり、そのぶん下の上限が緩んでしまう
    const single = build(dummyTarget(1));
    const huge = build(dummyTarget(500));
    // 500 で頭打ちなら、その 4 倍でも変わらないはず
    const huger = build(dummyTarget(2000));

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

  it('vertical は縦書きのレイアウトを要求する', () => {
    // 縦書きの見た目は CSS 側にあるので検証できないが、
    // 「演出がレイアウトの切り替えを要求したこと」までは確かめられる
    expect(resolveEffect('vertical').layout).toBe('vertical');
    expect(LAYOUT_CLASS.vertical).toBe('stage__text--vertical');
  });

  it('レイアウトを要求しない演出は layout が null になる', () => {
    // ここが null でないと LyricStage が余計なクラスを付けてしまう
    for (const name of [
      'fade',
      'typewriter',
      'bounce',
      'glitch',
      'zoom',
      'shatter',
      'zoomLine',
      'calm',
    ]) {
      expect(resolveEffect(name).layout, name).toBeNull();
    }
  });

  it('演出は DOM を触らない', () => {
    // レイアウトの切り替えは宣言に寄せたので、演出が root を汚すことはもう無い。
    // 触りにいったら「root は空オブジェクト」なので TypeError で落ちる
    for (const name of Object.keys(effects)) {
      const timeline = resolveEffect(name).build(dummyTarget(5));
      expect(timeline.duration()).toBeGreaterThan(0);
      timeline.kill();
    }
  });

  it('zoomLine は文字が 1 つも無くても組み立てられる', () => {
    // 行全体を動かす演出なので chars に依らない。
    // 文字を触る前提で書かれていたら、ここで落ちる
    const timeline = resolveEffect('zoomLine').build(dummyTarget(0));

    expect(timeline.duration()).toBeGreaterThan(0);

    timeline.kill();
  });
});

describe('resolveEffect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('名前が無ければ既定の演出を返す', () => {
    // undefined 同士で通ってしまわないよう、関数が返ることも確かめる
    expect(typeof resolveEffect(undefined).build).toBe('function');
    expect(resolveEffect(undefined).build).toBe(effects[DEFAULT_EFFECT]);
  });

  it('登録済みの名前はその演出を返す', () => {
    expect(resolveEffect('typewriter').build).toBe(effects.typewriter);
    expect(resolveEffect('bounce').build).toBe(effects.bounce);
    // { layout, build } で登録した演出も、同じ形で取り出せる
    expect(resolveEffect('vertical').build).toBe(effects.vertical.build);
  });

  it('未知の名前は警告して既定の演出に落とす', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(resolveEffect('存在しない演出').build).toBe(effects[DEFAULT_EFFECT]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('未知の名前ではレイアウトも当てない', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 既定は fade なので縦書きにはならない。ここが漏れると
    // 綴りを間違えた行だけ組み方が変わる、という分かりにくい不具合になる
    expect(resolveEffect('存在しない演出').layout).toBeNull();
  });

  it('Object.prototype 由来の名前を演出として拾わない', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 外部 JSON にこう書かれても、関数でないものを呼び出さないこと
    for (const name of ['__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
      expect(resolveEffect(name).build).toBe(effects[DEFAULT_EFFECT]);
    }
  });
});

describe('resolveEffect（動きを減らす設定）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 落とし先の演出に書いてよいもの。
   *
   * 「動かすプロパティ」を数え上げる形（x / scale / rotation …）にすると、
   * top や width のような数え漏れが素通りする。**書いてよいものを列挙する**方が
   * 「静かであること」という意図に一致し、抜け道が無い。
   * duration などの時間の指定は動きではないので許す。
   * parent / overwrite / runBackwards は gsap が自分で足す帳簿で、対象の見た目とは関係ない
   * （runBackwards は .from() の印）。
   */
  const CALM_PROPS = [
    'opacity',
    'duration',
    'ease',
    'delay',
    'parent',
    'overwrite',
    'runBackwards',
    'immediateRender',
  ];

  it('どの演出も calm に落ちる', () => {
    // レジストリ全体を回すので、動きの大きい演出を足しても検査の対象になる。
    // 比較先を resolveEffect 経由にしているのは、calm を { layout, build } 形式に
    // 変えたときに実装は正しいのにここだけ落ちる、を避けるため
    const calm = resolveEffect(REDUCED_MOTION_EFFECT).build;

    for (const name of Object.keys(effects)) {
      expect(resolveEffect(name, { reducedMotion: true }).build, name).toBe(calm);
    }
  });

  it('未指定・未知の名前でも calm に落ちる', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calm = resolveEffect(REDUCED_MOTION_EFFECT).build;

    expect(resolveEffect(undefined, { reducedMotion: true }).build).toBe(calm);
    expect(resolveEffect('存在しない演出', { reducedMotion: true }).build).toBe(calm);
  });

  it('未知の名前の警告に実際の落とし先が出る', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    resolveEffect('存在しない演出', { reducedMotion: true });

    // 「既定の fade を使います」と出すと、実際には calm で表示されているのに
    // 綴りの間違いを調べている人を誤導する
    expect(warn.mock.calls[0][0]).toContain(REDUCED_MOTION_EFFECT);
    expect(warn.mock.calls[0][0]).not.toContain(DEFAULT_EFFECT);
  });

  it('レイアウトは落とさない', () => {
    // writing-mode は動きではなくレイアウトの指定。動きを減らす設定でも
    // 縦書きは縦書きのまま読めるべきで、ここを一緒に落とすと縦書き前提で決めた
    // 文字サイズや段組み（style.css）ごと外れてしまう。
    // レジストリ全体を回すので、レイアウトの種類が増えても追従する
    for (const name of Object.keys(effects)) {
      expect(resolveEffect(name, { reducedMotion: true }).layout, name).toBe(
        resolveEffect(name).layout,
      );
    }
  });

  it('落とし先の演出は動きを持たない', () => {
    // 「calm に落ちている」だけでは、その calm がいつの間にか動くようになっても
    // 気付けない。落とし先そのものが動かないことを別に押さえる
    const timeline = resolveEffect('shatter', { reducedMotion: true }).build(dummyTarget(5));

    const used = timeline.getChildren().flatMap((child) => Object.keys(child.vars));

    // 中身を読めていることをまず確かめる。getChildren() が空を返していると
    // 「動かすプロパティが 1 つも無い」が素通りしてしまう
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((prop) => !CALM_PROPS.includes(prop))).toStrictEqual([]);
    expect(timeline.duration()).toBeGreaterThan(0);

    timeline.kill();
  });

  it('設定を渡さない呼び出しの意味が変わっていない', () => {
    // 第 2 引数の追加が既存の経路に影響していないこと。
    // 全件回すので、レジストリが増えても主張の範囲が狭まらない
    for (const name of Object.keys(effects)) {
      expect(resolveEffect(name, { reducedMotion: false }).build, name).toBe(
        resolveEffect(name).build,
      );
    }
  });
});
