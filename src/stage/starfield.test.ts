import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seededRandom } from '../lib/random';
import { createStars, starAlpha, Starfield, type Star } from './starfield';

describe('createStars', () => {
  it('種が同じなら毎回同じ星空になる', () => {
    const a = createStars(50, seededRandom(1));
    const b = createStars(50, seededRandom(1));
    expect(a).toEqual(b);
  });

  it('種が違えば違う星空になる', () => {
    const a = createStars(50, seededRandom(1));
    const b = createStars(50, seededRandom(2));
    expect(a).not.toEqual(b);
  });

  it('位置は画面に対する割合（0〜1）で持つ', () => {
    for (const star of createStars(200, seededRandom(7))) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThan(1);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(1);
    }
  });

  it('大きい星ほど明るい（大きくて暗い星が混ざらない）', () => {
    const stars = [...createStars(200, seededRandom(7))].sort((a, b) => a.radius - b.radius);
    const alphas = stars.map((star) => star.peakAlpha);
    expect(alphas).toEqual([...alphas].sort((a, b) => a - b));
  });
});

describe('starAlpha', () => {
  const star: Star = {
    x: 0.5,
    y: 0.5,
    radius: 1,
    peakAlpha: 0.8,
    phase: 0,
    speed: 1,
    color: '#fff',
  };

  it('時刻が進むと明るさが変わる', () => {
    expect(starAlpha(star, 0)).not.toBeCloseTo(starAlpha(star, 0.7));
  });

  it('消えも飛び出しもしない（0 以上、一番明るい時の値以下）', () => {
    for (let time = 0; time < 20; time += 0.05) {
      const alpha = starAlpha(star, time);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThanOrEqual(star.peakAlpha);
    }
  });
});

/**
 * Canvas の代わりに渡す偽物。描いた星を記録するだけ。
 *
 * DOM 無しで Starfield の判断（いつ描くか・どの解像度で描くか）だけを検証する。
 * 星が実際にどう見えるかはここでは分からないので、それは目で確かめる。
 */
class FakeContext {
  globalAlpha = 1;
  fillStyle = '';
  transform: number[] | null = null;
  /** 描き直した回数。「描かなかった」ことを見るために数える */
  clears = 0;
  readonly drawn: { x: number; y: number; alpha: number }[] = [];

  clearRect(): void {
    this.clears += 1;
    this.drawn.length = 0;
  }
  setTransform(...args: number[]): void {
    this.transform = args;
  }
  beginPath(): void {}
  arc(x: number, y: number): void {
    this.drawn.push({ x, y, alpha: this.globalAlpha });
  }
  fill(): void {}
}

/** ResizeObserver を差し替えるための偽物。テストから任意の大きさを流し込める */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private readonly callback: (entries: { contentRect: { width: number; height: number } }[]) => void;

  constructor(callback: (entries: { contentRect: { width: number; height: number } }[]) => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  /** 本物も購読した時点で 1 度鳴るので、それに合わせる */
  observe(): void {
    this.emit(800, 600);
  }
  disconnect(): void {}
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

describe('Starfield', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('devicePixelRatio', 2);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('表示倍率を掛けた実ピクセルで描画面を用意する', () => {
    const { canvas, context } = fakeCanvas();
    new Starfield(canvas, () => false);

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    // 以降 CSS ピクセルで描けるよう、拡大率は変換行列に入れる
    expect(context.transform).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('リサイズすると新しい大きさで描き直す', () => {
    const { canvas, context } = fakeCanvas();
    const starfield = new Starfield(canvas, () => false);
    starfield.render(3);
    const before = context.drawn[0].x;

    FakeResizeObserver.instances[0].emit(400, 300);
    expect(canvas.width).toBe(800);

    // 大きさが変わった後は、同じ時刻でも描き直す（描画面が消えているため）
    starfield.render(3);
    expect(context.drawn[0].x).toBeCloseTo(before / 2);
  });

  it('画面をまたいで表示倍率が変わったら追従する', () => {
    const { canvas } = fakeCanvas();
    const starfield = new Starfield(canvas, () => false);

    vi.stubGlobal('devicePixelRatio', 1);
    starfield.render(1);

    expect(canvas.width).toBe(800);
  });

  it('時刻が変われば描き直す', () => {
    const { canvas, context } = fakeCanvas();
    const starfield = new Starfield(canvas, () => false);

    starfield.render(1);
    const first = context.drawn.map((star) => star.alpha);
    starfield.render(1.5);
    const second = context.drawn.map((star) => star.alpha);

    expect(second).not.toEqual(first);
  });

  it('動きを減らす設定では、時刻が進んでも星は瞬かない', () => {
    const { canvas, context } = fakeCanvas();
    const starfield = new Starfield(canvas, () => true);

    starfield.render(1);
    // 星は消さない。動かない点でも星空は星空
    expect(context.drawn.length).toBeGreaterThan(0);
    const first = context.drawn.map((star) => star.alpha);

    starfield.render(30);
    expect(context.drawn.map((star) => star.alpha)).toEqual(first);
  });

  it('動きを減らす設定では、2 フレーム目以降は描画そのものを飛ばす', () => {
    const { canvas, context } = fakeCanvas();
    const starfield = new Starfield(canvas, () => true);

    starfield.render(1);
    expect(context.clears).toBe(1);

    starfield.render(2);
    starfield.render(30);
    expect(context.clears).toBe(1);
  });

  it('曲の途中で設定を変えても次のフレームから効く', () => {
    const { canvas, context } = fakeCanvas();
    let reduced = false;
    const starfield = new Starfield(canvas, () => reduced);

    starfield.render(12);
    const moving = context.drawn.map((star) => star.alpha);

    reduced = true;
    starfield.render(12.02);
    const still = context.drawn.map((star) => star.alpha);
    expect(still).not.toEqual(moving);

    // 落とし先は「時刻 0 の星空」。減らさない設定で 0 秒を描いたものと一致する
    const reference = fakeCanvas();
    new Starfield(reference.canvas, () => false).render(0);
    expect(still).toEqual(reference.context.drawn.map((star) => star.alpha));
  });
});
