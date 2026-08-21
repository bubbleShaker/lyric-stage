/**
 * 収録画面に出す値の組み立て。
 *
 * DOM を触らない。「どう見せるか」の判断（どの行が今の行か、どこが衝突しているか、
 * 書き出せるか）をここに集めると、画面の描き方を変えても判断は変わらないし、
 * ブラウザ無しで検査できる。
 */

import {
  NO_PENDING,
  orderProblems,
  previewLines,
  toSheet,
  type OrderProblem,
  type TapSession,
} from '../domain/tap-session';

export interface TapRow {
  index: number;
  text: string;
  effect?: string;
  /** 書き出したらこうなる、という値 */
  time: number;
  duration?: number;
  /** 今回の収録で叩いた行（false なら元シートの推定値のまま） */
  recorded: boolean;
  /** 次に開始を叩く行 */
  current: boolean;
  /** 終了と取り消しを受け付ける行 */
  open: boolean;
  /** この行の時刻が前の行と衝突している */
  problem?: OrderProblem['reason'];
  /** 衝突の相手（前の行）。原因がこちらにあることも多いので一緒に見せる */
  problemPartner: boolean;
}

export interface TapView {
  rows: TapRow[];
  /** 今回の収録で叩いた行の数 */
  recorded: number;
  total: number;
  problems: readonly OrderProblem[];
  canExport: boolean;
  /** 次に何を叩けばよいかの案内 */
  hint: string;
}

/** 12.3 → "12.30"。表示の桁を揃えると、行が並んだときに読み取りやすい */
export function formatSeconds(seconds: number): string {
  return seconds.toFixed(2);
}

/**
 * 書き出す JSON の文字列。`public/lyrics/<name>.json` に貼る中身そのもの。
 *
 * DOM 側に置かない。**この道具の成果物そのもの**なので、
 * 「書き出したものが歌詞シートとして読み直せる」を検査で守りたい。
 * 衝突が残っていれば `toSheet` が投げる（画面はその手前で止める）。
 */
export function exportText(session: TapSession): string {
  return `${JSON.stringify(toSheet(session), null, 2)}\n`;
}

export function buildView(session: TapSession): TapView {
  const lines = previewLines(session);
  const problems = orderProblems(session);

  const reasonAt = new Map(problems.map((problem) => [problem.index, problem.reason]));
  const partners = new Set(problems.map((problem) => problem.index - 1));

  const rows = lines.map((line, index) => ({
    index,
    text: line.text,
    ...(line.effect ? { effect: line.effect } : {}),
    time: line.time,
    ...(line.duration !== undefined ? { duration: line.duration } : {}),
    recorded: session.takes[index] !== undefined,
    current: index === session.cursor,
    open: index === session.pending,
    ...(reasonAt.has(index) ? { problem: reasonAt.get(index) } : {}),
    problemPartner: partners.has(index),
  }));

  return {
    rows,
    recorded: session.takes.filter((take) => take !== undefined).length,
    total: lines.length,
    problems,
    // 衝突が残っている間は書き出させない。toSheet の例外は最後の砦で、
    // 知らせはその手前（この画面）で出す
    canExport: problems.length === 0,
    hint: hintFor(session, problems),
  };
}

function hintFor(session: TapSession, problems: readonly OrderProblem[]): string {
  if (problems.length > 0) {
    return `${problems.length} 箇所で時刻が衝突しています。印の付いた行をクリックして録り直してください`;
  }

  const done = session.cursor >= session.source.lines.length;
  const outHint =
    session.pending === NO_PENDING ? '' : `／Enter で ${session.pending + 1} 行目の終了`;

  if (done) return `全ての行を録りました。書き出せます${outHint}`;
  return `Space で ${session.cursor + 1} 行目の開始${outHint}`;
}
