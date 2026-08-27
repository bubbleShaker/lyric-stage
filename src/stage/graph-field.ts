import type { IntensityQuery } from '../lib/intensity';
import { seededRandom } from '../lib/random';
import type { ReducedMotionQuery } from '../lib/reduced-motion';
import type { Backdrop } from './backdrop';
import { createGraphShape, GRAPH_SEED, type GraphShape, type Point } from './graph-shape';
import { PALETTE } from './palette';
import type { DrawSurface } from './scaled-canvas';

/**
 * 背景のグラフ（M11 / Issue #63）。**粒（`GrainField`）の奥にもう 1 枚重ねる層。**
 *
 * 画面の中央に、連結成分が 1 つの塊を据える。骨格（どの点をどの辺で結ぶか）は
 * `graph-shape.ts` が組み立て時に一度だけ作り、ここが持つのは
 * **「どこに置くか・どう漂わせるか・どんな濃さで描くか」**だけ。
 *
 * ## なぜ canvas を 2 枚に分けたか
 *
 * `backdrop.ts` の口は実装が各自 `clearRect` する契約なので、1 枚の canvas に
 * 素直に 2 つ描くと後の層が前の層を消す。口を「消す」と「描く」に割って
 * 1 枚へ合成する道もあったが、**それをやると `GrainField` の「同じコマなら
 * 描かない」（12 コマ/秒 / 2600 粒）が壊れる** — この層は毎フレーム動くので、
 * 共有の clear のたびに粒を 60 コマ/秒で塗り直すことになる。
 * 層ごとに自分の描画面を持たせ、**合成は DOM（`z-index`）に任せる**。
 *
 * ## `Starfield` / `GrainField` から引き継いだ約束
 *
 * - 描画面の辻褄合わせは `DrawSurface` に任せ、ここは絵の中身だけを持つ
 * - **時計は曲の再生位置。** 漂いを速度の積み上げで書かないのはこのため —
 *   積分にするとシークで背景だけ置いていかれる。点ごとに周期と位相の違う
 *   正弦の重ね合わせなら、同じ時刻からは必ず同じ姿が出る
 * - gsap は使わない。点は 120 個あり、1 つずつトゥイーンを張る対象ではない
 */

/** 点 1 つの漂い方。**点ごとに違うから、塊が一斉に動いて見えない** */
export interface Drift {
  /** 漂う幅（塊の半径に対する割合） */
  readonly ax: number;
  readonly ay: number;
  /** 周期（1 秒あたりのラジアン相当）。散らして全体が同じ拍で戻らないようにする */
  readonly fx: number;
  readonly fy: number;
  /** 位相 */
  readonly px: number;
  readonly py: number;
}

/**
 * 漂う幅の範囲。**辺は固定なので、ここを広げると線が伸び縮みするだけ。**
 *
 * 骨格が崩れて見えるほど動かすと「1 つのグラフ」ではなく「散らばった点」に
 * 戻る（第 2 稿の失敗）。塊の半径の数%に留める。
 */
const DRIFT_MIN = 0.012;
const DRIFT_RANGE = 0.03;

/** 周期の範囲。互いに素に近い値へ散らすと、全体が揃って戻る瞬間が来ない */
const FREQ_MIN = 0.11;
const FREQ_RANGE = 0.3;

/**
 * 塊の大きさ（画面に対する割合）と、盛り上がりでどれだけふくらむか。
 *
 * **短い辺を基準にする。** 長い辺で決めると、縦長の画面で塊が上下に切れる。
 * 横への広がりは `graph-shape.ts` の `DISC_ASPECT` が受け持つので、
 * ここは 1 つの倍率で足りる（縦横で別々に持つと、同じ「大きさ」を 2 か所で決めることになる）。
 *
 * ふくらみは既存の背景と同じ「盛り上がると画が開く」。ビネットが外へ退くのと同じ向き。
 */
