import { describe, expect, it } from 'vitest';
import { seededRandom } from '../lib/random';
import {
  createGrainSets,
  grainAlpha,
  grainSetIndex,
  GrainField,
  quantizeIntensity,
  vignetteRadius,
  vignetteStops,
  type Grain,
} from './grain-field';
import { PALETTE } from './palette';
import type { DrawSurface } from './scaled-canvas';

describe('createGrainSets', () => {
  it('種が同じなら毎回同じ粒になる', () => {
    expect(createGrainSets(3, 20, seededRandom(1))).toEqual(createGrainSets(3, 20, seededRandom(1)));
  });

  it('組ごとに違う粒が入る（同じ絵の繰り返しにならない）', () => {
    // 組を差し替えてちらつかせる仕掛けなので、組が同じ内容だと
    // **切り替えても画が変わらない**。作りとして成立しているかを見る
    const [first, second] = createGrainSets(2, 50, seededRandom(3));

    expect(first).not.toEqual(second);
  });

  it('位置は画面に対する割合（0〜1）で持つ', () => {
    for (const grain of createGrainSets(2, 200, seededRandom(7)).flat()) {
      expect(grain.x).toBeGreaterThanOrEqual(0);
      expect(grain.x).toBeLessThan(1);
      expect(grain.y).toBeGreaterThanOrEqual(0);
      expect(grain.y).toBeLessThan(1);
    }
  });

  it('粒は文字と競らない薄さに収まる', () => {
    // M8-2 の出発点そのもの。星空は 320 個の点が極太 900 の文字と同じ明度帯で
    // 競っていた。ここを上げると同じ失敗をやり直すことになる
    for (const grain of createGrainSets(4, 200, seededRandom(7)).flat()) {
      expect(grain.alpha).toBeLessThanOrEqual(0.25);
      expect(grain.alpha).toBeGreaterThan(0);
    }
  });

  it('粒の大きさは 1〜2px に収まる', () => {
    // 上限を見ないと、1 + weight * 50 のような値にしても他の検査は全部通る
    // （「大きい粒ほど濃い」も「画面の大きさに引きずられない」も成り立つ）。
    // 数 px を超えると粒ではなく点や四角に見えて、フィルムグレインでなくなる
    for (const grain of createGrainSets(4, 200, seededRandom(7)).flat()) {
      expect(grain.size).toBeGreaterThanOrEqual(1);
      expect(grain.size).toBeLessThanOrEqual(2);
    }
  });

  it('大きい粒ほど濃い（大きくて見えない粒が混ざらない）', () => {
    const grains = createGrainSets(1, 200, seededRandom(7))[0].sort((a, b) => a.size - b.size);
    const alphas = grains.map((grain) => grain.alpha);

    expect(alphas).toEqual([...alphas].sort((a, b) => a - b));
  });
});

describe('grainSetIndex', () => {
  it('12 コマ/秒で切り替わる', () => {
    // 60fps で描いても粒は 12 回しか変わらない。60 で変えると細かすぎて
    // 「ざらついた面」に均され、ちらつきとして見えない
    expect(grainSetIndex(0, 4)).toBe(0);
    expect(grainSetIndex(0.08, 4)).toBe(0);
    expect(grainSetIndex(1 / 12, 4)).toBe(1);
    expect(grainSetIndex(2 / 12, 4)).toBe(2);
  });

  it('組を一巡すると先頭へ戻る', () => {
    expect(grainSetIndex(4 / 12, 4)).toBe(0);
  });

  it('負の時刻でも配列の外を引かない', () => {
    // 剰余が負になると sets[-1] が undefined になり、for...of が例外を投げる。
    // 背景が落ちるだけでは済まず、Ticker の購読ごと巻き込む
    expect(grainSetIndex(-1, 4)).toBe(0);
  });
});

