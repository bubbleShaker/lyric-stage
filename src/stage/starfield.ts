import { seededRandom } from '../lib/random';
import type { ReducedMotionQuery } from '../lib/reduced-motion';

/**
 * 背景の星空。Canvas 2D で毎フレーム描く。
 *
 * gsap は使わない。星は数百個あり、1 つずつトゥイーンを張る対象ではないため
 * （GSAP に任せる価値があるのは「文字の登場」のような時間の組み立て）。
 *
 * 時計は曲の再生位置。実時間で回すとシークで背景だけ置いていかれる。
 * PLAN の「演出のマスタークロックは音声の再生位置」に揃える。
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

/** 星の色。ほとんどは白、たまに空の色を混ぜて奥行きを出す */
const STAR_COLORS = ['#f4f6ff', '#cfe4ff', '#7fd7ff'] as const;

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
    const hue = random();

    return {
      x: random(),
      y: random(),
      radius: 0.5 + depth * 1.4,
      peakAlpha: 0.2 + depth * 0.65,
      phase: random() * Math.PI * 2,
      // 手前の星ほどゆっくり瞬く。遠くの小さい星が細かくちらつく方が空らしい
      speed: 2.4 - depth * 1.6,
      color: hue < 0.08 ? STAR_COLORS[2] : hue < 0.4 ? STAR_COLORS[1] : STAR_COLORS[0],
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

export class Starfield {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly prefersReducedMotion: ReducedMotionQuery;
  private readonly stars: Star[];
  private readonly observer: ResizeObserver;

  /** 今の描画面の大きさ（CSS ピクセル）と拡大率 */
  private width = 0;
  private height = 0;
  private scale = 0;

  /** 前回描いた時刻。同じ絵を描き直さないための控え */
  private lastDrawnTime: number | null = null;

  /**
   * 「動きを減らす」設定の読み方は関数で受け取る。**既定値は置かない。**
   *
   * LyricStage と同じ形。背景も動くので同じ設定に従う必要があり、
   * 既定値を置くと新しい所で組み立てた時に渡し忘れても静かに無効になる。
   */
  constructor(canvas: HTMLCanvasElement, prefersReducedMotion: ReducedMotionQuery) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D の context を取得できません');

    this.canvas = canvas;
    this.context = context;
    this.prefersReducedMotion = prefersReducedMotion;
    this.stars = createStars(STAR_COUNT, seededRandom(STAR_SEED));

    // 大きさは ResizeObserver で拾う。毎フレーム clientWidth を読む形にすると、
    // 同じフレームで gsap が書き換えたスタイルの再計算をそのたびに強制してしまう。
    // observe() は購読した時点で 1 度呼ばれるので、初期化もここで済む。
    this.observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.resize(width, height, devicePixelRatio);
    });
    this.observer.observe(canvas);
  }

  /**
   * 1 フレーム描く。Ticker から曲の再生位置を渡して呼ぶ。
   *
   * @param time 曲の先頭からの秒数
   */
  render(time: number): void {
    // 画面をまたいで表示倍率が変わっても ResizeObserver は鳴らないので、
    // ここで見る。devicePixelRatio はただのプロパティ読みでレイアウトを誘発しない
    if (this.scale > 0 && devicePixelRatio !== this.scale) {
      this.resize(this.width, this.height, devicePixelRatio);
    }

    // 設定は毎フレーム読む。曲の途中で変えてもそのまま効く。
    // 動きを減らす時は時刻を 0 に畳む（星は消さない。動かない点でも星空は星空で、
    // 背景ごと消すと作品が別物になる）
    const drawTime = this.prefersReducedMotion() ? 0 : time;

    // 畳んだ結果 2 フレーム目以降は前回と同じ時刻になり、描画そのものが飛ぶ。
    // 動きを減らしたい人の端末で、同じ絵を 60 回/秒 描き続けずに済む
    if (drawTime === this.lastDrawnTime) return;

    this.draw(drawTime);
    this.lastDrawnTime = drawTime;
  }

  /** 購読をやめる。ページの寿命 = アプリの寿命なので本編では呼ばれない */
  destroy(): void {
    this.observer.disconnect();
  }

  /**
   * 描画面の解像度を合わせる。
   *
   * canvas は width / height 属性が実ピクセル数で、CSS の大きさとは別物。
   * 表示倍率を掛けた実ピクセルを持たせないと、高 DPI の画面で星がぼやける。
   */
  private resize(width: number, height: number, scale: number): void {
    this.canvas.width = Math.round(width * scale);
    this.canvas.height = Math.round(height * scale);

    // width への代入は context の状態（変換行列も塗り色も）を初期化する。
    // 拡大率を変換行列に入れておけば、以降は CSS ピクセルの座標で描ける
    this.context.setTransform(scale, 0, 0, scale, 0, 0);

    this.width = width;
    this.height = height;
    this.scale = scale;

    // 中身が消えたので、次のフレームでは同じ時刻でも描き直す
    this.lastDrawnTime = null;
  }

  private draw(time: number): void {
    const { context, width, height } = this;
    context.clearRect(0, 0, width, height);

    for (const star of this.stars) {
      context.globalAlpha = starAlpha(star, time);
      context.fillStyle = star.color;
      context.beginPath();
      context.arc(star.x * width, star.y * height, star.radius, 0, Math.PI * 2);
      context.fill();
    }

    // 次に描く人のために戻す（今は自分しか使っていないが、状態を残さない）
    context.globalAlpha = 1;
  }
}
