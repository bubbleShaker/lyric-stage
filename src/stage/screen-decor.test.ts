import { describe, expect, it } from 'vitest';
import {
  markClassName,
  MARK_EDGES,
  SCREEN_DECOR_CLASS,
  SCREEN_DECOR_GRID_CLASS,
  SCREEN_DECOR_MARK_CLASS,
  SCREEN_MARKS,
  type MarkEdge,
} from './screen-decor';
// Vite の ?raw で CSS を文字列として読む（decor.test.ts / palette.test.ts と同じ手）
import styleCss from '../style.css?raw';

/** 上下の辺。隅は必ず「上下のどちらか」と「左右のどちらか」を 1 つずつ取る */
const UP_DOWN_EDGES: readonly MarkEdge[] = ['top', 'bottom'];

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

  it.each(SCREEN_MARKS)('$className は上下と左右を 1 辺ずつ取る', (mark) => {
    // 「4 つとも違う組」だけでは、['top', 'bottom'] のような**隅ではない組**が通る
    // （レビュー指摘 🟡）。CSS 側は top: と bottom: を両方持つのでマークが縦に伸びる
    const upDown = mark.edges.filter((edge) => UP_DOWN_EDGES.includes(edge));

    expect(upDown).toHaveLength(1);
  });

  it.each(SCREEN_MARKS)('$className の名前と辺が一致する', (mark) => {
    // 検査が突き合わせるのは「定数 ↔ CSS」なので、名前の方は無防備だった
    // （レビュー指摘 🟡）。--top-right に edges: ['top', 'left'] と書いて CSS も
    // それに合わせると、**全部緑のままかぎ括弧が内側を向く**
    for (const edge of mark.edges) {
      expect(mark.className).toContain(edge);
    }
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
    const drawn = MARK_EDGES.filter((edge) => new RegExp(`border-${edge}-width\\s*:`).test(body));

    expect(drawn.sort()).toStrictEqual([...mark.edges].sort());
  });

  it.each(SCREEN_MARKS)('$className は自分の 2 辺を基準に置かれる', (mark) => {
    // 線を引く辺と置き場所がずれると、右上のかぎ括弧が左下に出る。
    // border-top-width と紛れないよう、宣言の頭に来る top: だけを見る
    const body = rulesFor(mark.className).join('\n');
    const anchored = MARK_EDGES.filter((edge) => new RegExp(`(^|[;{\\s])${edge}\\s*:`).test(body));

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
