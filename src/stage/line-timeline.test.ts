import { describe, expect, it } from 'vitest';
import type { LyricLine } from '../domain/lyrics';
import { buildLineTimeline, type PartTarget } from './line-timeline';

/**
 * 当て先のダミー。gsap は要素でなくただのオブジェクトもトゥイーンできるので、
 * ブラウザ無しで「いつ・何に当たるか」を確かめられる。
 *
 * frame に当たる autoAlpha は数値としてそのまま乗るため、
 * 「出番の前は隠れている」がここで読める（本物では visibility + opacity になる）。
 */
function dummyTarget(count: number): PartTarget {
  return {
    frame: {} as HTMLElement,
    root: {} as HTMLElement,
    chars: Array.from({ length: count }, () => ({}) as unknown as Element),
  };
}

/**
 * 語句の枠の autoAlpha を読む。1 なら見えている。
 *
 * Number() を通すのは、gsap が巻き戻しで書き戻す値が文字列の '0' になるため
 * （本物の要素なら CSS の値として同じ意味になる）。
 */
function alphaOf(targets: PartTarget[]): number[] {
  return targets.map((target) => Number((target.frame as unknown as { autoAlpha: number }).autoAlpha));
}

function build(line: LyricLine) {
  const targets: PartTarget[] = [];
  const timeline = buildLineTimeline(line, (part) => {
    const target = dummyTarget(part.text.length);
    targets.push(target);
    return target;
  });
  // 時計は外（音の再生位置）から与える。gsap 自身の時計では進めない
  timeline.pause();
  return { timeline, targets };
}

const line: LyricLine = {
  time: 0,
  text: 'AB',
  parts: [
    { text: 'A', at: 0 },
    { text: 'B', at: 1 },
  ],
};

describe('buildLineTimeline', () => {
  it('語句の数だけ当て先を作る', () => {
    const { targets, timeline } = build(line);

    expect(targets).toHaveLength(2);
    timeline.kill();
  });

  it('刻んでいない行でも 1 語句として組み立てる', () => {
    const { targets, timeline } = build({ time: 0, text: 'A' });

    expect(targets).toHaveLength(1);
    expect(timeline.duration()).toBeGreaterThan(0);
    timeline.kill();
  });

  it('組み立てた時点ではどの語句も見えていない', () => {
    // **これが M8-5 の要**。語句は行の頭でまとめて組み立てるので、隠さないと
    // at=1 の語句が最初から素の姿で置かれる。演出が opacity 0 から始まることに
    // 頼ると、そうでない演出を足した日に静かに破れる
    const { targets, timeline } = build(line);

    expect(alphaOf(targets)).toEqual([0, 0]);
    timeline.kill();
  });

  it('出番が来た語句だけが見える', () => {
    const { targets, timeline } = build(line);

    // 0 ちょうどではなく少し進めて見る。gsap は playhead が動いていない
    // タイムラインを描き直さないので、time(0) では組み立て直後と区別が付かない
    timeline.time(0.01);
    expect(alphaOf(targets)).toEqual([1, 0]);

    timeline.time(1.01);
    expect(alphaOf(targets)).toEqual([1, 1]);

    timeline.kill();
  });

  it('戻せば後の語句はまた隠れる（シークで巻き戻した時）', () => {
    const { targets, timeline } = build(line);

    timeline.time(1.01);
    timeline.time(0.01);

    expect(alphaOf(targets)).toEqual([1, 0]);
    timeline.kill();
  });

  it('行の長さは「最後の語句が出る時刻 + その演出の長さ」になる', () => {
    // 刻みすぎ（行の猶予をはみ出す）を、シートの検査が本番と同じ組み立てで
    // 測れるようにするための性質。src/lyric-sheets.test.ts が使う
    const single = build({ time: 0, text: 'A' });
    const spread = build({
      time: 0,
      text: 'AA',
      parts: [
        { text: 'A', at: 0 },
        { text: 'A', at: 2 },
      ],
    });

    expect(spread.timeline.duration()).toBeCloseTo(single.timeline.duration() + 2);

    single.timeline.kill();
    spread.timeline.kill();
  });

  it('語句ごとに違う演出を当てられる', () => {
    // 行の effect に畳まれていないこと。zoomLine は行の要素だけを動かすので、
    // 文字を当てにする演出と混ざっていれば子の数で分かる
    const { timeline } = build({
      time: 0,
      text: 'AB',
      parts: [
        { text: 'A', at: 0, effect: 'calm' },
        { text: 'B', at: 0.5, effect: 'glitch' },
      ],
    });

    // 語句 2 つぶんの「隠す set」と演出の timeline
    expect(timeline.getChildren(false).length).toBe(4);
    timeline.kill();
  });

  it('動きを減らす設定では静かな演出に落ちる', () => {
    const targets: PartTarget[] = [];
    const timeline = buildLineTimeline(
      { time: 0, text: 'A', effect: 'shatter' },
      (part) => {
        const target = dummyTarget(part.text.length);
        targets.push(target);
        return target;
      },
      { reducedMotion: true },
    );

    const used = timeline
      .getChildren(true)
      .flatMap((child) => Object.keys(child.vars))
      .filter((prop) => ['xPercent', 'yPercent', 'rotation', 'scale', 'z'].includes(prop));

    expect(used).toStrictEqual([]);
    timeline.kill();
  });
});