const SPAN_WIDTH_RATIO = 0.4;
const SPAN_HEIGHT_RATIO = 0.46;
const SPAN_SWELL = 0.09;

/** 漂いの効き。静かなときも止まりきらない（0 にすると背景が死ぬ） */
const WOBBLE_BASE = 0.6;
const WOBBLE_GAIN = 1.2;

/**
 * 線の濃さと、盛り上がりでどれだけ濃くなるか。
 *
 * **M8-2 の出発点を繰り返さないこと** — 星空は 320 個の点が極太 900 の文字と
 * 同じ明度帯で競っていた。線は 1px を切る細さなので粒（上限 0.17）より濃くできるが、
 * 上限は `MAX_ALPHA` で締める。
 */
const EDGE_ALPHA = 0.24;
const EDGE_ALPHA_GAIN = 0.4;

/** 点の濃さ。次数（集まっている辺の本数）が多いほど濃い */
const NODE_ALPHA = 0.26;
const NODE_ALPHA_PER_DEGREE = 0.035;
const NODE_ALPHA_GAIN = 0.35;

/**
 * 濃さの上限。**背景が文字と競わないための天井。**
 *
 * 次数は理屈のうえでは上限が無い（骨格の作り方を変えれば 12 本集まる点も出る）ので、
 * 「次数 × 係数」をそのまま不透明度にすると**骨格を触っただけで背景が濃くなる**。
 * 濃さの決定は骨格から独立していなければならない。
 *
 * **層が 1 枚増えたので、`palette.ts` が `sub` の段を決めた根拠を測り直した**
 * （M11 のレビュー指摘 🟡）。この層を `mute` で重ねたときの、英字サブテキスト
 * （`sub` の小さな字）のコントラスト:
 *
 * | 地 | `sub` の小さな字 |
 * |---|---|
 * | 素の紙 | 5.12:1 |
 * | **線の上（0.336）** | **4.60:1** |
 * | 点の上（0.42） | 4.45:1 |
 *
 * **AA（4.5:1）を守らせる相手は線だけにした。** 線は画面を横切る長い帯なので、
 * 字の「地」として振る舞う ＝ そのまま比を守らせるのが筋。点は半径 1〜3px の粒で、
 * 字の一画の上に載っても地にはならない（ビネットの縁を 4.79:1 で許しているのと
 * 同じ線引き）。**線の 0.336 は天井の下にあるので、この値を上げるときは
 * 表ごと測り直すこと** — 上限が 0.42 だからといって線を 0.42 まで濃くすると、
 * 今度は本当に AA を割る。
 *
 * **0.36 に下げる案は採らなかった。** 点の濃さは次数 3 で 0.365 に達するので、
 * 天井を 0.36 にすると **120 点中 104 点が静止時から張り付き、
 * 「盛り上がると濃くなる」が死ぬ**。天井は逃がし弁であって作業点ではない。
 */
const MAX_ALPHA = 0.42;

/**
 * 線だけに掛かる、もう一段低い天井。**AA の 4.5:1 から逆算した 0.36。**
 *
 * 上の表のとおり、線は字の「地」として振る舞うのでここを割らせない。
 * 今の `EDGE_ALPHA * (1 + EDGE_ALPHA_GAIN)` は 0.336 なので**普段は効かない** —
 * 濃さを触った人が気付かずに AA を割るのを止めるための逃がし弁。
 */
const EDGE_MAX_ALPHA = 0.36;

/** 点の大きさ（基準幅での px）。次数が多いほど大きい */
const NODE_RADIUS = 1;
const NODE_RADIUS_PER_DEGREE = 0.32;

/**
 * 大きさと濃さに効く次数の上限。**上限が無いと、たまたま辺が集まった 1 点だけが
 * 極端に大きく黒く出る**（グラフの次数は偏るので、これは珍しくない）。
 */
const DEGREE_CAP = 8;

