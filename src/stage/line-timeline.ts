import gsap from 'gsap';
import { partsOf, type LyricLine, type ResolvedPart } from '../domain/lyrics';
import { resolveDecor } from './decor';
import { buildDrift, DRIFT_SETTLE } from './drift';
import { buildExit, EXIT_DURATION } from './exit';
import { resolveEffect, type EffectLayout, type EffectTimeline } from './effects';
import { resolveSpark, type SparkShape, type SparkTarget } from './spark';
import { buildSubText } from './sub-text';

/**
 * 1 行を、語句ごとの登場が並んだ 1 本のタイムラインに組み立てる（M8-5）。
 *
 * **行の中の時間はここが持つ。** 毎フレームの判定（`app/lyric-timeline.ts`）が
 * 見ているのは今まで通り「今は何行目か」だけで、語句の刻みは行の頭で組んだ
 * この 1 本に載る。語句を毎フレーム選ぶ作りにすると、「先に出た語句を消さずに
 * 残す」という状態管理が app 層へ漏れ、行という単位が壊れる。
 *
 * DOM は作らない。**当て先を作るのは呼び出し側**（`LyricStage`）で、ここは
 * 「どの語句を・いつ・どの演出で」だけを持つ。この分担のおかげで、
 * 行の尺の検査（`src/lyric-sheets.test.ts`）が本番と同じ組み立てを、
 * ダミーの当て先を渡すだけで測れる。
 *
 * 純粋ではある**が無害ではない** — 受け取った当て先には gsap が値を書く
 * （隠す `autoAlpha` と、演出が動かすもの）。要素なら CSS、ただのオブジェクトなら
 * そのプロパティに書かれるので、検査はダミーを渡して結果を読める。
 */

/** 語句 1 つぶんの当て先 */
export interface PartTarget {
  /**
   * 構図（位置・大きさ・傾き）を持つ枠。
   *
   * GSAP がここに書くのは**見せる/隠すだけ**。位置は CSS の担当なので
   * transform には触らない（触ると構図と取り合いになる。src/stage/lyric-stage.ts）。
   */
  readonly frame: HTMLElement;
  /**
   * 着地した後の漂いが動かす層（M13-2）。**枠と文字の間に挟まっている。**
   *
   * 演出（`root`）と分けているのは、どちらも transform を書くため。同じ要素に
   * 重ねると GSAP のトゥイーンどうしが毎フレーム値を奪い合う（理由は `stage/drift.ts`）。
   *
   * 図形・英字・一過性の装飾もこの中に居るので、**語句は添え物ごと一緒に漂う**。
   */
  readonly drift: HTMLElement;
  /** 語句の文字が入る要素。演出が動かすのはこちら */
  readonly root: HTMLElement;
  /** SplitText が分解した 1 文字ずつの要素 */
  readonly chars: Element[];
  /**
   * 図形の当て先を 1 つ立てて返す（M8-3a）。**文字より奥に置かれる。**
   *
   * 「立てた要素の配列」を受け取る形にしなかったのは、**数と順序が図形の列と
   * 一致していることを規約でしか守れなくなる**ため。作る所と使う所が
   * この 1 行で繋がっていれば、取り違えようが無い。
   */
  readonly createDecor: (className: string) => HTMLElement;
  /**
   * 英字サブテキストの当て先を立てて返す（M8-3c）。**中身も入れて返す。**
   *
   * 図形（`createDecor`）はクラス名を渡すが、こちらは**文字列そのもの**を渡す
   * — 英字は語句ごとに違う中身なので、レジストリではなくシートが持っている。
   * 当て先の中に文字を入れるのは作る側の仕事にした（歌詞と同じく、外から来た
   * 文字列を DOM へ入れる所を 1 か所に閉じ込めるため）。
   */
  readonly createSub: (text: string) => HTMLElement;
  /**
   * 一過性の装飾の当て先を立てて返す（M10-1）。**文字より手前に置かれる。**
   *
   * 図形（`createDecor`）はクラス名を、英字（`createSub`）は文字列を渡すが、
   * こちらは**3 つまとめて**渡す。クラス名・破片の数・文字を写すかが要るので、
   * 位置引数を並べるより取り違えようが無い。**渡すのは `SparkShape`（DOM を立てるのに
   * 要る分だけ）で、演出の中身（`build`）は見せない。**
   */
  readonly createSpark: (spark: SparkShape) => SparkTarget;
}

