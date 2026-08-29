import { describe, expect, it } from 'vitest';
import { buildExit, EXIT_DURATION } from './exit';

/**
 * 漂う層の当て先。gsap は要素でなくただのオブジェクトも動かせる（drift.test.ts と同じ手）。
 *
 * **動かす項目を先に持たせる。** 素のオブジェクトでは「値が無い ＝ 0 から始まる」と
 * 解釈されるので、`opacity` を欠くと退場が 0 → 0 の変化になり、**消えているのか
 * 消しているのか区別が付かない**まま緑になる。
 */
function dummyDrift() {
  return { z: 0, rotationX: 0, opacity: 1, filter: 'none' } as Record<string, unknown>;
}

/** 組み立てたタイムラインを time 秒まで進めて、当て先の値を読む */
function stateAt(time: number, reducedMotion = false) {
  const target = dummyDrift();
  const timeline = buildExit(target, { reducedMotion }).pause();
  // **一度だけ余計に動かしてから目的の時刻へ**（gsap は playhead が動いていない
  // タイムラインを描き直さない。decor.test.ts と同じ理由）
  timeline.time(time + 0.0001).time(time);
  timeline.kill();

  return target;
}

describe('buildExit', () => {
  it('引き切るまでの長さで終わる', () => {
    // **これが伸びると次の語句と重なる時間が増えて「1 語句ずつ」が崩れる**。
    // 行の最後の語句は、この長さを行の終わりから逆算して置かれる（line-timeline.ts）
    const timeline = buildExit(dummyDrift());

    expect(timeline.duration()).toBeCloseTo(EXIT_DURATION);
    timeline.kill();
  });

  it('始まりでは素の見えのまま', () => {
    // 引き始めた瞬間に飛ぶと、受け渡しではなく差し替えに見える
    const start = stateAt(0);

    expect(Number(start.opacity)).toBeCloseTo(1);
    expect(Number(start.z)).toBeCloseTo(0);
  });

  it('奥へ引きながら消える', () => {
    const middle = stateAt(EXIT_DURATION / 2);

    expect(Number(middle.opacity)).toBeLessThan(1);
    expect(Number(middle.opacity)).toBeGreaterThan(0);
    // 奥（負の z）へ。手前に出ると「迫ってきて消えた」になり、登場と紛れる
    expect(Number(middle.z)).toBeLessThan(0);
  });

  it('引き切ると見えなくなる', () => {
    // **残ると次の行の語句に重なる。** 行が変わる時に要素ごと捨てられるので画には
    // 出ないが、行の中で次の語句へ渡す時はそうではない
    expect(Number(stateAt(EXIT_DURATION).opacity)).toBeCloseTo(0);
  });

  it('ぼかしは始点と終点の両方を書く', () => {
    // 素の見えは `filter: none` で、`none → blur(8px)` は補間できない
    // （effects.ts の rushIn と同じ理由）。`.from()` では書けない
    expect(String(stateAt(0).filter)).toContain('blur(0');
    expect(String(stateAt(EXIT_DURATION).filter)).toContain('blur(');
  });

  it('動きを減らす設定でも消えるが、位置は動かさない', () => {
    // **止めてはいけない。** 漂い（buildDrift）は丸ごと止めるが、退場を止めると
    // 語句が積み上がったまま行が終わる ＝ 画の作りそのものが変わる。
    // 前庭系の症状を誘発するのは位置と大きさの変化なので、不透明度だけで消す
    const middle = stateAt(EXIT_DURATION / 2, true);

    expect(Number(middle.opacity)).toBeLessThan(1);
    expect(Number(middle.z)).toBe(0);
    expect(String(middle.filter)).toBe('none');

    expect(Number(stateAt(EXIT_DURATION, true).opacity)).toBeCloseTo(0);
  });
});
