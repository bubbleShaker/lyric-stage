import { activeLineIndexAt, lineSpanAt, NO_LINE, type LyricSheet } from '../domain/lyrics';
import type { LyricPresenter, Playback } from '../domain/ports';
import type { Ticker } from './ticker';

/**
 * 再生位置と歌詞の表示を繋ぐ。
 *
 * 毎フレーム「今は何行目か」を domain に聞き、変わった時だけ組み立て直す。
 * 前回と同じ番号なら組み立てないので、同じ行のアニメーションが
 * 毎フレーム作り直されることはない。
 *
 * **行の中のどこまで進んだかは、毎フレーム音の再生位置から渡す**（M8-5）。
 * 行の中に語句の刻み（最大 3 秒）が入ったので、描画側に自前の時計を持たせると
 * 音を止めても残りの語句が出続け、行の途中へシークすると語句が遅れて出る。
 * 時計を 1 本（音）に絞れば、停止もシークも特別扱いせずに揃う。
 */
export function mountLyricTimeline(
  player: Playback,
  ticker: Ticker,
  sheet: LyricSheet,
  stage: LyricPresenter,
): () => void {
  let currentIndex = NO_LINE;

  return ticker.subscribe(() => {
    const index = activeLineIndexAt(sheet.lines, player.currentTime);

    if (index !== currentIndex) {
      currentIndex = index;
      if (index === NO_LINE) {
        stage.clear();
      } else {
        // **「この行が何秒出ているか」を知っているのはここだけ**（M13-1）。行そのものは
        // 次の行を知らないので、着地後も動き続ける演出は行を渡されただけでは尺を決められない
        stage.show(sheet.lines[index], lineSpanAt(sheet.lines, index));
      }
    }

    // 組み立てた直後のフレームからここを通る。show() の中で描かないのは、
    // 「どこまで進んだか」を知っているのが行の開始時刻を持つこちらだから
    if (currentIndex !== NO_LINE) {
      stage.render(player.currentTime - sheet.lines[currentIndex].time);
    }
  });
}
