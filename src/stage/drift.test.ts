import { describe, expect, it } from 'vitest';
import { buildDrift, DRIFT_CLASS, MAX_AMPLITUDE_SEED, MIN_DRIFT_SPAN } from './drift';
import { classRule as rulesFor } from '../test-support/css-rules';

/**
 * 漂う層の当て先。gsap は要素でなくただのオブジェクトも動かせるので、
 * ブラウザ無しで「何がどこまで書かれるか」を読める（decor.test.ts と同じ手）。
 */
function dummyDrift() {
  // **動かす項目を 0 で先に持たせる。** 空のオブジェクトに z や rotationY を書かせると、
  // gsap が「知らない項目 ＝ プラグイン不足では」と警告を出す（本物の要素なら
  // CSSPlugin が受け持つ項目なので、素のオブジェクトでは持ち主が居ない）。
  // 実際の要素も 0 から始まるので、こちらの方が本番に近い
  return { z: 0, rotationY: 0, rotationX: 0, yPercent: 0, opacity: 1 };
}

/** 片道 1 回ぶんの長さ（＝中のトゥイーンの尺）。往復の回数は尺との割り算で決まる */
function legOf(timeline: ReturnType<typeof buildDrift>): number {
  return timeline.getChildren()[0].duration();
}

/** 折り返し先の奥行き（＝漂いの深さ）。時刻に依らないので、周期の違いに邪魔されない */
function depthTargetOf(seed: number): number {
  const timeline = buildDrift(dummyDrift(), { span: 6, seed });
  const depth = Number(timeline.getChildren()[0].vars.z);
  timeline.kill();

  return depth;
}

/** 組み立てたタイムラインを time 秒まで進めて、当て先に書かれた奥行きを読む */
function depthAt(span: number, time: number, seed = 0): number {
  const target = dummyDrift();
  const timeline = buildDrift(target, { span, seed }).pause();
  // **一度だけ余計に動かしてから目的の時刻へ。** gsap は playhead が動いていない
  // タイムラインを描き直さない（decor.test.ts と同じ理由）
  timeline.time(time + 0.0001).time(time);
  const value = Number(target.z ?? 0);
  timeline.kill();

  return value;
}

describe('buildDrift', () => {
  it('滞在の長さちょうどで終わる', () => {
    // **これが崩れると、この後ろに積むもの（退場）と時間が重なる。** 同じ層の
    // 同じプロパティを 2 本のトゥイーンが奪い合うと、毎フレーム値が飛ぶ
    const timeline = buildDrift(dummyDrift(), { span: 4, seed: 0 });

    expect(timeline.duration()).toBeCloseTo(4);
    timeline.kill();
  });

  it('往復して元の位置に戻る', () => {
    // **滞在の終わりに元の位置へ戻っていること**が、この後ろに積むもの（退場・カメラ）の
    // 前提になる。片道の回数が奇数だと行ったきりで終わるので、偶数に丸めている
    for (const span of [2, 3, 4, 5, 6]) {
      expect(depthAt(span, 0)).toBeCloseTo(0);
      expect(depthAt(span, span)).toBeCloseTo(0);
    }

    // 途中では動いている（丸めた結果その場に留まる、では意味が無い）
    expect(depthAt(4, 1)).toBeGreaterThan(0);
  });

  it('語句ごとに周期が違う', () => {
    // 全部が同じ漂い方をすると 3 つが同時に同じ向きへ動き、「画面ごと揺れている」
    // ように見える。**揃う瞬間が来ない**ことがこの演出の要。
    //
    // **滞在は長めに取る**（レビュー指摘 🟡）。短い滞在では片道の回数が下限（2）に
    // 揃ってしまい、周期の違いを見ているつもりで深さの違いだけを見ることになる
    const first = buildDrift(dummyDrift(), { span: 6, seed: 0 });
    const second = buildDrift(dummyDrift(), { span: 6, seed: 1 });

    // 尺は同じ（どちらも滞在の長さ）でも、その中の片道の長さが違う
    expect(first.duration()).toBeCloseTo(second.duration());
    expect(legOf(first)).not.toBeCloseTo(legOf(second));

    first.kill();
    second.kill();
  });

  it('深さは語句が増えても頭打ちになる', () => {
    // **そのままだと語句を増やすほど際限なく深くなる**（レビュー指摘 🟡）。
    // 今のシートは 1 行 3 語句までなので顕在化しないが、4 つ目を書いた日に
    // z: 300 の語句が静かに生まれる。
    //
    // **折り返し先の値を直に読む。** ある時刻の z を比べる形にすると、周期が
    // 語句ごとに違うぶん「たまたま戻り切っていた」時刻を掴んで嘘の緑になる
    const deepest = depthTargetOf(MAX_AMPLITUDE_SEED);

    expect(depthTargetOf(0)).toBeLessThan(deepest);
    for (const seed of [MAX_AMPLITUDE_SEED + 1, MAX_AMPLITUDE_SEED + 3]) {
      expect(depthTargetOf(seed)).toBe(deepest);
    }
  });

  it('動きを減らす設定では何も動かさない', () => {
    // 漂いは遅いが**ずっと動き続ける**ので、前庭系の症状に対しては逃げ場が無い
    const target = dummyDrift();
    const timeline = buildDrift(target, { span: 5, seed: 0, reducedMotion: true });

    expect(timeline.duration()).toBe(0);
    expect(target.z).toBe(0);
    timeline.kill();
  });

  it('滞在が短すぎれば漂わせない', () => {
    const timeline = buildDrift(dummyDrift(), { span: MIN_DRIFT_SPAN - 0.01, seed: 0 });

    expect(timeline.duration()).toBe(0);
    timeline.kill();
  });

  it('滞在が無限でも NaN を作らない', () => {
    // `lineSpanAt` は duration を持たない最終行に対して Infinity を返す（M13-1）。
    // 通すと往復の回数も無限になり、1 回ぶんの長さが Infinity / Infinity ＝ NaN になる。
    // **NaN を渡された gsap は例外を投げず、そのトゥイーンだけが黙って何もしない**
    const target = dummyDrift();
    const timeline = buildDrift(target, { span: Infinity, seed: 0 });

    expect(timeline.duration()).toBe(0);
    expect(target.z).toBe(0);
    timeline.kill();
  });

  it('漂う層は中の 3D を平らに焼き込まない', () => {
    // これが無いと、漂いの z と演出の z が合成されず rushIn が平行移動になる。
    // **CSS 側にしか書けない指定**なので、値が消えても JS の検査では気付けない
    const rules = rulesFor(DRIFT_CLASS);

    expect(rules.some((body) => /transform-style:\s*preserve-3d/u.test(body))).toBe(true);
  });
});
