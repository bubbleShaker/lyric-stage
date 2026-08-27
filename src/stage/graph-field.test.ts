import { describe, expect, it } from 'vitest';
import { seededRandom } from '../lib/random';
import {
  createDrifts,
  driftedPoint,
  edgeAlpha,
  graphSpan,
  graphWobble,
  GraphField,
  nodeAlpha,
  nodeRadius,
} from './graph-field';
import { PALETTE } from './palette';
import type { DrawSurface } from './scaled-canvas';

/**
 * 背景が文字と競わないための天井（実装の `MAX_ALPHA` は 0.42）。
 *
 * **実装より少しだけ緩く置く**（`grain-field.test.ts` の 0.2 対 0.17 と同じ形）。
 * 詰めきると、濃さをほんの少し触るたびに検査ごと書き換えることになり、
 * 「上限がある」という本題が薄れる。ここを大きく上げるときは
 * **M8-2 の出発点**（320 個の点が極太 900 の文字と競っていた）を思い出すこと。
 */
const ALPHA_CEILING = 0.45;

/**
 * 線だけに掛かる、もう一段低い天井（実装の `EDGE_MAX_ALPHA` は 0.36）。
 *
 * **こちらは詰めて置く。** 0.36 は「英字サブテキストが AA の 4.5:1 を保つ最大の
 * 濃さ」から逆算した値で、緩めるとその根拠ごと意味を失う（`palette.ts` の `sub`）。
 * 線は画面を横切る長い帯なので字の「地」として振る舞う — 点（半径 1〜3px の粒）とは
 * 求めるものが違う、というのが天井を 2 つ持つ理由。
 */
const EDGE_ALPHA_CEILING = 0.36;

describe('createDrifts', () => {
  it('種が同じなら毎回同じ漂い方になる', () => {
    expect(createDrifts(20, seededRandom(1))).toEqual(createDrifts(20, seededRandom(1)));
  });

  it('点ごとに周期と位相が違う（塊が一斉に動いて見えない）', () => {
    const drifts = createDrifts(60, seededRandom(3));

    expect(new Set(drifts.map((drift) => drift.fx)).size).toBeGreaterThan(1);
    expect(new Set(drifts.map((drift) => drift.px)).size).toBeGreaterThan(1);
  });

  it('漂う幅は塊の数%に留まる（骨格が崩れて見えない）', () => {
    // ここを広げると辺が伸び縮みするだけでなく、「1 つのグラフ」ではなく
    // 「散らばった点」に戻る（第 2 稿の失敗）
    for (const drift of createDrifts(60, seededRandom(5))) {
      expect(drift.ax).toBeGreaterThan(0);
      expect(drift.ax).toBeLessThanOrEqual(0.05);
      expect(drift.ay).toBeLessThanOrEqual(0.05);
    }
  });
});

describe('driftedPoint', () => {
  const drift = createDrifts(1, seededRandom(7))[0];
  const point = { x: 0.3, y: -0.2 };

  it('同じ時刻からは必ず同じ位置が出る（時刻の関数）', () => {
    // **これが「マスタークロックは音の再生位置」を満たしている実体。**
    // 速度を積み上げる形にすると、シークで背景だけ置いていかれる
    expect(driftedPoint(point, drift, 12.5, 1)).toEqual(driftedPoint(point, drift, 12.5, 1));
  });

  it('時刻が進めば動く', () => {
    expect(driftedPoint(point, drift, 0, 1)).not.toEqual(driftedPoint(point, drift, 3.7, 1));
  });

  it('効きを 0 にすると基準の位置そのもの', () => {
    expect(driftedPoint(point, drift, 99, 0)).toEqual(point);
  });
});

describe('graphSpan', () => {
  it('短い辺から決める（縦長の画面で塊が上下に切れない）', () => {
    // 長い辺で決めると、縦長の画面では横幅いっぱいの塊になって上下がはみ出す
    expect(graphSpan(1920, 400, 0)).toBeLessThan(graphSpan(1920, 1080, 0));
    expect(graphSpan(400, 1920, 0)).toBeLessThan(graphSpan(1080, 1920, 0));
  });

  it('盛り上がるとふくらむ', () => {
    expect(graphSpan(800, 600, 1)).toBeGreaterThan(graphSpan(800, 600, 0));
  });

  it('ふくらみきっても短辺の半分を大きくは超えない', () => {
    // **求めているのは「1px も出ない」ことではない。** 縁でわずかに切れる方が
    // 塊が枠に閉じ込められて見えず、背景としてはむしろ正しい（実際、盛り上がり 1 では
    // 16:9 で 1.5% ほど出る）。落としたいのは、**塊が画面より大きくなって
    // 「線の走る面」にしか見えなくなる**変異のほう
    for (const [width, height] of [
      [1920, 1080],
      [800, 600],
      [400, 900],
    ]) {
      expect(graphSpan(width, height, 1)).toBeLessThanOrEqual((Math.min(width, height) / 2) * 1.1);
    }
  });
});

