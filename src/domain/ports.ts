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
  /**
   * 行を出す。`span` は**その行が画面に出ている長さ（秒）**（M13-1 / Issue #74）。
   *
   * 行そのものは「いつ・何を」しか持たないので、**次の行がいつ来るかは行から読めない**。
   * 着地した後も動き続ける演出（M13-2 の漂い）や、行の終わりから逆算して積む退場は、
   * これが無いと尺を決められない。求めるのは `lineSpanAt`（domain）の仕事で、
   * ここは受け取るだけ。
   *
   * **`Infinity` がありうる**（duration を持たない最終行）。作品のシートは
   * `sliceSheet` が区間の終わりで閉じるので有限だが、受け取る側は有限を前提にしない。
   */
  show(line: LyricLine, span: number): void;
  clear(): void;
  /**
   * 今出している行の、**行の頭からの経過秒**を伝える。
   *
   * 演出の時計は音の再生位置（M2 の技術選定で決めた「マスタークロック」）。
   * 描画側に自前の時計を持たせると、音を止めても演出だけが進み続ける。
   * M8-5 で行の中に語句の刻み（最大 3 秒）が入り、ズレが目に見えるようになったので
   * 口に足した。**show() の直後を含め、毎フレーム呼ばれる前提。**
   */
  render(offset: number): void;
}