describe('quantizeIntensity', () => {
  it('ごく小さな揺れを同じ値に畳む', () => {
    // level() は毎フレーム平滑化される連続値なので、丸めないと
    // 「同じコマなら描かない」の判定が一度も効かない
    expect(quantizeIntensity(0.5004)).toBe(quantizeIntensity(0.4998));
  });

  it('段をまたぐ違いは残す（反応が死なない）', () => {
    expect(quantizeIntensity(0.5)).not.toBe(quantizeIntensity(0.6));
  });

  it('端は端のまま（無音と振り切りが動く）', () => {
    expect(quantizeIntensity(0)).toBe(0);
    expect(quantizeIntensity(1)).toBe(1);
  });
});

describe('grainAlpha', () => {
  const grain: Grain = { x: 0.5, y: 0.5, size: 1.5, alpha: 0.08 };

  it('静かなら元の濃さのまま', () => {
    expect(grainAlpha(grain, 0)).toBe(grain.alpha);
  });

  it('盛り上がるほど濃いが、1 は超えない', () => {
    // globalAlpha は 1 を超える値を代入ごと無視する（Starfield で踏んだ罠）
    for (const generated of createGrainSets(4, 200, seededRandom(7)).flat()) {
      const quiet = grainAlpha(generated, 0);
      const loud = grainAlpha(generated, 1);

      expect(loud).toBeGreaterThan(quiet);
      expect(loud).toBeLessThanOrEqual(1);
    }
  });
});

describe('vignetteRadius', () => {
  it('四隅まで届く（角に円の縁が出ない）', () => {
    // 短辺で切ると半径の外＝四隅が最後の色で塗り潰され、角に段差が出る。
    // 対角の半分なら、中央から一番遠い点（＝角）にちょうど届く
    const [width, height] = [1920, 600];

    expect(vignetteRadius(width, height)).toBeCloseTo(Math.hypot(width / 2, height / 2));
  });

  it('画面の向きに依らない', () => {
    expect(vignetteRadius(1920, 600)).toBeCloseTo(vignetteRadius(600, 1920));
  });
});

describe('vignetteStops', () => {
  it('内から外へ向かって進む', () => {
    const stops = vignetteStops(0.5);
    const offsets = stops.map(([offset]) => offset);

    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    // 中心の側には素の地を残す（0 から始めると画面全体が沈む）
    expect(offsets[0]).toBeGreaterThan(0);
    expect(offsets.at(-1)).toBe(1);
  });

  it('内側は「透明」ではなく同じ色の不透明度 0', () => {
    // transparent は rgba(0, 0, 0, 0) なので、渡すと黒へ向かって補間される。
    // **明るい地では画面の中央がはっきり濁る**（反転前は地がほぼ黒だったので
    // 目では見分けられなかった。M9-1 でこの検査が効いた）
    expect(vignetteStops(0.5)[0][1]).toBe(`${PALETTE.mute}00`);
  });

  it('盛り上がっても消えない（縁まで一様だと画が締まらない）', () => {
    expect(edgeAlpha(1)).toBeGreaterThan(0);
  });

  it('盛り上がると薄くなる（＝画が開く）', () => {
    // 「違う値になる」だけを見ると向きを検査していないので、VIGNETTE_ALPHA_GAIN を
    // 負にしても通ってしまう（＝音が大きいほど画が閉じても緑）
    expect(edgeAlpha(1)).toBeLessThan(edgeAlpha(0));
  });

  it('盛り上がると素の地が外へ広がる', () => {
    // 濃さと範囲は別々に効く。片方だけ見ていると、もう片方の向きを間違えても緑になる
    expect(vignetteStops(1)[0][0]).toBeGreaterThan(vignetteStops(0)[0][0]);
  });

  it('内から外へ向かって濃くなる（不透明度の順）', () => {
    const alphas = vignetteStops(0.5).map(([, color]) => alphaOf(color));

    expect(alphas).toEqual([...alphas].sort((a, b) => a - b));
  });
});

/** `#rrggbbaa` の末尾 2 桁を数値で読む。色の値に依存せず向きだけを見るため */
function alphaOf(color: string): number {
  return Number.parseInt(color.slice(-2), 16);
}

function edgeAlpha(intensity: number): number {
  const stops = vignetteStops(intensity);

  return alphaOf(stops[stops.length - 1][1]);
}