describe('graphWobble', () => {
  it('静かなときも止まりきらない（0 にすると背景が死ぬ）', () => {
    expect(graphWobble(0)).toBeGreaterThan(0);
  });

  it('盛り上がるほど大きく漂う', () => {
    expect(graphWobble(1)).toBeGreaterThan(graphWobble(0));
  });
});

describe('edgeAlpha / nodeAlpha', () => {
  it('盛り上がると濃くなる', () => {
    expect(edgeAlpha(1)).toBeGreaterThan(edgeAlpha(0));
    expect(nodeAlpha(3, 1)).toBeGreaterThan(nodeAlpha(3, 0));
  });

  it('次数が多い点ほど濃い', () => {
    expect(nodeAlpha(8, 0)).toBeGreaterThan(nodeAlpha(2, 0));
  });

  it('次数が増え続けても濃さは頭打ちになる', () => {
    // **骨格の作り方を変えただけで背景が濃くなってはいけない。**
    // 次数に上限が無いので、素直に掛けると 20 本集まる点が真っ黒になる
    expect(nodeAlpha(40, 1)).toBe(nodeAlpha(8, 1));
  });

  it('文字と競う濃さまで上がらない', () => {
    expect(nodeAlpha(40, 1)).toBeLessThanOrEqual(ALPHA_CEILING);
  });

  it('線は英字サブテキストが AA を保てる濃さに収まる', () => {
    // 線は画面を横切る長い帯なので、字の「地」として振る舞う。0.36 を超えると
    // `sub` の小さな字が 4.5:1 を割る（実測は palette.ts の sub と MAX_ALPHA に）
    expect(edgeAlpha(1)).toBeLessThanOrEqual(EDGE_ALPHA_CEILING);
  });
});

describe('nodeRadius', () => {
  it('次数が多い点ほど大きい', () => {
    expect(nodeRadius(8, 960)).toBeGreaterThan(nodeRadius(1, 960));
  });

  it('次数が増え続けても大きさは頭打ちになる', () => {
    // たまたま辺が集まった 1 点だけが極端に大きく出るのを防ぐ
    expect(nodeRadius(40, 960)).toBe(nodeRadius(8, 960));
  });

  it('画面の幅に緩く追従する（割合ではない）', () => {
    // 割合にすると広い画面で丸が目立ちはじめる。点は「小さな印」であって、
    // 画面の一部を占める図形ではない
    expect(nodeRadius(4, 1920)).toBeCloseTo(nodeRadius(4, 960) * 2);
    expect(nodeRadius(4, 960)).toBeLessThan(4);
  });
});