/**
 * 語句の当て先を用意する係。
 *
 * `layout` を渡すのは、**縦書きの指定が文字への分割より先に効く必要がある**ため
 * （M4-2 の決定）。分割してから組み方を変えると、横組みで測った区切りのまま
 * 縦組みで出ることになる。
 */
export type PartTargetFactory = (part: ResolvedPart, layout: EffectLayout | null) => PartTarget;

export interface BuildLineOptions {
  /**
   * この行が画面に出ている長さ（秒）。求めるのは domain の `lineSpanAt`（M13-1）。
   *
   * **省略できない。** 既定値（次の行まで、など）を置くと、渡し忘れた所で
   * 漂いだけが静かに止まる — 画面には歌詞が出ているので気付けない。
   */
  readonly span: number;
  /** OS の「視差効果を減らす」設定が有効か */
  readonly reducedMotion?: boolean;
}

/**
 * 語句がすべて出揃った時刻に立つラベル。
 *
 * 漂い（M13-2）が入って以降、**タイムラインの尺は「行が出ている長さ」**になった。
 * 尺を測っても「刻みすぎて最後の語句が出る前に行が変わる」は分からないので、
 * 出揃う時刻を別に持つ。検査（`src/lyric-sheets.test.ts`）が見るのはこちら。
 *
 * GSAP のラベルにしているのは、戻り値を `{ timeline, settled }` に変えずに済むため。
 * 読む側は `timeline.labels[LINE_SETTLED]` で引ける。
 */
export const LINE_SETTLED = 'settled';

export function buildLineTimeline(
  line: LyricLine,
  createTarget: PartTargetFactory,
  { span, reducedMotion = false }: BuildLineOptions,
): EffectTimeline {
  // **止まった状態で作る。** 進めるのは外から与える時計（音の再生位置）だけで、
  // GSAP 自身の時計には乗せない。乗せると、音を止めても残りの語句が出続けて
  // 行が勝手に組み上がる。組み立てる側で pause() を呼ぶ約束にすると、
  // その 1 行が消えた時に**全テストが緑のまま**その壊れ方が戻ってくる
  const timeline = gsap.timeline({ paused: true });
  // 漂いと退場は**全部の語句を積み終えてから**足す（下の LINE_SETTLED を見よ）。
  // ここでは当て先と刻みだけ控える
  const staying: {
    target: PartTarget;
    at: number;
    /** 引き始める時刻。**null は「引かない」**（行の切り替えに任せる。下記） */
    leaves: number | null;
    seed: number;
  }[] = [];
  const parts = partsOf(line);

  parts.forEach((part, order) => {
    const { layout, build } = resolveEffect(part.effect, { reducedMotion });
    const target = createTarget(part, layout);

    // **出番が来るまで枠ごと隠す。** 語句は行の頭でまとめて組み立てるので、
    // 何もしないと at=1.85 の語句が最初から素の姿で置かれてしまう。
    // 演出はどれも opacity 0 から始まるので実際には見えないが、それは
    // 演出の書き方に頼った偶然でしかない。枠ごと隠せば、どんな演出を足しても
    // 「at の前には見えない」が仕組みとして守られる。
    //
    // 隠すのは gsap.set（タイムラインの外）で即座に。timeline.set(..., 0) に
    // 任せると、初回描画が次のフレームまで来ないぶん 1 フレームだけ見えてしまう。
    // 隠す側と見せる側をこの 2 行に並べておくのは、当て先を作る側（LyricStage /
    // 開発用ページ / テストのダミー）に約束を配らないため
    gsap.set(target.frame, { autoAlpha: 0 });
    timeline.set(target.frame, { autoAlpha: 1 }, part.at);

    // 図形は文字と**同じ時刻から**始める（M8-3a）。少し先に引いてから文字を乗せる
    // 手もあるが、それは語句の `at` を早めれば書ける。ここで前倒しにすると、
    // シートに書いた時刻と画に出る時刻がずれて、耳で詰める作業（Issue #37）が狂う
    for (const decor of resolveDecor(part.decor, { reducedMotion })) {
      timeline.add(decor.build(target.createDecor(decor.className)), part.at);
    }

    // 英字も図形と同じ時刻から（M8-3c）。語句・図形・英字が同時に動き出すことで、
    // 1 つの語句が「1 つの画」として立ち上がる
    if (part.sub !== undefined) {
      timeline.add(buildSubText(target.createSub(part.sub), { reducedMotion }), part.at);
    }

    // 一過性の装飾も同じ時刻から（M10-1）。**語句が出る瞬間に弾ける**のが狙いなので、
    // 図形・英字と同じくここで前倒しにも後ろ倒しにもしない。出さない指定
    // （未指定・動きを減らす設定・知らない名前）は null で返る
    const spark = resolveSpark(part.spark, { reducedMotion });
    if (spark !== null) {
      timeline.add(spark.build(target.createSpark(spark)), part.at);
    }

    const entrance = build({ root: target.root, chars: target.chars });
    timeline.add(entrance, part.at);

    staying.push({
      target,
      at: part.at + DRIFT_SETTLE,
      leaves: leavingAt(part.at + entrance.duration(), parts[order + 1], span),
      seed: order,
    });
  });

  // **ここまでの尺がそのまま「語句が出揃う時刻」**（レビュー指摘 🟡）。
  // 登場だけを数えるのでは足りない — 図形（M8-3a）・英字（M8-3c）・一過性の装飾
  // （M10-1）は語句と同じ時刻から始まるが、**登場より長い**ことがある（本編では
  // `burst` の 1.0 秒が `swing` の 0.6 秒を追い越す）。漂いを足す前の尺を読めば、
  // M13-2 より前の `timeline.duration()` と同じ意味がそのまま残る
  timeline.addLabel(LINE_SETTLED, timeline.duration());

  // **着地したら漂い始め、次へ渡すときに引く**（M13-2 / M13-3）。当て先が演出と
  // 別の層なので、登場の終わり際に重ねても取り合いにならない。
  //
  // **漂いと退場は時間を分ける。** どちらも漂う層の transform を書くので、重ねると
  // 毎フレーム値を奪い合う。漂いの尺は「引き始めるまで」に縮め、退場はその後ろに置く
  for (const { target, at, leaves, seed } of staying) {
    // 引かない語句は行が終わるまで漂う（漂いの尺は「次に何かが起きるまで」）
    timeline.add(buildDrift(target.drift, { span: (leaves ?? span) - at, seed, reducedMotion }), at);

    if (leaves !== null) timeline.add(buildExit(target.drift, { reducedMotion }), leaves);
  }

  // **一度だけ動かして、時刻 0 の姿を確定させる。** gsap は playhead が動いていない
  // タイムラインを描き直さないので、組み立てただけでは「時刻 0 で出る語句」に
  // 何も当たらない（先頭で一時停止していると画面が空になる）。ここで往復させておくと、
  // 以降は time(0) も普通に効く
  timeline.time(FIRST_FRAME).time(0);

  return timeline;
}

