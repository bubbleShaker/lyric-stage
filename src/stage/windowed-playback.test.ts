import { describe, expect, it } from 'vitest';
import type { Playback, PlaybackStatus } from '../domain/ports';
import { WindowedPlayback } from './windowed-playback';

/** 曲の全長を持つ本物の代わり。秒数と状態を手で動かせる */
class FakeSource implements Playback {
  currentTime = 0;
  duration = 0;
  paused = true;
  currentStatus: PlaybackStatus = 'idle';
  pauses = 0;
  toggles = 0;
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** 音源の読み込みが済んだ状態にする */
  ready(duration: number): void {
    this.duration = duration;
    this.currentStatus = 'ready';
    this.emit();
  }

  async toggle(): Promise<void> {
    this.toggles += 1;
    this.paused = !this.paused;
  }

  pause(): void {
    this.pauses += 1;
    this.paused = true;
  }

  seek(time: number): void {
    this.currentTime = time;
  }
}

/** 曲の 100〜120 秒だけを作品として見せる */
const WINDOW = { start: 100, end: 120 };

function setup() {
  const source = new FakeSource();
  return { source, player: new WindowedPlayback(source, WINDOW) };
}

describe('WindowedPlayback', () => {
  it('音源の読み込みが済んだら区間の頭へ送る', () => {
    const { source } = setup();
    expect(source.currentTime).toBe(0);
    source.ready(240);
    expect(source.currentTime).toBe(100);
  });

  it('頭へ送るのは一度だけ（以降はシークを尊重する）', () => {
    const { source } = setup();
    source.ready(240);
    source.seek(110);
    source.emit();
    expect(source.currentTime).toBe(110);
  });

  it('読み込みが済むまでは長さを名乗らない（シークバーを開けさせない）', () => {
    const { player } = setup();
    expect(player.duration).toBe(0);
  });

  it('長さは区間の長さ。曲の全長ではない', () => {
    const { source, player } = setup();
    source.ready(240);
    expect(player.duration).toBe(20);
  });

  it('音源が区間より短ければ音源の長さに合わせる', () => {
    const { source, player } = setup();
    source.ready(110);
    expect(player.duration).toBe(10);
  });

  it('再生位置は区間の先頭からの秒数', () => {
    const { source, player } = setup();
    source.ready(240);
    source.seek(105);
    expect(player.currentTime).toBe(5);
  });

  it('再生位置は区間の内側に収めて見せる', () => {
    const { source, player } = setup();
    source.ready(240);
    source.seek(80);
    expect(player.currentTime).toBe(0);
    source.seek(130);
    expect(player.currentTime).toBe(20);
  });

  it('シークは区間の内側に収めてから元の秒数に直す', () => {
    const { source, player } = setup();
    source.ready(240);
    player.seek(5);
    expect(source.currentTime).toBe(105);
    player.seek(-10);
    expect(source.currentTime).toBe(100);
    player.seek(999);
    expect(source.currentTime).toBe(120);
  });

  it('区間の終わりに達したら止める', () => {
    const { source, player } = setup();
    source.ready(240);
    source.paused = false;
    source.seek(120);
    player.keepInWindow();
    expect(source.paused).toBe(true);
  });

  it('行き過ぎた分は終わりへ戻す', () => {
    const { source, player } = setup();
    source.ready(240);
    source.paused = false;
    source.seek(120.4);
    player.keepInWindow();
    expect(source.currentTime).toBe(120);
  });

  it('区間の中では止めない', () => {
    const { source, player } = setup();
    source.ready(240);
    source.paused = false;
    source.seek(119.9);
    player.keepInWindow();
    expect(source.paused).toBe(false);
  });

  it('止まっている間は見張りが何もしない（頭出し直後に止め直さない）', () => {
    const { source, player } = setup();
    source.ready(240);
    source.seek(120);
    player.keepInWindow();
    expect(source.pauses).toBe(0);
  });

  it('終わりまで聴いた後に再生すると、頭から流し直す', async () => {
    const { source, player } = setup();
    source.ready(240);
    source.seek(120);
    await player.toggle();
    expect(source.currentTime).toBe(100);
    expect(source.paused).toBe(false);
  });

  it('途中で止めた後の再生は、その場から続ける', async () => {
    const { source, player } = setup();
    source.ready(240);
    source.seek(110);
    await player.toggle();
    expect(source.currentTime).toBe(110);
  });

  it('止める・状態・購読はそのまま元へ渡す', () => {
    const { source, player } = setup();
    player.pause();
    expect(source.pauses).toBe(1);

    source.currentStatus = 'error';
    expect(player.currentStatus).toBe('error');

    let called = 0;
    const unsubscribe = player.subscribe(() => {
      called += 1;
    });
    source.emit();
    expect(called).toBe(1);
    unsubscribe();
    source.emit();
    expect(called).toBe(1);
  });
});
