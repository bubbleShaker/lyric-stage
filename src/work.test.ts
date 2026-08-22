import { describe, expect, it } from 'vitest';
import { WHOLE_SONG } from './domain/work-window';
import { DEFAULT_SHEET_NAME, WORK_WINDOW, workWindowFor } from './work';

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

  it('20 秒台に収まっている（文字PV として作り込める尺）', () => {
    const length = WORK_WINDOW.end - WORK_WINDOW.start;
    expect(length).toBeGreaterThan(15);
    expect(length).toBeLessThan(35);
  });
});
