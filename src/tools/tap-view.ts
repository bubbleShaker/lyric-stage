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
  recordedCount,
  toSheet,
  type OrderProblem,
  type TapSession,
} from '../domain/tap-session';
import type { DraftNotice, DraftTrouble } from './tap-draft';

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

/**
 * 下書きまわりの言い回し。**状態機械（tap-draft）は理由だけを持ち、
 * 文面はここで決める。**domain の OrderConflictError が problems を持ち、
 * 「何行目の何が」を表示側に委ねているのと同じ分け方。
 */
export function draftNoticeText(notice: DraftNotice | undefined): string {
  if (!notice) return '';

  switch (notice.kind) {
    case 'resumed':
      return `下書きから再開しました（${notice.recorded} 行）。`;
    case 'discarded':
      return '下書きを破棄しました。最初から録れます。';
    default:
      // 知らせの種類を増やしたときに、ここで型が止める。
      // 素通しにすると新しい知らせが**別の文面で嘘をつく**
      return exhausted(notice);
  }
}

/**
 * 下書きが守られていないことの知らせ。
 *
 * **「直近に何が起きたか」と「今も自動保存が止まっているか」は別の事実。**
 * 一緒くたに 1 つの文面へ畳むと、破棄に失敗した瞬間に
 * 「保存が止まっている」という重い方の知らせが消える。
 */
export function draftTroubleText(state: {
  trouble?: DraftTrouble;
  saving: boolean;
}): string {
  const stopped = state.saving
    ? ''
    : '自動保存は止まっています。この画面を閉じると収録は失われます。';

  return `${troubleReason(state.trouble)}${stopped}`;
}

function troubleReason(trouble: DraftTrouble | undefined): string {
  if (trouble === undefined) return '';

  switch (trouble) {
    case 'unreadable':
      // 版が上がっただけの場合も含めて「読めなかった」に寄せる。
      // 破棄すると今録った分も消えるので、そこも書いておく
      return (
        '保存されていた下書きを読めませんでした（壊れているか、歌詞シートが書き換えられたか、古い形式です）。' +
        '破棄すると今録った分も消えますが、自動保存は戻ります。'
      );
    case 'save-failed':
      return '下書きを保存できません（詳細はコンソール）。';
    case 'clear-failed':
      return '下書きを破棄できませんでした（詳細はコンソール）。';
    default:
      return exhausted(trouble);
  }
}

/** 型で網羅を締める。増やした種類の文面を書き忘れたらコンパイルが止まる */
function exhausted(value: never): string {
  return String(value);
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
    recorded: recordedCount(session),
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
