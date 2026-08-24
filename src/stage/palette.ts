/**
 * 作品の配色（M8-2 / Issue #41）。**ここが色の単一の情報源。**
 *
 * M8-2 より前は、同じ色が `style.css` と `starfield.ts` の両方に書かれていた
 * （`#f4f6ff` が `--stage-fg` と `WHITE`、`#7fd7ff` が `--stage-accent` と `CYAN`）。
 * この形の二重管理は、**CSS だけ直して canvas が古い色のまま**という
 * 「画面を見ないと気付けない」ズレを生む。
 *
 * 集約先を CSS ではなく TS にしたのは、描き手（`GrainField` / `Starfield`）に
 * DOM 依存を持ち込まないため。`getComputedStyle` で読む形にすると、`DrawSurface`
 * という口しか知らずにテストできている今の作り（`scaled-canvas.ts`）が崩れる。
 * 代わりに `style.css` との一致は検査で見張る（`palette.test.ts`）。
 *
 * **モノトーン基調 + 差し色 1 色。** 極太 900 の白文字が画面のあちこちに飛ぶ構図
 * （M8-1 / M8-5）なので、背景は明度の段だけで組んで文字を立てる。
 */

/**
 * 明度の段。**色そのものではなく役割で名前を付けている。**
 *
 * 「シアン」のような色名で持つと、配色を変えた時に名前が嘘になる（`CYAN` が
 * 黄色を指す事態になる）。役割で持てば、値だけ差し替えれば済む。
 */
export const PALETTE = {
  /** 一番奥。body の背景 */
  bg: '#0a0a0c',
  /**
   * 面・帯の地。bg のすぐ上に敷く明度。
   *
   * 語句の後ろに敷く帯（M8-3a の `band`）が使う。背景の光には一度これを当てたが、
   * 地（`bg`）との差が小さすぎて不透明度をどう上げても「わずかに明るい黒」に
   * しかならず、`mute` に替えた経緯がある。**縁のある面なら、その僅かな差でも
   * 形として読める**（にじむ光との違い）。
   */
  dim: '#16171c',
  /** 線・グレイン。文字に競らない中間の明度 */
  mute: '#6b6d76',
  /** 文字（900）。作品の主役 */
  ink: '#f2f2f5',
  /**
   * 差し色。**作品側では使わず、「触れる所」（再生ボタン・seek）に限る。**
   *
   * #39 で「書体は歌詞にだけ当てて UI には広げない」と決めたのと同じ線を、
   * 向きを逆にして色にも引いている。パレットを 2 つに割るのではなく、
   * 1 つのパレットの中で役割を分ける形。
   *
   * 黄にしたのは bg に対するコントラストが一番高いため（15.6:1）。
   * 再生ボタンは「差し色の地 × bg の文字」なので、明るい差し色ほど読める。
   */
  accent: '#ffd60a',
  /** エラー表示。読めなかった時だけ出る */
  alert: '#ff9c9c',
} as const;

export type PaletteName = keyof typeof PALETTE;

/** パレットが持つ色そのもの。`#rrggbb` の 7 文字であることを型で保証する */
export type PaletteColor = (typeof PALETTE)[PaletteName];

/**
 * パレットの色に不透明度を足して `#rrggbbaa` にする。
 *
 * グラデーションの終点に使う。canvas の `addColorStop` に `transparent` を渡すと
 * **黒へ向かって補間される**（`transparent` は `rgba(0, 0, 0, 0)` なので、
 * 色の成分ごと 0 に近づく）。同じ色の不透明度だけを 0 にすれば、
 * 色味を保ったまま消えていく。
 *
 * 引数を `PaletteColor` に絞っているのは、書式の検査を型に任せるため。
 * 任意の文字列を受けると `rgb()` 記法や 3 桁の短縮形を渡せてしまい、
 * 末尾に 2 桁足すだけのこの実装が黙って壊れた色を返す。
 */
export function withAlpha(color: PaletteColor, alpha: number): string {
  // 0〜1 の外は 00 / ff に丸める。範囲外をそのまま計算すると
  // toString(16) が 3 桁以上になり、色として解釈できない文字列になる
  const clamped = Math.min(1, Math.max(0, alpha));

  return `${color}${Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/**
 * CSS 側の変数名。`style.css` の `:root` はこの名前で同じ値を宣言する。
 *
 * 綴りを検査と CSS で 2 回書かずに済むよう、規則を関数にしてある。
 */
export function cssVariableName(name: PaletteName): string {
  return `--stage-${name}`;
}
