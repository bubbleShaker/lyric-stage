import { describe, expect, it, vi } from 'vitest';
import { loadDeclaredFonts, type LoadableFont } from './display-font';

/** 呼ばれたかどうかと、いつ決着させるかを外から握れる偽の FontFace */
function fakeFont(): LoadableFont & { settle: () => void; fail: () => void; called: () => boolean } {
  let called = false;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // 誰も掴まない reject は Node の unhandledRejection になるので、ここで受けておく
  promise.catch(() => undefined);

  return {
    load: () => {
      called = true;
      return promise;
    },
    settle: () => resolve(),
    fail: () => reject(new Error('読めなかった')),
    called: () => called,
  };
}

/**
 * 溜まっている非同期の仕事をすべて流す。
 *
 * **`await Promise.resolve()` では足りない**（レビュー指摘 🟡）。あれはマイクロタスクを
 * 1 tick 進めるだけなので、`Promise.all` を `Promise.race`（＝最初の 1 つで先へ進む、
 * まさに防ぎたい実装ミス）に書き換えても「まだ進んでいない」ように見えてしまい、
 * 下の検査が壊れた実装を見逃す。マクロタスクを 1 回挟めば確実に決着する。
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('loadDeclaredFonts', () => {
  it('宣言された書体をすべて読みに行き、揃うまで待つ', async () => {
    const a = fakeFont();
    const b = fakeFont();
    const done = vi.fn();
    const waiting = loadDeclaredFonts([a, b]).then(done);

    expect(a.called()).toBe(true);
    expect(b.called()).toBe(true);

    a.settle();
    await flush();
    // 片方だけでは進まない。ここで進んでしまうと SplitText が代替の書体で測る
    expect(done).not.toHaveBeenCalled();

    b.settle();
    await waiting;
    expect(done).toHaveBeenCalled();
  });

  it('読めなかった書体があっても進む', async () => {
    // 書体は作品の見た目であって本体ではない。404 で歌詞まで止まってはいけない
    const a = fakeFont();
    a.fail();

    await expect(loadDeclaredFonts([a])).resolves.toBeUndefined();
  });

  it('返って来ないときは既定の上限（3 秒）で切り上げる', async () => {
    // 上限を明示的に渡さない。渡すと**既定値そのものは一度も実行されない**ので、
    // 既定を変えても（あるいは消しても）テストが赤くならない（レビュー指摘 🟢）
    vi.useFakeTimers();
    try {
      const a = fakeFont(); // 決着させない
      const done = vi.fn();
      const waiting = loadDeclaredFonts([a]).then(done);

      await vi.advanceTimersByTimeAsync(2999);
      expect(done).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await waiting;
      expect(done).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('書体が 1 つも宣言されていなくても進む', async () => {
    await expect(loadDeclaredFonts([])).resolves.toBeUndefined();
  });
});
