/**
 * 収録画面の組み立て。DOM を触るのはこのファイルだけ。
 *
 * 記録の判断（何を記録してよいか、どこが衝突しているか）は domain の
 * TapSession が持ち、見せ方の判断は tap-view、下書きとの噛み合わせは
 * tap-draft が持つ。ここは「キーを操作に変える」「値を要素に映す」だけを
 * 受け持つ。判断をこちらに混ぜると、DOM 越しでしか検査できなくなる。
 */

import type { LyricSheet } from '../domain/lyrics';
import type { Playback } from '../domain/ports';
import { moveCursorTo, tapIn, tapOut, undo, type TapSession } from '../domain/tap-session';
import {
  discardDraft,
  keepDraft,
  noticeShown,
  openDraft,
  type DraftState,
  type DraftStore,
} from './tap-draft';
import { commandForKey, isTextEntry, type TapCommand } from './tap-keys';
import { buildView, exportText, formatSeconds, type TapRow } from './tap-view';

export interface TapToolElements {
  list: HTMLElement;
  hint: HTMLElement;
  progress: HTMLElement;
  exportButton: HTMLButtonElement;
  discardButton: HTMLButtonElement;
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

/**
 * 破棄は 2 段階にする。**`window.confirm()` は使わない。**
 * この道具は Space と Backspace を横取りしているので、ネイティブのダイアログに
 * キー操作の主導権が移ると、閉じた後にどちらが効いているのか読みにくい。
 */
const DISCARD_LABEL = '下書きを破棄';
const DISCARD_ARMED_LABEL = '本当に破棄？（もう一度押す）';

export function mountTapTool(
  sheet: LyricSheet,
  player: Playback,
  store: DraftStore,
  el: TapToolElements,
): TapToolHandle {
  /** 収録と下書きの噛み合わせ。判断は tap-draft が持ち、ここは映すだけ */
  let draft = openDraft(sheet, store);
  // 起動時の読み込み失敗もコンソールへ（以降の遷移は adopt が受け持つ）
  if (draft.error !== undefined) console.error(draft.error);
  /** 今 textarea に出ている JSON を作ったときのセッション */
  let exported: TapSession | undefined;
  /** 今カーソルが載っている行。ここが変わった時だけ画面を追従させる */
  let scrolledTo = -1;
  /** 破棄ボタンが身構えているか（次のクリックで実行） */
  let armed = false;

  /** 下書きの状態を進める。この遷移で起きた不具合はここでだけ書き出す */
  const adopt = (next: DraftState) => {
    if (next !== draft && next.error !== undefined) console.error(next.error);
    draft = next;
  };

  /** 破棄ボタンの見た目。身構えているかどうかがラベルに出る */
  const setArmed = (next: boolean) => {
    armed = next;
    el.discardButton.textContent = next ? DISCARD_ARMED_LABEL : DISCARD_LABEL;
    el.discardButton.dataset.armed = String(next);
  };

  /**
   * 案内の欄に出す。**下書きの警告（trouble）は必ず前に残す。**
   * 打鍵や書き出しのたびに丸ごと上書きすると、
   * 「守られていない」ことの知らせだけが流れて消えてしまう。
   */
  const showHint = (message: string) => {
    el.hint.textContent = `${draft.trouble}${message}`;
    el.hint.dataset.trouble = String(draft.trouble !== '');
  };

  /**
   * 操作を適用する。**無視された打鍵は同じセッションが返る**ので、
   * その時は描き直さず、代わりに理由を出す（domain が不変で作られていることの実利）。
   */
  const apply = (next: TapSession, ignored: string) => {
    if (next === draft.session) {
      if (ignored) showHint(ignored);
      return;
    }
    adopt(keepDraft(store, draft, next));
    render();
  };

  const run = (command: TapCommand) => {
    // 収録に戻ったなら破棄の身構えは解く（打鍵が無視されても解けるよう、
    // 描き直しではなくここで）
    if (armed) setArmed(false);

    const now = player.currentTime;
    if (command === 'toggle') {
      player.toggle().catch((error: unknown) => {
        showHint('再生できませんでした');
        console.error(error);
      });
      return;
    }

    if (command === 'in') apply(tapIn(draft.session, now), IGNORED.in);
    else if (command === 'out') apply(tapOut(draft.session, now), IGNORED.out);
    else apply(undo(draft.session), IGNORED.undo);
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

    if (armed) setArmed(false);
    apply(moveCursorTo(draft.session, Number(row.dataset.index)), '');
  };

  /** 下書きの破棄。1 回目のクリックで身構え、2 回目で実行する */
  const onDiscard = () => {
    if (!armed) {
      setArmed(true);
      return;
    }

    adopt(discardDraft(store, draft));
    setArmed(false);
    render();
  };

  const onExport = () => {
    // 書き出しも「収録に戻った」うちに入る。ここで解かないと、身構えたまま
    // 書き出した後の 1 クリックが、身構えるつもりのまま破棄になる
    if (armed) setArmed(false);

    try {
      el.output.value = exportText(draft.session);
      exported = draft.session;

      // **焦点は移さない。** readonly の textarea に焦点を移すと Space も
      // Backspace も横取りされ、収録が続けられなくなる（画面上は無反応に見える）。
      // クリップボードは安全な文脈でないと存在しないので、無い場合も案内を出す
      const manual = '下の JSON を選択してコピーし、歌詞シートに貼ってください';
      if (!navigator.clipboard) {
        showHint(manual);
        return;
      }

      void navigator.clipboard
        .writeText(el.output.value)
        .then(() => {
          showHint('クリップボードに入れました。歌詞シートに貼ってください');
        })
        .catch(() => {
          showHint(manual);
        });
    } catch (error) {
      // ボタンは衝突がある間 disabled なので、ここに来るのは組み方を誤ったとき。
      // 「textarea に出ているものは exported のもの」を例外の道でも崩さない
      el.output.value = '';
      exported = undefined;
      showHint('書き出せませんでした（詳細はコンソール）');
      console.error(error);
    }
  };

  const render = () => {
    const view = buildView(draft.session);

    // 破棄の身構えを解く経路はここに集める（描き直しに至らない
    // 打鍵・書き出しの側でも解いているのは、そちらが render を呼ばないため）
    if (armed) setArmed(false);

    // 一度きりの知らせは案内の前に足す。案内（次に何を叩くか）は消さない
    showHint(`${draft.notice}${view.hint}`);
    draft = noticeShown(draft);
    el.progress.textContent = `${view.recorded} / ${view.total} 行`;
    el.exportButton.disabled = !view.canExport;
    el.discardButton.disabled = !draft.hasDraft;

    // 書き出した後に録り直したら、textarea の中身はもう実測と違う。**消す。**
    // 残すと、見た目は正しい JSON なので気づけないまま古い値を貼ってしまう
    if (exported !== undefined && exported !== draft.session) {
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
  el.discardButton.addEventListener('click', onDiscard);

  setArmed(false);
  render();

  return {
    dispose: () => {
      document.removeEventListener('keydown', onKeyDown);
      el.list.removeEventListener('click', onListClick);
      el.exportButton.removeEventListener('click', onExport);
      el.discardButton.removeEventListener('click', onDiscard);
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
