/**
 * 収録画面のキー割り当て。
 *
 * DOM のイベントそのものではなく「キーの名前」だけを見る。押されたキーが
 * どの操作に当たるかは覚え書きとして 1 か所にまとまっている方がよく、
 * ブラウザ無しで検査もできる。
 */

export type TapCommand = 'in' | 'out' | 'undo' | 'toggle';

/**
 * 収録中は片手が塞がるので、どれもホームポジションから遠くない単キーにする。
 * 修飾キーとの組み合わせは使わない（曲は待ってくれない）。
 *
 * `toggle`（再生・停止）を持つのは、`Space` を収録に使う以上、
 * **焦点のある再生ボタンを Space で押す道が塞がる**から。
 * これが無いとこのページの再生がマウス専用になる。
 */
export function commandForKey(key: string): TapCommand | undefined {
  switch (key) {
    case ' ':
      return 'in';
    case 'Enter':
      return 'out';
    case 'Backspace':
      return 'undo';
    case 'p':
    case 'P':
      return 'toggle';
    default:
      return undefined;
  }
}

/** 焦点のある要素のうち、判断に要る部分だけ。DOM 無しで検査できるようにするため */
export interface FocusedElement {
  tagName: string;
  /** input の type。input 以外では見ない */
  type?: string;
  isContentEditable?: boolean;
}

/** 文字を打ち込む場所の input[type]。ここに焦点があるときはキーを横取りしない */
const TEXT_ENTRY_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'number', 'password']);

/**
 * 文字を打ち込んでいる最中か。
 *
 * **再生位置のシークバー（`type="range"`）は文字を打つ場所ではないので横取りしてよい。**
 * 「input なら一律に除外」にすると、シークした直後に収録できなくなる（焦点が
 * つまみに残るため）。ここが収録中に一番効く判断なので、形だけを受け取って検査する。
 */
export function isTextEntryTarget(target: FocusedElement | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName === 'INPUT') return TEXT_ENTRY_TYPES.has(target.type ?? '');
  return false;
}

/** DOM との境目。イベントの相手から上の判断に要る形を取り出すだけ */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return isTextEntryTarget({
    tagName: target.tagName,
    ...(target instanceof HTMLInputElement ? { type: target.type } : {}),
    isContentEditable: target.isContentEditable,
  });
}
