/**
 * OS の「視差効果を減らす」設定の読み方。
 *
 * 読んだ結果をどう使うかは stage 層（`resolveEffect` / `LyricStage`）が持つ。
 * ここは「どこから読むか」だけを知っていて、ブラウザの API に触れる唯一の場所。
 */

/**
 * 設定を尋ねる関数。真なら動きを減らす。
 *
 * 値ではなく関数で受け渡すのは、**いつ読むかを使う側に決めさせる**ため。
 * 起動時に 1 度だけ読んだ真偽値を配ると、曲の途中で設定を変えても反映されない。
 */
export type ReducedMotionQuery = () => boolean;

/**
 * OS の設定を読む。
 *
 * MediaQueryList は作った後も matches が最新に保たれるので、
 * オブジェクトは 1 度だけ作って読み直せばよい（購読も再作成も要らない）。
 */
export function systemReducedMotion(): ReducedMotionQuery {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  return () => query.matches;
}

/**
 * 常に「減らさない」と答える。
 *
 * 演出そのものを見る開発用ページ（effect-preview.html）のためのもの。
 * あそこでは OS 設定に関わらず素の演出が出る方が正しい。
 */
export const neverReduceMotion: ReducedMotionQuery = () => false;
