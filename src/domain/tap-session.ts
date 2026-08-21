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
  readonly time: number;
  readonly end?: number;
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
  /**
   * 今の収録が始まった行。取り消しはここより前へは遡らない。
   *
   * pending だけでは足りない。行ごと取り消したときに次の取り消し先を
   * 決めるには「1 つ前の行も今の収録で叩いたのか」が要る。**この区切りが
   * 無いと、飛んだ地点を跨いで前回の収録成果まで消してしまう**。
   */
  readonly runStart: number;
}

/** 前の行と衝突している行。書き出す前に画面へ出すためのもの */
export interface OrderProblem {
  /**
   * 衝突している行の番号。**常に後ろ側の行**を指す。
   * 原因が前の行の打ち間違いであることも多いので、画面では前後どちらも見せる
   */
  readonly index: number;
  /**
   * previous-later: 前の行と同時か、前の行より前にある / overlap: 前の行の表示に食い込む。
   *
   * 性質は違う。previous-later は LyricSheet の不変条件（昇順）そのものの破れで、
   * overlap は読み込めはするが「間」が嘘になる品質の話。今は同じ強さで止めている
   */
  readonly reason: 'previous-later' | 'overlap';
}

/**
 * 衝突が残ったまま書き出そうとしたときの例外。
 *
 * 文面ではなく `problems` を持つ。「何行目の『どの歌詞』が」という言い回しは
 * 表示側の関心で、domain がそこまで決めるとメッセージを読み解かないと
 * 録り直す場所が分からなくなる。
 */
export class OrderConflictError extends Error {
  readonly problems: readonly OrderProblem[];

  constructor(problems: readonly OrderProblem[]) {
    super(`行の時刻が前の行と衝突しています（${problems.length} 箇所）`);
    this.name = 'OrderConflictError';
    this.problems = problems;
  }
}

/** 書き出す秒数の刻み。10ms は聴いて分かる差ではなく、JSON も読みやすい */
function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

/** 収録に使える時刻か。NaN や負の再生位置を記録させない */
function isValidTime(time: number): boolean {
  return Number.isFinite(time) && time >= 0;
}

/**
 * 元シートを土台に収録を始める。
 *
 * `source` は参照のまま持つ（書き出す行は複製する）。呼び出し側が元シートを
 * 後から書き換えると、このセッションの結果も変わる。
 */
export function startSession(source: LyricSheet): TapSession {
  return {
    source,
    takes: source.lines.map(() => undefined),
    cursor: 0,
    pending: NO_PENDING,
    runStart: 0,
  };
}

/** 今のセッションで時刻を持っている行の数 */
export function recordedCount(session: TapSession): number {
  return session.takes.filter((take) => take !== undefined).length;
}

/** 保存した下書きが読めなかったときの例外 */
export class TapDraftError extends Error {
  constructor(message: string) {
    super(`下書きが不正です: ${message}`);
    this.name = 'TapDraftError';
  }
}

/** 下書きの形。今の版は 1 */
const DRAFT_VERSION = 1;

/**
 * 収録途中の下書き。**保存されるのはこの形。**
 *
 * 持たせるのは `takes` と、それがどのシートのものかという印だけ。
 * `cursor` / `pending` / `runStart` は `resumeSession` が導出する。
 */
export interface TapDraft {
  readonly version: number;
  /** どのシートを録っていたか（下記 sheetFingerprint） */
  readonly sheet: string;
  readonly takes: readonly (Take | undefined)[];
}

/**
 * シートの指紋。歌詞が書き換われば合わなくなる値。
 *
 * 行数だけでは足りない。**1 行足して 1 行消したシート**には古い時刻が
 * そのまま載ってしまい、行数が合っているぶん気づけない。
 * 狙うのは取り違えの検出だけなので、短いハッシュ（FNV-1a）で足りる。
 */
export function sheetFingerprint(sheet: LyricSheet): string {
  const text = `${sheet.title}\n${sheet.lines.map((line) => line.text).join('\n')}`;

  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16);
}

/** 今の収録を下書きの形にする */
export function draftOf(session: TapSession): TapDraft {
  return {
    version: DRAFT_VERSION,
    sheet: sheetFingerprint(session.source),
    takes: session.takes,
  };
}

/**
 * 保存した下書きから収録を再開する。
 *
 * **セッションを外から手組みさせないための入口。** TapSession は
 * `runStart <= pending < cursor` と `[runStart, cursor)` に穴が無いことを
 * 守っており、画面側でオブジェクトリテラルを書くとその不変条件が
 * 規約でしか保たれなくなる（`pending: cursor - 1` の取り違えが再発する）。
 * だから**下書きに持たせるのは takes だけ**で、残りはここで導出する。
 *
 * - `cursor` は最後に録った行の次
 * - `pending` は無し。再開直後は終了も取り消しも働かない（まず開始を叩く）
 * - `runStart` は `cursor`。**取り消しは復元した分へは遡らない。**
 *   `moveCursorTo` で飛んだときと同じ扱いで、前の収録の成果を
 *   Backspace の連打で消せないようにするため
 *
 * `raw` を `unknown` で受けるのは、下書きの置き場所（localStorage）が
 * **手で書き換えられる外部入力**だから。`parseLyricSheet` と同じ立場。
 */
export function resumeSession(source: LyricSheet, raw: unknown): TapSession {
  const takes = parseDraft(raw, source);

  let cursor = 0;
  for (let index = takes.length - 1; index >= 0; index -= 1) {
    if (takes[index] !== undefined) {
      cursor = index + 1;
      break;
    }
  }

  // runStart === cursor なので [runStart, cursor) は空区間。
  // 復元した takes に穴があっても不変条件は保たれる
  return { source, takes, cursor, pending: NO_PENDING, runStart: cursor };
}

