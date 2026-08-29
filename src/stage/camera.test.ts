import { describe, expect, it } from 'vitest';
import { buildCameraMove, CAMERA_CLASS, CAMERA_MOVE, framingFor, restCamera, type Focus } from './camera';
import { classRule as rulesFor } from '../test-support/css-rules';

/** 画面のどこに・どれだけの幅で居るか。既定は真ん中の、画面の 3 割を占める語句 */
function focus(overrides: Partial<Focus> = {}): Focus {
  return { x: 0.5, y: 0.5, width: 0.3, aspect: 16 / 9, ...overrides };
}

/** カメラの当て先。gsap は要素でなくただのオブジェクトも動かせる（drift.test.ts と同じ手） */
function dummyCamera() {
  return { xPercent: 0, yPercent: 0, scale: 1, rotationZ: 0, rotationY: 0, z: 0 } as Record<
    string,
    unknown
  >;
}

describe('framingFor', () => {
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
    expect(framingFor(focus({ width: 0.95 }), 0).scale).toBe(1);
    expect(framingFor(focus({ width: 0.01 }), 0).scale).toBeLessThanOrEqual(2.4);
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
});