/**
 * この本数以上が集まる点を「節点」として扱う。一段暗い段（`sub`）で塗り、輪を添える。
 *
 * **実際に届く値でなければならない**（M11 のレビュー指摘 🔴）。当初は塗り分けを 6、
 * 輪を 7 に置いていたが、`createGraphShape` が作る次数は
 * `{2:16, 3:62, 4:34, 5:6, 6:2}`（平均 3.30 / **最大 6**）で、種を変えても最大は 6。
 * つまり**輪は production で 1 本も描かれない死んだコード**だった。しかも
 * 「大きさの差は数 px しかないので形でも示す」という当の手当てが効いていない。
 *
 * 5 に下げて 120 点中 8 点が節点になる。**閾値を定数で置く以上、それが実際に届く
 * ことを検査で留める**こと（`graph-field.test.ts` の「節点は必ず現れる」）—
 * 骨格の作り方を変えれば次数の分布も動くので、同じ間違いは何度でも起こせる。
 *
 * 塗り分けと輪で閾値を分けないのは、**分けるほどの段が無いから**。次数が 2〜6 しか
 * 無いところに 2 つの境目を置くと、どちらも「ごく一部の点」を指すだけになる。
 */
const HUB_DEGREE = 5;

/** 輪の大きさと濃さ。「線が集まる所」を大きさだけでなく形でも示す */
const RING_RADIUS_SCALE = 2.4;
const RING_ALPHA = 0.3;

/**
 * 点の大きさを決める基準の幅。この幅のとき係数がそのまま px になる。
 *
 * 割合ではなく基準幅からの比で決めるのは、**点は「小さな印」であって画面の一部を
 * 占める図形ではない**ため。割合にすると広い画面で丸が目立ちはじめる。
 */
const REFERENCE_WIDTH = 960;

/**
 * 線の太さ。1px を切る細さで、画面が広いほどわずかに太くする。
 *
 * 下限を割らないのは、**0 に近づくと canvas が線を描かなくなる**ため
 * （太さ 0 の線は何も塗らない）。狭い画面で辺だけが消える。
 */
const EDGE_WIDTH_DIVISOR = 1500;
const MIN_EDGE_WIDTH = 0.55;

/** 輪の線の太さ。点の塗りより細くしないと、輪ではなく二重丸に見える */
const RING_WIDTH_SCALE = 0.9;
const MIN_RING_WIDTH = 0.6;

/** 漂いの係数を作る。乱数を引数で受け取るので、この関数自体は純粋 */
export function createDrifts(count: number, random: () => number): Drift[] {
  return Array.from({ length: count }, () => ({
    ax: DRIFT_MIN + random() * DRIFT_RANGE,
    ay: DRIFT_MIN + random() * DRIFT_RANGE,
    fx: FREQ_MIN + random() * FREQ_RANGE,
    fy: FREQ_MIN + random() * FREQ_RANGE,
    px: random() * Math.PI * 2,
    py: random() * Math.PI * 2,
  }));
}

/**
 * 漂った後の位置。**時刻だけから決まる**（前のフレームの位置を持たない）。
 *
 * これが `Backdrop` の「マスタークロックは音の再生位置」を満たしている実体。
 * シークすれば塊の姿も一緒に飛ぶ。
 */
export function driftedPoint(point: Point, drift: Drift, time: number, wobble: number): Point {
  return {
    x: point.x + drift.ax * Math.sin(time * drift.fx + drift.px) * wobble,
    y: point.y + drift.ay * Math.sin(time * drift.fy + drift.py) * wobble,
  };
}

/** 塊の半径（CSS ピクセル）。盛り上がるとふくらむ */
export function graphSpan(width: number, height: number, intensity: number): number {
  return (
    Math.min(width * SPAN_WIDTH_RATIO, height * SPAN_HEIGHT_RATIO) * (1 + intensity * SPAN_SWELL)
  );
}

/** 漂いの効き */
export function graphWobble(intensity: number): number {
  return WOBBLE_BASE + intensity * WOBBLE_GAIN;
}