/**
 * Canvas の代わりに渡す偽物。描いた粒とグラデーションを記録するだけ。
 *
 * DOM 無しで GrainField の判断（いつ描くか）だけを検証する。
 * 実際にどう見えるかはここでは分からないので、それは目で確かめる
 * （effect-preview.html に背景を出せるようにしてある）。
 */
class FakeGradient {
  readonly stops: [number, string][] = [];
  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color]);
  }
}

class FakeContext {
  globalAlpha = 1;
  fillStyle: unknown = '';
  /** 描き直した回数。「描かなかった」ことを見るために数える */
  clears = 0;
  readonly grains: { x: number; y: number; size: number; alpha: number; color: unknown }[] = [];
  gradient: FakeGradient | null = null;
  /** ビネットの外側の半径。渡し方（対角か短辺か）を検査するために控える */
  vignetteRadius: number | null = null;

  clearRect(): void {
    this.clears += 1;
    this.grains.length = 0;
    this.gradient = null;
    this.vignetteRadius = null;
  }

  // 引数を捨てると「画面の大きさを渡している」ことを誰も見なくなる（レビュー指摘 🟡）。
  // vignetteRadius 単体の検査は幅と高さを直に受ける前提で書かれているので、
  // 呼ぶ側が短辺だけを渡す形に変わっても気付けない
  createRadialGradient(
    _x0: number,
    _y0: number,
    _r0: number,
    _x1: number,
    _y1: number,
    r1: number,
  ): FakeGradient {
    const gradient = new FakeGradient();
    this.gradient = gradient;
    this.vignetteRadius = r1;
    return gradient;
  }

  fillRect(x: number, y: number, width: number): void {
    // ビネットは「グラデーションで画面全体を塗る」1 回、粒は「色で小さく塗る」多数。
    // 塗り色がグラデーションかどうかで見分ける
    if (this.fillStyle instanceof FakeGradient) return;
    // 色まで控える。記録しないと、粒を文字と同じ白で塗っても全検査が緑になる
    // （M8-2 が潰そうとしている失敗そのもの。レビュー指摘 🟡）
    this.grains.push({ x, y, size: width, alpha: this.globalAlpha, color: this.fillStyle });
  }
}

/** 大きさと版をテストから動かせる描画面（starfield.test.ts と同じ形） */
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

