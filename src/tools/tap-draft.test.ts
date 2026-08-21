import { describe, expect, it } from 'vitest';
import type { LyricSheet } from '../domain/lyrics';
import { resumeSession, startSession, tapIn, tapOut, toSheet } from '../domain/tap-session';
import { draftKey, draftStore, draftText, noDraftStore, type DraftStorage } from './tap-draft';

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

    expect(draftText(session)).toBe('[{"time":11},null,null]');
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
