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

import type { LyricSheet } from '../domain/lyrics';
import {
  draftOf,
  recordedCount,
  resumeSession,
  startSession,
  type TapSession,
} from '../domain/tap-session';

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
 * 下書きの中身。形を決めるのは domain（`draftOf`）で、ここは文字にするだけ。
 *
 * JSON の配列は `undefined` を書けないので、未収録の行は `null` になる
 * （`resumeSession` はどちらも未収録として読む）。
 */
export function draftText(session: TapSession): string {
  return JSON.stringify(draftOf(session));
}

/**
 * 保存先の名前。**シートごとに分ける。**
 * 本編と `?lyrics=sample` の下書きが混ざると、行数が合っているぶん
 * 気づかないまま別の曲の時刻を読み込むことになる（中身の指紋は
 * `resumeSession` が見るので、ここは置き場所を分けるだけ）。
 *
 * 名前は `?lyrics=` から来るが、`loadLyricSheet` の検証を通ったものしか
 * 渡らない（この道具は `tap-main.ts` がシートを読めた後に組み立てる）。
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
 * 使える保存先が無いときの置き場所。`localStorage` が使えない場面
 * （ブラウザの設定で保存を止めている等）で使う。**道具そのものは動き続ける**
 * （下書きが残らないだけで、収録も書き出しもできる）。
 *
 * **保存を求められたら投げる。**黙って受け取って捨てると、`keepDraft` は
 * 成功として扱い「下書きがある」ことにしてしまう。画面には警告が出ず、
 * 破棄ボタンだけが点灯し、閉じれば全部消える —
 * **守られているつもりで守られていない**という、一番まずい形になる。
 */
export const unavailableDraftStore: DraftStore = {
  load: () => undefined,
  save: () => {
    throw new Error('下書きの保存先がありません');
  },
  clear: () => {},
};

/**
 * 収録と下書きの噛み合わせ。**DOM を触らない。**
 *
 * 「読めなかったら自動保存を止める」「保存に失敗したら知らせ続ける」
 * といった判断は、画面の組み立てに混ぜると検査できないまま増える。
 * 実際、下書きが読めないときに**最初の 1 打鍵が上書きしてしまう**という
 * 不具合はここが画面側に散っていたときに生まれた。
 */
export interface DraftState {
  readonly session: TapSession;
  /**
   * 一度だけ出す知らせ。出したら noticeShown で落とす。
   *
   * **文面ではなく「何が起きたか」を持つ。**言い回しは表示側の関心で、
   * ここが決めると文面を読み解かないと状態が分からなくなる
   * （domain の OrderConflictError が problems を持つのと同じ判断）
   */
  readonly notice?: DraftNotice;
  /** 下書きが守られていないことの知らせ。**直るまで消さない** */
  readonly trouble?: DraftTrouble;
  /** 保存先に下書きが在るか（破棄ボタンを押せるか） */
  readonly hasDraft: boolean;
  /** 自動保存が生きているか。止まっている間は保存先に触らない */
  readonly saving: boolean;
  /**
   * 直近に起きた不具合。呼び出し側がコンソールへ出す。
   * **持ち回る遷移もある**（noticeShown）ので、出す側は
   * 「前と違う不具合か」で二重出力を防ぐこと
   */
  readonly error?: unknown;
}

/** 一度だけ出す知らせ。再開したときは「何行戻ったか」も要る */
export type DraftNotice = { readonly kind: 'resumed'; readonly recorded: number } | {
  readonly kind: 'discarded';
};

/**
 * 下書きが守られていない理由。
 *
 * - unreadable: 保存されていたものを読めなかった（壊れている・別のシート・古い形式）
 * - save-failed: 保存できない（容量、保存先が無い）
 * - clear-failed: 破棄できなかった
 */
export type DraftTrouble = 'unreadable' | 'save-failed' | 'clear-failed';

/**
 * 下書きがあれば読んで収録を始める。**自動で再開する。**
 *
 * 「再開しますか」と聞く形にすると、押し忘れて上から録り直し、
 * 下書きを上書きするという、塞ごうとしている事故が形を変えて残る。
 */
export function openDraft(sheet: LyricSheet, store: DraftStore): DraftState {
  const empty: DraftState = { session: startSession(sheet), hasDraft: false, saving: true };

  try {
    const raw = store.load();
    if (raw === undefined) return empty;

    const session = resumeSession(sheet, raw);
    return {
      ...empty,
      session,
      hasDraft: true,
      notice: { kind: 'resumed', recorded: recordedCount(session) },
    };
  } catch (error) {
    // 読めない下書きは**こちらからは消さない**（手で直せば救えるかもしれない
    // 唯一の控えを勝手に捨てない）。ただし消さないだけでは足りず、
    // **自動保存も止めないと最初の 1 打鍵が上から書いて同じことになる。**
    // 捨てるかどうかは破棄（＝人の意思）に委ねる
    return { ...empty, hasDraft: true, saving: false, trouble: 'unreadable', error };
  }
}

/** 収録が進んだ状態にして、下書きに残す */
export function keepDraft(store: DraftStore, state: DraftState, session: TapSession): DraftState {
  const next: DraftState = { ...state, session, error: undefined };

  if (!state.saving) return next;
  // 何も録っていないうちは下書きを作らない（行をクリックしただけで
  // 中身の無い下書きが残り、次に開くと「0 行から再開」になる）
  if (!state.hasDraft && recordedCount(session) === 0) return next;

  try {
    store.save(session);
    // **trouble は「今この瞬間守られていないか」。**保存が通ったなら消す。
    // 残すと、破棄に失敗した後などに、実際は保存できているのに
    // 警告だけが案内欄へ貼り付いたまま抜け出せなくなる
    return { ...next, hasDraft: true, trouble: undefined };
  } catch (error) {
    // 容量や設定が理由なら次も失敗する。毎打鍵で投げ続けさせない
    return { ...next, saving: false, trouble: 'save-failed', error };
  }
}

/**
 * 下書きを捨てて最初から録り直す。
 *
 * 消せなかったときに「破棄しました」と出さない。次に開いたときに
 * 消したはずの下書きから再開することになり、何が起きたのか分からなくなる。
 */
export function discardDraft(store: DraftStore, state: DraftState): DraftState {
  try {
    store.clear();
  } catch (error) {
    return { ...state, trouble: 'clear-failed', error };
  }

  return {
    session: startSession(state.session.source),
    notice: { kind: 'discarded' },
    // 読めない下書きを守るために止めていた自動保存は、捨てた今こそ戻す
    hasDraft: false,
    saving: true,
  };
}

/** 一度きりの知らせを出し終えた状態 */
export function noticeShown(state: DraftState): DraftState {
  if (state.notice === undefined) return state;
  return { ...state, notice: undefined };
}
