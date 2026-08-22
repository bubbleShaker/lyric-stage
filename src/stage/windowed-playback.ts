import type { Playback, PlaybackStatus } from '../domain/ports';
import type { WorkWindow } from '../domain/work-window';

/**
 * 曲の一部だけを 1 つの作品として見せる Playback。
 *
 * 音源は曲の全長のまま置く（素材の利用ルールで加工版は置けない）ので、
 * 「作品はここからここまで」はコードが持つ。このクラスが**秒数の読み替えを
 * 一手に引き受ける**ことで、外側（再生コントロール・歌詞・背景）は
 * 「0 秒から始まる 27 秒の作品」だけを見ていればよくなる。
 *
 * 歌詞シートの側の付け替えは domain の sliceSheet が行う。区間を知っているのは
 * その 2 か所だけ。区間を切らない場合は WHOLE_SONG を渡せば素通しになる。
 */
export class WindowedPlayback implements Playback {
  private readonly source: Playback;
  private readonly workWindow: WorkWindow;
  /** 区間の頭へ送るのは一度だけ。以降は人の操作に任せる */
  private positioned = false;

  constructor(source: Playback, workWindow: WorkWindow) {
    // 書き間違えると「シークバーが無効のまま」という原因の分かりにくい壊れ方をする。
    // 定数の取り違えなので、起動した瞬間に気付ける方がよい
    if (!(workWindow.start >= 0) || !(workWindow.start < workWindow.end)) {
      throw new Error(
        `作品の区間が不正です: start=${String(workWindow.start)} end=${String(workWindow.end)}`,
      );
    }

    this.source = source;
    this.workWindow = workWindow;

    this.source.subscribe(() => {
      this.positionAtStart();
      // 終端の見張りは毎フレームの keepInWindow() が本命だが、配線を落とした時に
      // 曲の残り全部が流れ出すのは重い。イベント経由でも保険を掛けておく
      this.keepInWindow();
    });
    // 既に読み込みが済んでいる Playback を包むこともある。購読の中だけで頭出しすると、
    // その場合に一度も呼ばれず、作品が曲の 0 秒から始まる
    this.positionAtStart();
  }

  /** 読み込みが済んだら一度だけ区間の頭へ送る */
  private positionAtStart(): void {
    if (this.positioned) return;
    // 読み込みが済むまで currentTime への代入は効かないので、用意ができるのを待つ
    if (this.source.currentStatus !== 'ready') return;
    this.positioned = true;
    this.source.seek(this.workWindow.start);
  }

  /** 作品の長さ。音源の長さが分かるまでは 0 を返す */
  get duration(): number {
    const loaded = this.source.duration;
    // 0 のうちに長さを名乗ると、再生コントロールが「長さが分かった」と
    // 判断してシークバーを開けてしまう。読み込み前の挙動は今までどおりに保つ
    if (loaded <= 0) return 0;
    // 音源が区間より短い（取り違えた mp3 など）場合は音源の方に合わせる
    return Math.max(0, Math.min(this.workWindow.end, loaded) - this.workWindow.start);
  }

  get currentTime(): number {
    const elapsed = this.source.currentTime - this.workWindow.start;
    // 上限は区間の長さ（this.duration ではない）。読み込み前は duration が 0 なので、
    // そちらで抑えると再生位置が 0 に貼り付いて見える
    return Math.min(Math.max(0, elapsed), this.workWindow.end - this.workWindow.start);
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

    // 音源が区間より短いと終端の見張りが一度も働かず、曲が自然に終わる。
    // その後の再生は要素の仕様で 0 秒から始まるので、頭へ落ちた時は連れ戻す。
    //
    // **区間の頭に届かない音源では連れ戻さない。** seek は音源の長さで頭打ちになるので、
    // 戻しても届かず、seek → イベント → また連れ戻す、が終わらなくなる（取り違えた
    // mp3 を置いたときだけ起きる。上限側は pause() で状態が変わるので必ず収束する）
    if (
      this.source.currentTime < this.workWindow.start &&
      this.source.duration > this.workWindow.start
    ) {
      this.source.seek(this.workWindow.start);
      return;
    }

    if (this.source.currentTime < this.workWindow.end) return;
    this.source.pause();
    // 行き過ぎた分を戻して、終端でぴったり止まっているように見せる
    this.source.seek(this.workWindow.end);
  }

  /**
   * 終端で止まった後にもう一度押されたら、頭から流し直す。
   *
   * これが無いと「再生 → 即座に keepInWindow が止める」を繰り返し、
   * 一度最後まで聴いた人はリロードするまで二度と再生できない。
   */
  async toggle(): Promise<void> {
    if (this.source.paused && this.source.currentTime >= this.workWindow.end) {
      this.source.seek(this.workWindow.start);
    }
    await this.source.toggle();
  }

  /** 区間の内側に収めてから元の秒数に直す */
  seek(time: number): void {
    const length = this.workWindow.end - this.workWindow.start;
    const clamped = Math.min(Math.max(time, 0), length);
    this.source.seek(this.workWindow.start + clamped);
  }
}
