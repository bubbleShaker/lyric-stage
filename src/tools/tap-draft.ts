/**
 * 収録途中の下書きの置き場所。
 *
 * `toSheet` は衝突が残っていると書き出さない。それは正しいが、そのぶん
 * **リロードすると収録の途中が丸ごと消える**という一点が残るので、ここで塞ぐ。
 * 「壊れていても書き出す」抜け道を作るより、途中の状態を残す方がよい。
 *
 * 保存するのは `takes` だけ。`cursor` / `pending` / `runStart` は
 * `resumeSession` が導出する（TapSession の不変条件を外から手組みさせないため）。
 */

import type { TapSession } from '../domain/tap-session';

/**
 * `localStorage` のうち、この道具が使う部分だけ。
 *
 * 本物を直に触らず注入するのは、下書きの出し入れがこの道具の**成果物を守る**
 * 仕組みそのものだから。ブラウザ無しで検査できる形にしておく。
 */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DraftStore {
  /**
   * 保存済みの下書き。まだ無ければ undefined。
   *
   * 返すのは `unknown`。**中身の検証は domain の `resumeSession` が持つ**
   * （形の決まりは TapSession のもので、置き場所の都合ではない）。
   * 壊れた JSON なら投げる。呼び出し側は再開の失敗として一緒に扱えばよい。
   */
  load(): unknown;
  /** 保存する。失敗（容量超過など）は投げる。握り潰すと収録が守られていないことに気づけない */
  save(session: TapSession): void;
  clear(): void;
}

/**
 * 下書きの中身。`takes` の配列そのもの。
 *
 * JSON の配列は `undefined` を書けないので、未収録の行は `null` になる
 * （`resumeSession` はどちらも未収録として読む）。
 */
export function draftText(session: TapSession): string {
  return JSON.stringify(session.takes);
}

/**
 * 保存先の名前。**シートごとに分ける。**
 * 本編と `?lyrics=sample` の下書きが混ざると、行数が合っているぶん
 * 気づかないまま別の曲の時刻を読み込むことになる。
 */
export function draftKey(sheetName: string): string {
  return `lyric-stage:tap-draft:${sheetName}`;
}

export function draftStore(storage: DraftStorage, sheetName: string): DraftStore {
  const key = draftKey(sheetName);

  return {
    load: () => {
      const text = storage.getItem(key);
      if (text === null) return undefined;
      return JSON.parse(text) as unknown;
    },
    save: (session) => {
      storage.setItem(key, draftText(session));
    },
    clear: () => {
      storage.removeItem(key);
    },
  };
}

/**
 * 何も覚えない置き場所。`localStorage` が使えない場面（ブラウザの設定で
 * 保存を止めている等）で使う。**道具そのものは動き続ける**（下書きが
 * 残らないだけで、収録も書き出しもできる）。
 */
export const noDraftStore: DraftStore = {
  load: () => undefined,
  save: () => {},
  clear: () => {},
};
