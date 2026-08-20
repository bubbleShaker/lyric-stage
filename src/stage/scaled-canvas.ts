/**
 * CSS ピクセルの座標で描ける Canvas。
 *
 * canvas は width / height 属性が実ピクセル数で、CSS の大きさとは別物。表示倍率を
 * 掛けた実ピクセルを持たせないと高 DPI の画面でぼやける。その辻褄合わせ
 * （大きさの追従・変換行列の張り直し）だけをここに閉じ込め、
 * 中身を描く側（Starfield）は「幅と高さと context」しか知らずに済むようにする。
 */

/** 表示倍率の読み方。読み方を注入するのは lib/reduced-motion.ts と同じ理由 */
export type PixelRatioQuery = () => number;

/** ブラウザの表示倍率。ここが window に触れる唯一の場所 */
export const systemPixelRatio: PixelRatioQuery = () => window.devicePixelRatio;

/** 描く側が描画面に求める口。テストでは偽物を差し込める */
export interface DrawSurface {
  readonly context: CanvasRenderingContext2D;
  /** CSS ピクセルでの大きさ */
  readonly width: number;
  readonly height: number;
  /** 大きさが決まっていて描ける状態か */
  readonly ready: boolean;
  /** 描画面を作り直すたびに増える番号。前に描いた絵が消えたかの判定に使う */
  readonly version: number;
  /** 毎フレーム呼ぶ。表示倍率の変化に追従する */
  sync(): void;
}

export class ScaledCanvas implements DrawSurface {
  private readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  private readonly pixelRatio: PixelRatioQuery;
  private readonly observer: ResizeObserver;

  private cssWidth = 0;
  private cssHeight = 0;
  private scale = 0;
  private generation = 0;

  constructor(canvas: HTMLCanvasElement, pixelRatio: PixelRatioQuery) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D の context を取得できません');

    this.canvas = canvas;
    this.context = context;
    this.pixelRatio = pixelRatio;

    // 大きさは ResizeObserver で拾う。毎フレーム clientWidth を読む形にすると、
    // 同じフレームで gsap が書き換えたスタイルの再計算をそのたびに強制してしまう。
    //
    // **初回の通知は非同期**（購読した次の描画更新のタイミング、しかも
    // requestAnimationFrame より後）。つまり最初の 1 フレームは大きさが未定のまま
    // render が来る。それを描かずに済ませるための ready。
    this.observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.apply(width, height, this.pixelRatio());
    });
    this.observer.observe(canvas);
  }

  get width(): number {
    return this.cssWidth;
  }

  get height(): number {
    return this.cssHeight;
  }

  get ready(): boolean {
    return this.cssWidth > 0 && this.cssHeight > 0;
  }

  get version(): number {
    return this.generation;
  }

  /**
   * 画面をまたいで表示倍率が変わっても ResizeObserver は鳴らないので、ここで見る。
   * devicePixelRatio はただのプロパティ読みで、レイアウトの再計算を誘発しない。
   */
  sync(): void {
    const ratio = this.pixelRatio();
    if (this.scale > 0 && ratio !== this.scale) {
      this.apply(this.cssWidth, this.cssHeight, ratio);
    }
  }

  destroy(): void {
    this.observer.disconnect();
  }

  private apply(width: number, height: number, scale: number): void {
    // 端数のある表示倍率（Windows の 125% など）では実ピクセルの境界と厳密には
    // 揃わない。合わせるには observe の box に device-pixel-content-box を
    // 指定する必要があるが、対応していないブラウザがあるうえ、
    // 星のような点では目視で差が出ないので今はこのままにしている
    this.canvas.width = Math.round(width * scale);
    this.canvas.height = Math.round(height * scale);

    // width への代入は context の状態（変換行列も塗り色も）を初期化する。
    // 拡大率を変換行列に入れておけば、以降は CSS ピクセルの座標で描ける
    this.context.setTransform(scale, 0, 0, scale, 0, 0);

    this.cssWidth = width;
    this.cssHeight = height;
    this.scale = scale;

    // 中身が消えたことを描く側へ伝える
    this.generation += 1;
  }
}
