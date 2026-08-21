import { describe, expect, it } from 'vitest';
import { parseLyricSheet, type LyricSheet } from './lyrics';
import { moveCursorTo, startSession, tapIn, tapOut, toSheet, undo } from './tap-session';

/** 元シート。text と effect は収録で変わらないことを見るために入れてある */
const sheet: LyricSheet = {
  title: 'テスト',
  lines: [
    { time: 1, text: 'いち', effect: 'fade' },
    { time: 2, text: 'に', effect: 'bounce' },
    { time: 3, text: 'さん', effect: 'zoom', duration: 6 },
  ],
};

describe('tapIn', () => {
  it('叩いた秒数がその行の time になり、次の行へ進む', () => {
    const session = tapIn(startSession(sheet), 10.5);

    expect(session.cursor).toBe(1);
    expect(toSheet(session).lines[0]).toEqual({ time: 10.5, text: 'いち', effect: 'fade' });
  });

  it('まだ叩いていない行は元の time のまま残る（途中まで録って書き出せる）', () => {
    const session = tapIn(startSession(sheet), 10.5);

    expect(toSheet(session).lines[1]).toEqual({ time: 2, text: 'に', effect: 'bounce' });
  });

  it('録り終わった後に叩いても何も起きない', () => {
    let session = startSession(sheet);
    for (const time of [10, 20, 30]) session = tapIn(session, time);

    expect(tapIn(session, 40)).toBe(session);
  });

  it('負の時刻や NaN は記録しない', () => {
    const session = startSession(sheet);

    expect(tapIn(session, -1)).toBe(session);
    expect(tapIn(session, NaN)).toBe(session);
  });

  it('元のセッションを書き換えない', () => {
    const session = startSession(sheet);
    tapIn(session, 10.5);

    expect(session.cursor).toBe(0);
    expect(session.takes[0]).toBeUndefined();
  });
});

describe('tapOut', () => {
  it('開始から終了までが duration になる', () => {
    let session = tapIn(startSession(sheet), 10);
    session = tapOut(session, 13.25);

    expect(toSheet(session).lines[0]).toMatchObject({ time: 10, duration: 3.25 });
  });

  it('カーソルは進めない（次の行の開始はこれから叩く）', () => {
    const session = tapOut(tapIn(startSession(sheet), 10), 13);

    expect(session.cursor).toBe(1);
  });

  it('終了を叩かなかった行は duration を持たない（次の行まで表示）', () => {
    const session = tapIn(startSession(sheet), 10);

    expect(toSheet(session).lines[0].duration).toBeUndefined();
  });

  it('元の duration は引き継がない（新しい開始と古い長さの混ざった値を作らない）', () => {
    const session = tapIn(tapIn(tapIn(startSession(sheet), 10), 20), 30);

    expect(sheet.lines[2].duration).toBe(6);
    expect(toSheet(session).lines[2].duration).toBeUndefined();
  });

  it('開始より後でない打鍵は無視する', () => {
    const session = tapIn(startSession(sheet), 10);

    expect(tapOut(session, 10)).toBe(session);
    expect(tapOut(session, 9)).toBe(session);
  });

  it('まだ 1 行も叩いていなければ何も起きない', () => {
    const session = startSession(sheet);

    expect(tapOut(session, 5)).toBe(session);
  });

  it('丸めて 0 になるほど短い区間は間として書き出さない', () => {
    const session = tapOut(tapIn(startSession(sheet), 10), 10.001);

    expect(toSheet(session).lines[0].duration).toBeUndefined();
  });
});

describe('undo', () => {
  it('終了が記録されていれば終了だけを取り消す', () => {
    const before = tapIn(startSession(sheet), 10);
    const session = undo(tapOut(before, 13));

    expect(session.cursor).toBe(1);
    expect(toSheet(session).lines[0].duration).toBeUndefined();
    expect(toSheet(session).lines[0].time).toBe(10);
  });

  it('終了が無ければ行ごと取り消してカーソルを戻す', () => {
    const session = undo(tapIn(startSession(sheet), 10));

    expect(session.cursor).toBe(0);
    expect(toSheet(session).lines[0].time).toBe(1);
  });

  it('何も記録していなければ何も起きない', () => {
    const session = startSession(sheet);

    expect(undo(session)).toBe(session);
  });

  it('繰り返すと収録前まで戻る', () => {
    let session = tapOut(tapIn(tapIn(startSession(sheet), 10), 20), 26);
    for (let i = 0; i < 5; i += 1) session = undo(session);

    expect(session.cursor).toBe(0);
    expect(toSheet(session)).toEqual(sheet);
  });
});

describe('moveCursorTo', () => {
  it('指定の行から録り直せる', () => {
    let session = tapIn(tapIn(startSession(sheet), 10), 20);
    session = tapIn(moveCursorTo(session, 1), 21);

    expect(toSheet(session).lines[1].time).toBe(21);
  });

  it('既に記録した内容は残る', () => {
    const session = moveCursorTo(tapIn(startSession(sheet), 10), 0);

    expect(toSheet(session).lines[0].time).toBe(10);
  });

  it('範囲外や整数でない指定は無視する', () => {
    const session = startSession(sheet);

    expect(moveCursorTo(session, -1)).toBe(session);
    expect(moveCursorTo(session, 4)).toBe(session);
    expect(moveCursorTo(session, 1.5)).toBe(session);
  });
});

describe('toSheet', () => {
  it('書き出した JSON がそのまま歌詞シートとして読み込める', () => {
    let session = startSession(sheet);
    session = tapOut(tapIn(session, 10.004), 12.006);
    session = tapIn(session, 20.5);
    session = tapOut(tapIn(session, 30.126), 36.128);

    const written = toSheet(session);
    // 書き出しは JSON を経由するので、その往復に耐えることまで見る
    expect(parseLyricSheet(JSON.parse(JSON.stringify(written)))).toEqual(written);
  });

  it('秒数は 10ms の刻みに丸める', () => {
    const session = tapOut(tapIn(startSession(sheet), 10.004), 12.006);

    expect(toSheet(session).lines[0]).toMatchObject({ time: 10, duration: 2 });
  });

  it('title と、行の text・effect は収録で変わらない', () => {
    const session = tapIn(startSession(sheet), 10);
    const written = toSheet(session);

    expect(written.title).toBe('テスト');
    expect(written.lines.map((line) => `${line.text}:${line.effect}`)).toEqual([
      'いち:fade',
      'に:bounce',
      'さん:zoom',
    ]);
  });

  it('1 行も叩いていなければ元のシートと同じ', () => {
    expect(toSheet(startSession(sheet))).toEqual(sheet);
  });
});
