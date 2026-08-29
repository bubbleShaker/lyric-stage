import gsap from 'gsap';
import type { EffectTimeline } from './effects';

/**
 * 語句が次へ渡すときに奥へ引く（M13-3 / Issue #77）。
 *
 * ## M8-5 の取り消し
 *
 * 「語句は行が終わるまで画面に残る」（積み上げ）をやめる。作者の依頼は
 * 「**対応するセリフだけ画面に映るようにして欲しい**」（Issue #73）で、
 * 積み上げて画を埋めるのは狙いと逆だった。
 *
 * ## 穴を空けない
 *
 * 引き始めるのは**次の語句が出る時刻ちょうど**。前の語句が消えてから次が出るまでに
 * 何も映っていない時間ができると、のっぺり以上に悪い（候補ページで実測した）。
 * 両方が見えている 0.55 秒が、画の受け渡しになる。
 *
 * ## 漂いと時間を分ける
 *
 * 退場も漂いも `.stage__drift` の transform を書くので、**時間が重なると
 * 毎フレーム値を奪い合う**。漂いは「退場が始まるまで」に縮めてある
 * （`line-timeline.ts`）。漂いの往復の回数を偶数に丸めてあるのは、
 * ここが**元の位置から始まる**ことを当てにできるようにするため。
 *
 * ## M3 の決定との関係
 *
 * PLAN.md の M3 で「退場演出は持たない（`clear()` が非同期になり
 * `LyricStage` のライフサイクル管理が一段複雑になる）」と決めていた。
 * **行タイムラインの末尾に積む**なら、次の行が来る前に退場は終わっているので、
 * `clear()` は今のまま即座でよい。決定の前提だけが変わった。
 */

/**
 * 引き切るまでの長さ（秒）。
 *
 * **この長さぶん、前の語句と次の語句が同時に見える。** 短くすると受け渡しが
 * ぶつ切りに、長くすると画面に 2 語句が居る時間が増えて「1 語句ずつ」が崩れる。
 * 本編の語句の間隔（最短 1.1 秒）の半分ほどに置いた。
 */
export const EXIT_DURATION = 0.55;

/**
 * 引く深さ。
 *
 * 登場（`rushIn` の `z: -1400`）ほど遠くへは行かない。あちらは「無かったものが
 * 現れる」ので画面の外から来てよいが、退場は**読み終えた語句が退く**動きで、
 * 速すぎると読者が目で追えないまま消える。
 */
const DEPTH = -620;
/** 引きながら傾ける。まっすぐ奥へ引くだけだと「小さくなった」としか見えない */
const PITCH = 12;
/** 被写界深度の模倣。ピントが外れながら退く（`rushIn` の逆向き） */
const BLUR = 8;

export interface ExitOptions {
  /** OS の「視差効果を減らす」設定が有効か */
  readonly reducedMotion?: boolean;
}

/**
 * 退場を組み立てて返す。
 *
 * **当て先は要素でなくてもよい** — GSAP はただのオブジェクトにも書けるので、
 * 検査はダミーを渡して結果を読める（`drift.ts` と同じ）。
 *
 * `.from()` ではなく `.fromTo()` なのは `filter` のため。素の見えは `none` で、
 * `none → blur(8px)` は補間できない（`effects.ts` の `rushIn` と同じ理由）。
 *
 * **動きを減らす設定でも消す。** 漂い（`buildDrift`）は丸ごと止めるが、こちらは
 * 止めると**語句が積み上がったまま行が終わる** ＝ 画の作りそのものが変わってしまう。
 * 前庭系の症状を誘発するのは位置と大きさの変化なので、不透明度だけで消す。
 */
export function buildExit(target: object, { reducedMotion = false }: ExitOptions = {}): EffectTimeline {
  const timeline = gsap.timeline();

  if (reducedMotion) {
    return timeline.to(target, { opacity: 0, duration: EXIT_DURATION, ease: 'power1.in' });
  }

  return timeline.fromTo(
    target,
    { filter: 'blur(0px)' },
    {
      z: DEPTH,
      rotationX: PITCH,
      opacity: 0,
      filter: `blur(${BLUR}px)`,
      duration: EXIT_DURATION,
      // 引き始めをゆっくり、終わりを速く。**登場の逆向き**（power3.out の裏）で、
      // 「読み終えてから退く」という順序が動きにも出る
      ease: 'power2.in',
    },
  );
}
