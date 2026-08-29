import gsap from 'gsap';
import type { EffectTimeline } from './effects';

/**
 * 語句ではなくカメラの側を動かす（M13-4 / Issue #79）。
 *
 * ## 構図の読み替え
 *
 * 構図（M8-1 の `place`）は捨てない。今まで「画面のどこに置くか」だった値が
 * 「**どこへカメラを向けるか**」になるだけなので、シートは書き換えずに済む。
 * 語句は画面より広い空間に置かれたまま、カメラが順に寄っていく。
 *
 * ## 寄る量は測って決める
 *
 * 「1 語句が画面の幅をどれだけ占めるか」を決め、**枠の実寸から逆算する**。
 * 倍率を決め打ちにすると、`xl` の語句は画面からはみ出し、`sm` の語句は小さいまま
 * 残る（M8-1 の段階は 0.62〜1.28 倍と 2 倍の開きがある）。
 *
 * **測るのはここではない。** DOM を持っているのは `LyricStage` で、ここが受け取るのは
 * 測った結果（画面に対する割合）だけ。検査がダミーを渡して組み立てを借りられる
 * `line-timeline.ts` の作りを、カメラを足しても保つため。
 *
 * ## 置き場所
 *
 * `.stage__lines`（乗算と拍の揺れ）の**中**に置く。transform を持つ要素は
 * 重ね合わせ文脈を作り、**中の `mix-blend-mode` を地から切り離す**ので、
 * 乗算（M9-2）をカメラの外に残さないと語句が地に刷り重ならなくなる。
 */

/** カメラの層に当たるクラス。中身（位置と `transform-style`）は src/style.css が持つ */
export const CAMERA_CLASS = 'stage__camera';

/**
 * 次の語句へ移るのにかかる時間（秒）。
 *
 * **語句の最短間隔（0.751 秒）より短く。** 着くのは次の語句が出る時刻ちょうどなので、
 * これが間隔を超えると前の語句がまだ画面の真ん中に居るうちに動き出すことになる。
 */
export const CAMERA_MOVE = 0.45;

/**
 * 語句が出るより前に、カメラが動き始めている時間（秒）。
 *
 * **着くのは語句が出た後**（`at - CAMERA_LEAD + CAMERA_MOVE`）。これが無いと
 * **画面から何も見えない 0.25 秒**ができる（実測）— カメラが着いた時、前の語句は
 * もう枠の外へ運び去られているのに、次の語句はまだ登場の頭で不透明度が 0 だから。
 *
 * 語句が出る瞬間に前の語句がまだ枠に残っているよう、動き出しを遅らせる。
 * **歌より遅れて中心に来る**ことになるが、0.33 秒なら「カメラが追いかけた」に見える。
 */
export const CAMERA_LEAD = 0.12;

/**
 * 寄せた語句が画面に占める割合の**目安**。
 *
 * 1 に近づけるほど「大きく出す」が、**枠は `max-width: 86%` まで伸びうる**ので、
 * 長い語句では左右が切れる。0.62 は「6 文字の語句が画面いっぱいに見えて、
 * なお端に余白が残る」ところを目で決めた。
 *
 * **実現値ではない**（レビュー指摘 🟢）。回転と遠近で見かけの外接矩形がふくらむので、
 * 実測では 0.73 まで行くことがある。また下の上限に張り付く語句では届かない。
 *
 * **縦は別に持つ。** 縦組みの語句（`vertical`）は幅が狭く高さが画面いっぱいに近いので、
 * 幅だけで倍率を決めると**上下が切れる**（レビュー指摘 🔴 — 実測で 13 字の縦組みが
 * 画面の 1.97 倍になった）。高さの側は余白を薄くしてよい（縦組みは行が長いのが自然）。
 */
const FILL = 0.62;
const FILL_HEIGHT = 0.78;

/**
 * 寄せる倍率の下限と上限。
 *
 * 下限が 1 なのは、**引くのはカメラの仕事ではない**から。語句を小さく見せたければ
 * 構図の段階（`size`）を下げる。
 *
 * 上限は「字の縁がにじみ始める手前」で、ブラウザで見て決めた。**多くの語句がここへ
 * 張り付く**（レビュー指摘 🟡 — 1920px 幅では 27 語句中 24 個）。文字の基準寸法が
 * `clamp(1.75rem, 7vw, 5rem)` で頭打ちになるので、広い画面ほど語句は相対的に小さく、
 * `FILL` に届かせるには 10 倍近い拡大が要ってしまう。**上限を上げるより、
 * 広い画面での文字の基準寸法を見直す方が筋**（M7 のレスポンシブへ送る）。
 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 3.6;

/** 寄るたびに少し傾ける。まっすぐ寄るだけだと「拡大した」としか見えない */
const ROLL = 1.6;
const YAW = 6;

