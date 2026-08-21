/**
 * 収録画面の組み立て。DOM を触るのはこのファイルだけ。
 *
 * 記録の判断（何を記録してよいか、どこが衝突しているか）は domain の
 * TapSession が持ち、見せ方の判断は tap-view が持つ。ここは
 * 「キーを操作に変える」「値を要素に映す」だけを受け持つ。
 */

import type { LyricSheet } from '../domain/lyrics';
import type { Playback } from '../domain/ports';
import {
  moveCursorTo,
  startSession,
  tapIn,
  tapOut,
  toSheet,
  undo,
  type TapSession,
} from '../domain/tap-session';
import { commandForKey, isTextEntry, type TapCommand } from './tap-keys';
import { buildView, formatSeconds, type TapRow } from './tap-view';
import './tap-tool.css';

export interface TapToolElements {
  list: HTMLElement;
  hint: HTMLElement;
  progress: HTMLElement;
  exportButton: HTMLButtonElement;
  output: HTMLTextAreaElement;
}

export interface TapToolHandle {
  dispose(): void;
}

export function mountTapTool(
  sheet: LyricSheet,
  player: Playback,
  el: TapToolElements,
): TapToolHandle {
  let session = startSession(sheet);

  /**
   * 操作を適用する。**無視された打鍵は同じセッションが返る**ので、
   * その時は描き直さない（domain が不変で作られていることの実利）。
   */
  const apply = (next: TapSession) => {
    if (next === session) return;
    session = next;
    render();
  };

  const run = (command: TapCommand) => {
    const now = player.currentTime;
    if (command === 'in') apply(tapIn(session, now));
    else if (command === 'out') apply(tapOut(session, now));
    else apply(undo(session));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // 修飾キー付きの打鍵はブラウザ側の操作（再読み込みなど）なので触らない
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTextEntry(event.target)) return;

    const command = commandForKey(event.key);
    if (!command) return;

    // Space での画面送り、Backspace での「戻る」、
    // 焦点のあるボタンの再実行（再生ボタンを押した後の Space）を止める
    event.preventDefault();
    run(command);
  };

  // 行の要素を 1 つずつ購読せず、一覧にまとめて 1 つ。
  // 描き直しのたびに購読し直さずに済む
  const onListClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const row = target.closest<HTMLElement>('[data-index]');
    if (!row) return;

    apply(moveCursorTo(session, Number(row.dataset.index)));
  };

  const onExport = () => {
    try {
      const written = toSheet(session);
      el.output.value = `${JSON.stringify(written, null, 2)}\n`;
      el.output.focus();
      el.output.select();
      // クリップボードは拒否されることがある（安全な文脈でないなど）。
      // 選択済みなので手でコピーすればよく、失敗しても収録は続けられる
      void navigator.clipboard?.writeText(el.output.value).catch(() => undefined);
    } catch (error) {
      // ボタンは衝突がある間 disabled なので、ここに来るのは組み方を誤ったとき
      el.output.value = String(error);
      console.error(error);
    }
  };

  const render = () => {
    const view = buildView(session);

    el.hint.textContent = view.hint;
    el.progress.textContent = `${view.recorded} / ${view.total} 行`;
    el.exportButton.disabled = !view.canExport;

    el.list.replaceChildren(...view.rows.map(rowElement));

    // 曲は進み続けるので、今の行は自分で追いかけずに済むようにする
    el.list.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'center' });
  };

  document.addEventListener('keydown', onKeyDown);
  el.list.addEventListener('click', onListClick);
  el.exportButton.addEventListener('click', onExport);

  render();

  return {
    dispose: () => {
      document.removeEventListener('keydown', onKeyDown);
      el.list.removeEventListener('click', onListClick);
      el.exportButton.removeEventListener('click', onExport);
    },
  };
}

/** 1 行分の要素。歌詞は textContent で入れる（innerHTML に文字列を混ぜない） */
function rowElement(row: TapRow): HTMLElement {
  const li = document.createElement('li');
  li.className = 'tap-row';
  li.dataset.index = String(row.index);
  li.dataset.current = String(row.current);
  li.dataset.open = String(row.open);
  li.dataset.recorded = String(row.recorded);
  if (row.problem) li.dataset.problem = row.problem;
  if (row.problemPartner) li.dataset.partner = 'true';
  li.title = 'クリックするとこの行から録り直す';

  li.append(
    span('tap-row__no', String(row.index + 1)),
    span('tap-row__time', formatSeconds(row.time)),
    span('tap-row__duration', row.duration === undefined ? '—' : formatSeconds(row.duration)),
    span('tap-row__text', row.text),
    span('tap-row__effect', row.effect ?? ''),
  );

  return li;
}

function span(className: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}
