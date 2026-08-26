import { pulseAt, pulseIndexAt, type BeatPulse, type FlashPulse } from '../domain/beat';
import type { IntensityQuery } from '../lib/intensity';
import type { ReducedMotionQuery } from '../lib/reduced-motion';

/**
 * ビート同期の衝撃（M8-4 / Issue #49）— 拍で画面が瞬き、揺れる。
 *
 * 文字PV で画を締めているのは構図・図形・書体だけではなく、**画そのものが音に
 * 叩かれている**こと。拍の格子（`domain/beat.ts`）が「いつ」を、実音の解析
 * （`stage/loudness.ts` の `IntensityQuery`）が「どれだけ」を決める。
 *
 * ## 叩く先（Issue #49 で決めた 2 か所）
 *
 * - **フラッシュ** — `mountScreenDecor` が返すレイヤーの中に 1 枚敷く。背景（canvas）
 *   側でやると、M8-2 のレビュー指摘（**連続値が混じると「入力が同じなら描かない」が
 *   無効になる**）をもう一度踏むうえ、12 コマ/秒に抑えた描き直しの判定に新しい入力を
 *   足すことになる。DOM なら背景の判定に一切触らない
 * - **画面揺れ** — `.stage__lines`（語句の枠が並ぶ箱）。**`.stage__frame` は揺らせない** —
 *   あそこは構図（M8-1）が transform を持ち、GSAP は transform を自分のものとして
 *   扱うので取り合いになる。親を揺らせば中の構図はそのまま乗る
 *
 * ## 進み具合だけを書き、意味は CSS が決める（M8-3a / M8-3c と同じ分担）
 *
 * ここが書くのは 0〜1 の強さと -1〜1 の向きだけ。**どれだけ明るくなるか・何 px
 * 揺れるかは `style.css`** が持つ。画面の広さに応じた揺れ幅（`vmin`）や、明滅の
 * 明度差といった「画面を見て決める値」は CSS 側にある方が調整が 1 か所で済む。
 *
 * ## GSAP のタイムラインには乗せない
 *
 * 演出の時計は音の再生位置（M8-5 の 🔴）。GSAP 自身の時計で回すと、シークや停止で
 * 拍だけが置いていかれる。毎フレーム `render(time)` に再生位置を渡す形にする。
 */

/** 画面を覆う拍の膜。`mountScreenDecor` のレイヤーの中に敷く。
 *  **M9-1 で「光る」から「翳る」へ裏返った** — 膜は ink のままで、地の方が明るく
 *  なったため。名前（flash）は明滅一般を指す語なので据え置く（`style.css` を見よ） */
export const BEAT_FLASH_CLASS = 'screen-decor__flash';

/**
 * 書き込む CSS カスタムプロパティ。**`style.css` が読んでいなければ画は静止したまま**
 * になる（タイムラインは動いているのに何も起きない、M8-3a と同じ壊れ方）ので、
 * `beat-impact.test.ts` が CSS 側で読まれていることを見張る。
 */
export const FLASH_VAR = '--beat-flash';
export const SHAKE_X_VAR = '--beat-shake-x';
export const SHAKE_Y_VAR = '--beat-shake-y';

/**
 * 打拍ごとの揺れる向き（単位はだいたい 1 の長さ。実際の幅は CSS が掛ける）。
 *
 * 乱数ではなく表から順に引く。**決定的なので検査できる**し、作品としても
 * リロードのたびに揺れ方が変わらない（星の配置を種で固定したのと同じ判断）。
 *
 * 縦を強くしてあるのはキックに叩かれる画にするため。横に振ると「首を振る」動きに
 * 見えて、拍の重さが乗らない。6 つあるので 8 分（0.376 秒）で一巡は 2.3 秒 —
 * 小節（3.0 秒）と割り切れないぶん、繰り返しが目に付かない。
 */
export const SHAKE_DIRECTIONS: readonly (readonly [x: number, y: number])[] = [
  [0, 1],
  [0.35, -0.9],
  [-0.5, 0.85],
  [0.15, 1],
  [-0.3, -0.95],
  [0.6, 0.8],
];

/**
 * 静かな場面でも残る振れ幅と、実音で増える分。
 *
 * 実音を素直に掛けるだけ（`intensity` 倍）にすると、**音の無い
 * `effect-preview.html` では衝撃が一切出ない**（あちらの `window.loud` は既定 0）。
 * 拍は鳴っているのに画が動かないのでは、構図を見比べる道具として本番とずれる。
 */
const IMPACT_BASE = 0.3;
const IMPACT_GAIN = 0.7;

/**
 * 書き込む値を何段に刻むか。**M8-2 の 🔴 の一般化。**
 *
 * `IntensityQuery` は毎フレーム平滑化される連続値なので、生のまま書くと
 * 「前と同じなら書かない」が一度も効かず、**拍の合間の静かなフレームでも
 * スタイルを書き換え続ける**（書き換えるたびにレイアウトの再計算が要る）。
 * 64 段にしてあるのは、揺れ幅（最大 10px）でも明滅（最大 6%）でも 1 段の差が
 * 目に見えないため。
 */
const VALUE_STEPS = 64;

function quantize(value: number): number {
  return Math.round(value * VALUE_STEPS) / VALUE_STEPS;
}

/**
 * その打拍で揺れる向き。**負の打拍でも表の中を指す**（区間の手前は時刻が負になる）。
 */
