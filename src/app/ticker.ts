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

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.frame !== 0) return; // 二重起動を防ぐ
    const tick = () => {
      for (const listener of this.listeners) listener();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
