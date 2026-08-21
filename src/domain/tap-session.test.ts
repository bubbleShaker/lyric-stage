import { describe, expect, it } from 'vitest';
import { parseLyricSheet, type LyricSheet } from './lyrics';
import {
  moveCursorTo,
  NO_PENDING,
  orderProblems,
  startSession,
  tapIn,
  tapOut,
  toSheet,
  undo,
} from './tap-session';

/**
 * 元シート。text と effect は収録で変わらないことを見るために入れてある。
 * time は「収録し直す前の推定値」なので、叩く時刻（11 / 21 / 31）とは少しずれている。
 */
const sheet: LyricSheet = {
  title: 'テスト',
  lines: [
    { time: 10, text: 'いち', effect: 'fade' },
    { time: 20, text: 'に', effect: 'bounce' },
    { time: 30, text: 'さん', effect: 'zoom', duration: 6 },
  ],
};

/** 開始だけを順に叩いたセッションを作る */
function tappedAll(...times: number[]) {
  return times.reduce(tapIn, startSession(sheet));
}

describe('tapIn', () => {
  it('叩いた秒数がその行の time になり、次の行へ進む', () => {
    const session = tapIn(startSession(sheet), 10.5);

    expect(session.cursor).toBe(1);
    expect(toSheet(session).lines[0]).toEqual({ time: 10.5, text: 'いち', effect: 'fade' });
  });

  it('まだ叩いていない行は元の time のまま残る（途中まで録って書き出せる）', () => {
    const session = tapIn(startSession(sheet), 10.5);

    expect(toSheet(session).lines[1]).toEqual({ time: 20, text: 'に', effect: 'bounce' });
  });

  it('録り終わった後に叩いても何も起きない', () => {
    const session = tappedAll(11, 21, 31);

    expect(tapIn(session, 41)).toBe(session);
  });

  it('前に録った時刻より後でなければ記録しない（行の前後が入れ替わらない）', () => {
    const session = tappedAll(11, 21);

    expect(tapIn(session, 5)).toBe(session);
    expect(tapIn(session, 21)).toBe(session);
    expect(tapIn(session, 21.004)).toBe(session); // 丸めると同時刻になる連打
    expect(tapIn(session, 21.2).cursor).toBe(3);
  });

  it('前の行の終了より後であることを求める', () => {
    const session = tapOut(tapIn(startSession(sheet), 11), 15);

    expect(tapIn(session, 14)).toBe(session);
    expect(tapIn(session, 16).cursor).toBe(2);
  });

  it('録り直しで飛んだ先でも、前に録った行との前後を見る', () => {
    const session = moveCursorTo(tappedAll(11, 21, 31), 2);

    expect(tapIn(session, 15)).toBe(session);
  });

  it('負の時刻や NaN、Infinity は記録しない', () => {
    const session = startSession(sheet);

    expect(tapIn(session, -1)).toBe(session);
    expect(tapIn(session, NaN)).toBe(session);
    expect(tapIn(session, Infinity)).toBe(session);
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
    const session = tapOut(tapIn(startSession(sheet), 11), 14.25);

    expect(toSheet(session).lines[0]).toMatchObject({ time: 11, duration: 3.25 });
  });

  it('カーソルは進めない（次の行の開始はこれから叩く）', () => {
    const session = tapOut(tapIn(startSession(sheet), 11), 14);

    expect(session.cursor).toBe(1);
  });

  it('終了を叩かなかった行は duration を持たない（次の行まで表示）', () => {
    const session = tapIn(startSession(sheet), 11);

    expect(toSheet(session).lines[0].duration).toBeUndefined();
  });

  it('元の duration は引き継がない（新しい開始と古い長さの混ざった値を作らない）', () => {
    const session = tappedAll(11, 21, 31);

    expect(sheet.lines[2].duration).toBe(6);
    expect(toSheet(session).lines[2].duration).toBeUndefined();
  });

  it('開始より後でない打鍵は無視する', () => {
    const session = tapIn(startSession(sheet), 11);

    expect(tapOut(session, 11)).toBe(session);
    expect(tapOut(session, 10)).toBe(session);
  });

  it('まだ 1 行も叩いていなければ何も起きない', () => {
    const session = startSession(sheet);

    expect(tapOut(session, 5)).toBe(session);
  });

  it('録り直しで飛んだ直後は働かない（以前に録った行の duration を書き換えない）', () => {
    const session = moveCursorTo(tapOut(tapIn(startSession(sheet), 11), 14), 0);

    expect(tapOut(session, 25)).toBe(session);
    expect(toSheet(session).lines[0].duration).toBe(3);
  });

  it('丸めて 0 になるほど短い区間は間として書き出さない', () => {
    const session = tapOut(tapIn(startSession(sheet), 11), 11.001);

    expect(toSheet(session).lines[0].duration).toBeUndefined();
  });
});

