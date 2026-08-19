import type { Playback, PlaybackStatus } from '../domain/ports';

/**
 * <audio> の薄いラッパ。Playback の実装。
 *
 * 演出のマスタークロックはこの currentTime。M2 以降のタイムラインは
 * requestAnimationFrame でここを読み続けて追従する。
 * このクラスは「音を鳴らす」以上のことを知らない（GSAP も歌詞も import しない）。
 */
export class AudioPlayer implements Playback {
  private readonly el: HTMLAudioElement;
  private readonly listeners = new Set<() => void>();
  private status: PlaybackStatus = 'idle';

  constructor(src: string) {
    this.el = new Audio();
    // metadata だけ先読みして再生時間を得る。曲全体を先読みしないので初期表示が速い
    this.el.preload = 'metadata';
    this.el.src = src;

    // 状態が変わりうるイベントをまとめて購読者に転送する
    const notify = () => this.emit();
    for (const type of ['play', 'pause', 'ended', 'seeked', 'durationchange'] as const) {
      this.el.addEventListener(type, notify);
    }
    this.el.addEventListener('loadedmetadata', () => {
      this.status = 'ready';
      this.emit();
    });
    this.el.addEventListener('error', () => {
      this.status = 'error';
      this.emit();
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  get currentTime(): number {
    return this.el.currentTime;
  }

  get duration(): number {
    // メタデータ未取得の間は NaN が返るので 0 に均す
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }

  get paused(): boolean {
    return this.el.paused;
  }

  get currentStatus(): PlaybackStatus {
    return this.status;
  }

  /** 秒数を 0〜duration に収めてから代入する */
  seek(time: number): void {
    const clamped = Math.max(time, 0);
    const max = this.duration;
    this.el.currentTime = max > 0 ? Math.min(clamped, max) : clamped;
  }

  /**
   * ブラウザは音の自動再生を禁止しているので、必ずクリックなどの
   * ユーザー操作から呼ぶこと。play() は Promise を返し、拒否されると reject する。
   * 状態の通知は play / pause イベント経由で行われるのでここでは emit しない。
   */
  async toggle(): Promise<void> {
    if (this.el.paused) {
      await this.el.play();
    } else {
      this.el.pause();
    }
  }
}
