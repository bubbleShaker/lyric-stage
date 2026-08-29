import { describe, expect, it } from 'vitest';
import {
  buildCameraMove,
  CAMERA_CLASS,
  CAMERA_MOVE,
  focusIn,
  framingFor,
  restCamera,
  type Focus,
} from './camera';
import { classRule as rulesFor } from '../test-support/css-rules';

/** 画面のどこに・どれだけの幅で居るか。既定は真ん中の、画面の 3 割を占める語句 */
function focus(overrides: Partial<Focus> = {}): Focus {
  return { x: 0.5, y: 0.5, width: 0.3, height: 0.2, aspect: 16 / 9, ...overrides };
}

/** カメラの当て先。gsap は要素でなくただのオブジェクトも動かせる（drift.test.ts と同じ手） */
function dummyCamera() {
  return { xPercent: 0, yPercent: 0, scale: 1, rotationZ: 0, rotationY: 0, z: 0 } as Record<
    string,
    unknown
  >;
}

/**
 * カメラの値を当てたとき、その語句が画面のどこへ着くか。
 *
 * **`framingFor` とは逆向きに、独立に組み立てている**（レビュー指摘 🔴）。
 * 「framingFor の答えを framingFor で確かめる」形だと同語反復になり、回転の
 * 打ち消しを丸ごと落としても検査が通ってしまった（実測: 着地が 0.459..0.557 まで
 * ずれるのに全件緑）。
 *
 * ここでは CSS が実際にする合成をなぞる —
 * ずれ `d` に **拡大 → rotationY → rotate(Z)** を順に効かせ、最後に平行移動を足す。
 * 遠近の割り算は掛け算なので、中心（0）に着くかどうかの判定には影響しない。
 */
function landingOf(spot: Focus, seed: number): { x: number; y: number } {
  const framing = framingFor(spot, seed);
  const rad = (deg: number) => (deg * Math.PI) / 180;

  // 画面の幅を 1 とした画素の空間へ（高さは 1/aspect）
  const dx = (spot.x - 0.5) * framing.scale;
  const dy = ((spot.y - 0.5) / spot.aspect) * framing.scale;

  // rotationY は縦軸まわり ＝ 横だけが縮む
  const turnedX = dx * Math.cos(rad(framing.rotationY));
  // rotate(Z) は画面の中で x と y を混ぜる
  const cos = Math.cos(rad(framing.rotationZ));
  const sin = Math.sin(rad(framing.rotationZ));
  const rotatedX = turnedX * cos - dy * sin;
  const rotatedY = turnedX * sin + dy * cos;

  // 平行移動（xPercent は幅に対する％、yPercent は高さに対する％）
  return {
    x: 0.5 + rotatedX + framing.xPercent / 100,
    y: 0.5 + (rotatedY + framing.yPercent / 100 / spot.aspect) * spot.aspect,
  };
}

