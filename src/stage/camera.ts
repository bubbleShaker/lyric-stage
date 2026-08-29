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
 * 寄せた語句が画面の幅に占める割合。
 *
 * 1 に近づけるほど「大きく出す」が、**枠は `max-width: 86%` まで伸びうる**ので、
 * 長い語句では左右が切れる。0.62 は「6 文字の語句が画面いっぱいに見えて、
 * なお端に余白が残る」ところを目で決めた。
 */
const FILL = 0.62;

/**
 * 寄せる倍率の下限と上限。
 *
 * 下限が 1 なのは、**引くのはカメラの仕事ではない**から。語句を小さく見せたければ
 * 構図の段階（`size`）を下げる。上限は、極端に短い語句（`幻が`）で 3 倍を超えると
 * 字の縁がにじむため（transform の拡大は字形を描き直さないことがある）。
 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 2.4;

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
  /** 語句の幅（画面の幅に対する割合）。**寄る量はここから決まる** */
  readonly width: number;
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
 * gsap がカメラに書く変形は `translate → rotate(Z) → rotationY → scale` の順に
 * 積まれる（＝点には拡大・回転・平行移動の順に効く）。回転も拡大も**箱の中心**
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
 * 回転は画素の空間で x と y を混ぜるので、**割合のまま回すと縦横比のぶん狂う**。
 * 幅を単位にして計算し、最後に高さの単位へ戻す。
 *
 * `seed` は行の中で何番目の語句か。傾きの向きを交互にして、寄るたびに同じ絵に
 * ならないようにする（漂い（`drift.ts`）が周期をずらしているのと同じ趣旨）。
 */
export function framingFor(focus: Focus, seed: number): Framing {
  const scale = zoomFor(focus.width);
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
 * 語句の幅から寄る倍率を決める。
 *
 * **幅が 0 の時は寄らない**（1 倍）。測れなかった語句 — 書体が届く前や、
 * DOM を持たない検査のダミー — で `Infinity` を返さないため。
 */
function zoomFor(width: number): number {
  if (!(width > 0)) return MIN_ZOOM;

  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, FILL / width));
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
 * 次の語句へ移る。**着くのは移動が終わった時**なので、置く位置は
 * 「次の語句が出る時刻 - `CAMERA_MOVE`」になる（`line-timeline.ts`）。
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
