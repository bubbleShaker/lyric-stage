/**
 * 再生位置を持つ何か、を表す最小のインターフェース。
 *
 * UI やタイムラインはこの型だけに依存させる。こうしておくと
 * M6 のタイミング入力ツールやテストで、本物の <audio> の代わりに
 * 偽物を差し込めるようになる（具象ではなく抽象に依存する）。
 */
export interface Playback {
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly currentStatus: PlaybackStatus;
  /** 状態変化の購読。戻り値を呼ぶと解除する */
  subscribe(listener: () => void): () => void;
  toggle(): Promise<void>;
  seek(time: number): void;
}

export type PlaybackStatus = 'idle' | 'ready' | 'error';