describe('framingFor', () => {
  it('どこに居る語句も画面の真ん中に着く', () => {
    // **この検査がこのファイルの要**。拡大の打ち消しだけでは足りず、回転（`rotate(Z)` と
    // `rotationY`）と縦横比も通した後のずれを消さないと、**端に置いた語句が枠から外れる**
    // （実測: `top-right` の語句が画面の 0.59 に着いた）。
    //
    // **x と y の両方を中心から外した場合**を必ず含める — 片方だけだと `rotate(Z)` が
    // 混ぜる項が 0 になり、打ち消しを落としても気付けない
    for (const seed of [0, 1, 2]) {
      for (const spot of [
        focus({ x: 0.5, y: 0.5 }),
        focus({ x: 0.9, y: 0.2 }),
        focus({ x: 0.1, y: 0.85 }),
        focus({ x: 0.78, y: 0.9, aspect: 1 }),
        focus({ x: 0.15, y: 0.1, aspect: 0.6 }),
      ]) {
        const landing = landingOf(spot, seed);

        expect(landing.x, `seed ${seed} / x ${spot.x}`).toBeCloseTo(0.5, 6);
        expect(landing.y, `seed ${seed} / y ${spot.y}`).toBeCloseTo(0.5, 6);
      }
    }
  });

  it('画面の真ん中に居る語句には寄るだけ（動かさない）', () => {
    const framing = framingFor(focus(), 0);

    expect(framing.xPercent).toBeCloseTo(0);
    expect(framing.yPercent).toBeCloseTo(0);
    expect(framing.scale).toBeGreaterThan(1);
  });

  it('端に居る語句は、中心へ引き寄せる向きに動かす', () => {
    // **符号を間違えると語句が画面の外へ飛ぶ**（寄せるつもりが遠ざける）
    const right = framingFor(focus({ x: 0.9 }), 0);
    const low = framingFor(focus({ y: 0.9 }), 0);

    expect(right.xPercent).toBeLessThan(0);
    expect(low.yPercent).toBeLessThan(0);
  });

  it('平行移動には倍率が掛かっている', () => {
    // gsap は translate を拡大の**後**に効かせるので、掛けないと寄るほど中心からずれる。
    // 幅だけ変えて倍率を変え、同じ居場所に対する移動量を比べる
    const near = framingFor(focus({ x: 0.9, width: 0.5 }), 0);
    const far = framingFor(focus({ x: 0.9, width: 0.25 }), 0);

    expect(far.scale).toBeGreaterThan(near.scale);
    expect(far.xPercent / near.xPercent).toBeCloseTo(far.scale / near.scale);
  });

  it('小さい語句ほど強く寄る', () => {
    // **倍率を決め打ちにできない理由**。構図の段階は 0.62〜1.28 と 2 倍の開きがあるので、
    // 同じ倍率で寄せると片方は画面からはみ出し、もう片方は小さいまま残る
    expect(framingFor(focus({ width: 0.2 }), 0).scale).toBeGreaterThan(
      framingFor(focus({ width: 0.5 }), 0).scale,
    );
  });

  it('寄る量には上限と下限がある', () => {
    // 下限が 1 なのは**引くのはカメラの仕事ではない**から（小さく見せたいなら構図の段階）。
    // 上限が要るのは、極端に短い語句で字の縁がにじむため
    expect(framingFor(focus({ width: 0.95, height: 0.9 }), 0).scale).toBe(1);
    expect(framingFor(focus({ width: 0.01, height: 0.01 }), 0).scale).toBeLessThanOrEqual(4);
  });

  it('縦に長い語句は高さで頭を押さえる', () => {
    // **縦組みの語句は幅が狭く高さが画面いっぱいに近い**（レビュー指摘 🔴）。
    // 幅だけで倍率を決めると、実測で 13 字の縦組みが画面の 1.97 倍になった
    const tall = framingFor(focus({ width: 0.05, height: 0.62 }), 0);

    // 寄せた後も画面に収まる
    expect(tall.scale * 0.62).toBeLessThanOrEqual(1);
    // 幅だけを見ていたら 3.6（上限）に張り付いていた
    expect(tall.scale).toBeLessThan(3.6);
  });

  it('測れなかった語句には寄らない', () => {
    // `getBoundingClientRect` は描かれていない要素に 0 を返す。割り算がそのまま
    // `Infinity` になると、**カメラが無限に寄って画面が真っ黒になる**
    const framing = framingFor(focus({ width: 0 }), 0);

    expect(framing.scale).toBe(1);
    expect(Number.isFinite(framing.xPercent)).toBe(true);
  });

  it('語句ごとに傾きの向きが変わる', () => {
    // 寄るたびに同じ絵にならないように。漂い（drift.ts）が周期をずらすのと同じ趣旨
    expect(Math.sign(framingFor(focus(), 0).rotationZ)).not.toBe(
      Math.sign(framingFor(focus(), 1).rotationZ),
    );
  });
});

describe('restCamera', () => {
  it('その語句を枠に収めた姿で据える', () => {
    const camera = dummyCamera();
    restCamera(camera, focus({ x: 0.9 }));

    expect(Number(camera.scale)).toBeGreaterThan(1);
    expect(Number(camera.xPercent)).toBeLessThan(0);
  });

  it('動きを減らす設定では素の姿にする', () => {
    // カメラが動かないので、語句は構図に書いたとおりの場所・大きさで出る
    // （M13-4 より前の見え）。**寄せたまま止めるのではない** — 画面ぜんぶが
    // 寄った状態で固定されると、端に置いた語句が画面の外に居ることになる
    const camera = dummyCamera();
    restCamera(camera, focus({ x: 0.9 }), { reducedMotion: true });

    expect(camera.scale).toBe(1);
    expect(camera.xPercent).toBe(0);
  });
});

