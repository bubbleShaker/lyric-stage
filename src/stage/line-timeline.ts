import gsap from 'gsap';
import { partsOf, type LyricLine, type ResolvedPart } from '../domain/lyrics';
import { resolveEffect, type EffectLayout, type EffectTimeline } from './effects';

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
}

/**
 * 語句の当て先を用意する係。
 *
 * `layout` を渡すのは、**縦書きの指定が文字への分割より先に効く必要がある**ため
 * （M4-2 の決定）。分割してから組み方を変えると、横組みで測った区切りのまま
 * 縦組みで出ることになる。
 */
export type PartTargetFactory = (
  part: ResolvedPart,
  layout: EffectLayout | null,
  index: number,
) => PartTarget;

export interface BuildLineOptions {
  /** OS の「視差効果を減らす」設定が有効か */
  readonly reducedMotion?: boolean;
}

export function buildLineTimeline(
  line: LyricLine,
  createTarget: PartTargetFactory,
  { reducedMotion = false }: BuildLineOptions = {},
): EffectTimeline {
  const timeline = gsap.timeline();

  partsOf(line).forEach((part, index) => {
    const { layout, build } = resolveEffect(part.effect, { reducedMotion });
    const target = createTarget(part, layout, index);

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
    timeline.add(build({ root: target.root, chars: target.chars }), part.at);
  });

  return timeline;
}