describe('GraphField', () => {
  it('大きさが決まるまで描かない（ResizeObserver の初回通知は非同期に来る）', () => {
    const surface = new FakeSurface(0, 0, false);
    const field = new GraphField(surface, () => false, () => 0);

    field.render(0);
    expect(surface.fake.clears).toBe(0);

    surface.resize(800, 600);
    field.render(0);
    expect(surface.fake.clears).toBe(1);
  });

  it('線と点の両方を描く', () => {
    const surface = new FakeSurface();
    new GraphField(surface, () => false, () => 0).render(0);

    expect(surface.fake.edges.length).toBeGreaterThan(0);
    expect(surface.fake.nodes.length).toBeGreaterThan(0);
  });

  it('線の両端は必ず点の位置にある（辺が宙に浮かない）', () => {
    // 添字を取り違えても canvas は例外を出さない（NaN の座標を黙って捨てる）。
    // 位置が一致していることを見ないと、線がごっそり消えても検査は緑のまま
    const surface = new FakeSurface();
    new GraphField(surface, () => false, () => 0).render(4);

    const dots = new Set(surface.fake.nodes.map((node) => `${node.x},${node.y}`));
    for (const edge of surface.fake.edges) {
      expect(dots.has(`${edge.fromX},${edge.fromY}`)).toBe(true);
      expect(dots.has(`${edge.toX},${edge.toY}`)).toBe(true);
    }
  });

  it('線も点も文字の段（ink）では塗らない', () => {
    // M8-2 の眼目そのもの。文字と同じ明度で塗ると背景が主役を食う
    const surface = new FakeSurface();
    new GraphField(surface, () => false, () => 1).render(4);

    const colors = new Set([
      ...surface.fake.edges.map((edge) => edge.color),
      ...surface.fake.nodes.map((node) => node.color),
    ]);

    expect(colors).not.toContain(PALETTE.ink);
    expect([...colors].every((color) => color === PALETTE.mute || color === PALETTE.sub)).toBe(true);
  });

  it('どの線も点も輪も文字と競う濃さでは描かない', () => {
    const surface = new FakeSurface();
    new GraphField(surface, () => false, () => 1).render(4);

    for (const alpha of [
      ...surface.fake.nodes.map((node) => node.alpha),
      ...surface.fake.rings.map((ring) => ring.alpha),
    ]) {
      expect(alpha).toBeLessThanOrEqual(ALPHA_CEILING);
    }
    // 線は一段低い天井。**配線の側でも見る** — edgeAlpha 単体が守っていても、
    // 描く側が別の値を globalAlpha に入れていたら意味が無い
    for (const edge of surface.fake.edges) {
      expect(edge.alpha).toBeLessThanOrEqual(EDGE_ALPHA_CEILING);
    }
  });

  it('節点が実際に現れる（閾値が骨格の次数に届いている）', () => {
    // **これが無いと閾値が死んでいても全検査が緑になる**（M11 のレビュー指摘 🔴）。
    // 当初は輪の閾値を次数 7 に置いていたが、createGraphShape の次数は最大 6 なので
    // **輪は 1 本も描かれなかった** — コメントと PLAN が「形でも示す」と言っている
    // 当の手当てが効いていない状態。次数の分布は骨格の作り方しだいで動くので、
    // 閾値を定数で置くなら「届いていること」を留めるしかない
    const surface = new FakeSurface();
    new GraphField(surface, () => false, () => 0).render(4);

    expect(surface.fake.rings.length).toBeGreaterThan(0);
    expect(surface.fake.nodes.filter((node) => node.color === PALETTE.sub).length).toBeGreaterThan(
      0,
    );
  });

  it('節点は一部に留まる（全部が節点なら区別の意味が無い）', () => {
    // 下限だけを見ていると、閾値を 0 まで下げて「全点が節点」にしても緑のまま。
    // 節点はアクセントであって既定の姿ではない
    const surface = new FakeSurface();
    new GraphField(surface, () => false, () => 0).render(4);

    expect(surface.fake.rings.length).toBeLessThan(surface.fake.nodes.length / 5);
  });

  it('輪は節点にだけ添う（塗りと輪の食い違いが起きない）', () => {
    // 塗り分けと輪で閾値を分けていた頃の名残を落とす。片方だけ動かすと
    // 「暗い点なのに輪が無い」「輪はあるのに薄い」が混ざる
    const surface = new FakeSurface();
    new GraphField(surface, () => false, () => 0).render(4);

    const hubs = surface.fake.nodes.filter((node) => node.color === PALETTE.sub);
    expect(surface.fake.rings).toHaveLength(hubs.length);
    for (const ring of surface.fake.rings) {
      expect(hubs.some((hub) => hub.x === ring.x && hub.y === ring.y)).toBe(true);
    }
  });

  it('強さが 0〜1 の外でも畳む', () => {
    // **Canvas は範囲外の globalAlpha 代入を黙って無視する**（＝直前の不透明度で
    // 描かれる）。口の側の約束が破れた時に画が壊れるのではなく、
    // 「なぜか一部だけ濃い」という読み解けない絵になるので、入口で畳む
    const wild = new FakeSurface();
    new GraphField(wild, () => false, () => 5).render(4);

    const full = new FakeSurface();
    new GraphField(full, () => false, () => 1).render(4);

    expect(wild.fake.nodes).toEqual(full.fake.nodes);

    const negative = new FakeSurface();
    new GraphField(negative, () => false, () => -3).render(4);

    const quiet = new FakeSurface();
    new GraphField(quiet, () => false, () => 0).render(4);

    expect(negative.fake.nodes).toEqual(quiet.fake.nodes);
  });

  it('塊は画面の中央に据わる（極端な縦横比でも隅に寄らない）', () => {
    // 短辺から半径を決めているので、横長でも縦長でも中央に据わる。
    // ふくらみきった状態（盛り上がり 1）で見る。
    //
    // **縁から少し出るのは許す**（graphSpan の検査に理由を書いた）。ここで見たいのは
    // 「中央にある」と「画面より大きくならない」の 2 つで、1px 単位の収まりではない
    for (const [width, height] of [
      [1920, 1080],
      [400, 900],
    ]) {
      const surface = new FakeSurface(width, height);
      new GraphField(surface, () => false, () => 1).render(4);

      const nodes = surface.fake.nodes;
      const margin = Math.min(width, height) * 0.1;
      for (const node of nodes) {
        expect(node.x).toBeGreaterThanOrEqual(-margin);
        expect(node.x).toBeLessThanOrEqual(width + margin);
        expect(node.y).toBeGreaterThanOrEqual(-margin);
        expect(node.y).toBeLessThanOrEqual(height + margin);
      }

      // 重心が画面の中央にあること。範囲だけを見ていると、原点を取り違えて
      // 塊ごと隅へずれても全部の点が「範囲内」に収まってしまう。
      //
      // **ぴったり中央は求めない。** 120 点をばらまいた重心は原点から少しずれる
      // （毎回同じずれだが、点数や種を変えれば別の値になる）。見たいのは
      // 「塊の大きさに対して無視できるずれか」なので、許容も塊の大きさで測る
      const centre = nodes.reduce(
        (sum, node) => ({ x: sum.x + node.x / nodes.length, y: sum.y + node.y / nodes.length }),
        { x: 0, y: 0 },
      );
      const tolerance = graphSpan(width, height, 1) * 0.1;
      expect(Math.abs(centre.x - width / 2)).toBeLessThan(tolerance);
      expect(Math.abs(centre.y - height / 2)).toBeLessThan(tolerance);
    }
  });

  it('盛り上がると塊が中心からふくらむ', () => {
    const quiet = new FakeSurface();
    new GraphField(quiet, () => false, () => 0).render(0);

    const loud = new FakeSurface();
    new GraphField(loud, () => false, () => 1).render(0);

    // 漂いも同時に強まるので個々の点では逆転しうる。中心からの平均で見る
    const spreadOf = (surface: FakeSurface): number => {
      const distances = surface.fake.nodes.map((node) =>
        Math.hypot(node.x - surface.width / 2, node.y - surface.height / 2),
      );

      return distances.reduce((sum, d) => sum + d, 0) / distances.length;
    };

    expect(spreadOf(loud)).toBeGreaterThan(spreadOf(quiet));
  });

  it('時刻が進むと点が漂う', () => {
    const surface = new FakeSurface();
    const field = new GraphField(surface, () => false, () => 0);

    field.render(0);
    const first = surface.fake.nodes.map((node) => node.x);

    field.render(3.5);
    expect(surface.fake.nodes.map((node) => node.x)).not.toEqual(first);
  });

  it('辺は漂っても組み変わらない（連結成分が 1 つのまま保たれる）', () => {
    // **毎フレーム距離で結び直すと、近づいた所で辺が生まれ離れた所で切れる**
    // ＝ もう「連結成分が 1 つ」ではない。骨格は固定であることを見る
    const surface = new FakeSurface();
    const field = new GraphField(surface, () => false, () => 0);

    field.render(0);
    const before = surface.fake.edges.length;

    field.render(40);
    expect(surface.fake.edges.length).toBe(before);
  });

  it('再生を止めている間は描き直さない', () => {
    // 止めている間 currentTime は動かない。同じ絵を 60 回/秒 描き続けずに済む
    const surface = new FakeSurface();
    const field = new GraphField(surface, () => false, () => 0);

    field.render(7.5);
    field.render(7.5);
    field.render(7.5);

    expect(surface.fake.clears).toBe(1);
  });

  it('描画面が作り直されたら、同じ時刻でも描き直す', () => {
    const surface = new FakeSurface();
    const field = new GraphField(surface, () => false, () => 0);

    field.render(3);
    surface.resize(400, 300);
    field.render(3);

    expect(surface.fake.clears).toBe(2);
  });

  it('動きを減らす設定では、時刻が進んでも姿が変わらない', () => {
    const surface = new FakeSurface();
    const field = new GraphField(surface, () => true, () => 0);

    field.render(1.1);
    // 背景ごと消さない。動かないグラフはグラフのまま
    expect(surface.fake.nodes.length).toBeGreaterThan(0);
    const first = surface.fake.nodes.map((node) => node.x);

    // 描き直しの判定を跨がせるため、間に描画面を作り直す
    surface.resize(800, 600);
    field.render(30.05);

    expect(surface.fake.nodes.map((node) => node.x)).toEqual(first);
  });

  it('動きを減らす設定では、2 フレーム目以降は描画そのものを飛ばす', () => {
    const surface = new FakeSurface();
    const field = new GraphField(surface, () => true, () => 0);

    field.render(1.1);
    expect(surface.fake.clears).toBe(1);

    field.render(2.2);
    field.render(30.05);
    expect(surface.fake.clears).toBe(1);
  });

  it('動きを減らす設定では、音が鳴っていても反応しない', () => {
    // 音での明滅も「動き」。時刻と同じく強さも 0 に畳む
    const surface = new FakeSurface();
    new GraphField(surface, () => true, () => 1).render(5);

    const reference = new FakeSurface();
    new GraphField(reference, () => false, () => 0).render(0);

    expect(surface.fake.nodes).toEqual(reference.fake.nodes);
    expect(surface.fake.edges).toEqual(reference.fake.edges);
  });

  it('曲の途中で設定を変えても次のフレームから効く', () => {
    const surface = new FakeSurface();
    let reduced = false;
    const field = new GraphField(surface, () => reduced, () => 0);

    field.render(12.1);
    const moving = surface.fake.nodes.map((node) => node.x);

    reduced = true;
    field.render(12.12);
    const still = surface.fake.nodes.map((node) => node.x);
    expect(still).not.toEqual(moving);

    // 落とし先は「時刻 0 のグラフ」
    const reference = new FakeSurface();
    new GraphField(reference, () => false, () => 0).render(0);
    expect(still).toEqual(reference.fake.nodes.map((node) => node.x));
  });

  it('後始末をする（不透明度を残したまま次の描画に入らない）', () => {
    // globalAlpha は context に残る。戻し忘れると、次に描く層が
    // 最後に引いた輪の薄さで塗られる
    const surface = new FakeSurface();
    new GraphField(surface, () => false, () => 0).render(5);

    expect(surface.fake.globalAlpha).toBe(1);
  });
});

