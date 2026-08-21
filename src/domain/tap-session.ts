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

/** 終了も取り消しも受け付ける行が無い状態 */
export const NO_PENDING = -1;

export interface TapSession {
  /** 元の歌詞シート。text と effect はここから持ち出す */
  readonly source: LyricSheet;
  /** source.lines と同じ長さ。まだ叩いていない行は undefined */
  readonly takes: readonly (Take | undefined)[];
  /** 次に開始を待っている行。行数と同じなら録り終わり */
  readonly cursor: number;
  /**
   * 直前に開始を叩いた行。終了（tapOut）と取り消し（undo）が働く先。
   *
   * 「cursor - 1」で代用しない。moveCursorTo で任意の行へ飛べる以上、
   * カーソルの 1 つ前が直前に叩いた行とは限らず、代用すると**飛んだ先で
   * 叩いた終了が、以前に録った別の行の duration を黙って書き換える**。
   */
  readonly pending: number;
}

/** 前の行と衝突している行。書き出す前に画面へ出すためのもの */
export interface OrderProblem {
  /** 衝突している行の番号 */
  index: number;
  /** previous-later: 前の行と同時か、前の行より前にある / overlap: 前の行の表示に食い込む */
  reason: 'previous-later' | 'overlap';
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
  return {
    source,
    takes: source.lines.map(() => undefined),
    cursor: 0,
    pending: NO_PENDING,
  };
}

/** takes の 1 要素だけを差し替えた新しいセッションを作る */
function withTake(
  session: TapSession,
  index: number,
  take: Take | undefined,
  next: { cursor: number; pending: number },
): TapSession {
  const takes = session.takes.slice();
  takes[index] = take;
  return { source: session.source, takes, cursor: next.cursor, pending: next.pending };
}

/** その行より前に、既に収録済みの時刻があるなら返す */
function recordedBefore(session: TapSession, index: number): number | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    const take = session.takes[i];
    if (take) return take.end ?? take.time;
  }
  return undefined;
}

/**
 * 今の行の開始を記録して次の行へ進む。
 *
 * 録り終わった後の打鍵は無視する（叩きすぎても落ちない）。
 * **前に録った時刻より後でなければ記録しない。** 逆行や同時刻を通すと、
 * 書き出したシートで行の前後が入れ替わる（歌詞の並びが変わってしまう）。
 * 比較は丸めた後の値で行う。書き出されるのはそちらなので、
 * 10ms 以内の連打も「同時刻」として弾ける。
 */
export function tapIn(session: TapSession, time: number): TapSession {
  if (session.cursor >= session.source.lines.length) return session;
  if (!isValidTime(time)) return session;

  const previous = recordedBefore(session, session.cursor);
  if (previous !== undefined && round(time) <= round(previous)) return session;

  return withTake(session, session.cursor, { time }, {
    cursor: session.cursor + 1,
    pending: session.cursor,
  });
}

/**
 * 直前に開始を叩いた行の終了を記録する（= その行の後に間が空く）。
 *
 * 終了を叩かなかった行は duration を持たず、次の行が来るまで表示され続ける。
 * 開始より後でない打鍵は無視する。duration: 0 のような不正なデータを作らないため。
 */
export function tapOut(session: TapSession, time: number): TapSession {
  const take = session.takes[session.pending];
  if (!take) return session;
  if (!isValidTime(time) || time <= take.time) return session;

  return withTake(session, session.pending, { time: take.time, end: time }, {
    cursor: session.cursor,
    pending: session.pending,
  });
}

/**
 * 直前の打鍵を取り消す。
 *
 * 終了が記録されていれば終了だけを、無ければ行ごと取り消してカーソルを戻す。
 * 行ごと取り消したら、その 1 つ前の行が新しい取り消し先になる（続けて叩けば
 * 録った順に遡れる）。ただし記録の無い行に当たったらそこで止まる。
 */