/** 線の不透明度。天井は点より一段低い（`EDGE_MAX_ALPHA` を見よ） */
export function edgeAlpha(intensity: number): number {
  return Math.min(EDGE_MAX_ALPHA, EDGE_ALPHA * (1 + intensity * EDGE_ALPHA_GAIN));
}

/** 点の不透明度。次数が多いほど濃い（上限は `DEGREE_CAP` と `MAX_ALPHA` の二重） */
export function nodeAlpha(degree: number, intensity: number): number {
  const weighted = NODE_ALPHA + Math.min(degree, DEGREE_CAP) * NODE_ALPHA_PER_DEGREE;

  return Math.min(MAX_ALPHA, weighted * (1 + intensity * NODE_ALPHA_GAIN));
}

/** 点の半径（CSS ピクセル）。画面の幅に緩く追従する */
export function nodeRadius(degree: number, width: number): number {
  const unit = width / REFERENCE_WIDTH;

  return (NODE_RADIUS + Math.min(degree, DEGREE_CAP) * NODE_RADIUS_PER_DEGREE) * unit;
}

/**
 * 画面上の位置（CSS ピクセル）。
 *
 * **`graph-shape.ts` の `Point` とは別の型にする**（M11 のレビュー指摘 🟡）。
 * あちらは「原点が塊の中心で半径 1 前後」と宣言していて、画面座標を入れると
 * 型の契約が嘘になる。分けておけば、塊内座標と画面座標の取り違えが型で落ちる。
 */
interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** 直前に描いた絵の素性。同じものをもう一度描かないための控え */
interface DrawnFrame {
  readonly time: number;
  readonly version: number;
  readonly intensity: number;
}

export class GraphField implements Backdrop {
  private readonly surface: DrawSurface;
  private readonly prefersReducedMotion: ReducedMotionQuery;
  private readonly intensity: IntensityQuery;
  private readonly shape: GraphShape;
  private readonly drifts: readonly Drift[];
  private lastDrawn: DrawnFrame | null = null;

  /**
   * 設定の読み方も盛り上がりの強さも関数で受け取る。**既定値は置かない**
   * （`GrainField` / `Starfield` と同じ理由）。渡し忘れても画面は出てしまうので、
   * 既定値があると「動きを減らす設定が効いていない」ことに気付けない。
   */
  constructor(
    surface: DrawSurface,
    prefersReducedMotion: ReducedMotionQuery,
    intensity: IntensityQuery,
  ) {
    this.surface = surface;
    this.prefersReducedMotion = prefersReducedMotion;
    this.intensity = intensity;

    // **骨格と漂いは同じ乱数の列から作る。** 別々の種にすると、片方だけ
    // 変えたつもりが両方変わる（次に触る人が読み違える）ような依存が生まれない
    const random = seededRandom(GRAPH_SEED);
    this.shape = createGraphShape(random);
    this.drifts = createDrifts(this.shape.nodes.length, random);
  }

  render(time: number): void {
    this.surface.sync();

    // 大きさが決まるまでは描かない。ResizeObserver の初回通知は非同期なので、
    // ここを抜くと最初の 1 フレームだけ既定サイズ（300×150）の座標系で描かれる
    if (!this.surface.ready) return;

    // 設定は毎フレーム読む。曲の途中で変えてもそのまま効く。
    // **落とし先は「時刻 0 のグラフ」** — 背景ごと消すと作品が別物になる。
    // 動かないグラフはグラフのままで、盛り上がりへの反応も止める（明滅も動き）
    const reduced = this.prefersReducedMotion();
    const at = reduced ? 0 : time;
    // **入口で 0〜1 に畳む**（M11 のレビュー指摘 🟡。`GrainField` の `vignetteStops` と
    // 同じ守り方）。約束の外の値が来ても即死はしないが、負だと `edgeAlpha` が負になり、
    // **Canvas は範囲外の `globalAlpha` 代入を黙って無視する** ＝ 直前の不透明度で
    // 描かれる（`Starfield` で踏んだ罠）。約束を守らせるのではなくここで畳む
    const level = reduced ? 0 : Math.min(1, Math.max(0, this.intensity()));

    // 描き直すかどうかは**描画の入力すべて**で決める。入力が増えたらここにも足すこと。
    //
    // **この層は毎フレーム動くので、普段この判定は素通りする。** それでも置くのは
    // 2 つの場面のため — 動きを減らす設定（時刻が 0 に固定される）と、
    // **再生を止めているとき**（`currentTime` が動かない）。どちらも入力が
    // 止まるので、同じ絵を 60 回/秒 描き続けずに済む
    const drawn = this.lastDrawn;
    if (drawn?.time === at && drawn.version === this.surface.version && drawn.intensity === level) {
      return;
    }

    this.draw(at, level);
    this.lastDrawn = { time: at, version: this.surface.version, intensity: level };
  }

