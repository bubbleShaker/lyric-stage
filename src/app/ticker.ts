/**
 * requestAnimationFrame のループを 1 本に集約する。
 *
 * 再生位置を読みたい人（再生コントロールの表示、歌詞タイムライン）がそれぞれ
 * 独自に rAF を回すと、同じ currentTime を別のタイミングで読むことになって
 * 表示がズレる。購読者を集めてここだけが毎フレーム呼ぶ形にする。
 */
export class Ticker {
  private readonly listeners = new Set<() => void>();
  private frame = 0;
  private running = false;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.running) return; // 二重起動を防ぐ
    this.running = true;

    const tick = () => {
      // 次フレームの予約を先に済ませる。購読者の呼び出しより後に置くと、
      // 誰か 1 人が例外を投げただけでループが二度と再開しなくなる。
      this.frame = requestAnimationFrame(tick);

      for (const listener of this.listeners) {
        // 1 人の失敗を全体に波及させない。時計は止めてはいけない
        try {
          listener();
        } catch (error) {
          console.error(error);
        }
      }
    };

    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
