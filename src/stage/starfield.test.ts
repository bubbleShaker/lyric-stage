import { describe, expect, it } from 'vitest';
import { seededRandom } from '../lib/random';
import type { DrawSurface } from './scaled-canvas';
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

  it('消えも飛び出しもしない（0 より大きく、一番明るい時の値以下）', () => {
    // 実際に描かれるのは createStars が作る星なので、手書きの 1 個ではなく
    // 生成された全ての星で見る。速さや瞬きの深さを変えた時に壊れてくれる
    for (const generated of createStars(200, seededRandom(7))) {
      for (let time = 0; time < 20; time += 0.05) {
        const alpha = starAlpha(generated, time);
        expect(alpha).toBeGreaterThan(0);
        expect(alpha).toBeLessThanOrEqual(generated.peakAlpha);
      }
    }
  });
});

/**
 * Canvas の代わりに渡す偽物。描いた星を記録するだけ。
 *
 * DOM 無しで Starfield の判断（いつ描くか）だけを検証する。
 * 星が実際にどう見えるかはここでは分からないので、それは目で確かめる。
 */
class FakeContext {
  globalAlpha = 1;
  fillStyle = '';
  /** 描き直した回数。「描かなかった」ことを見るために数える */
  clears = 0;
  readonly drawn: { x: number; y: number; alpha: number }[] = [];

  clearRect(): void {
    this.clears += 1;
    this.drawn.length = 0;
  }
  beginPath(): void {}
  arc(x: number, y: number): void {
    this.drawn.push({ x, y, alpha: this.globalAlpha });
  }
  fill(): void {}
}

/** 大きさと版をテストから動かせる描画面 */
class FakeSurface implements DrawSurface {
  readonly fake = new FakeContext();
  width: number;
  height: number;
  ready: boolean;
  version = 0;

  constructor(width = 800, height = 600, ready = true) {
    this.width = width;
    this.height = height;
    this.ready = ready;
  }

  get context(): CanvasRenderingContext2D {
    return this.fake as unknown as CanvasRenderingContext2D;
  }

  sync(): void {}

  /** 描画面が作り直された（＝中身が消えた）ことにする */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.ready = true;
    this.version += 1;
  }
}

describe('Starfield', () => {
  it('大きさが決まるまで描かない（ResizeObserver の初回通知は非同期に来る）', () => {
    const surface = new FakeSurface(0, 0, false);
    const starfield = new Starfield(surface, () => false);

    starfield.render(0);
    expect(surface.fake.clears).toBe(0);

    surface.resize(800, 600);
    starfield.render(0);
    expect(surface.fake.clears).toBe(1);
  });

  it('時刻が変われば描き直す', () => {
    const surface = new FakeSurface();
    const starfield = new Starfield(surface, () => false);

    starfield.render(1);
    const first = surface.fake.drawn.map((star) => star.alpha);
    starfield.render(1.5);

    expect(surface.fake.drawn.map((star) => star.alpha)).not.toEqual(first);
  });

  it('同じ時刻なら描き直さない', () => {
    const surface = new FakeSurface();
    const starfield = new Starfield(surface, () => false);

    starfield.render(1);
    starfield.render(1);
    expect(surface.fake.clears).toBe(1);
  });

  it('描画面が作り直されたら、同じ時刻でも描き直す', () => {
    const surface = new FakeSurface();
    const starfield = new Starfield(surface, () => false);

    starfield.render(3);
    const before = surface.fake.drawn[0].x;

    surface.resize(400, 300);
    starfield.render(3);

    expect(surface.fake.clears).toBe(2);
    // 星は作り直さない。同じ空が新しい大きさに合わせて描き直されるだけ
    expect(surface.fake.drawn[0].x).toBeCloseTo(before / 2);
  });

  it('リサイズしても星の数と並びは変わらない', () => {
    const surface = new FakeSurface();
    const starfield = new Starfield(surface, () => false);

    starfield.render(3);
    const before = surface.fake.drawn.map((star) => ({
      x: star.x / surface.width,
      y: star.y / surface.height,
    }));

    surface.resize(1920, 1080);
    starfield.render(3);
    const after = surface.fake.drawn.map((star) => ({
      x: star.x / surface.width,
      y: star.y / surface.height,
    }));

    expect(after.length).toBe(before.length);
    after.forEach((star, index) => {
      expect(star.x).toBeCloseTo(before[index].x);
      expect(star.y).toBeCloseTo(before[index].y);
    });
  });

  it('動きを減らす設定では、時刻が進んでも星は瞬かない', () => {
    const surface = new FakeSurface();
    const starfield = new Starfield(surface, () => true);

    starfield.render(1);
    // 星は消さない。動かない点でも星空は星空
    expect(surface.fake.drawn.length).toBeGreaterThan(0);
    const first = surface.fake.drawn.map((star) => star.alpha);

    starfield.render(30);
    expect(surface.fake.drawn.map((star) => star.alpha)).toEqual(first);
  });

  it('動きを減らす設定では、2 フレーム目以降は描画そのものを飛ばす', () => {
    const surface = new FakeSurface();
    const starfield = new Starfield(surface, () => true);

    starfield.render(1);
    expect(surface.fake.clears).toBe(1);

    starfield.render(2);
    starfield.render(30);
    expect(surface.fake.clears).toBe(1);
  });

  it('曲の途中で設定を変えても次のフレームから効く', () => {
    const surface = new FakeSurface();
    let reduced = false;
    const starfield = new Starfield(surface, () => reduced);

    starfield.render(12);
    const moving = surface.fake.drawn.map((star) => star.alpha);

    reduced = true;
    starfield.render(12.02);
    const still = surface.fake.drawn.map((star) => star.alpha);
    expect(still).not.toEqual(moving);

    // 落とし先は「時刻 0 の星空」。減らさない設定で 0 秒を描いたものと一致する
    const reference = new FakeSurface();
    new Starfield(reference, () => false).render(0);
    expect(still).toEqual(reference.fake.drawn.map((star) => star.alpha));
  });
});
