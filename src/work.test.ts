import { describe, expect, it } from 'vitest';
import { secondsPerBeat } from './domain/beat';
import { WHOLE_SONG } from './domain/work-window';
import { BEAT_GRID, DEFAULT_SHEET_NAME, WORK_WINDOW, workWindowFor } from './work';

/**
 * 作品固有の値そのものを検証する。
 *
 * ここが守るのは「どのシートにどの区間を当てるか」の対応付け。組み立て側
 * （main.ts）に三項演算子で書くとテストが届かず、書き戻しても全テストが緑のまま
 * 公開ページだけが壊れる（実際に一度そうなった）。
 */
describe('workWindowFor', () => {
  it('本編のシートには作品の区間を当てる', () => {
    expect(workWindowFor(DEFAULT_SHEET_NAME)).toBe(WORK_WINDOW);
  });

  it('本編以外のシートは曲を丸ごと流す', () => {
    // 開発用の sample は 1〜33 秒。作品の区間を当てると 1 行だけが延々出るページになる
    expect(workWindowFor('sample')).toBe(WHOLE_SONG);
    expect(workWindowFor('')).toBe(WHOLE_SONG);
  });
});

describe('WORK_WINDOW', () => {
  it('区間として成立している', () => {
    expect(WORK_WINDOW.start).toBeGreaterThanOrEqual(0);
    expect(WORK_WINDOW.end).toBeGreaterThan(WORK_WINDOW.start);
  });

  it('区間の頭と終わりが拍の上に載っている', () => {
    // 拍の格子は**曲の先頭起点**で書いてある。区間の頭が拍からずれていると、
    // 切り出した後の時間軸で叩く位置が音から浮く（画は動くので気付きにくい）。
    // Issue #37 で区間を広げるときも、頭は拍の上に置くこと。
    //
    // **頭の方は BEAT_GRID.origin と同じ値なので差は必ず 0**（レビュー指摘 🟢）。
    // この検査が効くのは片方だけ動かしたときで、許容（0.05 拍 ≒ 38ms）は
    // 「拍の頭として測り直した値が端数を持つ」ことを見込んだ幅。
    //
    // **終わりも見る**（Issue #37 のレビュー指摘）。区間の終わりが拍から外れると、
    // 尺の最後だけ拍が半端な所で切れる。今は 52 拍ちょうど（39.07 秒 / M12-1）
    const perBeat = secondsPerBeat(BEAT_GRID);
    const offGrid = [WORK_WINDOW.start, WORK_WINDOW.end]
      .map((time) => (time - BEAT_GRID.origin) / perBeat)
      .filter((beats) => Math.abs(beats - Math.round(beats)) >= 0.05);

    expect(offGrid).toStrictEqual([]);
  });

  it('手で作り込める尺に収まっている', () => {
    // 上限は「1 語句ずつ手で構図を置ける量」。語句の構図は 1 つずつ手で置くので、
    // 区間を広げるほど作り込む量がそのまま増える。**M12-1（Issue #69）で作者が
    // 「あと 10 秒」と言って 39.07 秒（10 行 / 27 語句）になったので 40 秒へ上げた。**
    // **余白は 1 秒だけにする**（レビュー指摘 🟢）。歯止めなので、次に伸ばす人が
    // 必ずここを読む位置に置く（余裕を持たせると 2 行ぶん黙って広がれてしまう）。
    // ここは作り込みが追いつかない長さへ黙って広がることを止めるための歯止めで、
    // **広げるときは実際に全語句へ構図を置いてから上げること**
    // （置き忘れは lyric-sheets.test.ts の「作品に出る全ての語句に構図が
    // 明示されている」が落とすので、上げただけでは緑にならない）。
    //
    // 下限は「作品と呼べる長さ」。M8-5 の間だけ 12 秒（3 行）に縮めていたので
    // 10 秒まで下げていたが、Issue #37 で 7 行へ戻したので歯止めも戻す。
    //
    // **縮めた状態への戻り道を塞いでいるのはこちらではない**（レビュー指摘 🟡）。
    // 20 秒は 5 行でも 6 行でも通るので、ここは「1 行だけ出して終わりにならない」
    // 歯止めに留まる。行数を守るのは lyric-sheets.test.ts の
    // 「切り出すとラスサビの 10 行が残る」の方
    const length = WORK_WINDOW.end - WORK_WINDOW.start;
    expect(length).toBeGreaterThan(20);
    expect(length).toBeLessThan(40);
  });
});
