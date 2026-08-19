/**
 * <audio> の薄いラッパ。
 *
 * 演出のマスタークロックはこの currentTime。M2 以降のタイムラインは
 * requestAnimationFrame でここを読み続けて追従する。
 * このクラスは「音を鳴らす」以上のことを知らない（GSAP も歌詞も import しない）。
 */
export type AudioPlayerStatus = 'idle' | 'ready' | 'error';

export class AudioPlayer {
  private readonly el: HTMLAudioElement;
  private readonly listeners = new Set<() => void>();
  private status: AudioPlayerStatus = 'idle';

  constructor(src: string) {
    this.el = new Audio();
    // metadata だけ先読みして再生時間を得る。曲全体を先読みしないので初期表示が速い
    this.el.preload = 'metadata';
    this.el.src = src;

    // 状態が変わりうるイベントをまとめて購読者に転送する
    const notify = () => this.emit();
    for (const type of ['play', 'pause', 'ended', 'seeked'] as const) {
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

  /** 状態変化の購読。戻り値を呼ぶと解除できる */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  get currentTime(): number {
    return this.el.currentTime;
  }

  /** 秒数を 0〜duration に収めてから代入する */
  set currentTime(time: number) {
    const max = this.duration;
    this.el.currentTime = Math.min(Math.max(time, 0), max > 0 ? max : time);
  }

  get duration(): number {
    // メタデータ未取得の間は NaN が返るので 0 に均す
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }

  get paused(): boolean {
    return this.el.paused;
  }

  get currentStatus(): AudioPlayerStatus {
    return this.status;
  }

  /**
   * ブラウザは音の自動再生を禁止しているので、必ずクリックなどの
   * ユーザー操作から呼ぶこと。play() は Promise を返し、拒否されると reject する。
   */
  async toggle(): Promise<void> {
    if (this.el.paused) {
      await this.el.play();
    } else {
      this.el.pause();
    }
    this.emit();
  }
}
