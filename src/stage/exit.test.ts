import { describe, expect, it } from 'vitest';
import { buildExit, BLUR, EXIT_DURATION, exitStartFor, MIN_STAY } from './exit';

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
  // **`kill()` は書かれた値を残す**（`revert()` は戻してしまう）。読むのはこの後
  timeline.kill();

  return target;
}

describe('buildExit', () => {
  // **両方の枝で同じ尺**（レビュー指摘 🟡）。行の最後の語句はこの長さを行の終わりから
  // 逆算して置かれる（exitStartFor）ので、片方だけ変えると消え終わりが行の外へずれる。
  // 伸ばせば次の語句と重なる時間が増えて「1 語句ずつ」も崩れる
  it.each([false, true])('引き切るまでの長さで終わる（動きを減らす設定: %s）', (reducedMotion) => {
    const timeline = buildExit(dummyDrift(), { reducedMotion });

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
    // **終点は名指しで見る**（レビュー指摘 🟡）。`blur(` が入っているかだけだと
    // `blur(0px)` でも通る ＝ ぼかしが一切動かなくても緑になる
    expect(String(stateAt(EXIT_DURATION).filter)).toContain(`blur(${BLUR}`);
  });

  it('組み立てただけでは何も書かない', () => {
    // **gsap の `fromTo` は既定で始点を即座に書く**（レビュー指摘 🔴）。ここでは
    // `filter: blur(0px)` が語句の出ている全区間に当たることになり、`none` 以外の
    // `filter` は要素を平面に潰すので、`.stage__drift` の `preserve-3d` が効かなくなる
    // （＝ rushIn の文字ごとの奥行きがただの平行移動になる）。素のオブジェクト相手では
    // 画に出ないので、**ここで見張るしかない**
    const target = dummyDrift();
    buildExit(target).pause();

    expect(target.filter).toBe('none');
    expect(target.opacity).toBe(1);
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

describe('exitStartFor', () => {
  it('次の語句があれば、その語句が出る時刻から引く', () => {
    // 重ねるのは穴を空けないため。前の語句が消えてから次が出るまでに何も映って
    // いない時間ができると、のっぺり以上に悪い
    expect(exitStartFor(0.6, 2, 5)).toBe(2);
  });

  it('行の最後の語句は、行が終わるちょうどに消え終わる', () => {
    expect(exitStartFor(0.6, undefined, 5)).toBeCloseTo(5 - EXIT_DURATION);
  });

  it('出揃ってすぐには引き始めない', () => {
    // **境界を跨いだ瞬間に引き始めるのでは、この分岐の目的を果たさない**
    // （レビュー指摘 🔴）。本編の `ネーション` は逆算した引き始めとの差が
    // 0.001 秒しかなく、「一瞬映って消えた」になっていた
    const span = 3;
    const justEnough = span - EXIT_DURATION - MIN_STAY;

    expect(exitStartFor(justEnough, undefined, span)).not.toBeNull();
    expect(exitStartFor(justEnough + 0.01, undefined, span)).toBeNull();
  });

  it('行の長さが無限なら引かない', () => {
    // `lineSpanAt` は duration を持たない最終行に Infinity を返す（M13-1）。
    // そのまま逆算すると Infinity の位置に退場を置くことになり、**行のタイムラインの
    // 尺ごと無限になる**（レビュー指摘 🔴）。buildDrift が同じ値を弾いているのと同じ理由
    expect(exitStartFor(0.6, undefined, Infinity)).toBeNull();
  });
});