/**
 * その語句が引き始める時刻（M13-3）。**引かないなら null。**
 *
 * - 次の語句がある … **その語句が出る時刻**から引き始める。重ねるのは穴を空けないため —
 *   前の語句が消えてから次が出るまでに何も映っていない時間ができると、のっぺり以上に悪い
 * - 行の最後の語句 … 次が無いので、**行が終わるちょうどに消え終わる**よう逆算する
 *
 * **ただし登場が終わる前には引き始めない。** 本編の 3 秒の行では最後の語句が
 * 2.254 秒に出るので、逆算した 2.45 秒は**まだ出切っていない**（`swing` は 0.6 秒かかる）。
 * そのまま引くと「一瞬映って消えた」になる。間に合わない行では引かず、行の切り替えに
 * 任せる — 語句は漂ったまま次の行へ渡るので、止まった画にはならない。
 *
 * **次の語句がある側には同じ手当てをしていない。** 語句の間隔（本編で最短 1.1 秒）は
 * どの登場（最長 0.85 秒）より広いので、まだ起きない。起きる時は間隔の方が詰まりすぎで、
 * `lyric-sheets.test.ts` の「行の猶予に収まる」が先に落ちる。
 */
function leavingAt(entranceEnd: number, next: ResolvedPart | undefined, span: number): number | null {
  if (next !== undefined) return next.at;

  const leaves = span - EXIT_DURATION;

  return leaves >= entranceEnd ? leaves : null;
}

/**
 * 「動かした」と gsap に認めさせるだけの、ごく短い時間（秒）。
 *
 * 1 フレーム（60fps で 16.7ms）よりずっと短いので、この間に進む演出は無い。
 */
const FIRST_FRAME = 0.0001;
