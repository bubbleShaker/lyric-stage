import { describe, expect, it } from 'vitest';
import { parseLyricSheet, type LyricSheet } from '../domain/lyrics';
import {
  moveCursorTo,
  OrderConflictError,
  startSession,
  tapIn,
  tapOut,
} from '../domain/tap-session';
import type { DraftTrouble } from './tap-draft';
import { buildView, draftNoticeText, draftTroubleText, exportText, formatSeconds } from './tap-view';

const sheet: LyricSheet = {
  title: 'テスト',
  lines: [
    { time: 10, text: 'いち', effect: 'fade' },
    { time: 20, text: 'に', effect: 'bounce' },
    { time: 30, text: 'さん', effect: 'zoom', duration: 6 },
  ],
};

describe('buildView', () => {
  it('書き出したらこうなる、という値を並べる', () => {
    const view = buildView(tapOut(tapIn(startSession(sheet), 11), 15));

    expect(view.rows[0]).toMatchObject({ text: 'いち', time: 11, duration: 4, recorded: true });
    // まだ叩いていない行は元の推定値のまま
    expect(view.rows[1]).toMatchObject({ time: 20, recorded: false });
  });

  it('今の行と、終了を受け付ける行が分かる', () => {
    const view = buildView(tapIn(startSession(sheet), 11));

    expect(view.rows.map((row) => row.current)).toEqual([false, true, false]);
    expect(view.rows.map((row) => row.open)).toEqual([true, false, false]);
  });

  it('録り直しで飛んだ直後は、終了を受け付ける行が無い', () => {
    const view = buildView(moveCursorTo(tapIn(startSession(sheet), 11), 0));

    expect(view.rows.some((row) => row.open)).toBe(false);
  });

  it('衝突は、その行と相手（前の行）の両方に印を付ける', () => {
    const view = buildView(tapIn(startSession(sheet), 25));

    expect(view.rows[0].problemPartner).toBe(true);
    expect(view.rows[1].problem).toBe('previous-later');
    expect(view.rows[2].problem).toBeUndefined();
  });

  it('衝突が残っている間は書き出させない', () => {
    expect(buildView(tapIn(startSession(sheet), 25)).canExport).toBe(false);
    expect(buildView(tapIn(startSession(sheet), 11)).canExport).toBe(true);
  });

  it('進み具合を数える', () => {
    const view = buildView(tapIn(tapIn(startSession(sheet), 11), 21));

    expect(view.recorded).toBe(2);
    expect(view.total).toBe(3);
  });

  it('次に叩くものを案内する', () => {
    expect(buildView(startSession(sheet)).hint).toContain('Space で 1 行目の開始');
    expect(buildView(tapIn(startSession(sheet), 11)).hint).toContain('Enter で 1 行目の終了');
    expect(buildView(tapIn(tapIn(tapIn(startSession(sheet), 11), 21), 31)).hint).toContain(
      '全ての行を録りました',
    );
  });

  it('衝突しているときは、それを最初に伝える', () => {
    expect(buildView(tapIn(startSession(sheet), 25)).hint).toContain('衝突');
  });
});

describe('exportText', () => {
  it('書き出した文字列が、そのまま歌詞シートとして読み直せる', () => {
    const session = tapOut(tapIn(tapIn(startSession(sheet), 11.004), 21.5), 27.006);
    const written = exportText(session);

    expect(parseLyricSheet(JSON.parse(written))).toEqual({
      title: 'テスト',
      lines: [
        { time: 11, text: 'いち', effect: 'fade' },
        { time: 21.5, text: 'に', effect: 'bounce', duration: 5.51 },
        { time: 30, text: 'さん', effect: 'zoom', duration: 6 },
      ],
    });
  });

  it('人が読める形で、末尾に改行がある（ファイルに貼るため）', () => {
    const written = exportText(startSession(sheet));

    expect(written).toContain('\n  "lines": [');
    expect(written.endsWith('\n')).toBe(true);
  });

  it('衝突が残っていれば書き出さない', () => {
    expect(() => exportText(tapIn(startSession(sheet), 25))).toThrow(OrderConflictError);
  });
});

describe('formatSeconds', () => {
  it('桁を揃える', () => {
    expect(formatSeconds(12.3)).toBe('12.30');
    expect(formatSeconds(0)).toBe('0.00');
  });
});


describe('draftNoticeText', () => {
  it('再開したときは何行戻ったかを言う', () => {
    expect(draftNoticeText({ kind: 'resumed', recorded: 12 })).toContain('12 行');
  });

  it('破棄したときは最初から録れることを言う', () => {
    expect(draftNoticeText({ kind: 'discarded' })).toContain('破棄');
  });

  it('知らせが無ければ何も出さない', () => {
    expect(draftNoticeText(undefined)).toBe('');
  });
});

describe('draftTroubleText', () => {
  const troubles: DraftTrouble[] = ['unreadable', 'save-failed', 'clear-failed'];

  it.each(troubles)('%s には必ず文面がある（黙って消えない）', (trouble) => {
    expect(draftTroubleText({ trouble, saving: false })).not.toBe('');
  });

  it('何も起きていなければ何も出さない', () => {
    expect(draftTroubleText({ saving: true })).toBe('');
  });

  it('自動保存が止まっていることは、直近の不具合が何であれ必ず言う', () => {
    // 破棄の失敗が「保存が止まっている」を押し流さないこと。
    // 読めない下書きを捨てそこねた場面がまさにこれ
    for (const trouble of troubles) {
      expect(draftTroubleText({ trouble, saving: false })).toContain('自動保存は止まっています');
    }
  });

  it('保存が生きているなら、止まっているとは言わない', () => {
    expect(draftTroubleText({ trouble: 'clear-failed', saving: true })).not.toContain(
      '自動保存は止まっています',
    );
  });

  it('読めない下書きでは、破棄すると今録った分も消えることを言う', () => {
    expect(draftTroubleText({ trouble: 'unreadable', saving: false })).toContain('今録った分も消えます');
  });
});
