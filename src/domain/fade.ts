/**
 * 作品の頭と終わりの現れ具合（M12-2 / Issue #70）。
 *
 * 区間の頭で音が唐突に始まり、終わりで `keepInWindow()` がそのまま止める——
 * という切り口を、画と音の両方で閉じる。
 *
 * **ここが返すのは 0〜1 の「現れ具合」だけ。** 何色の膜をどれだけ被せるかは
 * `style.css`、音量にどう渡すかは `stage/loudness.ts` が決める（M8-3a の
 * `--decor-grow`・M8-4 の `--beat-flash` と同じ分担）。
 *
 * **画と音で 1 本の曲線を共有する。** 別々に持つと、片方だけ長さを変えたときに
 * 画が明けているのに音がまだ小さい、という「合っていないのに動いてはいる」状態に
 * なる（このリポジトリが一番嫌う壊れ方）。時計もいつもの音の再生位置なので、
 * シークすれば画も音も一緒に飛ぶ。
 */

/** フェードの長さ（秒）。**曲ごとの値なので `work.ts` が持つ** */
export interface FadeSpans {
  /** 頭。0 なら頭のフェードは無し */
  readonly in: number;
  /** 終わり。0 なら終わりのフェードは無し */
  readonly out: number;
}

/** 作品の何秒目か → 現れ具合（0 = 完全に隠れている / 1 = 素の画） */
export type FadeCurve = (time: number) => number;

/**
 * 区間の長さとフェードの長さから曲線を作る。
 *
 * **重なる長さは受け付けない。** `in + out > length` だと、頭のフェードが明ける前に
 * 終わりのフェードが始まる＝どこにも素の画が無い作品になる。値の書き間違いで
 * しか起きないので、`WindowedPlayback` の区間の検査と同じく起動した瞬間に落とす。
 *
 * `length` に `Infinity`（`WHOLE_SONG`）を渡してもよい。終わりが無いので
 * 尻のフェードが効かなくなるだけで、頭のフェードはそのまま働く。
 */
export function createFadeCurve(length: number, spans: FadeSpans): FadeCurve {
  if (!(spans.in >= 0) || !(spans.out >= 0)) {
    throw new Error(`フェードの長さが不正です: in=${String(spans.in)} out=${String(spans.out)}`);
  }
  if (!(length > 0) || spans.in + spans.out > length) {
    throw new Error(
      `フェードが区間に収まりません: length=${String(length)} in=${String(spans.in)} out=${String(spans.out)}`,
    );
  }

  return (time) => {
    // NaN は比較をすべてすり抜けて 1 として返ってしまうので先に落とす
    // （画が明るいまま貼り付き、音も鳴りっぱなしになる）
    if (!Number.isFinite(time)) return 0;

    // 頭より前（区間の外）は隠れている側
    if (time <= 0) return 0;

    // **長さ 0 のときに 0 除算を作らない。** 書かない側は「ずっと素の画」なので 1。
    // 終端を跨いだ後（falling が負）は下の Math.max が 0 に締める
    const rising = spans.in > 0 ? time / spans.in : 1;
    const falling = spans.out > 0 ? (length - time) / spans.out : 1;

    return Math.max(0, Math.min(1, rising, falling));
  };
}
