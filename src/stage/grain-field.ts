import type { IntensityQuery } from '../lib/intensity';
import { seededRandom } from '../lib/random';
import type { ReducedMotionQuery } from '../lib/reduced-motion';
import type { Backdrop } from './backdrop';
import { PALETTE, withAlpha } from './palette';
import type { DrawSurface } from './scaled-canvas';

/**
 * 文字PV 風の背景（M8-2 / Issue #41）。粒と影の 2 つだけで組む。
 *
 * - **ビネット（周辺減光）** — 画面の縁を淡く沈ませる。音が大きいほど外へ退いて
 *   薄くなる（＝画が開く）。**M9-1（Issue #53）まではこれが「中心の光」だった** —
 *   明暗を反転させた地では、中央に灰の放射を置いても照明ではなく汚れに見えるので、
 *   同じ「画が開く」を影の側から作り直した
 * - **フィルムグレイン** — 細かい粒を撒き、時刻を粗く刻んで別の粒に切り替える。
 *   映写機のちらつき
 *
 * **帯・枠・グリッド・英字サブテキストは持たない。** あれらは「図形グラフィック」
 * そのもので M8-3 の担当。ここで先に置くと、M8-3 が背景と図形の両方を触ることに
 * なり、どちらの層の話をしているのか分からなくなる。M8-2 は「文字を立てるために
 * 背景をどれだけ引くか」だけを決める回にしてある。
 *
 * `Starfield` から引き継いだ約束（M5 の資産）:
 * - 描画面の辻褄合わせは `DrawSurface` に任せ、ここは絵の中身だけを持つ
 * - 時計は曲の再生位置。実時間で回すとシークで背景だけ置いていかれる
 * - gsap は使わない。粒は数百個あり、1 つずつトゥイーンを張る対象ではない
 */

/** 粒 1 つ。位置は画面の大きさに対する割合で持つ（リサイズで作り直さずに済む） */
export interface Grain {
  /** 0〜1 */
  readonly x: number;
  readonly y: number;
  /** 一辺の長さ（CSS ピクセル） */
  readonly size: number;
  /** 静かな場面での不透明度 */
  readonly alpha: number;
}

/**
 * 粒の組の数と、1 組あたりの粒の数。
 *
 * **粒を動かすのではなく、組ごと差し替えてちらつかせる。** 同じ粒をずらすと
 * 「粒が流れる」絵になり、フィルムグレインではなく降る雪や埃に見える。
 * 組を 4 つ持てば、切り替わりの繰り返しは目で追えない程度にはばらける。
 */
const GRAIN_SETS = 4;

/**
 * 1 組あたりの粒の数。**多いのは絵のためだけではない。**
 *
 * ビネットは薄いグラデーションなので、canvas の 8bit 出力では階調が足りず
 * 同心円状の縞（バンディング）が出る。粒を密に撒くと境界がばらけて縞が消える
 * ＝ 粒がディザとして働く。420 個では疎すぎて縞が残った（実際に見て決めた）。
 *
 * この数を許せるのは描き直しを抑えているから。**抑えは 2 つ揃って初めて効く** —
 * コマの量子化（`GRAIN_FPS`）と強さの量子化（`INTENSITY_STEPS`）で、
 * どちらか片方でも生の値に戻すと 60 コマ/秒で 2600 個を塗り直すことになる。
 */
const GRAINS_PER_SET = 2600;

/**
 * 粒を切り替える速さ（コマ/秒）。
 *
 * 実際の描画は 60fps だが、粒は 12 コマ/秒でしか変わらない。60 で変えると
 * 細かすぎて「ざらついた面」に均されてしまい、ちらつきとして見えない
 * （実写フィルムのグレインも 24 コマ/秒で切り替わる）。
 */
const GRAIN_FPS = 12;

/** 粒の並びの種。変えると粒の散り方が変わる（作品としては固定） */
const GRAIN_SEED = 0x6a17;

