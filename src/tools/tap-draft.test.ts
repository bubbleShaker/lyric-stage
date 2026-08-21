import { describe, expect, it } from 'vitest';
import type { LyricSheet } from '../domain/lyrics';
import {
  moveCursorTo,
  resumeSession,
  sheetFingerprint,
  startSession,
  tapIn,
  tapOut,
  toSheet,
} from '../domain/tap-session';
import {
  discardDraft,
  draftKey,
  draftStore,
  draftText,
  keepDraft,
  noDraftStore,
  noticeShown,
  openDraft,
  type DraftStorage,
  type DraftStore,
} from './tap-draft';

const sheet: LyricSheet = {
  title: 'テスト',
  lines: [
    { time: 10, text: 'いち', effect: 'fade' },
    { time: 20, text: 'に', effect: 'bounce' },
    { time: 30, text: 'さん', effect: 'zoom', duration: 6 },
  ],
};

/** localStorage の代わり。中身を覗けるようにしてある */
function fakeStorage(initial: Record<string, string> = {}): DraftStorage & {
  items: Map<string, string>;
} {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

describe('draftText', () => {
  it('未収録の行も場所を残す（行の番号がずれない）', () => {
    const session = tapIn(startSession(sheet), 11);

    expect(JSON.parse(draftText(session))).toMatchObject({
      version: 1,
      takes: [{ time: 11 }, null, null],
    });
  });

  it('どのシートを録っていたかの印を持つ', () => {
    const stored = JSON.parse(draftText(startSession(sheet))) as { sheet: string };

    expect(stored.sheet).toBe(sheetFingerprint(sheet));
  });
});

describe('draftStore', () => {
  it('保存した下書きから、録った時刻がそのまま戻る', () => {
    const storage = fakeStorage();
    const store = draftStore(storage, 'shining-star');
    const session = tapOut(tapIn(startSession(sheet), 11), 15);

    store.save(session);
    const resumed = resumeSession(sheet, store.load());

    expect(toSheet(resumed).lines[0]).toEqual({
      time: 11,
      text: 'いち',
      effect: 'fade',
      duration: 4,
    });
  });

  it('まだ何も保存していなければ undefined', () => {
    expect(draftStore(fakeStorage(), 'shining-star').load()).toBeUndefined();
  });

  it('シートごとに分かれている（別の曲の時刻を読み込まない）', () => {
    const storage = fakeStorage();
    draftStore(storage, 'shining-star').save(tapIn(startSession(sheet), 11));

    expect(draftStore(storage, 'sample').load()).toBeUndefined();
  });

  it('破棄すると保存先からも消える', () => {
    const storage = fakeStorage();
    const store = draftStore(storage, 'shining-star');
    store.save(tapIn(startSession(sheet), 11));

    store.clear();

    expect(store.load()).toBeUndefined();
    expect(storage.items.size).toBe(0);
  });

  it('壊れた中身は投げる（再開の失敗として扱えるように）', () => {
    const storage = fakeStorage({ [draftKey('shining-star')]: '{壊れた' });

    expect(() => draftStore(storage, 'shining-star').load()).toThrow();
  });

  it('保存できないときは投げる（握り潰すと守られていないことに気づけない）', () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error('容量が足りません');
    };

    expect(() => draftStore(storage, 'shining-star').save(startSession(sheet))).toThrow();
  });
});

describe('noDraftStore', () => {
  it('何も覚えないが、呼んでも落ちない', () => {
    expect(noDraftStore.load()).toBeUndefined();
    expect(() => {
      noDraftStore.save(tapIn(startSession(sheet), 11));
      noDraftStore.clear();
    }).not.toThrow();
  });
});


/** 保存も読み込みも失敗する置き場所（容量超過や設定で止められている場面） */
function brokenStore(): DraftStore {
  return {
    load: () => {
      throw new Error('読めません');
    },
    save: () => {
      throw new Error('保存できません');
    },
    clear: () => {},
  };
}

describe('openDraft', () => {
  it('下書きが無ければ何も録っていない状態から始まる', () => {
    const state = openDraft(sheet, draftStore(fakeStorage(), 'sample'));

    expect(state).toMatchObject({ notice: '', trouble: '', hasDraft: false, saving: true });
    expect(state.session.cursor).toBe(0);
  });

  it('下書きがあれば自動で再開し、何行戻ったかを知らせる', () => {
    const storage = fakeStorage();
    const store = draftStore(storage, 'sample');
    store.save(tapIn(startSession(sheet), 11));

    const state = openDraft(sheet, store);

    expect(state.notice).toContain('1 行');
    expect(state.hasDraft).toBe(true);
    expect(toSheet(state.session).lines[0].time).toBe(11);
  });

  describe('読めない下書き', () => {
    const store = () => draftStore(fakeStorage({ [draftKey('sample')]: '{壊れた' }), 'sample');

    it('道具は起動する（収録は最初から始められる）', () => {
      const state = openDraft(sheet, store());

      expect(state.session.cursor).toBe(0);
      expect(state.trouble).not.toBe('');
      expect(state.error).toBeDefined();
    });

    it('自動保存を止める。**最初の 1 打鍵が上から書いて捨ててしまわないように**', () => {
      const state = openDraft(sheet, store());

      expect(state.saving).toBe(false);
    });

    it('こちらからは消さない（破棄ボタンを押せる状態にするに留める）', () => {
      const storage = fakeStorage({ [draftKey('sample')]: '{壊れた' });
      const state = openDraft(sheet, draftStore(storage, 'sample'));
      keepDraft(draftStore(storage, 'sample'), state, tapIn(state.session, 11));

      expect(storage.items.get(draftKey('sample'))).toBe('{壊れた');
      expect(state.hasDraft).toBe(true);
    });
  });
});

