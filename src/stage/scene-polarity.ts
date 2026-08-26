import { polarityAt, type Polarity, type PolarityTrack } from '../domain/lyrics';

/**
 * 画の明暗の切り替え（M9-3a / Issue #57）— シートに書いた極性で、画そのものが裏返る。
 *
 * M9-1 が配色を静的に反転し、M9-2 が文字を地に刷り重ねた。ここは同じ主題の三段目で、
 * **反転を曲の途中で起こす**（参考にした IRIS OUT MV の核）。
 *
 * ## ここが持つのは「どちらの極性か」だけ
 *
 * 何がどう裏返るかは `style.css`（`.scene[data-polarity='ink']` の `filter: invert(1)`）。
 * M8-3a の `--decor-grow`・M8-4 の `--beat-flash` と同じ分担で、**JS は状態を書くだけ**。
 * CSS 側が読み忘れると画は静止したままになるので、`scene-polarity.test.ts` が
 * 属性を当てにした規則の実在を見張る。
 *
 * ## GSAP のタイムラインには乗せない
 *
 * 演出の時計は音の再生位置（M8-5 の 🔴）。GSAP 自身の時計で回すと、シークや停止で
 * 極性だけが置いていかれる。毎フレーム `render(time)` に再生位置を渡す形にする
 * （`beat-impact.ts` と同じ）。
 *
 * ## 明滅の安全はここでは守らない
 *
 * 全画面の反転は明滅なので、切り替えの間隔には下限が要る。ただし極性はデータで書く
 * ものなので、**壁を置ける場所はシートの入口**（`domain/lyrics.ts` の
 * `MIN_POLARITY_INTERVAL` と `parseLyricSheet`）。ここに書いても、シートを直に
 * 渡す別の経路ができた時に素通りする。
 */

/** 極性を書き込む属性。**`style.css` がこれを読んでいなければ画は裏返らない** */
export const POLARITY_ATTR = 'data-polarity';

export interface ScenePolarity {
  /** 毎フレーム、作品の再生位置を渡す */
  readonly render: (time: number) => void;
}

/**
 * 画を裏返す枠（`.scene`）に極性を書き込む口を返す。
 *
 * **属性は最初のフレームを待たずに一度書く。** 既定の極性（`paper`）は
 * `filter` を当てない状態なので画としては同じだが、書いておかないと
 * 「まだ一度も書かれていない」と「既定に戻っている」が DOM から区別できない。
 */
export function mountScenePolarity(scene: HTMLElement, track: PolarityTrack): ScenePolarity {
  // 直前に書いた値。同じ値をもう一度書かないための控え（`beat-impact.ts` と同じ手）。
  // 極性は 1 曲に数回しか変わらないので、毎フレーム書くと**変わらないフレームでも
  // スタイルの再計算が走る** — しかも当たっているのは全画面の filter なので高くつく
  let written: Polarity | null = null;

  const write = (polarity: Polarity): void => {
    if (written === polarity) return;
    scene.setAttribute(POLARITY_ATTR, polarity);
    written = polarity;
  };

  write(polarityAt(track, 0));

  return {
    render(time) {
      write(polarityAt(track, time));
    },
  };
}
