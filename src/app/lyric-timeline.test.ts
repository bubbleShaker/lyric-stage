import { describe, expect, it } from 'vitest';
import type { LyricLine, LyricSheet } from '../domain/lyrics';
import type { LyricPresenter, Playback } from '../domain/ports';
import { mountLyricTimeline } from './lyric-timeline';
import { Ticker } from './ticker';

/**
 * 本物の <audio> の代わりに、秒数を手で動かせる偽物を差し込む。
 * port（Playback / LyricPresenter）に依存しているおかげで、
 * ブラウザも音も無しでタイムラインの挙動を確かめられる。
 */
class FakePlayback implements Playback {
  currentTime = 0;
  duration = 60;
  paused = true;
  currentStatus = 'ready' as const;
  subscribe(): () => void {
    return () => {};
  }
  async toggle(): Promise<void> {}
  pause(): void {
    this.paused = true;
  }
  seek(time: number): void {
    this.currentTime = time;
  }
}

class SpyPresenter implements LyricPresenter {
  readonly calls: string[] = [];
  show(line: LyricLine): void {
    this.calls.push(`show:${line.text}`);
  }
  clear(): void {
    this.calls.push('clear');
  }
}

/** rAF を使わず、任意のタイミングで手動で回せる Ticker 相当 */
class ManualTicker {
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  tick(): void {
    for (const listener of this.listeners) listener();
  }
}

const sheet: LyricSheet = {
  title: 'テスト',
  lines: [
    { time: 0, text: 'A' },
    { time: 10, text: 'B', duration: 2 },
    { time: 20, text: 'C' },
  ],
};

function setup() {
  const player = new FakePlayback();
  const ticker = new ManualTicker();
  const presenter = new SpyPresenter();
  mountLyricTimeline(player, ticker as unknown as Ticker, sheet, presenter);
  return { player, ticker, presenter };
}

describe('mountLyricTimeline', () => {
  it('行が変わった時だけ描画し直す', () => {
    const { player, ticker, presenter } = setup();

    player.currentTime = 1;
    ticker.tick();
    ticker.tick();
    ticker.tick();

    expect(presenter.calls).toEqual(['show:A']);
  });

  it('次の行に入ると差し替わる', () => {
    const { player, ticker, presenter } = setup();

    player.currentTime = 1;
    ticker.tick();
    player.currentTime = 10;
    ticker.tick();

    expect(presenter.calls).toEqual(['show:A', 'show:B']);
  });

  it('duration が切れたら消す', () => {
    const { player, ticker, presenter } = setup();

    player.currentTime = 10;
    ticker.tick();
    player.currentTime = 12;
    ticker.tick();

    expect(presenter.calls).toEqual(['show:B', 'clear']);
  });

  it('シークで戻っても追従する', () => {
    const { player, ticker, presenter } = setup();

    player.currentTime = 25;
    ticker.tick();
    player.seek(1);
    ticker.tick();

    expect(presenter.calls).toEqual(['show:C', 'show:A']);
  });

  it('購読を解除すると更新が止まる', () => {
    const player = new FakePlayback();
    const ticker = new ManualTicker();
    const presenter = new SpyPresenter();
    const unsubscribe = mountLyricTimeline(
      player,
      ticker as unknown as Ticker,
      sheet,
      presenter,
    );

    unsubscribe();
    player.currentTime = 1;
    ticker.tick();

    expect(presenter.calls).toEqual([]);
  });
});