describe('GrainField', () => {
  it('大きさが決まるまで描かない（ResizeObserver の初回通知は非同期に来る）', () => {
    const surface = new FakeSurface(0, 0, false);
    const field = new GrainField(surface, () => false, () => 0);

    field.render(0);
    expect(surface.fake.clears).toBe(0);

    surface.resize(800, 600);
    field.render(0);
    expect(surface.fake.clears).toBe(1);
  });

  it('粒とビネットの両方を描く', () => {
    const surface = new FakeSurface();
    new GrainField(surface, () => false, () => 0).render(0);

    expect(surface.fake.grains.length).toBeGreaterThan(0);
    expect(surface.fake.gradient?.stops.length).toBeGreaterThan(0);
  });

  it('粒は mute で塗る（文字と同じ明度帯に上げない）', () => {
    // M8-2 の眼目。ink（文字と同じ白）で塗ってしまうと、画面全体に散った
    // 細かい点が文字と競る — 星空でやった失敗の作り直しになる
    const surface = new FakeSurface();
    new GrainField(surface, () => false, () => 0).render(0);

    expect(new Set(surface.fake.grains.map((grain) => grain.color))).toEqual(
      new Set([PALETTE.mute]),
    );
  });

  it('ビネットの半径は画面の対角から決める', () => {
    // 呼ぶ側が短辺を渡す形に変わると、横長の画面で四隅がグラデーションの
    // 最後の色に塗り潰され、角に円の縁が出る。vignetteRadius 単体の検査は
    // 幅と高さを直に受ける前提なので、配線はここでしか見ていない
    const surface = new FakeSurface(1920, 600);
    new GrainField(surface, () => false, () => 0.5).render(0);

    expect(surface.fake.vignetteRadius).toBeCloseTo(vignetteRadius(1920, 600));
  });

  it('コマが変われば別の粒に切り替わる', () => {
    const surface = new FakeSurface();
    const field = new GrainField(surface, () => false, () => 0);

    field.render(0);
    const first = surface.fake.grains.map((grain) => grain.x);

    field.render(1 / 12);
    expect(surface.fake.grains.map((grain) => grain.x)).not.toEqual(first);
  });

  it('同じコマの間は描き直さない（60fps でも 12 回しか描かない）', () => {
    const surface = new FakeSurface();
    const field = new GrainField(surface, () => false, () => 0);

    field.render(0);
    field.render(0.02);
    field.render(0.06);

    expect(surface.fake.clears).toBe(1);
  });

  it('描画面が作り直されたら、同じコマでも描き直す', () => {
    const surface = new FakeSurface();
    const field = new GrainField(surface, () => false, () => 0);

    field.render(3);
    const before = surface.fake.grains[0].x;

    surface.resize(400, 300);
    field.render(3);

    expect(surface.fake.clears).toBe(2);
    // 粒は作り直さない。同じ並びが新しい大きさに合わせて描き直されるだけ
    expect(surface.fake.grains[0].x).toBeCloseTo(before / 2);
  });

  it('リサイズしても粒の数と並びは変わらない', () => {
    const surface = new FakeSurface();
    const field = new GrainField(surface, () => false, () => 0);

    field.render(3);
    const before = surface.fake.grains.map((grain) => ({
      x: grain.x / surface.width,
      y: grain.y / surface.height,
    }));

    surface.resize(1920, 1080);
    field.render(3);
    const after = surface.fake.grains.map((grain) => ({
      x: grain.x / surface.width,
      y: grain.y / surface.height,
    }));

    expect(after.length).toBe(before.length);
    after.forEach((grain, index) => {
      expect(grain.x).toBeCloseTo(before[index].x);
      expect(grain.y).toBeCloseTo(before[index].y);
    });
  });

  it('粒の大きさは画面の大きさに引きずられない', () => {
    // 位置は割合で持つが、大きさは CSS ピクセルそのもの。割合にすると
    // 4K の画面で粒が巨大な四角になる
    const small = new FakeSurface(400, 300);
    new GrainField(small, () => false, () => 0).render(3);

    const large = new FakeSurface(1920, 1080);
    new GrainField(large, () => false, () => 0).render(3);

    expect(large.fake.grains[0].size).toBe(small.fake.grains[0].size);
  });

  it('動きを減らす設定では、時刻が進んでも粒は変わらない', () => {
    const surface = new FakeSurface();
    const field = new GrainField(surface, () => true, () => 0);

    // 時刻はコマの番号が別々になるものを選ぶ（1.1 秒は 1 番、30.05 秒は 0 番）。
    // 秒の整数はどれも 12 の倍数コマ目＝0 番の組なので、設定が効いていなくても
    // 「変わらなかった」ことになってしまう
    field.render(1.1);
    // 粒も光も消さない。動かない粒は粒のまま
    expect(surface.fake.grains.length).toBeGreaterThan(0);
    const first = surface.fake.grains.map((grain) => grain.x);

    field.render(30.05);
    expect(surface.fake.grains.map((grain) => grain.x)).toEqual(first);
  });

  it('動きを減らす設定では、2 フレーム目以降は描画そのものを飛ばす', () => {
    const surface = new FakeSurface();
    const field = new GrainField(surface, () => true, () => 0);

    // ここも別々のコマに当たる時刻を選ぶ（1 / 2 / 0 番の組）。
    // 設定が効いていなければ 3 回描かれる
    field.render(1.1);
    expect(surface.fake.clears).toBe(1);

    field.render(2.2);
    field.render(30.05);
    expect(surface.fake.clears).toBe(1);
  });

  it('盛り上がると粒は濃くなり、ビネットは退く（粒の位置は動かない）', () => {
    const quiet = new FakeSurface();
    new GrainField(quiet, () => false, () => 0).render(5);

    const loud = new FakeSurface();
    new GrainField(loud, () => false, () => 1).render(5);

    quiet.fake.grains.forEach((grain, index) => {
      const excited = loud.fake.grains[index];
      expect(excited.alpha).toBeGreaterThan(grain.alpha);
      expect(excited.x).toBe(grain.x);
      expect(excited.y).toBe(grain.y);
    });
    // 題名どおりビネットも見る。粒の差だけを見ていると「退く」を誰も検査していない。
    // **半径は音で動かないので、見るのは段の側**（素の地を残す範囲が外へ動くこと）。
    // 半径を見たままにすると、音との関係が段へ移ったことに気付かず緑のままになる
    expect(loud.fake.vignetteRadius).toBeCloseTo(quiet.fake.vignetteRadius ?? 0);
    expect(loud.fake.gradient?.stops[0][0]).toBeGreaterThan(
      quiet.fake.gradient?.stops[0][0] ?? 1,
    );
  });

  it('強さが変われば、同じコマでも描き直す', () => {
    const surface = new FakeSurface();
    let level = 0;
    const field = new GrainField(surface, () => false, () => level);

    field.render(5);
    level = 0.7;
    field.render(5);

    expect(surface.fake.clears).toBe(2);
  });

  it('強さのごく小さな揺れでは描き直さない', () => {
    // **これが無いと 12 コマ/秒の前提が崩れる**（レビュー指摘 🔴）。
    // createLoudness の level() は毎フレーム平滑化される連続値なので、
    // 生のまま控えに入れると条件が一度も一致せず、60 コマ/秒で 2600 個の粒を
    // 塗り直すことになる。段に丸めているから同じコマの間は 1 回で済む
    const surface = new FakeSurface();
    let level = 0.5;
    const field = new GrainField(surface, () => false, () => level);

    field.render(5);
    for (const wobble of [0.5004, 0.4998, 0.5011, 0.4995]) {
      level = wobble;
      field.render(5.01);
    }

    expect(surface.fake.clears).toBe(1);
  });

  it('強さが段をまたげば描き直す（丸めても反応は死なない）', () => {
    const surface = new FakeSurface();
    let level = 0.5;
    const field = new GrainField(surface, () => false, () => level);

    field.render(5);
    level = 0.6;
    field.render(5);

    expect(surface.fake.clears).toBe(2);
  });

  it('動きを減らす設定では、音が鳴っていても反応しない', () => {
    const surface = new FakeSurface();
    new GrainField(surface, () => true, () => 1).render(5);

    // 音での明滅も「動き」。コマと同じく強さも 0 に畳む
    const reference = new FakeSurface();
    new GrainField(reference, () => false, () => 0).render(0);

    expect(surface.fake.grains).toEqual(reference.fake.grains);
    expect(surface.fake.gradient?.stops).toEqual(reference.fake.gradient?.stops);
  });

  it('曲の途中で設定を変えても次のフレームから効く', () => {
    const surface = new FakeSurface();
    let reduced = false;
    const field = new GrainField(surface, () => reduced, () => 0);

    // 0 コマ目に当たらない時刻を選ぶ。12 秒ちょうどは 144 コマ目（4 の倍数）で
    // 落とし先と同じ組になるため、設定が効いていなくてもこの検査が通ってしまう
    field.render(12.1);
    const moving = surface.fake.grains.map((grain) => grain.x);

    reduced = true;
    field.render(12.12);
    const still = surface.fake.grains.map((grain) => grain.x);
    expect(still).not.toEqual(moving);

    // 落とし先は「0 コマ目」。減らさない設定で 0 秒を描いたものと一致する
    const reference = new FakeSurface();
    new GrainField(reference, () => false, () => 0).render(0);
    expect(still).toEqual(reference.fake.grains.map((grain) => grain.x));
  });

  it('粒の後始末をする（不透明度を残したまま次の描画に入らない）', () => {
    // globalAlpha は context に残る。戻し忘れると、次に描く光が
    // 最後の粒の薄さで塗られる
    const surface = new FakeSurface();
    new GrainField(surface, () => false, () => 0).render(5);

    expect(surface.fake.globalAlpha).toBe(1);
  });
});