/** 盛り上がりが粒をどれだけ明るくするか。控えめ — 粒が文字と競ってはいけない */
const GRAIN_GAIN = 0.55;

/**
 * 盛り上がりを何段に刻むか。**これが無いと描き直しの判定が働かない。**
 *
 * `createLoudness` の `level()` は毎フレーム平滑化される連続値（`smoothLevel`）で、
 * 音が鳴っている間は**必ず前フレームと違う値**になる。生のまま控えに入れると
 * 「同じコマなら描かない」の条件が常に false になり、12 コマ/秒のつもりが
 * 60 コマ/秒で 2600 個の粒を塗り直すことになる（レビュー指摘 🔴）。
 *
 * 32 段にしてあるのは、粒の濃さ（0.06〜0.34 の帯）でも光の半径（短辺の 36〜60%）でも
 * 1 段の差が目に見えないため。**控えと描画の両方でこの値を使う**こと —
 * 片方だけ刻むと、控えは「同じ」と言っているのに絵が違う状態になる。
 */
const INTENSITY_STEPS = 32;

/** 盛り上がりを段に丸める。控えに入れる値と描く値を揃えるための関数 */
export function quantizeIntensity(level: number): number {
  return Math.round(level * INTENSITY_STEPS) / INTENSITY_STEPS;
}

/**
 * ビネットが素の地を残す範囲（外周の半径に対する割合）と、音でどれだけ後退するか。
 *
 * **静かなときは狭く（画が締まる）、盛り上がると外へ引く（画が開く）。**
 * 音との関係は反転前の光と同じ「盛り上がると画が開く」だが、開き方が逆向きに
 * なっている — 光は広がることで開き、影は退くことで開く。
 */
const VIGNETTE_CLEAR = 0.34;
const VIGNETTE_OPEN = 0.16;

/**
 * 外周でのビネットの濃さと、音でどれだけ薄まるか。
 *
 * **盛り上がっても消えはしない**（縁まで一様に明るいと画が締まらない）。
 * 反転前の「静かでも光が消えない」と同じ趣旨で、守る端が逆になっただけ。
 *
 * 影の色は `mute`。**`dim` では見えなかった**（`#e6e1d7` は地の `#f3f0ea` との差が
 * 小さすぎて、不透明度をどう上げても「わずかに沈んだ紙」にしかならない）。
 * `dim` はパレットの中で CSS 側の面・帯が使う段として残してある。
 */
const VIGNETTE_ALPHA = 0.22;
const VIGNETTE_ALPHA_GAIN = 0.1;

/**
 * 粒を組ごと作る。乱数を引数で受け取るので、この関数自体は純粋。
 *
 * 大きさと不透明度を 1 つの `weight`（粒の強さ）から決めている。独立に振ると
 * 「大きくて見えない粒」のような無駄な粒が混ざり、描画だけして画に出ない。
 */
export function createGrainSets(
  setCount: number,
  perSet: number,
  random: () => number,
): Grain[][] {
  return Array.from({ length: setCount }, () =>
    Array.from({ length: perSet }, () => {
      const weight = random();

      return {
        x: random(),
        y: random(),
        // 1〜2px。これ以上大きいと粒ではなく点に見える
        size: 1 + weight,
        // 上限 0.17。粒の色は mute（#8b877e）なので、地（#f3f0ea）にこの濃さで
        // 乗せても文字（#14120f）とは明度が一桁違い、競らない。
        // **ここを大きく上げると星空と同じ失敗をやり直す** — 画面全体に散った
        // 細かい点が、極太 900 の文字と同じ明度帯に降りてくる（M8-2 の出発点）。
        //
        // **M9-1（Issue #53）で 0.06 + 0.16 から下げた。** 明暗の反転で、粒は
        // 「暗い地に載る明るい点」から「明るい地に載る暗い点」になった。同じ
        // 不透明度でも後者の方が強く出る（明るい面の中の暗い点は、暗い面の中の
        // 明るい点より目に付く）ので、そのまま反転すると紙ではなく汚れに見える。
        // 目で見て決めた値。これ以下だと粒があること自体が分からなくなる
        alpha: 0.05 + weight * 0.12,
      };
    }),
  );
}

