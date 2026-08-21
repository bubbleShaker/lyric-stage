/**
 * 収録画面のキー割り当て。
 *
 * DOM のイベントそのものではなく「キーの名前」だけを見る。押されたキーが
 * どの操作に当たるかは覚え書きとして 1 か所にまとまっている方がよく、
 * ブラウザ無しで検査もできる。
 */

export type TapCommand = 'in' | 'out' | 'undo';

/**
 * 収録中は片手が塞がるので、どれもホームポジションから遠くない単キーにする。
 * 修飾キーとの組み合わせは使わない（曲は待ってくれない）。
 */
export function commandForKey(key: string): TapCommand | undefined {
  switch (key) {
    case ' ':
      return 'in';
    case 'Enter':
      return 'out';
    case 'Backspace':
      return 'undo';
    default:
      return undefined;
  }
}

/** 文字を打ち込む場所。ここに焦点があるときはキーを横取りしない */
const TEXT_ENTRY_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'number', 'password']);

export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  // 再生位置のシークバー（type="range"）は文字を打つ場所ではないので横取りしてよい。
  // ここを一律に除外すると、シークした直後に収録できなくなる
  if (target instanceof HTMLInputElement) return TEXT_ENTRY_TYPES.has(target.type);
  return false;
}
