import { activeLineIndexAt, NO_LINE, type LyricSheet } from '../domain/lyrics';
import type { LyricStage } from '../stage/lyric-stage';
import type { Playback } from '../stage/playback';
import type { Ticker } from './ticker';

/**
 * 再生位置と歌詞の表示を繋ぐ。
 *
 * 毎フレーム「今は何行目か」を domain に聞き、変わった時だけ描画し直す。
 * 前回と同じ番号なら何もしないので、同じ行のアニメーションが
 * 毎フレーム作り直されることはない。
 * シークも特別扱い不要で、行番号が変われば自然に追従する。
 */
export function mountLyricTimeline(
  player: Playback,
  ticker: Ticker,
  sheet: LyricSheet,
  stage: LyricStage,
): () => void {
  let currentIndex = NO_LINE;

  return ticker.subscribe(() => {
    const index = activeLineIndexAt(sheet.lines, player.currentTime);
    if (index === currentIndex) return;

    currentIndex = index;
    if (index === NO_LINE) {
      stage.clear();
    } else {
      stage.show(sheet.lines[index]);
    }
  });
}