/**
 * 移動の途中でいったん引く深さ。
 *
 * まっすぐ寄せると 2 点を結ぶ直線をなぞるだけになる。**途中で一度引くと、
 * 回り込んで next へ入っていく**ように見える（作者の言う「近寄ったり離れたり」）。
 */
const ARC_DEPTH = -240;

/**
 * カメラが向く先。**画面（カメラの箱）に対する割合で表した、語句の居場所と大きさ。**
 *
 * 測るのは `LyricStage`。ここが px を受け取らないのは、**測り方を知らないまま
 * 検査できるようにする**ため（ダミーは好きな数を渡せる）。
 */
export interface Focus {
  /** 語句の中心（0〜1。0.5 が画面の真ん中） */
  readonly x: number;
  readonly y: number;
  /**
   * 語句の幅と高さ（画面に対する割合）。**寄る量はここから決まる。**
   *
   * **高さも要る**（レビュー指摘 🔴）。縦組みの語句は幅が狭く高さが画面いっぱいに
   * 近いので、幅だけで決めると上下が切れる。
   */
  readonly width: number;
  readonly height: number;
  /**
   * 画面の縦横比（幅 ÷ 高さ）。
   *
   * **傾きの打ち消しに要る**（`framingFor` を見よ）。回転は画素の空間で x と y を
   * 混ぜるので、割合のまま回すと縦横比のぶんだけ狂う。
   */
  readonly aspect: number;
}

/** カメラに書く値。`gsap.set` にも `to` にもそのまま渡せる形 */
export interface Framing {
  readonly xPercent: number;
  readonly yPercent: number;
  readonly scale: number;
  readonly rotationZ: number;
  readonly rotationY: number;
}

/**
 * その語句を画面の真ん中に収める、カメラの値。
 *
 * ## 平行移動は「拡大と回転を通した後のずれ」を打ち消す
 *
 * gsap がカメラに書く変形は `translate → rotate(Z) → rotationY → rotationX → skew →
 * scale` の順に積まれる（＝点には拡大・回転・平行移動の順に効く）。**この順序は
 * gsap の CSSPlugin が決めている**ので、gsap を上げた日は実測し直すこと — 順序が
 * 変わっても例外は出ず、端に置いた語句の着地だけが静かにずれる。回転も拡大も**箱の中心**
 * まわりなので、中心から離れた語句ほど回転で動く。倍率だけを打ち消すと
 * **端に置いた語句が枠から外れる**（実測: `top-right` の語句が画面の 0.59 に着いた）。
 *
 * そこで「中心からのずれ」に拡大と回転を実際に通し、その結果を打ち消す:
 *
 * ```
 * ずれ d → 拡大 s·d → rotationY で x が cos φ 倍 → rotate(Z) で x と y が混ざる
 * ```
 *
 * **遠近の割り算は考えなくてよい。** 画面の位置は `(平行移動 + 回した後のずれ) × 遠近`
 * という形なので、括弧の中をゼロにすれば遠近の値に関わらず中心に来る。
 *
 * ## 縦横比
 *
 * **x と y を混ぜるのは `rotate(Z)`**。割合のまま回すと縦横比のぶん狂うので、
 * 幅を単位にして計算し、最後に高さの単位へ戻す。
 *
 * `rotationY` の `cos` は今の `YAW`（6 度）では 0.995 で**画には出ない**
 * （レビュー指摘 🟡 — 落としても着地は変わらなかった）。傾きを強めた日のための保険として
 * 式に残す。
 *
 * `seed` は行の中で何番目の語句か。傾きの向きを交互にして、寄るたびに同じ絵に
 * ならないようにする（漂い（`drift.ts`）が周期をずらしているのと同じ趣旨）。
 */
