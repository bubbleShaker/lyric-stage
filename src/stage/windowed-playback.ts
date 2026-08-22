import type { WorkWindow } from '../domain/lyrics';
import type { Playback, PlaybackStatus } from '../domain/ports';

/**
 * 曲の一部だけを 1 つの作品として見せる Playback。
 *
 * 音源は曲の全長のまま置く（素材の利用ルールで加工版は置けない）ので、
 * 「作品はここからここまで」はコードが持つ。このクラスが**秒数の読み替えを
 * 一手に引き受ける**ことで、外側（再生コントロール・歌詞・背景）は
 * 「0 秒から始まる 27 秒の作品」だけを見ていればよくなる。
 *
 * 歌詞シートの側の付け替えは domain の sliceSheet が行う。区間を知っているのは
 * その 2 か所だけ。
 */
export class WindowedPlayback implements Playback {
  private readonly source: Playback;
  private readonly window: WorkWindow;
  /** 区間の頭へ送るのは metadata が来てから 1 回だけ。以降は人の操作に任せる */
  private positioned = false;

  constructor(source: Playback, window: WorkWindow) {
    this.source = source;
    this.window = window;

    // 読み込みが済むまで currentTime への代入は効かないので、
    // 用意ができたのを見てから開始位置へ送る
    this.source.subscribe(() => {
      if (this.positioned) return;
      if (this.source.currentStatus !== 'ready') return;
      this.positioned = true;
      this.source.seek(this.window.start);
    });
  }

  /** 作品の長さ。音源の長さが分かるまでは 0 を返す */
  get duration(): number {
    const loaded = this.source.duration;
    // 0 のうちに長さを名乗ると、再生コントロールが「長さが分かった」と
    // 判断してシークバーを開けてしまう。読み込み前の挙動は今までどおりに保つ
    if (loaded <= 0) return 0;
    // 音源が区間より短い（取り違えた mp3 など）場合は音源の方に合わせる
    return Math.max(0, Math.min(this.window.end, loaded) - this.window.start);
  }

  get currentTime(): number {
    const elapsed = this.source.currentTime - this.window.start;
    // 上限は区間の長さ（this.duration ではない）。読み込み前は duration が 0 なので、
    // そちらで抑えると再生位置が 0 に貼り付いて見える
    return Math.min(Math.max(0, elapsed), this.window.end - this.window.start);
  }

  get paused(): boolean {
    return this.source.paused;
  }

  get currentStatus(): PlaybackStatus {
    return this.source.currentStatus;
  }

  subscribe(listener: () => void): () => void {
    return this.source.subscribe(listener);
  }

  pause(): void {
    this.source.pause();
  }

  /**
   * 区間の外へ出ていないか見張る。**毎フレーム呼ぶ想定**（駆動は composition root）。
   *
   * timeupdate イベントは 250ms 程度の粗さでしか飛ばないので、それに任せると
   * 終端を最大 0.25 秒行き過ぎてから止まる。作品の最後の 1 行が切れて見える。
   */
  keepInWindow(): void {
    if (this.source.paused) return;
    if (this.source.currentTime < this.window.end) return;
    this.source.pause();
    // 行き過ぎた分を戻して、終端でぴったり止まっているように見せる
    this.source.seek(this.window.end);
  }

  /**
   * 終端で止まった後にもう一度押されたら、頭から流し直す。
   *
   * これが無いと「再生 → 即座に keepInWindow が止める」を繰り返し、
   * 一度最後まで聴いた人はリロードするまで二度と再生できない。
   */
  async toggle(): Promise<void> {
    if (this.source.paused && this.source.currentTime >= this.window.end) {
      this.source.seek(this.window.start);
    }
    await this.source.toggle();
  }

  /** 区間の内側に収めてから元の秒数に直す */
  seek(time: number): void {
    const length = this.window.end - this.window.start;
    const clamped = Math.min(Math.max(time, 0), length);
    this.source.seek(this.window.start + clamped);
  }
}
