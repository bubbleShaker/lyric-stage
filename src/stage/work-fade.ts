import type { FadeCurve } from '../domain/fade';

/**
 * 作品の頭と終わりのフェード（M12-2 / Issue #70）— 画と音を同じ曲線で開け閉めする。
 *
 * ## 書くのは進み具合だけ（M8-3a / M8-4 と同じ分担）
 *
 * ここが膜に書くのは `--work-fade`（0〜1 の現れ具合）だけで、**何色でどれだけ
 * 覆うかは `style.css`**。読み忘れると「値は毎フレーム正しく書かれているのに
 * 画だけ開かない」になるので、`work-fade.test.ts` が CSS 側で読まれていることを見張る。
 *
 * ## 膜は再生コントロールとクレジットより奥に置く
 *
 * 手前に置くと、**フェードインの最中＝まだ止まっている間に再生ボタンが霞む**
 * （押し所が分からない）。クレジット（音楽：魔王魂）は素材の利用条件なので、
 * なおさら覆ってはいけない。奥行きの取り決めは `style.css` の z-index が持つ。
 *
 * ## GSAP のタイムラインには乗せない
 *
 * 演出の時計は音の再生位置。GSAP 自身の時計で回すと、シークや停止でフェードだけが
 * 置いていかれる（`beat-impact.ts` / `scene-polarity.ts` と同じ）。
 */

/** 現れ具合を書き込む CSS カスタムプロパティ。**`style.css` が読んでいなければ画は開かない** */
export const WORK_FADE_VAR = '--work-fade';

/**
 * 音量を決める口。**実装は `stage/loudness.ts` の `AudioOutput`**（音の出口を
 * あちらが持っているため）。ここが関数 1 本で受けるのは、膜が知る必要のあるのが
 * 「0〜1 を渡す」ことだけだから — 解析の口まで見えていると、フェードが盛り上がりを
 * 読めてしまう（依存は要る分だけ細くする）。
 */
export type VolumeControl = (level: number) => void;

export interface WorkFade {
  /** 毎フレーム、作品の再生位置を渡す */
  readonly render: (time: number) => void;
}

/**
 * 書き込む値を何段に刻むか（`beat-impact.ts` の VALUE_STEPS と同じ趣旨）。
 *
 * 曲線は連続値なので、生のまま書くと**フェードが終わった後も毎フレーム
 * わずかに違う値**を書き続ける可能性がある。128 段なら 2 秒のフェードで
 * 0.8% 刻み ＝ 目にも耳にも段差は分からず、開け終わった後は書き込みが止まる。
 */
const VALUE_STEPS = 128;

function quantize(value: number): number {
  return Math.round(value * VALUE_STEPS) / VALUE_STEPS;
}

/**
 * 膜と音量に現れ具合を配る口を返す。
 *
 * **組み立て直後に一度書く。** 書かないと、最初のフレームが来るまで画は素のまま・
 * 音量も素のままで、**再生ボタンを押した瞬間だけ音が飛び出す**（`mountScenePolarity`
 * が既定の極性を一度書くのと同じ理由）。
 */
export function mountWorkFade(veil: HTMLElement, curve: FadeCurve, volume: VolumeControl): WorkFade {
  // 直前に書いた値。同じ値をもう一度書かないための控え（`beat-impact.ts` と同じ手）
  let written: number | null = null;

  const write = (time: number): void => {
    const level = quantize(curve(time));
    if (written === level) return;

    veil.style.setProperty(WORK_FADE_VAR, String(level));
    volume(level);
    written = level;
  };

  write(0);

  return { render: write };
}
