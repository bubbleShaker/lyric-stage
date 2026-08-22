import type { LyricLine } from './lyrics';

/**
 * 外側（音声・描画）に求める最小の口。
 *
 * 実装は stage 層に置き、app 層はこの型だけを見る。
 * 内側（domain）に口を置くことで、依存の矢印を全て内向きに揃えられる。
 * テストでは偽物を差し込めるので、DOM も音も無しで検証できる。
 */

export type PlaybackStatus = 'idle' | 'ready' | 'error';

/** 再生位置を持つ何か */
export interface Playback {
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly currentStatus: PlaybackStatus;
  /** 状態変化の購読。戻り値を呼ぶと解除する */
  subscribe(listener: () => void): () => void;
  toggle(): Promise<void>;
  /**
   * 止める。既に止まっていれば何もしない。
   *
   * toggle() で代用しない。「今動いているか」を読んでから切り替えるまでの間に
   * 状態が変わりうるので、止めたつもりが再生の開始になる。
   */
  pause(): void;
  seek(time: number): void;
}

/** 1 行を出したり消したりできる何か */
export interface LyricPresenter {
  show(line: LyricLine): void;
  clear(): void;
}
