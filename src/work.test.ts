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

  it('区間の頭が拍の上に載っている', () => {
    // 拍の格子は**曲の先頭起点**で書いてある。区間の頭が拍からずれていると、
    // 切り出した後の時間軸で叩く位置が音から浮く（画は動くので気付きにくい）。
    // Issue #37 で区間を広げるときも、頭は拍の上に置くこと。
    //
    // **今は両方が同じ値なので差は必ず 0**（レビュー指摘 🟢）。この検査が効くのは
    // 片方だけ動かしたときで、許容（0.05 拍 ≒ 38ms）は「拍の頭として測り直した値が
    // 端数を持つ」ことを見込んだ幅
    const beats = (WORK_WINDOW.start - BEAT_GRID.origin) / secondsPerBeat(BEAT_GRID);

    expect(Math.abs(beats - Math.round(beats))).toBeLessThan(0.05);
  });

  it('手で作り込める尺に収まっている', () => {
    // 上限は M8-0 で決めたラスサビ 1 ブロック（約 27 秒）。語句の構図は 1 つずつ
    // 手で置くので、区間を広げるほど作り込む量がそのまま増える。
    //
    // 下限は「作品と呼べる長さ」。M8-5 の間だけ 12 秒（3 行）に縮めていたので
    // 10 秒まで下げていたが、Issue #37 で 7 行へ戻したので歯止めも戻す。
    // **これが縮めた状態への戻り道を塞ぐ**（縮めた尺は公開ページに出るのに、
    // 止めるものが PLAN のチェックボックスしか無かった）
    const length = WORK_WINDOW.end - WORK_WINDOW.start;
    expect(length).toBeGreaterThan(20);
    expect(length).toBeLessThan(35);
  });
});