describe('undo', () => {
  it('終了が記録されていれば終了だけを取り消す', () => {
    const session = undo(tapOut(tapIn(startSession(sheet), 11), 14));

    expect(session.cursor).toBe(1);
    expect(toSheet(session).lines[0]).toEqual({ time: 11, text: 'いち', effect: 'fade' });
  });

  it('終了が無ければ行ごと取り消してカーソルを戻す', () => {
    const session = undo(tapIn(startSession(sheet), 11));

    expect(session.cursor).toBe(0);
    expect(toSheet(session).lines[0].time).toBe(10);
  });

  it('何も記録していなければ何も起きない', () => {
    const session = startSession(sheet);

    expect(undo(session)).toBe(session);
  });

  it('繰り返すと収録前まで戻る', () => {
    let session = tapOut(tappedAll(11, 21), 26);
    for (let i = 0; i < 5; i += 1) session = undo(session);

    expect(session.cursor).toBe(0);
    expect(session.pending).toBe(NO_PENDING);
    expect(toSheet(session)).toEqual(sheet);
  });

  it('録り直しで飛んだ直後は働かない（以前に録った行を消さない）', () => {
    const session = moveCursorTo(tappedAll(11, 21), 0);

    expect(undo(session)).toBe(session);
  });
});

describe('moveCursorTo', () => {
  it('指定の行から録り直せる', () => {
    const session = tapIn(moveCursorTo(tappedAll(11, 21), 1), 22);

    expect(toSheet(session).lines[1].time).toBe(22);
  });

  it('既に記録した内容は残る', () => {
    const session = moveCursorTo(tapIn(startSession(sheet), 11), 0);

    expect(toSheet(session).lines[0].time).toBe(11);
  });

  it('録り終わりの位置（行数と同じ番号）には移せる', () => {
    expect(moveCursorTo(startSession(sheet), 3).cursor).toBe(3);
  });

  it('範囲外や整数でない指定は無視する', () => {
    const session = startSession(sheet);

    expect(moveCursorTo(session, -1)).toBe(session);
    expect(moveCursorTo(session, 4)).toBe(session);
    expect(moveCursorTo(session, 1.5)).toBe(session);
  });

  it('同じ位置への移動で、取り消し先が無いなら何も起きない', () => {
    const session = startSession(sheet);

    expect(moveCursorTo(session, 0)).toBe(session);
  });
});

describe('orderProblems', () => {
  it('収録前も、順に叩いている間も衝突しない', () => {
    expect(orderProblems(startSession(sheet))).toEqual([]);
    expect(orderProblems(tappedAll(11, 21))).toEqual([]);
  });

  it('録った時刻が後ろの未収録の行を追い越したら、その行を挙げる', () => {
    // 1 行目を 25 秒に録ると、まだ元の 20 秒のままの 2 行目より後になる
    const session = tapIn(startSession(sheet), 25);

    expect(orderProblems(session)).toEqual([{ index: 1, reason: 'previous-later' }]);
  });

  it('前の行の表示が次の行に食い込んだら挙げる', () => {
    // 1 行目を 11〜19 秒に録ると、元の 20 秒の 2 行目には掛からない
    expect(orderProblems(tapOut(tapIn(startSession(sheet), 11), 19))).toEqual([]);
    // 21 秒まで伸ばすと食い込む
    expect(orderProblems(tapOut(tapIn(startSession(sheet), 11), 21))).toEqual([
      { index: 1, reason: 'overlap' },
    ]);
  });

  it('録り直せば解消する', () => {
    const session = tapIn(startSession(sheet), 25);

    expect(orderProblems(tapIn(session, 26))).toEqual([]);
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

  it('途中まで録った結果も、読み直して歌詞の並びが変わらない', () => {
    const written = toSheet(tapIn(startSession(sheet), 11));

    expect(parseLyricSheet(JSON.parse(JSON.stringify(written))).lines.map((l) => l.text)).toEqual([
      'いち',
      'に',
      'さん',
    ]);
  });

  it('衝突が残っていたら書き出さず、録り直す行を伝える', () => {
    const session = tapIn(startSession(sheet), 25);

    expect(() => toSheet(session)).toThrow(/2 行目「に」/);
  });

  it('秒数は 10ms の刻みに丸める', () => {
    const session = tapOut(tapIn(startSession(sheet), 10.004), 12.006);

    // 開始は 10.00、終了は 12.01 に丸まる。duration はその差
    expect(toSheet(session).lines[0]).toMatchObject({ time: 10, duration: 2.01 });
  });

  it('time + duration が、丸めた終了の時刻と一致する', () => {
    const session = tapOut(tapIn(startSession(sheet), 10.004), 12.999);
    const line = toSheet(session).lines[0];

    expect(line.time + (line.duration ?? 0)).toBeCloseTo(13, 10);
  });

  it('刻みからはみ出す桁を JSON に書かない', () => {
    const session = tapOut(tappedAll(11, 21, 30.126), 36.128);
    const written = JSON.stringify(toSheet(session).lines[2]);

    expect(written).toContain('"duration":6');
    expect(written).not.toMatch(/\d\.\d{3}/);
  });

  it('title と、行の text・effect は収録で変わらない', () => {
    const written = toSheet(tapIn(startSession(sheet), 11));

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

  it('元のシートの行と同じオブジェクトを返さない（書き換えが波及しない）', () => {
    const written = toSheet(startSession(sheet));

    expect(written.lines[0]).not.toBe(sheet.lines[0]);
  });
});
