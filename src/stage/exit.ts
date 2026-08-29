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
 * 両方が見えている `EXIT_DURATION` が、画の受け渡しになる。
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
 *
 * **本編の語句の間隔は最短 0.751 秒**（`イマジ → ネーション` と `今も → 降り募る`。
 * レビュー指摘 🟡 を受けてシートを実測した。以前ここには「最短 1.1 秒」と書いていたが、
 * それは**行の**間隔だった）。0.55 秒だと最短の所で次の語句の在席時間の 73% を食い、
 * 「対応するセリフだけ映す」（Issue #73）と正面から擦れる。0.4 秒なら 53%、
 * 普通の間隔（1.128 秒）では 35% に収まる。
 */
export const EXIT_DURATION = 0.4;

/**
 * 引き始める前に、その語句が動かずに居る最短の時間（秒）。
 *
 * **これが無いと「出切った瞬間に引き始める」語句が生まれる**（レビュー指摘 🔴）。
 * 本編の `ネーション` は 1.879 秒に出て 0.57 秒かけて出揃うので、行の終わりから
 * 逆算した引き始めとの差が 0.001 秒しかなかった。閾値を置くだけでは境界へ寄るだけで、
 * 「一瞬映って消えた」を防ぐという分岐の目的を果たさない。
 */
export const MIN_STAY = 0.4;

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
/**
 * 被写界深度の模倣。ピントが外れながら退く（`rushIn` の逆向き）。
 *
 * export しているのは `exit.test.ts` が終点を名指しで見るため。`blur(` が入って
 * いるかだけを見ると、**ぼかしが一切動かなくても緑になる**（レビュー指摘 🟡）。
 */
export const BLUR = 8;

/**
 * その語句が引き始める時刻。**引かないなら null。**
 *
 * - 次の語句がある … **その語句が出る時刻**から引き始める。重ねるのは穴を空けないため —
 *   前の語句が消えてから次が出るまでに何も映っていない時間ができると、のっぺり以上に悪い
 * - 行の最後の語句 … 次が無いので、**行が終わるちょうどに消え終わる**よう逆算する
 *
 * **出揃ってから `MIN_STAY` は留まる。** 間に合わない行では引かず、行の切り替えに
 * 任せる — 語句は漂ったまま次の行へ渡るので、止まった画にはならない。
 *
 * **`span` が有限でなければ引かない**（レビュー指摘 🔴）。`lineSpanAt` は duration を
 * 持たない最終行に `Infinity` を返す。そのまま逆算すると `Infinity` の位置に退場を置く
 * ことになり、**行のタイムラインの尺ごと無限になる**（`buildDrift` が同じ値を名指しで
 * 弾いているのと同じ理由）。`NaN` は下の比較が false になるので、この 1 行が無くても落ちる。
 *
 * `appears` は**その語句にまつわるものが出揃う時刻**（登場だけではない）。図形・英字・
 * 一過性の装飾は登場より長いことがあり（`burst` の 1.0 秒 > `swing` の 0.6 秒）、
 * 退場は箱ごと引くので、装飾が出ている最中に引き始めては噛み合わない。
 */
export function exitStartFor(appears: number, nextPartAt: number | undefined, span: number): number | null {
  if (nextPartAt !== undefined) return nextPartAt;
  if (!Number.isFinite(span)) return null;

  const leaves = span - EXIT_DURATION;

  return leaves >= appears + MIN_STAY ? leaves : null;
}

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
      // **始点を組み立てた瞬間に当てない**（レビュー指摘 🔴）。gsap の `fromTo` は
      // 既定で `immediateRender: true` ＝ タイムラインの後ろに置いても、始点の値だけは
      // 組み立てと同時に書かれる。ここでは `filter: blur(0px)` が**語句が出ている
      // 全区間**に当たることになり、**`none` 以外の `filter` は要素を平面に潰す**ので、
      // `.stage__drift` の `transform-style: preserve-3d` が効かなくなる
      // （＝ `rushIn` の文字ごとの奥行きがただの平行移動になる。style.css の警告そのもの）。
      // `rushIn` が同じ書き方で無事なのは、当て先が `at` まで枠ごと隠れているため。
      //
      // **引き始めてからは潰れる**（Chromium で実測: 語句が出ている間は文字の
      // transform が `matrix3d`、引き始めると `matrix` に落ちる）。退く語句の奥行きは
      // この層が持っているので、文字ごとの奥行きが失われても画は変わらない
      immediateRender: false,
      // 引き始めをゆっくり、終わりを速く。**登場の逆向き**（power3.out の裏）で、
      // 「読み終えてから退く」という順序が動きにも出る
      ease: 'power2.in',
    },
  );
}