/**
 * 下書きの形を確かめる。
 *
 * 確かめるのは**形と、どのシートのものか**だけで、時刻の逆行や食い込みは
 * 弾かない。弾くと収録の成果がまるごと失われるが、通せば `orderProblems` が
 * 衝突として拾い、画面から録り直せる（下書きを守ることの方が大事）。
 */
function parseDraft(raw: unknown, source: LyricSheet): (Take | undefined)[] {
  if (typeof raw !== 'object' || raw === null) throw new TapDraftError('オブジェクトではありません');

  const { version, sheet, takes } = raw as Record<string, unknown>;

  if (version !== DRAFT_VERSION) throw new TapDraftError(`版が違います（${String(version)}）`);
  if (sheet !== sheetFingerprint(source)) {
    // 同じ名前のシートでも、歌詞が書き換わっていれば別物として扱う
    throw new TapDraftError('別のシート、または歌詞が書き換えられたシートのものです');
  }
  if (!Array.isArray(takes)) throw new TapDraftError('takes が配列ではありません');
  if (takes.length !== source.lines.length) {
    throw new TapDraftError(
      `行数が合いません（下書き ${takes.length} / シート ${source.lines.length}）`,
    );
  }

  return takes.map((value, index) => parseTake(value, index));
}

function parseTake(value: unknown, index: number): Take | undefined {
  // JSON では未収録の行が null になる（undefined は配列の穴として書き出される）
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object') throw new TapDraftError(`[${index}] がオブジェクトではありません`);

  const { time, end } = value as Record<string, unknown>;

  if (typeof time !== 'number' || !isValidTime(time)) {
    throw new TapDraftError(`[${index}].time が 0 以上の数値ではありません`);
  }
  if (end === undefined || end === null) return { time };

  if (typeof end !== 'number' || !isValidTime(end) || end <= time) {
    throw new TapDraftError(`[${index}].end が開始より後の数値ではありません`);
  }

  // 読んだ値をそのまま持たない。余計なプロパティを内側へ持ち込まないため
  return { time, end };
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
  return {
    source: session.source,
    takes,
    cursor: next.cursor,
    pending: next.pending,
    runStart: session.runStart,
  };
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
 * 裏を返すと、前の行の終了を叩いた直後に次の行を始める（隙間 0）ことはできず、
 * 最低 10ms の間が入る。表示の切り替わりとしては見えない差。
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
  if (session.pending === NO_PENDING) return session;

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
 * 録った順に遡れる）。ただし**今の収録の始まり（runStart）より前へは遡らない。**
 * 遡らせると、録り直しで飛ぶ前に録った行を消したり、その duration を
 * 後から書き換えたりできてしまう（取り消しているつもりの行とは別の行を触る）。
 */
export function undo(session: TapSession): TapSession {
  if (session.pending === NO_PENDING) return session;

  const take = session.takes[session.pending];
  if (!take) return session;

  const index = session.pending;
  if (take.end !== undefined) {
    return withTake(session, index, { time: take.time }, { cursor: session.cursor, pending: index });
  }

  const previous = index - 1;
  const inThisRun = previous >= session.runStart && session.takes[previous] !== undefined;
  return withTake(session, index, undefined, {
    cursor: index,
    pending: inThisRun ? previous : NO_PENDING,
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

  return {
    source: session.source,
    takes: session.takes,
    cursor: index,
    pending: NO_PENDING,
    // ここから新しい収録が始まる。取り消しはこれより前へ遡らない
    runStart: index,
  };
}

/**
 * 収録結果を行の並びにする。**書き出したらこうなる、という下見。**
 *
 * まだ叩いていない行は元の値のまま残るので、途中まで録って書き出せる。
 * **叩いた行の duration は終了の打鍵からしか作らない。** 元の duration を
 * 残すと、開始を録り直した行で「新しい開始 + 古い長さ」という、
 * どちらの収録にも属さない値ができてしまう。
 *
 * 衝突が残っていても返す（`toSheet` と違って投げない）。収録中の画面は
 * 「今どうなっているか」を出し続ける必要があり、衝突しているときこそ
 * その値を見せないと、どこを録り直せばよいか分からないため。
 */
export function previewLines(session: TapSession): readonly LyricLine[] {
  return buildLines(session);
}

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
  return problemsOf(buildLines(session));
}

function problemsOf(lines: readonly LyricLine[]): OrderProblem[] {
  const problems: OrderProblem[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const previous = lines[i - 1];
    if (lines[i].time <= previous.time) {
      problems.push({ index: i, reason: 'previous-later' });
      continue;
    }
    if (previous.duration === undefined) continue;

    // 足し算の結果は丸め直してから比べる。10ms の格子に載った値どうしでも
    // 和には誤差が出る（10 + 1.12 = 11.120000000000001）ので、
    // **前の行の終了と次の行の開始がぴったり同じ**という正しい並びを
    // 食い込みと読み違えてしまう
    if (round(previous.time + previous.duration) > lines[i].time) {
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
 * 画面は orderProblems を見て、この例外（OrderConflictError）に当たる前に知らせること。
 *
 * 衝突は「録った時刻」と「まだ元のままの推定時刻」の間にしか起きないので、
 * 指された行まで叩き進めれば必ず解消する。収録の成果が失われるわけではない。
 */
export function toSheet(session: TapSession): LyricSheet {
  const lines = buildLines(session);
  const problems = problemsOf(lines);
  if (problems.length > 0) throw new OrderConflictError(problems);

  return { title: session.source.title, lines };
}
