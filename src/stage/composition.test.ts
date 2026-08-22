import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANCHOR_CLASS,
  DEFAULT_ANCHOR,
  DEFAULT_SIZE,
  isAnchorName,
  isSizeName,
  resolveComposition,
  SIZE_CLASS,
} from './composition';
import { LAYOUT_CLASS } from './effects';
// Vite の ?raw で CSS を文字列として読む（lyric-sheets.test.ts が JSON でやっているのと同じ手）
import styleCss from '../style.css?raw';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 未知の名前は既定に落として警告する作りなので、黙らせないと出力が汚れる */
function silenceWarnings() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

describe('resolveComposition', () => {
  it('アンカーは縦と横の 2 枚のクラスに、大きさは 1 枚になる', () => {
    const { classes } = resolveComposition({ at: 'bottom-right', size: 'xl' });

    expect(classes).toStrictEqual([...ANCHOR_CLASS['bottom-right'], SIZE_CLASS.xl]);
  });

  it('指定が無ければ既定の構図になる', () => {
    // 開発用のシートと effect-preview.html がここに落ちる。
    // 本編シートは全行に構図を書く規約（lyric-sheets.test.ts が見張る）
    const { classes, vars } = resolveComposition(undefined);

    expect(classes).toStrictEqual([...ANCHOR_CLASS[DEFAULT_ANCHOR], SIZE_CLASS[DEFAULT_SIZE]]);
    expect(vars).toStrictEqual({});
  });

  it('ずらし幅は割合から百分率になる', () => {
    const { vars } = resolveComposition({
      at: 'top-left',
      size: 'md',
      nudge: { x: 0.07, y: -0.125 },
    });

    // 0.07 * 100 は 7.000000000000001 になるので、埃が残っていないことも見る
    expect(vars).toStrictEqual({ '--place-nudge-x': '7%', '--place-nudge-y': '-12.5%' });
  });

  it('書かなかった軸のカスタムプロパティは置かない', () => {
    // 置かないことで CSS 側の既定値（0%）が効く。ここで 0% を書き込むと、
    // 「指定しなかった」と「0 を指定した」が区別できなくなる
    const { vars } = resolveComposition({ at: 'top-left', size: 'md', nudge: { x: 0.05 } });

    expect(vars).toStrictEqual({ '--place-nudge-x': '5%' });
  });

  it('傾きは度の単位が付く', () => {
    const { vars } = resolveComposition({ at: 'middle-center', size: 'lg', tilt: -3 });

    expect(vars).toStrictEqual({ '--place-tilt': '-3deg' });
  });

  it('傾き 0 も指定として扱う', () => {
    // undefined との取り違えでよくある落とし穴。0 は「傾けない」という指定
    const { vars } = resolveComposition({ at: 'middle-center', size: 'lg', tilt: 0 });

    expect(vars).toStrictEqual({ '--place-tilt': '0deg' });
  });

  it('知らないアンカー名は既定に落ちて警告する', () => {
    // 投げないのは、シートの綴り間違い 1 つで作品が丸ごと出なくなるのを避けるため。
    // 綴りの間違いそのものは lyric-sheets.test.ts が名指しで落とす
    const warn = silenceWarnings();

    const { classes } = resolveComposition({ at: 'top-middle', size: 'md' });

    expect(classes).toStrictEqual([...ANCHOR_CLASS[DEFAULT_ANCHOR], SIZE_CLASS.md]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('知らない大きさの段階も既定に落ちて警告する', () => {
    const warn = silenceWarnings();

    const { classes } = resolveComposition({ at: 'top-left', size: 'huge' });

    expect(classes).toStrictEqual([...ANCHOR_CLASS['top-left'], SIZE_CLASS[DEFAULT_SIZE]]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('名前の判定', () => {
  it('Object.prototype 由来の名前を実在と誤認しない', () => {
    // effects.ts の isEffectName と同じ罠。単に ANCHOR_CLASS[name] と書くと
    // 'toString' や 'constructor' が真になり、クラス名の代わりに関数が渡る
    expect(isAnchorName('toString')).toBe(false);
    expect(isAnchorName('constructor')).toBe(false);
    expect(isSizeName('__proto__')).toBe(false);
  });

  it('実在する名前は通る', () => {
    expect(isAnchorName('middle-center')).toBe(true);
    expect(isSizeName('sm')).toBe(true);
  });
});

describe('レジストリ', () => {
  it('9 通りのアンカーがすべて別のクラスの組になる', () => {
    // 書き写しの間違いで 2 つのアンカーが同じ場所を指すと、画面を見ても
    // 「そういう構図なのか間違いなのか」が分からない
    const combinations = Object.values(ANCHOR_CLASS).map((pair) => pair.join(' '));

    expect(new Set(combinations).size).toBe(Object.keys(ANCHOR_CLASS).length);
  });

  it('既定の名前が実在する', () => {
    expect(isAnchorName(DEFAULT_ANCHOR)).toBe(true);
    expect(isSizeName(DEFAULT_SIZE)).toBe(true);
  });
});

describe('CSS との対応', () => {
  // レジストリは「名前 → クラス」の唯一の関門だが、**その先の対応関係は無防備**。
  // 'stage__frame--middl' と打ち間違えても型検査もテストも全部通り、起きるのは
  // 「position: absolute のまま offset が auto → 静的位置（左上）に出る」という、
  // 例外も警告も出ない壊れ方。ここで名前が CSS 側に実在することを見る。
  const declared = (className: string) =>
    // 「.クラス名」の直後がクラス名として続かない位置（-- で始まる別のクラスと区別する）
    new RegExp(`\\.${className}(?![\\w-])`).test(styleCss);

  const cases: [string, string][] = [
    ...Object.entries(ANCHOR_CLASS).flatMap(([name, pair]) =>
      pair.map((className): [string, string] => [`アンカー ${name}`, className]),
    ),
    ...Object.entries(SIZE_CLASS).map(([name, className]): [string, string] => [
      `大きさ ${name}`,
      className,
    ]),
    // レイアウト（effects.ts）も同じ穴を持つので併せて見る
    ...Object.entries(LAYOUT_CLASS).map(([name, className]): [string, string] => [
      `レイアウト ${name}`,
      className,
    ]),
  ];

  it.each(cases)('%s のクラス .%s が style.css にある', (_label, className) => {
    expect(declared(className)).toBe(true);
  });
});