  private draw(time: number, intensity: number): void {
    const { context, width, height } = this.surface;
    context.clearRect(0, 0, width, height);

    const span = graphSpan(width, height, intensity);
    const wobble = graphWobble(intensity);

    // 画面上の位置を先に全点ぶん求める。辺を引くときに両端が要るので、
    // ここで一度だけ計算して使い回す（辺ごとに求めると 1 点を平均 3 回計算する）
    const placed: ScreenPoint[] = this.shape.nodes.map((node, index) => {
      const point = driftedPoint(node, this.drifts[index], time, wobble);

      return { x: width / 2 + point.x * span, y: height / 2 + point.y * span };
    });

    this.drawEdges(placed, intensity);
    this.drawNodes(placed, intensity);
  }

  private drawEdges(placed: readonly ScreenPoint[], intensity: number): void {
    const { context, width } = this.surface;

    context.strokeStyle = PALETTE.mute;
    context.lineWidth = Math.max(MIN_EDGE_WIDTH, width / EDGE_WIDTH_DIVISOR);
    context.globalAlpha = edgeAlpha(intensity);

    // **1 本の道として引く。** 辺ごとに beginPath / stroke を呼ぶと、同じ
    // 不透明度・同じ色の線を数百回ぶん状態設定ごと繰り返すことになる。
    // 濃さが辺ごとに違わないからこそ、まとめて引ける
    context.beginPath();
    for (const [a, b] of this.shape.edges) {
      context.moveTo(placed[a].x, placed[a].y);
      context.lineTo(placed[b].x, placed[b].y);
    }
    context.stroke();

    context.globalAlpha = 1;
  }

  private drawNodes(placed: readonly ScreenPoint[], intensity: number): void {
    const { context, width } = this.surface;
    const unit = width / REFERENCE_WIDTH;

    for (let i = 0; i < placed.length; i++) {
      const degree = this.shape.degrees[i];
      const radius = nodeRadius(degree, width);
      const hub = degree >= HUB_DEGREE;

      context.fillStyle = hub ? PALETTE.sub : PALETTE.mute;
      context.globalAlpha = nodeAlpha(degree, intensity);
      context.beginPath();
      context.arc(placed[i].x, placed[i].y, radius, 0, Math.PI * 2);
      context.fill();

      // 節点だけ輪を持つ。大きさの差は数 px しかないので、
      // 「線が集まる所」を形でも示さないと画では読み取れない
      if (hub) {
        context.strokeStyle = PALETTE.sub;
        context.lineWidth = Math.max(MIN_RING_WIDTH, unit * RING_WIDTH_SCALE);
        context.globalAlpha = RING_ALPHA;
        context.beginPath();
        context.arc(placed[i].x, placed[i].y, radius * RING_RADIUS_SCALE, 0, Math.PI * 2);
        context.stroke();
      }
    }

    // 不透明度だけは戻しておく（塗り色は次に描く時に必ず指定するので残してよい）
    context.globalAlpha = 1;
  }
}