/**
 * Canvas の代わりに渡す偽物。引いた線と点を記録するだけ
 * （`grain-field.test.ts` の FakeContext と同じ役）。
 *
 * DOM 無しで `GraphField` の判断（いつ・どこに・どんな濃さで描くか）を検証する。
 * 実際にどう見えるかはここでは分からないので、それは目で確かめる。
 *
 * `moveTo` / `lineTo` の対を線として、`arc` を点として控える。**`fill` と `stroke` を
 * 区別する** — 点は塗り、次数の高い点に添える輪は線なので、混ぜると
 * 「輪だけが濃い」ような間違いが見えなくなる。
 */
interface FakeEdge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  alpha: number;
  color: unknown;
}

interface FakeDot {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  color: unknown;
}

class FakeContext {
  globalAlpha = 1;
  fillStyle: unknown = '';
  strokeStyle: unknown = '';
  lineWidth = 1;
  /** 描き直した回数。「描かなかった」ことを見るために数える */
  clears = 0;
  readonly edges: FakeEdge[] = [];
  readonly nodes: FakeDot[] = [];
  readonly rings: FakeDot[] = [];

  private segments: { fromX: number; fromY: number; toX: number; toY: number }[] = [];
  private arcs: { x: number; y: number; radius: number }[] = [];
  private cursor: { x: number; y: number } | null = null;

  clearRect(): void {
    this.clears += 1;
    this.edges.length = 0;
    this.nodes.length = 0;
    this.rings.length = 0;
  }

  beginPath(): void {
    this.segments = [];
    this.arcs = [];
    this.cursor = null;
  }

  moveTo(x: number, y: number): void {
    this.cursor = { x, y };
  }

  lineTo(x: number, y: number): void {
    if (this.cursor) {
      this.segments.push({ fromX: this.cursor.x, fromY: this.cursor.y, toX: x, toY: y });
    }
    this.cursor = { x, y };
  }

  arc(x: number, y: number, radius: number): void {
    this.arcs.push({ x, y, radius });
  }

  stroke(): void {
    for (const segment of this.segments) {
      this.edges.push({ ...segment, alpha: this.globalAlpha, color: this.strokeStyle });
    }
    for (const arc of this.arcs) {
      this.rings.push({ ...arc, alpha: this.globalAlpha, color: this.strokeStyle });
    }
  }

  fill(): void {
    for (const arc of this.arcs) {
      this.nodes.push({ ...arc, alpha: this.globalAlpha, color: this.fillStyle });
    }
  }
}

/** 大きさと版をテストから動かせる描画面（grain-field.test.ts と同じ形） */
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
