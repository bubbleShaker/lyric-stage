import gsap from 'gsap';
import { partsOf, type LyricLine, type ResolvedPart } from '../domain/lyrics';
import { resolveDecor } from './decor';
import { resolveEffect, type EffectLayout, type EffectTimeline } from './effects';
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
  /** OS の「視差効果を減らす」設定が有効か */
  readonly reducedMotion?: boolean;
}

export function buildLineTimeline(
  line: LyricLine,
  createTarget: PartTargetFactory,
  { reducedMotion = false }: BuildLineOptions = {},
): EffectTimeline {
  // **止まった状態で作る。** 進めるのは外から与える時計（音の再生位置）だけで、
  // GSAP 自身の時計には乗せない。乗せると、音を止めても残りの語句が出続けて
  // 行が勝手に組み上がる。組み立てる側で pause() を呼ぶ約束にすると、
  // その 1 行が消えた時に**全テストが緑のまま**その壊れ方が戻ってくる
  const timeline = gsap.timeline({ paused: true });

  partsOf(line).forEach((part) => {
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

    timeline.add(build({ root: target.root, chars: target.chars }), part.at);
  });

  // **一度だけ動かして、時刻 0 の姿を確定させる。** gsap は playhead が動いていない
  // タイムラインを描き直さないので、組み立てただけでは「時刻 0 で出る語句」に
  // 何も当たらない（先頭で一時停止していると画面が空になる）。ここで往復させておくと、
  // 以降は time(0) も普通に効く
  timeline.time(FIRST_FRAME).time(0);

  return timeline;
}

/**
 * 「動かした」と gsap に認めさせるだけの、ごく短い時間（秒）。
 *
 * 1 フレーム（60fps で 16.7ms）よりずっと短いので、この間に進む演出は無い。
 */
const FIRST_FRAME = 0.0001;