describe('keepDraft', () => {
  const opened = (storage: DraftStorage) => openDraft(sheet, draftStore(storage, 'sample'));

  it('録った内容が保存先に残る', () => {
    const storage = fakeStorage();
    const store = draftStore(storage, 'sample');
    const state = keepDraft(store, opened(storage), tapIn(startSession(sheet), 11));

    expect(state.hasDraft).toBe(true);
    expect(toSheet(openDraft(sheet, store).session).lines[0].time).toBe(11);
  });

  it('何も録っていないうちは下書きを作らない', () => {
    const storage = fakeStorage();
    const store = draftStore(storage, 'sample');
    // 行をクリックしただけ（カーソルは動くが時刻は入らない）
    const state = keepDraft(store, opened(storage), moveCursorTo(startSession(sheet), 2));

    expect(storage.items.size).toBe(0);
    expect(state.hasDraft).toBe(false);
  });

  it('保存に失敗したら、以後は保存を試みずに知らせ続ける', () => {
    const store = brokenStore();
    const failed = keepDraft(store, openDraft(sheet, noDraftStore), tapIn(startSession(sheet), 11));

    expect(failed.saving).toBe(false);
    expect(failed.trouble).not.toBe('');
    expect(failed.error).toBeDefined();

    // 次の打鍵は保存を試みない（try の中に入らないので error も付かない）
    const next = keepDraft(store, failed, tapIn(failed.session, 21));
    expect(next.trouble).toBe(failed.trouble);
    expect(next.error).toBeUndefined();
  });

  it('警告は消えない（打鍵を重ねても流れない）', () => {
    let state = keepDraft(brokenStore(), openDraft(sheet, noDraftStore), tapIn(startSession(sheet), 11));
    for (let i = 0; i < 5; i += 1) state = noticeShown(keepDraft(brokenStore(), state, state.session));

    expect(state.trouble).not.toBe('');
  });
});

describe('discardDraft', () => {
  it('保存先から消え、何も録っていない状態に戻る', () => {
    const storage = fakeStorage();
    const store = draftStore(storage, 'sample');
    const state = keepDraft(store, openDraft(sheet, store), tapIn(startSession(sheet), 11));

    const discarded = discardDraft(store, state);

    expect(storage.items.size).toBe(0);
    expect(discarded.hasDraft).toBe(false);
    expect(discarded.session.cursor).toBe(0);
    expect(discarded.notice).toContain('破棄');
  });

  it('読めない下書きを捨てたら、自動保存が戻る', () => {
    const storage = fakeStorage({ [draftKey('sample')]: '{壊れた' });
    const store = draftStore(storage, 'sample');

    const discarded = discardDraft(store, openDraft(sheet, store));

    expect(discarded.saving).toBe(true);
    expect(discarded.trouble).toBe('');
  });

  it('消せなかったら「破棄しました」と言わない（次に開くと戻ってくるため）', () => {
    const store: DraftStore = {
      load: () => undefined,
      save: () => {},
      clear: () => {
        throw new Error('消せません');
      },
    };
    const state = openDraft(sheet, store);

    const discarded = discardDraft(store, state);

    expect(discarded.notice).toBe('');
    expect(discarded.trouble).not.toBe('');
    expect(discarded.session).toBe(state.session);
  });
});

describe('noticeShown', () => {
  it('一度きりの知らせを落とす（収録はそのまま）', () => {
    const storage = fakeStorage();
    const store = draftStore(storage, 'sample');
    store.save(tapIn(startSession(sheet), 11));
    const resumed = openDraft(sheet, store);

    const shown = noticeShown(resumed);

    expect(resumed.notice).not.toBe('');
    expect(shown.notice).toBe('');
    expect(shown.session).toBe(resumed.session);
  });

  it('警告は落とさない（下書きが守られていない間は出し続ける）', () => {
    const store = draftStore(fakeStorage({ [draftKey('sample')]: '{壊れた' }), 'sample');

    const shown = noticeShown(openDraft(sheet, store));

    expect(shown.trouble).not.toBe('');
  });

  it('知らせが無ければ同じものを返す', () => {
    const state = openDraft(sheet, noDraftStore);

    expect(noticeShown(state)).toBe(state);
  });
});
