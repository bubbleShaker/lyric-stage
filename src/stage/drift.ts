import gsap from 'gsap';
import type { EffectTimeline } from './effects';

/**
 * 着地した語句が、そのまま漂い続ける（M13-2 / Issue #75）。
 *
 * ## なぜ要るか
 *
 * 演出（`stage/effects.ts`）はどれも**登場を 1 本返すだけ**で、素の見えへ着地したら
 * そこで終わる。行の間隔は 3 秒あり語句は積み上がるので、**止まった語句が 2〜3 個
 * 並ぶ時間**が生まれる。作者の言う「のっぺり」の正体はこれ（Issue #73）。
 *
 * ## 演出とは層を分ける
 *
 * 漂いが触るのは `.stage__drift`、演出が触るのは `.stage__text` とその中の文字。
 * **同じ要素に重ねてはいけない** — どちらも transform を書くので、GSAP の
 * トゥイーンどうしが毎フレーム値を奪い合う。構図（M8-1）を枠へ、演出を文字へと
 * 分けたのと同じ線を、もう 1 本引いている。
 *
 * ## 無限に回さない
 *
 * 行のタイムラインは音の再生位置で `time()` して巻き戻す（＝スクラブする）。
 * `repeat: -1` を混ぜると尺が `Infinity` になり、シークも、`lyric-sheets.test.ts` の
 * 尺の検査も成り立たなくなる。**滞在の長さちょうどで終わる有限な往復**にする。
 */

/** 漂う層に当たるクラス。中身（`transform-style`）は src/style.css が持つ */
export const DRIFT_CLASS = 'stage__drift';

/**
 * 登場が済んでから漂い始めるまでの間（秒）。
 *
 * 一番長い登場（`swing` の 0.6 秒）より少し短い。**わざと重ねている** — 完全に
 * 待つと「着地して、止まって、また動き出す」という 3 拍子になり、止まる瞬間が
 * かえって際立つ。着地の終わり際から漂いが引き継ぐと、動きが途切れない。
 */
export const DRIFT_SETTLE = 0.45;

/**
 * これより滞在が短ければ漂わせない（秒）。
 *
 * 往復が 1 回も回らない長さで動かすと、漂いではなく「もう一度ゆっくり動いた」に
 * 見える。行の終わり際に出る語句（`at` が行の尻に寄っている語句）がここに落ちる。
 */
export const MIN_DRIFT_SPAN = 0.9;

/** 往復 1 回ぶんの長さの目安（秒）。語句ごとに `CYCLE_STEP` ずつずらす */
const BASE_CYCLE = 1.15;
const CYCLE_STEP = 0.3;

/**
 * 漂いの深さと角度。
 *
 * `z` は画面の奥行き方向。**親に `perspective` が張られていることが前提**で、
 * `.stage__lines` の `clamp(600px, 70vw, 1400px)` がそれにあたる（src/style.css）。
 * 遠近が効いているので、奥へ引くだけで大きさも位置も動く — 平面での拡大縮小と違い、
 * 画面の隅に置いた語句は隅の方向へ滑る。
 *
 * 値は「読めなくならない範囲でいちばん動く」ところを目で決めた。**歌詞は読ませる
 * ものなので、振り切ってはいけない** — 奥行き 1000px 相当の遠近に対して z が 90〜230 は、
 * 見かけの大きさで 1.1〜1.3 倍にあたる。
 */
const DEPTH = 90;
const DEPTH_STEP = 70;
const YAW = 6;
const YAW_STEP = 3;
const PITCH = 3.5;
/** 浮き沈み（語句自身の高さに対する割合）。px で書かないのは文字サイズが画面で変わるため */
const FLOAT = 2.5;

export interface DriftOptions {
  /** 漂い続ける長さ（秒）。語句が出てから行が終わるまで */
  readonly span: number;
  /**
   * 行の中で何番目の語句か。**周期と向きをずらすためだけに使う。**
   *
   * 全部の語句が同じ漂い方をすると、3 つが同時に同じ向きへ動いて「画面ごと
   * 揺れている」ように見える。周期を素数的にずらす必要はなく、少し違えば
   * 揃う瞬間が来ない。
   */
  readonly seed: number;
  /** OS の「視差効果を減らす」設定が有効か */
  readonly reducedMotion?: boolean;
}

/**
 * 漂いを組み立てて返す。
 *
 * **当て先は要素でなくてもよい** — GSAP はただのオブジェクトにも書けるので、
 * 検査はダミーを渡して結果を読める（`line-timeline.ts` と同じ）。
 *
 * 漂わせない時（動きを減らす設定・滞在が短すぎる）も**空のタイムラインを返す**。
 * `null` を返す形にすると、呼ぶ側に分岐が 1 つ増えるうえ、「漂わない」ことを
 * 尺 0 として扱えなくなる。
 */
export function buildDrift(
  target: object,
  { span, seed, reducedMotion = false }: DriftOptions,
): EffectTimeline {
  const timeline = gsap.timeline();

  // 前庭系の症状（めまい）を誘発しうるのは、画面の広い範囲が急に動くこと。
  // 漂いは遅いが、**ずっと動き続ける**ぶん逃げ場が無いので、減らす設定では丸ごと止める
  if (reducedMotion) return timeline;

  // **`Infinity` を弾くのはここ**（`lineSpanAt` は無限を返しうる）。通すと往復の回数も
  // 無限になり、1 回ぶんの長さが `Infinity / Infinity` ＝ NaN になる。NaN を渡された
  // GSAP は例外を投げず、**そのトゥイーンだけが黙って何もしない**ので、
  // 「なぜかこの行だけ漂わない」という追いにくい形で出る。
  // `span >= MIN` の否定形で書いているのは、NaN も同時に落とすため
  if (!Number.isFinite(span) || !(span >= MIN_DRIFT_SPAN)) return timeline;

  // 片道の回数を整数に丸めてから 1 回ぶんの長さを割り戻す。**合計がちょうど span** に
  // なるので、この後ろに積むもの（M13-3 の退場）と時間が重ならない。
  //
  // **必ず偶数にする。** yoyo は片道ごとに向きを変えるので、奇数だと行ったきりで
  // 終わる — 滞在の終わりに語句が奥（または手前）へずれたまま止まり、**次に積むものが
  // 「どこから始まるか」を知らないまま書く**ことになる。偶数なら必ず元の位置に戻る
  const cycles = Math.round(span / (BASE_CYCLE + seed * CYCLE_STEP) / 2);
  const laps = Math.max(2, cycles * 2);
  const toward = seed % 2 === 0 ? 1 : -1;

  return timeline.to(target, {
    z: DEPTH + seed * DEPTH_STEP,
    rotationY: toward * (YAW + seed * YAW_STEP),
    rotationX: -toward * PITCH,
    yPercent: toward * -FLOAT,
    duration: span / laps,
    // 端で速度が 0 になる曲線。等速（none）だと折り返しが角として見える
    ease: 'sine.inOut',
    yoyo: true,
    repeat: laps - 1,
  });
}
