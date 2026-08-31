import { describe, expect, it } from 'vitest';
import { secondsPerBeat } from './domain/beat';
import { createFadeCurve } from './domain/fade';
import { WHOLE_SONG } from './domain/work-window';
import { isAnchorName, isSizeName } from './stage/composition';
import { isEffectName } from './stage/effects';
import { isVeilName } from './stage/kanji-veil';
import {
  BEAT_GRID,
  DEFAULT_SHEET_NAME,
  PRELUDE,
  WORK_FADE,
  WORK_WINDOW,
  workWindowFor,
} from './work';

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
    // 「あと 10 秒」と言って 39.07 秒（10 行 / 27 語句）になったので 40 秒へ上げ、
    // **M14-2 で序のぶん（6.01 秒）を足して 46 秒にした** — 上げてよいのは
    // 「手で置く語句が増えない伸び」だけで、序は 1 行・語句に刻まないのでそれに当たる。**
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
    expect(length).toBeLessThan(46);
  });
});

describe('WORK_FADE', () => {
  const length = WORK_WINDOW.end - WORK_WINDOW.start;

  it('区間に収まっている（組み立てた瞬間に落ちない）', () => {
    // 本番と同じ経路で組み立てる。重なる長さを書くと明ける前に暮れ始める作品になり、
    // domain 側が投げる — それが**画面ではなく起動時に**分かることを、ここで確かめる
    expect(() => createFadeCurve(length, WORK_FADE)).not.toThrow();
  });

  it('長さが拍の上に載っている', () => {
    // 拍から外れたフェードは、明けきる瞬間・暮れ始める瞬間が音の刻みから浮く。
    // 許容は区間の頭と終わりと同じ 0.05 拍（≒ 38ms）
    const perBeat = secondsPerBeat(BEAT_GRID);
    const offGrid = [WORK_FADE.in, WORK_FADE.out]
      .map((span) => span / perBeat)
      .filter((beats) => Math.abs(beats - Math.round(beats)) >= 0.05);

    expect(offGrid).toStrictEqual([]);
  });

  it('作品の半分を覆っていない', () => {
    // フェードは閉じ方であって作品ではない。長すぎると「薄い画をずっと見ている」ことになる
    expect(WORK_FADE.in + WORK_FADE.out).toBeLessThan(length / 2);
  });
});

describe('PRELUDE（序 / M14-2）', () => {
  const perBeat = secondsPerBeat(BEAT_GRID);
  const end = PRELUDE.time + (PRELUDE.duration ?? 0);

  it('出る時刻と消える時刻が拍の上に載っている', () => {
    // 区間の頭・終わり・フェードと同じ扱い（許容 0.05 拍 ≒ 38ms）。序は歌の前に
    // 置くものなので、拍から外れると**歌い出しへの繋がりだけが緩む**
    const offGrid = [PRELUDE.time, end]
      .map((time) => time / perBeat)
      .filter((beats) => Math.abs(beats - Math.round(beats)) >= 0.05);

    expect(offGrid).toStrictEqual([]);
  });

  it('頭のフェードが明けてから出る', () => {
    // 明ける前に出すと、序は薄れた状態で現れて途中から濃くなる。
    // 「無音から画が立ち上がり、そこへ一文が降りる」という順を守る
    expect(PRELUDE.time).toBeGreaterThan(WORK_FADE.in);
  });

  it('区間の中に収まっている', () => {
    expect(end).toBeLessThanOrEqual(WORK_WINDOW.end - WORK_WINDOW.start);
  });

  it('演出・構図・帳の名前が実在する', () => {
    // シートの綴りは lyric-sheets.test.ts が落とすが、**序はシートに載らない**ので
    // その網に掛からない。同じ壊れ方（綴り間違いは既定に落ちるか、黙って消える）を
    // ここで止める
    expect(PRELUDE.effect !== undefined && isEffectName(PRELUDE.effect)).toBe(true);
    expect(PRELUDE.place?.at !== undefined && isAnchorName(PRELUDE.place.at)).toBe(true);
    expect(PRELUDE.place?.size !== undefined && isSizeName(PRELUDE.place.size)).toBe(true);
    expect(PRELUDE.veil !== undefined && isVeilName(PRELUDE.veil)).toBe(true);
  });

  it('掲げる一文が縦組みで読める（ラテン文字を含まない）', () => {
    // 縦組みはラテン文字を横倒しにする（M4-3 で本編に対して決めた線）。
    // 序も同じ組み方なので、同じ制限が掛かる
    expect(/[\p{Script=Latin}\p{Nd}]/u.test(PRELUDE.text)).toBe(false);
  });

  it('語句に刻んでいない（一文を据え置く）', () => {
    // 帳の前提（stage/kanji-veil.ts）。刻むとカメラが語句を追い始め、
    // 据えた一文の上に帳を重ねるという形が崩れる
    expect(PRELUDE.parts).toBeUndefined();
  });
});
