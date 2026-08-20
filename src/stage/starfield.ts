import { seededRandom } from '../lib/random';
import type { ReducedMotionQuery } from '../lib/reduced-motion';
import type { DrawSurface } from './scaled-canvas';

/**
 * 背景の星空。Canvas 2D で毎フレーム描く。
 *
 * gsap は使わない。星は数百個あり、1 つずつトゥイーンを張る対象ではないため
 * （GSAP に任せる価値があるのは「文字の登場」のような時間の組み立て）。
 *
 * 時計は曲の再生位置。実時間で回すとシークで背景だけ置いていかれる。
 * PLAN の「演出のマスタークロックは音声の再生位置」に揃える。
 *
 * 描画面の辻褄合わせ（大きさ・表示倍率）は DrawSurface に任せ、
 * ここは「星をどう作るか」と「いつ描くか」だけを持つ。
 */

/** 星 1 つ。位置は画面の大きさに対する割合で持つ */
export interface Star {
  /** 0〜1。リサイズしても作り直さなくて済むよう、px ではなく割合で持つ */
  readonly x: number;
  readonly y: number;
  /** 半径（CSS ピクセル） */
  readonly radius: number;
  /** 一番明るい瞬間の不透明度 */
  readonly peakAlpha: number;
  /** 瞬きの初期位相（ラジアン）。星ごとにずらして一斉に光らないようにする */
  readonly phase: number;
  /** 瞬きの速さ（ラジアン/秒） */
  readonly speed: number;
  readonly color: string;
}

/** 星の色。多くは白、少し青みがかったものを混ぜ、たまに空の色を差す */
const WHITE = '#f4f6ff';
const PALE_BLUE = '#cfe4ff';
const CYAN = '#7fd7ff';

/** 瞬きの深さ。0 なら瞬かず、1 なら消えるまで暗くなる */
const TWINKLE_DEPTH = 0.45;

/**
 * 星を作る。乱数を引数で受け取るので、この関数自体は純粋。
 *
 * 大きさ・明るさ・瞬きの速さを 1 つの `depth`（手前らしさ）から決めている。
 * それぞれ独立に振ると、大きくて暗い星のような不自然な組み合わせが混ざる。
 */
export function createStars(count: number, random: () => number): Star[] {
  return Array.from({ length: count }, () => {
    const depth = random();
    const colorRoll = random();

    return {
      x: random(),
      y: random(),
      radius: 0.5 + depth * 1.4,
      peakAlpha: 0.2 + depth * 0.65,
      phase: random() * Math.PI * 2,
      // 手前の星ほどゆっくり瞬く。遠くの小さい星が細かくちらつく方が空らしい
      speed: 2.4 - depth * 1.6,
      color: colorRoll < 0.08 ? CYAN : colorRoll < 0.4 ? PALE_BLUE : WHITE,
    };
  });
}

/** その時刻における星の不透明度 */
export function starAlpha(star: Star, time: number): number {
  const twinkle = 1 - TWINKLE_DEPTH + TWINKLE_DEPTH * Math.sin(star.phase + time * star.speed);
  return star.peakAlpha * twinkle;
}

/** 星の数。画面の広さに依らず固定にして、リサイズで空が作り替わらないようにする */
const STAR_COUNT = 320;

/** 星空の種。変えると星の並びが変わる（作品としては固定） */
const STAR_SEED = 0x5eed;

/** 直前に描いた絵の素性。同じものをもう一度描かないための控え */
interface DrawnFrame {
  readonly time: number;
  readonly version: number;
}

export class Starfield {
  private readonly surface: DrawSurface;
  private readonly prefersReducedMotion: ReducedMotionQuery;
  private readonly stars: Star[];
  private lastDrawn: DrawnFrame | null = null;

  /**
   * 「動きを減らす」設定の読み方は関数で受け取る。**既定値は置かない。**
   *
   * LyricStage と同じ形。背景も動くので同じ設定に従う必要があり、
   * 既定値を置くと新しい所で組み立てた時に渡し忘れても静かに無効になる。
   */
  constructor(surface: DrawSurface, prefersReducedMotion: ReducedMotionQuery) {
    this.surface = surface;
    this.prefersReducedMotion = prefersReducedMotion;
    this.stars = createStars(STAR_COUNT, seededRandom(STAR_SEED));
  }

  /**
   * 1 フレーム描く。Ticker から曲の再生位置を渡して呼ぶ。
   *
   * @param time 曲の先頭からの秒数
   */
  render(time: number): void {
    this.surface.sync();

    // 大きさが決まるまでは描かない。ResizeObserver の初回通知は非同期なので、
    // ここを抜くと最初の 1 フレームだけ既定サイズ（300×150）の座標系で
    // 星が左上の一点に固まって描かれる
    if (!this.surface.ready) return;

    // 設定は毎フレーム読む。曲の途中で変えてもそのまま効く。
    // 動きを減らす時は時刻を 0 に畳む（星は消さない。動かない点でも星空は星空で、
    // 背景ごと消すと作品が別物になる）
    const drawTime = this.prefersReducedMotion() ? 0 : time;

    // 描き直すかどうかは**描画の入力すべて**で決める。今の入力は時刻と描画面の版だけ
    // （M5-2 で盛り上がりの強さが入力に加わったら、ここにも足すこと。
    // 足し忘れると、時刻が同じフレームで強さの変化が黙って捨てられる）。
    //
    // 時刻を畳んだ結果、動きを減らす設定では 2 フレーム目以降が前回と同じになり、
    // 描画そのものが飛ぶ。同じ絵を 60 回/秒 描き続けずに済む
    if (this.lastDrawn?.time === drawTime && this.lastDrawn.version === this.surface.version) {
      return;
    }

    this.draw(drawTime);
    this.lastDrawn = { time: drawTime, version: this.surface.version };
  }

  private draw(time: number): void {
    const { context, width, height } = this.surface;
    context.clearRect(0, 0, width, height);

    for (const star of this.stars) {
      context.globalAlpha = starAlpha(star, time);
      context.fillStyle = star.color;
      context.beginPath();
      context.arc(star.x * width, star.y * height, star.radius, 0, Math.PI * 2);
      context.fill();
    }

    // 不透明度だけは戻しておく（塗り色は次に描く時に必ず指定するので残してよい）
    context.globalAlpha = 1;
  }
}
