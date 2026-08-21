/**
 * タイミング収録の状態と操作。
 *
 * 「再生しながらキーを叩くと、その秒数が行に焼かれる」という M6 の中身のうち、
 * DOM も音も要らない部分だけをここに置く。キーの割り当ても JSON の書き出しも
 * 知らないので、ブラウザ無しでテストできる。
 *
 * 状態は書き換えず、操作するたびに新しい値を返す。取り消し（undo）が
 * 「1 つ前の値に戻す」ではなく「1 つ前の操作を打ち消す」で書けるのと、
 * 収録中の画面が「今の値」を持つだけで済むため。
 */

import type { LyricLine, LyricSheet } from './lyrics';

/**
 * 1 行分の収録結果。
 *
 * `end` は終了を叩いた時刻（秒）で、叩かなければ持たない。
 * 差ではなく時刻そのものを持つのは、記録の時点では引き算をする理由が無く、
 * 「叩いた瞬間」をそのまま残す方が後から読み解きやすいため。
 */
export interface Take {
  time: number;
  end?: number;
}

export interface TapSession {
  /** 元の歌詞シート。text と effect はここから持ち出す */
  readonly source: LyricSheet;
  /** source.lines と同じ長さ。まだ叩いていない行は undefined */
  readonly takes: readonly (Take | undefined)[];
  /** 次に開始を待っている行。行数と同じなら録り終わり */
  readonly cursor: number;
}

/** 書き出す秒数の刻み。10ms は聴いて分かる差ではなく、JSON も読みやすい */
function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

/** 収録に使える時刻か。NaN や負の再生位置を記録させない */
function isValidTime(time: number): boolean {
  return Number.isFinite(time) && time >= 0;
}

export function startSession(source: LyricSheet): TapSession {
  return { source, takes: source.lines.map(() => undefined), cursor: 0 };
}

/** takes の 1 要素だけを差し替えた新しいセッションを作る */
function withTake(session: TapSession, index: number, take: Take | undefined, cursor: number): TapSession {
  const takes = session.takes.slice();
  takes[index] = take;
  return { source: session.source, takes, cursor };
}

/**
 * 今の行の開始を記録して次の行へ進む。
 * 録り終わった後の打鍵は無視する（叩きすぎても落ちない）。
 */
export function tapIn(session: TapSession, time: number): TapSession {
  if (session.cursor >= session.source.lines.length) return session;
  if (!isValidTime(time)) return session;

  return withTake(session, session.cursor, { time }, session.cursor + 1);
}

/**
 * 直前に開始を記録した行の終了を記録する（= その行の後に間が空く）。
 *
 * 終了を叩かなかった行は duration を持たず、次の行が来るまで表示され続ける。
 * 開始より後でない打鍵は無視する。duration: 0 のような不正なデータを作らないため。
 */
export function tapOut(session: TapSession, time: number): TapSession {
  const index = session.cursor - 1;
  const take = session.takes[index];
  if (!take) return session;
  if (!isValidTime(time) || time <= take.time) return session;

  return withTake(session, index, { time: take.time, end: time }, session.cursor);
}

/**
 * 直前の打鍵を取り消す。
 *
 * 終了が記録されていれば終了だけを、無ければ行ごと取り消してカーソルを戻す。
 * 打鍵は必ず「開始 → 終了」の順にしかならないので、履歴を持たなくても
 * この導出で直前の操作が分かる。
 */
export function undo(session: TapSession): TapSession {
  const index = session.cursor - 1;
  const take = session.takes[index];
  if (!take) return session;

  if (take.end !== undefined) {
    return withTake(session, index, { time: take.time }, session.cursor);
  }
  return withTake(session, index, undefined, index);
}

/**
 * カーソルを任意の行へ移す（その行から録り直す）。
 * 範囲外の指定は無視する。既に記録した内容はそのまま残す。
 */
export function moveCursorTo(session: TapSession, index: number): TapSession {
  if (!Number.isInteger(index) || index < 0 || index > session.source.lines.length) return session;

  return { source: session.source, takes: session.takes, cursor: index };
}

/**
 * 収録結果を歌詞シートにする。書き出す JSON の中身。
 *
 * まだ叩いていない行は元の値のまま残るので、途中まで録って書き出せる。
 * **叩いた行の duration は終了の打鍵からしか作らない。** 元の duration を
 * 残すと、開始を録り直した行で「新しい開始 + 古い長さ」という、
 * どちらの収録にも属さない値ができてしまう。
 */
export function toSheet(session: TapSession): LyricSheet {
  const lines = session.source.lines.map((line, index) => {
    const take = session.takes[index];
    if (!take) return line;

    const recorded: LyricLine = { ...line, time: round(take.time) };
    delete recorded.duration;

    if (take.end !== undefined) {
      const duration = round(take.end - take.time);
      // 丸めた結果 0 になるほど短い区間は、間として書き出さない
      if (duration > 0) recorded.duration = duration;
    }

    return recorded;
  });

  return { title: session.source.title, lines };
}
