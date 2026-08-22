import type { LyricPlacement } from '../domain/lyrics';

/**
 * 行の構図（`LyricPlacement`）を、画面に当てられる形に翻訳する。
 *
 * `effects.ts` と同じ分担で書いている — シートには**名前**だけを書き、
 * 「その名前が実在するか」と「どんな見た目になるか」はこちらが持つ。
 * domain（`lyrics.ts`）は形しか検証しないので、CSS の語彙を知らずに済む。
 *
 * 実際の位置や大きさの値は持たない。**すべて CSS クラスに預けている**（中身は
 * `src/style.css`）。ここが返すのは「どのクラスを当てるか」と、割合で書かれた
 * 微調整をカスタムプロパティに直したものだけ。
 *
 * 当てる先は行そのものではなく、**その外側の枠**（`.stage__frame`）。GSAP は
 * 行の要素の transform を自分のものとして扱うので、構図を同じ要素に置くと
 * 前の行の寄せ方が残ってしまう。触る人を分けている。
 */

/** 名前付きのアンカー。基準点を画面のどこに取るか */
export type AnchorName =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/**
 * アンカーが当てる CSS クラス。**縦と横の 2 枚に分けている。**
 *
 * 9 通りを 9 つのクラスで書くと、端の余白のような同じ値が 9 か所に散り、
 * 詰めたくなった時に直し漏れる。縦の位置と横の位置は独立に決まるので、
 * 6 つのクラスの組み合わせで表す。
 */
export const ANCHOR_CLASS: Record<AnchorName, readonly [string, string]> = {
  'top-left': ['stage__frame--top', 'stage__frame--left'],
  'top-center': ['stage__frame--top', 'stage__frame--center'],
  'top-right': ['stage__frame--top', 'stage__frame--right'],
  'middle-left': ['stage__frame--middle', 'stage__frame--left'],
  'middle-center': ['stage__frame--middle', 'stage__frame--center'],
  'middle-right': ['stage__frame--middle', 'stage__frame--right'],
  'bottom-left': ['stage__frame--bottom', 'stage__frame--left'],
  'bottom-center': ['stage__frame--bottom', 'stage__frame--center'],
  'bottom-right': ['stage__frame--bottom', 'stage__frame--right'],
};

/**
 * 文字の大きさの段階。
 *
 * 行**単位**の緩急だけを持つ。1 行の中で一部だけ大きくするのは M8-3 以降
 * （SplitText の words を EffectTarget に足す話）。
 */
export type SizeName = 'sm' | 'md' | 'lg' | 'xl';

export const SIZE_CLASS: Record<SizeName, string> = {
  sm: 'stage__frame--sm',
  md: 'stage__frame--md',
  lg: 'stage__frame--lg',
  xl: 'stage__frame--xl',
};

/**
 * 構図の指定が無い行に使う既定。
 *
 * 本編シートは全行に構図を書く規約（`src/lyric-sheets.test.ts` が見張る）なので、
 * ここに落ちるのは開発用のシートと `effect-preview.html` だけ。
 *
 * 置き場所は M8-1 より前と同じ「中央に 1 行」。大きさは `lg` で、
 * 前（`clamp(1.75rem, 7vw, 5rem)`）より**やや大きめ**に寄せてある
 * （`lg` は `1.45 × clamp(1.5rem, 5.5vw, 3.6rem)`＝狭い画面で 2 割ほど大きい）。
 */
export const DEFAULT_ANCHOR: AnchorName = 'middle-center';
export const DEFAULT_SIZE: SizeName = 'lg';

/** 当てるものと外すもの。両方を 1 つの値にまとめて LyricStage に渡す */
export interface Composition {
  /** 当てる CSS クラス。外すときも同じ配列を使う */
  readonly classes: readonly string[];
  /** インラインで置くカスタムプロパティ。外すときは同じキーを消す */
  readonly vars: Readonly<Record<string, string>>;
}

export function isAnchorName(name: string): name is AnchorName {
  // Object.hasOwn で自前のキーだけを見る（effects.ts の isEffectName と同じ理由）
  return Object.hasOwn(ANCHOR_CLASS, name);
}

export function isSizeName(name: string): name is SizeName {
  return Object.hasOwn(SIZE_CLASS, name);
}

/**
 * 構図の指定から「当てるクラス」と「置くカスタムプロパティ」を作る。
 *
 * 知らない名前は既定に落として警告する（`resolveEffect` と同じ振る舞い）。
 * 落とさずに投げると、シートの綴り間違い 1 つで作品が丸ごと出なくなる。
 *
 * DOM には触らない。当てるのも外すのも `LyricStage` の仕事（M4-2 の決定）。
 */
export function resolveComposition(place: LyricPlacement | undefined): Composition {
  const anchor = resolveName(place?.at, isAnchorName, DEFAULT_ANCHOR, 'アンカー名');
  const size = resolveName(place?.size, isSizeName, DEFAULT_SIZE, '大きさの段階');

  const vars: Record<string, string> = {};
  // 指定された分だけ置く。書かなかった軸は CSS 側の既定値（0）がそのまま効く
  if (place?.nudge?.x !== undefined) vars['--place-nudge-x'] = percent(place.nudge.x);
  if (place?.nudge?.y !== undefined) vars['--place-nudge-y'] = percent(place.nudge.y);
  if (place?.tilt !== undefined) vars['--place-tilt'] = `${place.tilt}deg`;

  return { classes: [...ANCHOR_CLASS[anchor], SIZE_CLASS[size]], vars };
}

function resolveName<T extends string>(
  name: string | undefined,
  isKnown: (value: string) => value is T,
  fallback: T,
  label: string,
): T {
  if (name === undefined) return fallback;
  if (isKnown(name)) return name;

  console.warn(`未知の${label}です: ${name}（${fallback} を使います）`);
  return fallback;
}

/**
 * 割合を CSS の百分率にする。
 *
 * `0.07 * 100` は `7.000000000000001` になる。見た目に差は出ないが、
 * インラインの style に埃が残ると検査で扱いにくいので小数第 1 位で丸める。
 */
function percent(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}