describe('buildCameraMove', () => {
  it('移動の長さで終わる', () => {
    // **語句の最短間隔（0.751 秒）より短いこと。** 着くのは次の語句が出る時刻なので、
    // これが間隔を超えると前の語句がまだ画面の真ん中に居るうちに動き出す
    const timeline = buildCameraMove(dummyCamera(), focus(), 1);

    expect(timeline.duration()).toBeCloseTo(CAMERA_MOVE);
    expect(CAMERA_MOVE).toBeLessThan(0.751);
    timeline.kill();
  });

  it('途中で一度引いて、着く時には戻っている', () => {
    // まっすぐ寄せると 2 点を結ぶ直線をなぞるだけになる。途中で引くと回り込んで見える
    // （作者の言う「近寄ったり離れたり」）。**着いた時に引いたままだと画が遠いまま**
    const camera = dummyCamera();
    const timeline = buildCameraMove(camera, focus({ x: 0.2 }), 1).pause();

    timeline.time(CAMERA_MOVE / 2 + 0.0001).time(CAMERA_MOVE / 2);
    expect(Number(camera.z)).toBeLessThan(0);

    timeline.time(CAMERA_MOVE + 0.0001).time(CAMERA_MOVE);
    expect(Number(camera.z)).toBeCloseTo(0);

    timeline.kill();
  });

  it('着いた時に次の語句が枠に収まっている', () => {
    const camera = dummyCamera();
    const target = focus({ x: 0.2, y: 0.8 });
    const timeline = buildCameraMove(camera, target, 1).pause();

    timeline.time(CAMERA_MOVE + 0.0001).time(CAMERA_MOVE);

    const framing = framingFor(target, 1);
    expect(Number(camera.xPercent)).toBeCloseTo(framing.xPercent);
    expect(Number(camera.yPercent)).toBeCloseTo(framing.yPercent);
    expect(Number(camera.scale)).toBeCloseTo(framing.scale);

    timeline.kill();
  });

  it('動きを減らす設定では動かさない', () => {
    // 画面ぜんぶが動くので、漂い（drift）より影響が大きい
    const camera = dummyCamera();
    const timeline = buildCameraMove(camera, focus({ x: 0.2 }), 1, { reducedMotion: true });

    expect(timeline.duration()).toBe(0);
    expect(camera.scale).toBe(1);
    timeline.kill();
  });

  it('カメラの層は中の 3D を平らに焼き込まない', () => {
    // ここで潰すと、語句ごとの奥行き（漂い・退場）もカメラ自身の z（移動の途中の
    // 引き）も、ただの拡大縮小になる。**CSS にしか書けない指定**
    const rules = rulesFor(CAMERA_CLASS);

    expect(rules.some((body) => /transform-style:\s*preserve-3d/u.test(body))).toBe(true);
  });

  it('カメラの箱は画面と完全に重なる', () => {
    // **式が黙って前提にしている 2 つ**（レビュー指摘 🟡）:
    // - `xPercent` / `yPercent` の 100% が画面の幅・高さと一致すること
    // - 遠近を張る `.stage__lines` と原点が一致すること
    //   （一致しているから「遠近の割り算を無視してよい」が成り立つ。ずれた瞬間、
    //   画は中心から外れるのに例外も型検査の赤も出ない）
    const rules = rulesFor(CAMERA_CLASS);

    expect(rules.some((body) => /position:\s*absolute/u.test(body))).toBe(true);
    expect(rules.some((body) => /inset:\s*0/u.test(body))).toBe(true);
  });
});

describe('focusIn', () => {
  it('画面に対する割合へ揃える', () => {
    // **割り算をここに置いた理由**（レビュー指摘 🔴）。測る側（LyricStage）に持たせると、
    // 幅を割り忘れても画は「なんとなく寄る」ので気付けない
    const spot = focusIn({ left: 400, top: 90, width: 200, height: 60 }, { width: 1000, height: 500 });

    expect(spot.x).toBeCloseTo(0.5);
    expect(spot.y).toBeCloseTo(0.24);
    expect(spot.width).toBeCloseTo(0.2);
    expect(spot.height).toBeCloseTo(0.12);
    expect(spot.aspect).toBeCloseTo(2);
  });

  it('画面が測れなければ寄らない値を返す', () => {
    // 描かれる前の枠は 0 を返す。割り算がそのまま Infinity になると
    // **カメラが無限に寄って画面が真っ黒になる**
    const spot = focusIn({ left: 0, top: 0, width: 0, height: 0 }, { width: 0, height: 0 });

    expect(framingFor(spot, 0).scale).toBe(1);
    expect(Number.isFinite(spot.x)).toBe(true);
  });
});
