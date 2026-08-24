import { describe, expect, it } from 'vitest';
import {
  markClassName,
  SCREEN_DECOR_CLASS,
  SCREEN_DECOR_GRID_CLASS,
  SCREEN_DECOR_MARK_CLASS,
  SCREEN_MARKS,
  type MarkEdge,
} from './screen-decor';
// Vite の ?raw でファイルを文字列として読む（decor.test.ts / palette.test.ts と同じ手）
import styleCss from '../style.css?raw';
import mainTs from '../main.ts?raw';

const EDGES: readonly MarkEdge[] = ['top', 'right', 'bottom', 'left'];

describe('四隅のマーク', () => {
  it('隅ごとに別のクラスが当たる', () => {
    const classes = SCREEN_MARKS.map((mark) => mark.className);

    expect(new Set(classes).size).toBe(classes.length);
  });

  it('四隅を 1 つずつ持つ', () => {
    // 写し間違いで同じ隅が 2 つになると、反対側の隅だけが抜けた画になる
    const corners = SCREEN_MARKS.map((mark) => [...mark.edges].sort().join('-'));

    expect(new Set(corners).size).toBe(SCREEN_MARKS.length);
  });

  it('class 属性には基底のクラスも入る', () => {
    // 付け忘れると position: absolute が落ち、4 つが通常の流れで左上に積み重なる
    const [first] = SCREEN_MARKS;

    expect(markClassName(first).split(' ')).toStrictEqual([
      SCREEN_DECOR_MARK_CLASS,
      first.className,
    ]);
  });
});

describe('CSS との対応', () => {
  // **コメントを落としてから走査する。** このリポジトリはコメントでクラス名を
  // 書くので、素で見ると「説明を 1 行足しただけで緑になる」（decor.test.ts と同じ手当て）
  const css = styleCss.replace(/\/\*[\s\S]*?\*\//g, '');

  const declared = (className: string) =>
    // 「.クラス名」の直後がクラス名として続かない位置（-- で始まる別のクラスと区別する）
    new RegExp(`\\.${className}(?![\\w-])`).test(css);

  /** そのクラスを含むセレクタの規則の中身を集める */
  const rulesFor = (className: string): string[] => {
    const pattern = new RegExp(`([^{}]*\\.${className}(?![\\w-])[^{}]*)\\{([^}]*)\\}`, 'g');

    return [...css.matchAll(pattern)].map(([, , body]) => body);
  };

  const cases: [string, string][] = [
    ['レイヤー', SCREEN_DECOR_CLASS],
    ['分割線', SCREEN_DECOR_GRID_CLASS],
    ['マークの基底', SCREEN_DECOR_MARK_CLASS],
    ...SCREEN_MARKS.map((mark): [string, string] => [`マーク ${mark.className}`, mark.className]),
  ];

  it.each(cases)('%s のクラス .%s が style.css にある', (_label, className) => {
    // クラス名は定数だが、その先の対応関係は無防備。打ち間違えても型検査も
    // 全テストも通り、起きるのは「その図形だけが出ない」という例外も警告も出ない
    // 壊れ方（M8-1 のレビュー指摘と同じ穴）
    expect(declared(className)).toBe(true);
  });

  it.each(SCREEN_MARKS)('$className は自分の 2 辺だけに線を引く', (mark) => {
    // 写し間違えて top-right が左の辺を引くとかぎ括弧が内側を向くが、
    // 4 つ並んでいると向きの違いは目で追いにくい
    const body = rulesFor(mark.className).join('\n');
    const drawn = EDGES.filter((edge) => new RegExp(`border-${edge}-width\\s*:`).test(body));

    expect(drawn.sort()).toStrictEqual([...mark.edges].sort());
  });

  it.each(SCREEN_MARKS)('$className は自分の 2 辺を基準に置かれる', (mark) => {
    // 線を引く辺と置き場所がずれると、右上のかぎ括弧が左下に出る。
    // border-top-width と紛れないよう、宣言の頭に来る top: だけを見る
    const body = rulesFor(mark.className).join('\n');
    const anchored = EDGES.filter((edge) => new RegExp(`(^|[;{\\s])${edge}\\s*:`).test(body));

    expect(anchored.sort()).toStrictEqual([...mark.edges].sort());
  });

  it('マークの色はレイヤーから流れてくる', () => {
    // 隅ごとの規則が色を持たないので、レイヤーが currentColor の出どころになる。
    // ここが欠けるとマークが body の文字色（--stage-ink）で描かれ、画面の四隅に
    // 歌詞と同じ明度の線が出る（palette.test.ts は 16 進の直書きしか見ない）
    const body = rulesFor(SCREEN_DECOR_CLASS).join('\n');

    expect(body).toMatch(/color\s*:\s*var\(--stage-mute\)/);
  });
});

describe('本編への配線', () => {
  it('main.ts が図形を敷いている', () => {
    // この 1 行が消えても、型検査もほかの検査も全部緑のまま**画面から図形だけが
    // 消える**（M8-3a で「作品のどこかに図形が置かれている」を検査にしたのと同じ穴）。
    // 配線そのものは DOM が要って検査できないので、呼んでいることだけを見る
    expect(mainTs).toMatch(/mountScreenDecor\(/);
  });
});
