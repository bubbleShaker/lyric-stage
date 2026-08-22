import { describe, expect, it } from 'vitest';
import type { Playback, PlaybackStatus } from '../domain/ports';
import { WHOLE_SONG } from '../domain/work-window';
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

/**
 * 本物の <audio> に寄せた偽物。**seek と pause が更にイベントを起こす。**
 *
 * WindowedPlayback は自分の購読の中から keepInWindow() を呼ぶので、見張りの中の
 * seek / pause がまた見張りを呼ぶ。止まらない組み合わせが無いことをこれで確かめる。
 */
class EmittingSource extends FakeSource {
  /** 購読が何回走ったか。暴走したら跳ね上がる */
  notifications = 0;

  constructor() {
    super();
    this.subscribe(() => {
      this.notifications += 1;
    });
  }

  /** 本物と同じく、音源の長さより先へは進めない */
  override seek(time: number): void {
    super.seek(this.duration > 0 ? Math.min(time, this.duration) : time);
    this.emit();
  }

  override pause(): void {
    super.pause();
    this.emit();
  }
}

/** 曲の 100〜120 秒だけを作品として見せる */
const WINDOW = { start: 100, end: 120 };

function setup() {
  const source = new FakeSource();
  return { source, player: new WindowedPlayback(source, WINDOW) };
}

describe('WindowedPlayback', () => {
  it('区間が不正なら組み立てを拒む（定数の取り違えに気付けるように）', () => {
    const source = new FakeSource();
    expect(() => new WindowedPlayback(source, { start: 120, end: 100 })).toThrow();
    expect(() => new WindowedPlayback(source, { start: 100, end: 100 })).toThrow();
    expect(() => new WindowedPlayback(source, { start: -1, end: 100 })).toThrow();
  });

  it('既に読み込みが済んでいる Playback を包んでも区間の頭へ送る', () => {
    // 購読のコールバックの中だけで頭出しすると、この場合に一度も呼ばれない
    const source = new FakeSource();
    source.duration = 240;
    source.currentStatus = 'ready';
    new WindowedPlayback(source, WINDOW);
    expect(source.currentTime).toBe(100);
  });

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

  it('区間の手前へ落ちたら連れ戻す', () => {
    // 音源が区間より短いと終端の見張りが働かないまま曲が自然に終わり、
    // 次の再生は要素の仕様で 0 秒から始まる。曲の頭から全部流れてしまう経路
    const { source, player } = setup();
    source.ready(240);
    source.paused = false;
    source.seek(0);
    player.keepInWindow();
    expect(source.currentTime).toBe(100);
    expect(source.paused).toBe(false);
  });

  it('元の Playback のイベントでも見張りが働く（毎フレームの駆動を落とした時の保険）', () => {
    const { source } = setup();
    source.ready(240);
    source.paused = false;
    source.seek(130);
    source.emit();
    expect(source.paused).toBe(true);
  });

  it('見張りの中の pause / seek が更に見張りを呼んでも収束する', () => {
    const source = new EmittingSource();
    const player = new WindowedPlayback(source, WINDOW);
    source.ready(240);
    source.paused = false;
    source.currentTime = 130;
    source.notifications = 0;

    player.keepInWindow();

    expect(source.paused).toBe(true);
    expect(source.currentTime).toBe(120);
    // pause と seek で 1 回ずつ。連鎖が続いていれば桁が変わる
    expect(source.notifications).toBeLessThan(10);
  });

  it('区間の頭に届かない音源では連れ戻さない（seek が頭打ちになり終わらなくなる）', () => {
    // 取り違えた mp3（作品の区間より短い）を置いた場合。連れ戻しても届かないので、
    // seek → イベント → また連れ戻す、が止まらなくなる経路
    const source = new EmittingSource();
    const player = new WindowedPlayback(source, WINDOW);
    source.ready(50);
    source.paused = false;
    source.currentTime = 10;
    source.notifications = 0;

    expect(() => {
      player.keepInWindow();
    }).not.toThrow();
    expect(source.notifications).toBeLessThan(10);
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

describe('WindowedPlayback（曲を丸ごと扱う WHOLE_SONG）', () => {
  // 区間を切らない場合の特別扱いを消すための値。素の Playback と同じでなければ意味が無い
  function whole() {
    const source = new FakeSource();
    return { source, player: new WindowedPlayback(source, WHOLE_SONG) };
  }

  it('長さも再生位置も素通し', () => {
    const { source, player } = whole();
    source.ready(240);
    source.seek(90);
    expect(player.duration).toBe(240);
    expect(player.currentTime).toBe(90);
  });

  it('シークを丸めない', () => {
    const { source, player } = whole();
    source.ready(240);
    player.seek(200);
    expect(source.currentTime).toBe(200);
  });

  it('見張りは何もしない', () => {
    const { source, player } = whole();
    source.ready(240);
    source.paused = false;
    source.seek(239);
    player.keepInWindow();
    expect(source.paused).toBe(false);
    expect(source.pauses).toBe(0);
  });
});
