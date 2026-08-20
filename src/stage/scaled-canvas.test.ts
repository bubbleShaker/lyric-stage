import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScaledCanvas } from './scaled-canvas';

class FakeContext {
  transform: number[] | null = null;
  setTransform(...args: number[]): void {
    this.transform = args;
  }
}

/**
 * ResizeObserver の偽物。
 *
 * **observe() では鳴らさない。** 本物の初回通知は購読した次の描画更新まで
 * 待たされるので、同期で鳴らすと「実ブラウザでは起こり得ない状態」を
 * 前提にしたテストになってしまう。通知はテストが明示的に起こす。
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private readonly callback: (entries: { contentRect: { width: number; height: number } }[]) => void;
  disconnected = false;

  constructor(callback: (entries: { contentRect: { width: number; height: number } }[]) => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  emit(width: number, height: number): void {
    this.callback([{ contentRect: { width, height } }]);
  }
}

function fakeCanvas() {
  const context = new FakeContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

/** 最後に作られた観測者。テストから大きさの通知を起こすために使う */
function observer(): FakeResizeObserver {
  return FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1];
}

describe('ScaledCanvas', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('大きさの通知が来るまでは描ける状態にならない', () => {
    const { canvas } = fakeCanvas();
    const surface = new ScaledCanvas(canvas, () => 2);

    expect(surface.ready).toBe(false);

    observer().emit(800, 600);
    expect(surface.ready).toBe(true);
  });

  it('表示倍率を掛けた実ピクセルで描画面を用意する', () => {
    const { canvas, context } = fakeCanvas();
    const surface = new ScaledCanvas(canvas, () => 2);
    observer().emit(800, 600);

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    // 描く側は CSS ピクセルの座標で書けるよう、拡大率は変換行列に入れる
    expect(context.transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(surface.width).toBe(800);
    expect(surface.height).toBe(600);
  });

  it('描画面を作り直すたびに版が上がる（中身が消えたことを描く側へ伝える）', () => {
    const { canvas } = fakeCanvas();
    const surface = new ScaledCanvas(canvas, () => 1);

    observer().emit(800, 600);
    const first = surface.version;
    observer().emit(400, 300);

    expect(surface.version).toBeGreaterThan(first);
  });

  it('sync で表示倍率の変化に追従する', () => {
    const { canvas } = fakeCanvas();
    let ratio = 2;
    const surface = new ScaledCanvas(canvas, () => ratio);
    observer().emit(800, 600);
    const before = surface.version;

    ratio = 1;
    surface.sync();

    expect(canvas.width).toBe(800);
    expect(surface.width).toBe(800);
    expect(surface.version).toBeGreaterThan(before);
  });

  it('表示倍率が変わっていなければ sync は何もしない', () => {
    const { canvas } = fakeCanvas();
    const surface = new ScaledCanvas(canvas, () => 2);
    observer().emit(800, 600);
    const before = surface.version;

    surface.sync();
    surface.sync();

    expect(surface.version).toBe(before);
  });

  it('大きさの通知が来る前は sync が空回りする', () => {
    const { canvas } = fakeCanvas();
    let ratio = 2;
    const surface = new ScaledCanvas(canvas, () => ratio);

    ratio = 3;
    surface.sync();

    expect(surface.ready).toBe(false);
    expect(surface.version).toBe(0);
  });

  it('context が取れない環境では組み立てに失敗する', () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => new ScaledCanvas(canvas, () => 1)).toThrow();
  });

  it('destroy で購読をやめる', () => {
    const { canvas } = fakeCanvas();
    new ScaledCanvas(canvas, () => 1).destroy();
    expect(observer().disconnected).toBe(true);
  });
});
