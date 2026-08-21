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
  undo,
  type TapSession,
} from '../domain/tap-session';
import { commandForKey, isTextEntry, type TapCommand } from './tap-keys';
import { buildView, exportText, formatSeconds, type TapRow } from './tap-view';

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

/**
 * 打鍵が無視されたときの言い訳。無反応のままだと収録中に原因が分からない。
 *
 * 記録に関わるものだけを持つ（`toggle` は再生の操作でセッションを変えない）。
 * キーを増やしたときに「これは記録系か」を型が聞いてくれる形にしてある。
 */
const IGNORED: Record<Exclude<TapCommand, 'toggle'>, string> = {
  in: '記録しませんでした。前に録った時刻より後で叩いてください（全ての行を録り終えている場合も記録されません）',
  out: '終了を記録しませんでした。先に Space でこの行の開始を叩いてください',
  undo: '取り消せる打鍵がありません',
};

export function mountTapTool(
  sheet: LyricSheet,
  player: Playback,
  el: TapToolElements,
): TapToolHandle {
  let session = startSession(sheet);
  /** 今 textarea に出ている JSON を作ったときのセッション */
  let exported: TapSession | undefined;
  /** 今カーソルが載っている行。ここが変わった時だけ画面を追従させる */
  let scrolledTo = -1;

  /**
   * 操作を適用する。**無視された打鍵は同じセッションが返る**ので、
   * その時は描き直さず、代わりに理由を出す（domain が不変で作られていることの実利）。
   */
  const apply = (next: TapSession, ignored: string) => {
    if (next === session) {
      if (ignored) el.hint.textContent = ignored;
      return;
    }
    session = next;
    render();
  };

  const run = (command: TapCommand) => {
    const now = player.currentTime;
    if (command === 'toggle') {
      player.toggle().catch((error: unknown) => {
        el.hint.textContent = '再生できませんでした';
        console.error(error);
      });
      return;
    }

    if (command === 'in') apply(tapIn(session, now), IGNORED.in);
    else if (command === 'out') apply(tapOut(session, now), IGNORED.out);
    else apply(undo(session), IGNORED.undo);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // 修飾キー付きの打鍵はブラウザ側の操作（再読み込みなど）なので触らない
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTextEntry(event.target)) return;

    const command = commandForKey(event.key);
    if (!command) return;

    // Space での画面送り、Backspace での「戻る」、
    // 焦点のあるボタンの再実行（再生ボタンを押した後の Space）を止める。
    // **リピートを弾くより先に止める。** 後にすると、押しっぱなしの間だけ
    // 既定の動作が生き返り、収録は 1 行で止まるのにページだけスクロールする
    event.preventDefault();

    // 押しっぱなしの自動リピートは収録ではない。再生中は currentTime が進み続けるので、
    // 弾かないと逆行のガードを素通りして数十行がまとめて焼かれる
    if (event.repeat) return;

    run(command);
  };

  // 行の要素を 1 つずつ購読せず、一覧にまとめて 1 つ。
  // 描き直しのたびに購読し直さずに済む
  const onListClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const row = target.closest<HTMLElement>('[data-index]');
    if (!row) return;

    apply(moveCursorTo(session, Number(row.dataset.index)), '');
  };

  const onExport = () => {
    try {
      el.output.value = exportText(session);
      exported = session;

      // **焦点は移さない。** readonly の textarea に焦点を移すと Space も
      // Backspace も横取りされ、収録が続けられなくなる（画面上は無反応に見える）。
      // クリップボードは安全な文脈でないと存在しないので、無い場合も案内を出す
      const manual = '下の JSON を選択してコピーし、歌詞シートに貼ってください';
      if (!navigator.clipboard) {
        el.hint.textContent = manual;
        return;
      }

      void navigator.clipboard
        .writeText(el.output.value)
        .then(() => {
          el.hint.textContent = 'クリップボードに入れました。歌詞シートに貼ってください';
        })
        .catch(() => {
          el.hint.textContent = manual;
        });
    } catch (error) {
      // ボタンは衝突がある間 disabled なので、ここに来るのは組み方を誤ったとき。
      // 「textarea に出ているものは exported のもの」を例外の道でも崩さない
      el.output.value = '';
      exported = undefined;
      el.hint.textContent = '書き出せませんでした（詳細はコンソール）';
      console.error(error);
    }
  };

  const render = () => {
    const view = buildView(session);

    el.hint.textContent = view.hint;
    el.progress.textContent = `${view.recorded} / ${view.total} 行`;
    el.exportButton.disabled = !view.canExport;

    // 書き出した後に録り直したら、textarea の中身はもう実測と違う。**消す。**
    // 残すと、見た目は正しい JSON なので気づけないまま古い値を貼ってしまう
    if (exported !== undefined && exported !== session) {
      el.output.value = '';
      exported = undefined;
    }

    el.list.replaceChildren(...view.rows.map(rowElement));

    // 曲は進み続けるので、今の行は自分で追いかけずに済むようにする。
    // ただし毎回追従させると、衝突箇所を見に行った時に引き戻してしまう
    const cursor = view.rows.findIndex((row) => row.current);
    if (cursor !== scrolledTo) {
      scrolledTo = cursor;
      el.list.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'center' });
    }
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
  li.title = problemTitle(row) ?? 'クリックするとこの行から録り直す';

  li.append(
    span('tap-row__no', String(row.index + 1)),
    span('tap-row__time', formatSeconds(row.time)),
    span('tap-row__duration', row.duration === undefined ? '—' : formatSeconds(row.duration)),
    span('tap-row__text', row.text),
    span('tap-row__effect', row.effect ?? ''),
  );

  return li;
}

/** 衝突の種類は色だけでは伝わらないので、行の説明にも書く */
function problemTitle(row: TapRow): string | undefined {
  if (row.problem === 'previous-later') return '前の行と同時か、前の行より前にあります';
  if (row.problem === 'overlap') return '前の行の表示がこの行に食い込んでいます';
  if (row.problemPartner) return 'この行の時刻が、次の行と衝突しています';
  return undefined;
}

function span(className: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}