export function undo(session: TapSession): TapSession {
  const take = session.takes[session.pending];
  if (!take) return session;

  const index = session.pending;
  if (take.end !== undefined) {
    return withTake(session, index, { time: take.time }, { cursor: session.cursor, pending: index });
  }

  const previous = index - 1;
  return withTake(session, index, undefined, {
    cursor: index,
    pending: session.takes[previous] ? previous : NO_PENDING,
  });
}

/**
 * カーソルを任意の行へ移す（その行から録り直す）。
 * 範囲外の指定は無視する。既に記録した内容はそのまま残す。
 *
 * 飛んだ先では「直前に叩いた行」が無くなる。終了も取り消しも、
 * まずこの位置で開始を叩いてから。
 */
export function moveCursorTo(session: TapSession, index: number): TapSession {
  if (!Number.isInteger(index) || index < 0 || index > session.source.lines.length) return session;
  if (index === session.cursor && session.pending === NO_PENDING) return session;

  return { source: session.source, takes: session.takes, cursor: index, pending: NO_PENDING };
}

/**
 * 収録結果を行の並びにする。
 *
 * まだ叩いていない行は元の値のまま残るので、途中まで録って書き出せる。
 * **叩いた行の duration は終了の打鍵からしか作らない。** 元の duration を
 * 残すと、開始を録り直した行で「新しい開始 + 古い長さ」という、
 * どちらの収録にも属さない値ができてしまう。
 */
function buildLines(session: TapSession): LyricLine[] {
  return session.source.lines.map((line, index) => {
    const take = session.takes[index];
    // 未収録の行も複製する。返した行を書き換えられても元シートに波及しないため
    if (!take) return { ...line };

    // 元の duration はここで落ちる（残す判断は下の終了の打鍵だけが持つ）
    const { duration: _original, ...rest } = line;
    const time = round(take.time);
    const recorded: LyricLine = { ...rest, time };

    if (take.end !== undefined) {
      // 丸めた後の値どうしで引く。time + duration が書き出した終了と一致する。
      // 引き算の結果も丸め直す（6.0000000000000036 のような値を JSON に書かない）
      const duration = round(round(take.end) - time);
      // 丸めた結果 0 になるほど短い区間は、間として書き出さない
      if (duration > 0) recorded.duration = duration;
    }

    return recorded;
  });
}

/**
 * 前の行と衝突している行を返す。空なら書き出せる。
 *
 * 収録の途中では、**録った時刻と元シートの時刻が混ざる**。録った時刻が
 * 後ろの未収録の行より後になると、書き出した JSON を読み直したときに
 * （parseLyricSheet が time で整列するので）歌詞の並びが変わってしまう。
 * 順番を直すために並べ替えるわけにはいかない（歌詞の順は作者が決めたもの）ので、
 * **どの行から録り直せばよいかを画面に出せる形で返す。**
 */
export function orderProblems(session: TapSession): OrderProblem[] {
  const lines = buildLines(session);
  const problems: OrderProblem[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const previous = lines[i - 1];
    if (lines[i].time <= previous.time) {
      problems.push({ index: i, reason: 'previous-later' });
    } else if (previous.duration !== undefined && previous.time + previous.duration > lines[i].time) {
      problems.push({ index: i, reason: 'overlap' });
    }
  }

  return problems;
}

/**
 * 収録結果を歌詞シートにする。書き出す JSON の中身。
 *
 * 衝突が残っていたら書き出さない。LyricSheet は「time の昇順に整列済み」を
 * 名乗る型で、表示側（activeLineIndexAt）は二分探索でそれに依存している。
 * 壊れたシートを黙って作る方が、書き出せないことより悪い。
 * 画面は orderProblems を見て、この例外に当たる前に知らせること。
 */
export function toSheet(session: TapSession): LyricSheet {
  const problems = orderProblems(session);
  if (problems.length > 0) {
    const { index } = problems[0];
    throw new Error(
      `${index + 1} 行目「${session.source.lines[index].text}」の時刻が前の行と衝突しています。この行から録り直してください`,
    );
  }

  return { title: session.source.title, lines: buildLines(session) };
}