/**
 * その時刻に使う粒の組の番号。
 *
 * 時刻を `GRAIN_FPS` で刻んで丸めるので、**同じコマの間は入力が変わらない。**
 * 描き直すかどうかの判定（`render`）がこの値を見るため、副産物として
 * 60fps のうち 12 回しか描かずに済む。
 */
export function grainSetIndex(time: number, setCount: number): number {
  // 負の時刻は 0 に畳む。剰余が負になると配列の外を引く
  // （`sets[-1]` は undefined で、for...of が例外になる）。
  //
  // **これは仮定ではなく通る経路。** `WindowedPlayback.currentTime` は区間の
  // 手前で実際に負を返す（助走の 1 小節ぶん）。その間は 0 番の組で止まる —
  // 歌が始まる前なので、ちらつかない方がむしろ画として正しい
  // （回し続けたいなら `((f % n) + n) % n`）
  const frame = Math.max(0, Math.floor(time * GRAIN_FPS));

  return frame % setCount;
}

/**
 * その盛り上がりにおける粒の不透明度。
 *
 * Canvas の `globalAlpha` は 1 を超える値を**代入ごと無視する**ので、ここで抑える
 * （`Starfield` で踏んだ罠と同じ。無視されると直前の粒の不透明度で描かれる）。
 */
export function grainAlpha(grain: Grain, intensity: number): number {
  return Math.min(1, grain.alpha * (1 + intensity * GRAIN_GAIN));
}

/**
 * ビネットの外周の半径（CSS ピクセル）。**画面の対角の半分。**
 *
 * 短辺ではなく対角を基準にするのは、四隅まで届かせるため。短辺で切ると
 * 半径の外——つまり四隅——がグラデーションの最後の色で塗り潰され、
 * **角に色の段差（円の縁）が出る**。反転前の光は「画面に収まる」ことが要件
 * だったので短辺基準だったが、ビネットは逆に「はみ出して四隅を覆う」ことが要件。
 *
 * 濃さの段は割合（`vignetteStops`）で決まるので、**音の強さはここには効かない。**
 * 半径と段の両方を動かすと、同じ「開き」を 2 か所で作ることになる。
 */
export function vignetteRadius(width: number, height: number): number {
  return Math.hypot(width, height) / 2;
}

/**
 * ビネットの色の段。`addColorStop` にそのまま渡せる形で返す。
 *
 * 3 段に分けているのは、2 段（中心と外周）だと減衰が直線になり、影ではなく
 * 「円い面」に見えるため。中ほどを半分より薄くすると裾が伸びて地に馴染む。
 *
 * **始点は透明ではなく「同じ色の不透明度 0」。** `transparent` は `rgba(0, 0, 0, 0)`
 * で、渡すと黒へ向かって補間される（`withAlpha` の説明を見よ）。反転前は地が
 * ほぼ黒だったので目では見分けられなかったが、**明るい地では画面の中央が
 * はっきり濁る** — 反転して初めて画に出る類の間違いで、`grain-field.test.ts` が
 * 先に検査として書き残していた。
 */
export function vignetteStops(intensity: number): readonly (readonly [number, string])[] {
  const alpha = Math.max(0, VIGNETTE_ALPHA - intensity * VIGNETTE_ALPHA_GAIN);
  const clear = Math.min(0.99, VIGNETTE_CLEAR + intensity * VIGNETTE_OPEN);

  return [
    [clear, withAlpha(PALETTE.mute, 0)],
    // 素の地が終わる所から外周までの中ほど。割合そのものではなく「残りの何割か」で
    // 置くので、盛り上がって clear が外へ動いても裾の形（減衰の曲がり方）は保たれる
    [clear + (1 - clear) * 0.55, withAlpha(PALETTE.mute, alpha * 0.35)],
    [1, withAlpha(PALETTE.mute, alpha)],
  ];
}