export function framingFor(focus: Focus, seed: number): Framing {
  const scale = zoomFor(focus.width, focus.height);
  const toward = seed % 2 === 0 ? 1 : -1;
  const roll = toward * ROLL;
  const yaw = -toward * YAW;

  // 中心からのずれ。**どちらも「画面の幅」を単位にする**（回転が両者を混ぜるため）
  const aspect = focus.aspect > 0 ? focus.aspect : 1;
  const dx = scale * (focus.x - 0.5);
  const dy = (scale * (focus.y - 0.5)) / aspect;

  // rotationY は縦軸まわりなので、横のずれだけが cos で縮む
  const turned = dx * Math.cos(toRadians(yaw));
  const cos = Math.cos(toRadians(roll));
  const sin = Math.sin(toRadians(roll));

  return {
    xPercent: -(turned * cos - dy * sin) * 100,
    // 高さの単位へ戻す
    yPercent: -(turned * sin + dy * cos) * aspect * 100,
    scale,
    rotationZ: roll,
    rotationY: yaw,
  };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * 語句の大きさから寄る倍率を決める。**幅と高さの厳しい方に合わせる。**
 *
 * **測れなかった時は寄らない**（1 倍）。`getBoundingClientRect` は描かれていない
 * 要素に 0 を返すので、割り算がそのまま `Infinity` になる ＝ カメラが無限に寄る。
 */
function zoomFor(width: number, height: number): number {
  const byWidth = width > 0 ? FILL / width : MIN_ZOOM;
  const byHeight = height > 0 ? FILL_HEIGHT / height : MIN_ZOOM;

  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(byWidth, byHeight)));
}

/**
 * 測った 2 つの矩形を `Focus` にする。**画面に対する割合へ揃えるだけ。**
 *
 * 測るのは `LyricStage`（DOM を持っているのはあちらだけ）だが、**揃え方はここに置く** —
 * 割り算を向こうに置くと、幅を割り忘れても画が「なんとなく寄る」ので気付けない
 * （レビュー指摘 🔴: 割り算を落とす変異が検査を素通りした）。
 *
 * 渡すのは**変形を通していない**寸法（`offsetLeft` などの組みの値）。カメラは
 * 前の行の寄せを持ったままここへ来るので、`getBoundingClientRect` で測ると
 * 前の行の倍率が掛かった値になる。
 */
export function focusIn(
  part: { left: number; top: number; width: number; height: number },
  stage: { width: number; height: number },
): Focus {
  if (!(stage.width > 0) || !(stage.height > 0)) {
    return { x: 0.5, y: 0.5, width: 0, height: 0, aspect: 1 };
  }

  return {
    x: (part.left + part.width / 2) / stage.width,
    y: (part.top + part.height / 2) / stage.height,
    width: part.width / stage.width,
    height: part.height / stage.height,
    aspect: stage.width / stage.height,
  };
}

export interface CameraOptions {
  /** OS の「視差効果を減らす」設定が有効か */
  readonly reducedMotion?: boolean;
}

/**
 * 行の頭でカメラを据える。**タイムラインには乗せない**（時間を持たない）。
 *
 * 動きを減らす設定では素の姿に戻す。カメラが動かないので、語句は構図に書いた
 * とおりの場所に、書いたとおりの大きさで出る（M13-4 より前の見え）。
 */
export function restCamera(camera: object, focus: Focus, { reducedMotion = false }: CameraOptions = {}): void {
  if (reducedMotion) {
    gsap.set(camera, { xPercent: 0, yPercent: 0, scale: 1, rotationZ: 0, rotationY: 0, z: 0 });
    return;
  }

  gsap.set(camera, { ...framingFor(focus, 0), z: 0 });
}

/**
 * 次の語句へ移る。**着くのは語句が出た後**（`line-timeline.ts` が `CAMERA_LEAD` だけ
 * 手前から動かし始める）。着地を語句が出る時刻に合わせると、前の語句を運び去った枠に
 * 次の語句がまだ現れていない時間ができる（理由は `CAMERA_LEAD`）。
 *
 * 動きを減らす設定では**空のタイムライン**を返す。カメラが据わったまま動かないので、
 * 語句は構図どおりの場所に出続ける（`buildDrift` と同じ、空を返して呼ぶ側に分岐を作らない形）。
 */
export function buildCameraMove(
  camera: object,
  focus: Focus,
  seed: number,
  { reducedMotion = false }: CameraOptions = {},
): EffectTimeline {
  const timeline = gsap.timeline();

  if (reducedMotion) return timeline;

  timeline.to(camera, { ...framingFor(focus, seed), duration: CAMERA_MOVE, ease: 'power2.inOut' }, 0);

  // 途中で一度引いて、また寄る。**`scale` とは別のプロパティ**（`z` は遠近が効く）なので、
  // 上の寄せと時間が重なっても値を奪い合わない
  timeline.to(camera, { z: ARC_DEPTH, duration: CAMERA_MOVE / 2, ease: 'sine.out' }, 0);
  timeline.to(camera, { z: 0, duration: CAMERA_MOVE / 2, ease: 'sine.in' }, CAMERA_MOVE / 2);

  return timeline;
}