export function shakeDirectionAt(pulse: BeatPulse, time: number): readonly [number, number] {
  const index = pulseIndexAt(pulse, time);
  const length = SHAKE_DIRECTIONS.length;

  return SHAKE_DIRECTIONS[((index % length) + length) % length];
}

/** 叩く先。どちらも既に画面に居る要素で、ここでは作らない（フラッシュの膜だけ足す） */
export interface BeatImpactTargets {
  /** `mountScreenDecor` が返したレイヤー。この中に拍の膜を敷く */
  readonly layer: HTMLElement;
  /** 揺らす箱（`.stage__lines`）。**構図の枠を渡してはいけない** */
  readonly lines: HTMLElement;
}

export interface BeatImpactPulses {
  /** 明滅する刻み。**下限を通した型しか受け取らない**（`domain/beat.ts`） */
  readonly flash: FlashPulse;
  /** 揺れる刻み。明滅ではないので下限は掛からない */
  readonly shake: BeatPulse;
}

export interface BeatImpact {
  /** 毎フレーム、作品の再生位置を渡す */
  readonly render: (time: number) => void;
}

/** その瞬間に書き込む値。段に刻んだ後の値なので、同じなら書かなくてよい */
export interface ImpactValues {
  /** 拍の膜の強さ（0〜1） */
  readonly flash: number;
  /** 揺れの向きと大きさ（-1〜1） */
  readonly x: number;
  readonly y: number;
}

export interface ImpactInputs {
  /** OS の「視差効果を減らす」設定が有効か */
  readonly reduced: boolean;
  /** 今の盛り上がり（0〜1。外れた値は挟む） */
  readonly intensity: number;
}

/**
 * その時刻に書き込む値を決める。**DOM を知らないので検査できる。**
 *
 * 組み立て（`mountBeatImpact`）から切り出してあるのは、ここに畳み込みも量子化も
 * clamp も集まっているから（レビュー指摘 🔴）。DOM の中に置くと、
 * **`reduced` の畳み込みを落としても量子化を外しても全テストが緑のまま**になる
 * — 落ちるのがアクセシビリティの約束なので、目でも気付けない。
 * `GrainField` が `quantizeIntensity` を切り出して検査しているのと同じ形。
 */
export function impactValues(
  pulses: BeatImpactPulses,
  time: number,
  { reduced, intensity }: ImpactInputs,
): ImpactValues {
  // **畳み込みの門番はここ 1 か所。** 強さが 0 になれば瞬きも揺れも 0 になるので、
  // 打拍ごとの値の側で二度畳まない（二重にすると、どちらが本物の門番か読めなくなる）。
  // **拍の膜も揺れる箱も消さない** — #41 で粒とビネットを消さず時刻を 0 に畳んだのと同じ判断。
  //
  // 盛り上がりを挟むのは、`IntensityQuery` の型（`() => number`）が 0〜1 を
  // 縛らないため（レビュー指摘 🟡）。`effect-preview.html` が渡すのは無加工の
  // `() => window.loud` なので、コンソールで 20 と打てば
  // **画面全体が ink 一色に覆われる**（明るさの上限を CSS の係数に預けている以上、
  // 掛ける側の値もここで締める）
  const strength = reduced ? 0 : IMPACT_BASE + IMPACT_GAIN * clamp(intensity, 0, 1);

  const swing = pulseAt(pulses.shake, time) * strength;
  const [dx, dy] = shakeDirectionAt(pulses.shake, time);

  return {
    flash: quantize(pulseAt(pulses.flash, time) * strength),
    x: quantize(swing * dx),
    y: quantize(swing * dy),
  };
}

function clamp(value: number, min: number, max: number): number {
  // **NaN は素通りする**（Math.min/max は NaN を伝播させる）ので先に落とす。
  // 通すと書き込む値ごと NaN になり、CSS 側が丸ごと invalid になって
  // **揺れも瞬きも黙って止まる**
  if (!Number.isFinite(value)) return min;

  return Math.min(Math.max(value, min), max);
}

/**
 * 拍の膜を敷き、毎フレームの書き込み口を返す。
 *
 * 設定の読み方も盛り上がりの強さも関数で受け取る（`GrainField` と同じ）。
 * **既定値は置かない** — 渡し忘れても画面は出てしまうので、既定があると
 * 「動きを減らす設定が効いていない」ことに気付けない。
 */
export function mountBeatImpact(
  targets: BeatImpactTargets,
  pulses: BeatImpactPulses,
  prefersReducedMotion: ReducedMotionQuery,
  intensity: IntensityQuery,
): BeatImpact {
  const { layer, lines } = targets;

  // 要素は親の文書から作る（mountScreenDecor と同じ理由）
  const flash = layer.ownerDocument.createElement('span');
  flash.className = BEAT_FLASH_CLASS;
  layer.append(flash);

  // 直前に書いた値。同じ値をもう一度書かないための控え
  let written: ImpactValues | null = null;

  return {
    render(time) {
      // 設定も盛り上がりも毎フレーム読む（曲の途中で設定を変えてもそのまま効く）。
      // 何を書くかを決めるのは純粋な `impactValues` で、ここは書くだけ
      const values = impactValues(pulses, time, {
        reduced: prefersReducedMotion(),
        intensity: intensity(),
      });

      if (
        written &&
        written.flash === values.flash &&
        written.x === values.x &&
        written.y === values.y
      ) {
        return;
      }

      flash.style.setProperty(FLASH_VAR, String(values.flash));
      lines.style.setProperty(SHAKE_X_VAR, String(values.x));
      lines.style.setProperty(SHAKE_Y_VAR, String(values.y));
      written = values;
    },
  };
}