/** 直前に描いた絵の素性。同じものをもう一度描かないための控え */
interface DrawnFrame {
  readonly setIndex: number;
  readonly version: number;
  readonly intensity: number;
}

export class GrainField implements Backdrop {
  private readonly surface: DrawSurface;
  private readonly prefersReducedMotion: ReducedMotionQuery;
  private readonly intensity: IntensityQuery;
  private readonly grainSets: Grain[][];
  private lastDrawn: DrawnFrame | null = null;

  /**
   * 設定の読み方も盛り上がりの強さも関数で受け取る。**既定値は置かない**
   * （`Starfield` と同じ理由）。渡し忘れても画面は出てしまうので、
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
    this.grainSets = createGrainSets(GRAIN_SETS, GRAINS_PER_SET, seededRandom(GRAIN_SEED));
  }

  render(time: number): void {
    this.surface.sync();

    // 大きさが決まるまでは描かない。ResizeObserver の初回通知は非同期なので、
    // ここを抜くと最初の 1 フレームだけ既定サイズ（300×150）の座標系で描かれる
    if (!this.surface.ready) return;

    // 設定は毎フレーム読む。曲の途中で変えてもそのまま効く。
    // 動きを減らす時は組を 0 番に固定し、音での明滅も止める（明滅も「動き」）。
    // **粒も光も消さない。** 動かない粒は粒のままで、背景ごと消すと作品が別物になる
    const reduced = this.prefersReducedMotion();
    const setIndex = reduced ? 0 : grainSetIndex(time, this.grainSets.length);
    // 段に丸めてから控えに入れる。生の値は毎フレーム変わるので、
    // 丸めないと下の判定が一度も効かない（INTENSITY_STEPS の説明を見よ）
    const level = reduced ? 0 : quantizeIntensity(this.intensity());

    // 描き直すかどうかは**描画の入力すべて**で決める。入力が増えたらここにも足すこと。
    // 時刻ではなく「何番の組か」を控えるので、同じコマの間は描画が飛ぶ
    const drawn = this.lastDrawn;
    if (
      drawn?.setIndex === setIndex &&
      drawn.version === this.surface.version &&
      drawn.intensity === level
    ) {
      return;
    }

    this.draw(setIndex, level);
    this.lastDrawn = { setIndex, version: this.surface.version, intensity: level };
  }

  private draw(setIndex: number, intensity: number): void {
    const { context, width, height } = this.surface;
    context.clearRect(0, 0, width, height);

    this.drawVignette(intensity);
    this.drawGrains(setIndex, intensity);
  }

  private drawVignette(intensity: number): void {
    const { context, width, height } = this.surface;
    const radius = vignetteRadius(width, height);

    // 内側の円の半径を 0 にして、素の地を残す範囲は段の割合（vignetteStops）で決める。
    // 中心は画面の中央 — 構図（M8-1）は 9 つのアンカーに散るので、
    // どれか 1 つに寄せると他の構図の行だけが沈む
    const gradient = context.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      radius,
    );
    for (const [offset, color] of vignetteStops(intensity)) {
      gradient.addColorStop(offset, color);
    }

    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  private drawGrains(setIndex: number, intensity: number): void {
    const { context, width, height } = this.surface;
    context.fillStyle = PALETTE.mute;

    // 円（arc）ではなく矩形で描く。粒は 1〜2px なので形の差は見えず、
    // fillRect はパスを組み立てずに済むぶん数百個ぶんの差が出る
    for (const grain of this.grainSets[setIndex]) {
      context.globalAlpha = grainAlpha(grain, intensity);
      context.fillRect(grain.x * width, grain.y * height, grain.size, grain.size);
    }

    // 不透明度だけは戻しておく（塗り色は次に描く時に必ず指定するので残してよい）
    context.globalAlpha = 1;
  }
}
