import { afterEach, describe, expect, it, vi } from 'vitest';
import { DECOR_LAYOUT_CLASS, decors, isDecorName, resolveDecor } from './decor';
// Vite の ?raw で CSS を文字列として読む（composition.test.ts と同じ手）
import styleCss from '../style.css?raw';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 知らない名前は警告して落とす作りなので、黙らせないと出力が汚れる */
function silenceWarnings() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

/**
 * 図形の当て先。gsap は要素でなくただのオブジェクトも動かせるので、
 * ブラウザ無しで「何がどこまで書かれるか」を読める（effects.test.ts と同じ手）。
 */
function dummyDecor() {
  return {} as unknown as HTMLElement;
}

/** 組み立てたタイムラインを time 秒まで進めて、当て先に書かれた値を読む */
function growAt(build: ReturnType<typeof resolveDecor>[number]['build'], time: number) {
  const element = dummyDecor();
  const timeline = build(element).pause();
  // **一度だけ余計に動かしてから目的の時刻へ。** gsap は playhead が動いていない
  // タイムラインを描き直さないので、組み立て直後の time(0) は何も書かない
  // （本番では buildLineTimeline が親のタイムラインで同じことをしている）
  timeline.time(time + 0.0001).time(time);
  const value = Number((element as unknown as Record<string, unknown>)['--decor-grow']);
  timeline.kill();

  return value;
}

describe('resolveDecor', () => {
  it('名前の列がそのままクラスの列になる', () => {
    const resolved = resolveDecor(['band', 'rule']);

    expect(resolved.map((entry) => entry.className)).toStrictEqual([
      decors.band.className,
      decors.rule.className,
    ]);
  });

  it('指定が無ければ何も返さない', () => {
    // 演出（resolveEffect）と違い、**既定の図形は無い**。帯と枠のどちらを
    // 意図したかは名前でしか分からないので、適当な図形を出すより出さない方がよい
    expect(resolveDecor([])).toStrictEqual([]);
  });

  it('知らない名前は落として警告する', () => {
    // 投げないのは、シートの綴り間違い 1 つで作品が丸ごと出なくなるのを避けるため。
    // 綴りの間違いそのものは lyric-sheets.test.ts が名指しで落とす
    const warn = silenceWarnings();

    const resolved = resolveDecor(['band', 'bnad']);

    expect(resolved.map((entry) => entry.className)).toStrictEqual([decors.band.className]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('進み具合を 0 から 1 へ動かす', () => {
    const [band] = resolveDecor(['band']);

    expect(growAt(band.build, 0)).toBe(0);
    expect(growAt(band.build, 10)).toBe(1);
  });

  it('動きを減らす設定では、図形は残して伸びる過程だけを飛ばす', () => {
    // #41 で粒と光を消さずに時刻を 0 に畳んだのと同じ判断。図形は構図の一部で、
    // 消すと画が別物になる
    const [band] = resolveDecor(['band'], { reducedMotion: true });

    expect(band.className).toBe(decors.band.className);
    // 時刻 0 の時点で出来上がっている（＝伸びる動きが無い）
    expect(growAt(band.build, 0)).toBe(1);
  });
});

describe('名前の判定', () => {
  it('Object.prototype 由来の名前を実在と誤認しない', () => {
    // effects.ts の isEffectName / composition.ts の isAnchorName と同じ罠
    expect(isDecorName('toString')).toBe(false);
    expect(isDecorName('constructor')).toBe(false);
    expect(isDecorName('__proto__')).toBe(false);
  });

  it('実在する名前は通る', () => {
    expect(isDecorName('band')).toBe(true);
  });
});

describe('レジストリ', () => {
  it('図形ごとに別のクラスが当たる', () => {
    // 書き写しの間違いで 2 つの図形が同じクラスを指すと、シートには
    // 別の名前を書いているのに画は同じという、読んでも分からない状態になる
    const classes = Object.values(decors).map((entry) => entry.className);

    expect(new Set(classes).size).toBe(classes.length);
  });
});

describe('CSS との対応', () => {
  // レジストリは「名前 → クラス」の唯一の関門だが、**その先の対応関係は無防備**。
  // 'stage__decor--bnad' と打ち間違えても型検査もテストも全部通り、起きるのは
  // 「図形だけが出ない」という例外も警告も出ない壊れ方（M8-1 のレビュー指摘と同じ穴）。
  const declared = (className: string) =>
    // 「.クラス名」の直後がクラス名として続かない位置（-- で始まる別のクラスと区別する）
    new RegExp(`\\.${className}(?![\\w-])`).test(styleCss);

  const cases: [string, string][] = [
    ...Object.entries(decors).map(([name, entry]): [string, string] => [`図形 ${name}`, entry.className]),
    ...Object.entries(DECOR_LAYOUT_CLASS).map(([name, className]): [string, string] => [
      `組み方 ${name}`,
      className,
    ]),
  ];

  it.each(cases)('%s のクラス .%s が style.css にある', (_label, className) => {
    expect(declared(className)).toBe(true);
  });

  it('図形はどれも進み具合を読んでいる', () => {
    // JS 側は --decor-grow を動かすだけで、それが何を意味するかは CSS が決める
    // （伸びる向きは組み方で変わるので、両方に書くと同じ判断が 2 か所になる）。
    // CSS 側が読み忘れると、**タイムラインは動いているのに画は静止したまま**という
    // 壊れ方になる。クラスごとに、その規則の中で --decor-grow が使われているか見る
    const missing = Object.values(decors)
      .map((entry) => entry.className)
      .filter((className) => !rulesFor(className).some((body) => body.includes('--decor-grow')));

    expect(missing).toStrictEqual([]);
  });

  /** そのクラスを含むセレクタの規則の中身を集める */
  function rulesFor(className: string): string[] {
    const pattern = new RegExp(`([^{}]*\\.${className}(?![\\w-])[^{}]*)\\{([^}]*)\\}`, 'g');

    return [...styleCss.matchAll(pattern)].map(([, , body]) => body);
  }
});
