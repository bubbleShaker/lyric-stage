/**
 * 画面に敷く図形（M8-3b / Issue #45）— 三分割の分割線と四隅のマーク。
 *
 * M8-3a（`decor.ts`）が**語句に貼り付く**図形だったのに対し、こちらは**画面そのもの**に
 * 貼り付く。語句と一緒に動かないので、シートに口は無い（データを持たない）。
 * 置く仕組みだけがここにある。
 *
 * ## なぜ DOM で、なぜ実要素か
 *
 * 画面座標に対して静的なので canvas にも描ける。それでも DOM に置くのは、
 * `Backdrop` の実装がどれも自分で `clearRect` を呼ぶため — 素直に 2 つ並べると
 * 後の層が前を消す（#41 のレビュー指摘 🟡）。「背景（canvas）と図形（DOM）を
 * 役割で分ける」という #43 の線にそのまま乗せる。
 *
 * 擬似要素（`.stage::before`）にすれば JS は一切要らないが、**GSAP は擬似要素を
 * 直接動かせない**（#43 で実要素を選んだのと同じ理由）。M8-4（ビート同期の衝撃 =
 * フラッシュ・画面揺れ）が叩く先はまさにこの画面の図形なので、掴める形で置く。
 *
 * ## クラス名は定数で持つ
 *
 * `index.html` に直書きすれば JS ゼロで済むが、`effect-preview.html` にも同じものが
 * 要る（#41 で「歌詞と一緒に見えないと密度を判断できない」と決めた）ので、
 * マークアップが 2 か所に増える。関数にすれば呼ぶのは 1 行で、副産物として
 * クラス名が定数になり `style.css` への実在を検査できる（`decor.test.ts` と同じ手）。
 */

/** 図形をまとめて載せる固定レイヤー。色と四隅の余白はここが配る */
export const SCREEN_DECOR_CLASS = 'screen-decor';

/**
 * 三分割の分割線。**全面の方眼グリッドは採らなかった**（Issue #45）。
 *
 * 線の本数が多いと背景の粒（`GrainField`）と競り、極太 900 の文字の後ろが賑やかになる。
 * 縦横それぞれ 2 本だけなら、構図（M8-1 のアンカー 9 種）が何を基準に置かれているかを
 * 示すだけで済む。
 */
export const SCREEN_DECOR_GRID_CLASS = 'screen-decor__grid';

/** 四隅のマークが共通で持つクラス（大きさ・線の太さ・色） */
export const SCREEN_DECOR_MARK_CLASS = 'screen-decor__mark';

/**
 * マークが線を引きうる 4 辺。位置の指定にもそのまま使う。
 *
 * 型を列から導いているのは、**辺を増やしたときに検査が静かに片肺にならない**ため
 * （レビュー指摘 🟡）。列と型を別々に書くと、`screen-decor.test.ts` の走査だけが
 * 古い 4 辺を見たまま緑になる。
 */
export const MARK_EDGES = ['top', 'right', 'bottom', 'left'] as const;

export type MarkEdge = (typeof MARK_EDGES)[number];

export interface ScreenMark {
  /** 隅ごとのクラス。位置と、どちらの辺に線を引くかを持つ */
  readonly className: string;
  /**
   * その隅が線を引く 2 辺（縦の辺 1 つ + 横の辺 1 つ）。**`style.css` と対で守る値。**
   *
   * 写し間違えて `top-right` が左の辺を引くと、かぎ括弧が内側を向く。
   * 4 つ並んでいると向きの違いは目で追いにくいので、`screen-decor.test.ts` が
   * 「その隅の規則が、この 2 辺だけを引いているか」を見る。
   *
   * **クラス名との整合も検査する**（レビュー指摘 🟡）。CSS と揃えて書き換えれば
   * `--top-right` が左の辺を引く形も全部緑で通ってしまうので、名前に出ている辺と
   * ここの辺が一致していることを別途見る。
   */
  readonly edges: readonly [MarkEdge, MarkEdge];
}

export const SCREEN_MARKS = [
  { className: 'screen-decor__mark--top-left', edges: ['top', 'left'] },
  { className: 'screen-decor__mark--top-right', edges: ['top', 'right'] },
  { className: 'screen-decor__mark--bottom-right', edges: ['bottom', 'right'] },
  { className: 'screen-decor__mark--bottom-left', edges: ['bottom', 'left'] },
] as const satisfies readonly ScreenMark[];

/**
 * 隅ごとのマークに当てる class 属性の中身。
 *
 * **基底のクラスを必ず併せて付ける**ための 1 か所。付け忘れると
 * `position: absolute` が落ちて、4 つのマークが通常の流れで左上に積み重なる
 * （`decor.ts` の `DECOR_BASE_CLASS` が持つのと同じ危うさ）。
 * 組み立ての DOM は検査できない（jsdom 未導入）が、ここは純粋なので検査できる。
 */
export function markClassName(mark: ScreenMark): string {
  return `${SCREEN_DECOR_MARK_CLASS} ${mark.className}`;
}

/**
 * 図形のレイヤーを組み立てて `parent` の末尾に足す。
 *
 * **重なりは `z-index` が決める**（`style.css`）。このレイヤーが `-1`、背景の canvas が
 * `-2`、歌詞は段を持たない（負の段より必ず手前）。**`append` する順には依存しない** —
 * 当初はどちらも `-1` にして「canvas より後に敷く」ことに委ねていたが、破れても
 * 例外も検査の赤も出ず分割線が粒の下に沈むだけなので、順序を宣言の側へ移した
 * （レビュー指摘 🟡）。`.stage` の中に入れないのは、あちらが
 * 「中の要素はすべて absolute である前提」で組まれているため（`style.css`）。
 *
 * 返り値はレイヤーそのもの。M8-4 でここを叩くときの取っ手になる。
 */
export function mountScreenDecor(parent: Element): HTMLElement {
  // 要素は parent の文書から作る。document を直に参照すると、別の文書
  // （テストの偽物や iframe）に組み立てられなくなる
  const doc = parent.ownerDocument;

  const layer = doc.createElement('div');
  layer.className = SCREEN_DECOR_CLASS;
  // 装飾でしかないので支援技術からは隠す（背景の canvas と同じ扱い）
  layer.setAttribute('aria-hidden', 'true');

  const grid = doc.createElement('span');
  grid.className = SCREEN_DECOR_GRID_CLASS;
  layer.append(grid);

  for (const mark of SCREEN_MARKS) {
    const element = doc.createElement('span');
    element.className = markClassName(mark);
    layer.append(element);
  }

  parent.append(layer);

  return layer;
}
