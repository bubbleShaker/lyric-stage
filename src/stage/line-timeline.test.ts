import gsap from 'gsap';
import { describe, expect, it, vi } from 'vitest';
import type { LyricLine } from '../domain/lyrics';
import { buildLineTimeline, type PartTarget } from './line-timeline';

/**
 * 当て先のダミー。gsap は要素でなくただのオブジェクトもトゥイーンできるので、
 * ブラウザ無しで「いつ・何に当たるか」を確かめられる。
 *
 * frame に当たる autoAlpha は数値としてそのまま乗るため、
 * 「出番の前は隠れている」がここで読める（本物では visibility + opacity になる）。
 */
function dummyTarget(
  count: number,
): PartTarget & {
  readonly decorClasses: string[];
  readonly subTexts: string[];
  readonly sparkNames: string[];
  /** 図形・英字・一過性の装飾に渡した当て先そのもの。gsap が書いた値を後から読むために控える */
  readonly extras: Record<string, unknown>[];
} {
  // 図形を頼まれた回数と名前を控える。本物では枠の中に要素が立つ（M8-3a）
  const decorClasses: string[] = [];
  // 英字も同じ（M8-3c）。こちらは名前ではなく中身そのものが渡る
  const subTexts: string[] = [];
  // 一過性の装飾（M10-1）。こちらは登録そのものが渡るので、クラス名で控える
  const sparkNames: string[] = [];
  const extras: Record<string, unknown>[] = [];

  const extra = () => {
    const element: Record<string, unknown> = {};
    extras.push(element);
    return element as unknown as HTMLElement;
  };

  return {
    frame: {} as HTMLElement,
    root: {} as HTMLElement,
    chars: Array.from({ length: count }, () => ({}) as unknown as Element),
    decorClasses,
    subTexts,
    sparkNames,
    extras,
    createDecor: (className) => {
      decorClasses.push(className);
      return extra();
    },
    createSub: (text) => {
      subTexts.push(text);
      return extra();
    },
    createSpark: (spark) => {
      sparkNames.push(spark.className);
      // 破片は本物と同じ数だけ立てる。数が違うと、破片ごとに違う値を書く演出
      // （burst の放射）の検査が「たまたま通る」ようになる
      return { box: extra(), pieces: Array.from({ length: spark.pieces }, () => extra()) };
    },
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

/** ダミーの当て先。図形の控えを読めるよう、PartTarget より広い型で持つ */
type DummyTarget = ReturnType<typeof dummyTarget>;

function build(line: LyricLine) {
  const targets: DummyTarget[] = [];
  const timeline = buildLineTimeline(line, (part) => {
    const target = dummyTarget(part.text.length);
    targets.push(target);
    return target;
  });
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

  it('止まった状態で返る（進めるのは外から与える時計だけ）', () => {
    // 組み立てる側で pause() を呼ぶ約束にすると、その 1 行が消えた時に
    // 全テストが緑のまま「音を止めても語句が出続ける」が戻ってくる
    const { timeline } = build(line);

    expect(timeline.paused()).toBe(true);
    timeline.kill();
  });

  it('出番の来ていない語句は見えない', () => {
    // **これが M8-5 の要**。語句は行の頭でまとめて組み立てるので、隠さないと
    // at=1 の語句が最初から素の姿で置かれる。演出が opacity 0 から始まることに
    // 頼ると、そうでない演出を足した日に静かに破れる
    const { targets, timeline } = build(line);

    // 組み立て直後（＝時刻 0）。時刻 0 の語句だけが見えている
    expect(alphaOf(targets)).toEqual([1, 0]);

    timeline.time(0.5);
    expect(alphaOf(targets)).toEqual([1, 0]);

    timeline.time(1.01);
    expect(alphaOf(targets)).toEqual([1, 1]);

    timeline.kill();
  });

  it('行の頭より後ろから始まる語句は、時刻 0 でも見えない', () => {
    const { targets, timeline } = build({
      time: 0,
      text: 'A',
      parts: [{ text: 'A', at: 0.5 }],
    });

    expect(alphaOf(targets)).toEqual([0]);
    timeline.kill();
  });

  it('戻せば後の語句はまた隠れる（シークで巻き戻した時）', () => {
    const { targets, timeline } = build(line);

    timeline.time(1.01);
    timeline.time(0);

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
    // 行の effect に畳まれていないこと。同じ位置・同じ文字数で演出だけを変え、
    // 行の長さが**後の語句に当てた演出の長さで決まる**ことを見る
    const withGlitch = build({
      time: 0,
      text: 'AB',
      parts: [
        { text: 'A', at: 0, effect: 'calm' },
        { text: 'B', at: 0.5, effect: 'glitch' },
      ],
    });
    const allCalm = build({
      time: 0,
      text: 'AB',
      parts: [
        { text: 'A', at: 0, effect: 'calm' },
        { text: 'B', at: 0.5, effect: 'calm' },
      ],
    });

    expect(withGlitch.timeline.duration()).not.toBeCloseTo(allCalm.timeline.duration());

    withGlitch.timeline.kill();
    allCalm.timeline.kill();
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

  it('動きを減らす設定が図形と英字にも届く', () => {
    // `resolveDecor` / `buildSubText` へ渡す `{ reducedMotion }` を落としても、上の
    // 「静かな演出に落ちる」は演出のプロパティしか見ていないので**緑のまま**になる
    // （レビュー指摘 🟡）。畳んだ姿は「時刻 0 で既に出来上がっている」ことで分かる
    const targets: DummyTarget[] = [];
    const timeline = buildLineTimeline(
      { time: 0, text: 'A', decor: ['band'], sub: 'MAGIC' },
      (part) => {
        const target = dummyTarget(part.text.length);
        targets.push(target);
        return target;
      },
      { reducedMotion: true },
    );

    // 「時刻 0 の姿」を見ていることを明示する（再レビュー指摘 🟡）。組み立て直後の値は
    // gsap が生成時に書いたものなので、往復させておく方が意図が読める
    timeline.time(0.0001).time(0);

    const values = targets[0].extras.flatMap((element) =>
      ['--decor-grow', '--sub-reveal']
        .filter((property) => Object.hasOwn(element, property))
        .map((property) => Number(element[property])),
    );

    // 図形と英字で 2 つ。どちらも伸びる過程を飛ばして終わりの姿になっている
    expect(values).toStrictEqual([1, 1]);
    timeline.kill();
  });
});

describe('語句に貼り付く図形（M8-3a）', () => {
  it('書いた図形の数だけ当て先を頼む', () => {
    const { targets, timeline } = build({
      time: 0,
      text: 'AB',
      parts: [
        { text: 'A', at: 0, decor: ['band', 'rule'] },
        { text: 'B', at: 1 },
      ],
    });

    expect(targets.map((target) => target.decorClasses)).toEqual([
      ['stage__decor--band', 'stage__decor--rule'],
      [],
    ]);
    timeline.kill();
  });

  it('知らない図形名の当て先は作らない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { targets, timeline } = build({ time: 0, text: 'A', decor: ['bnad'] });

    expect(targets[0].decorClasses).toEqual([]);
    // 回数ではなく中身を見る。ダミーの当て先には CSSPlugin が効かないので、
    // gsap 自身も「Invalid property autoAlpha」と警告する（この環境だけの雑音）
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('bnad'));

    timeline.kill();
    warn.mockRestore();
  });

  it('図形は語句と同じ時刻から始まる', () => {
    // 前倒しにしない（M8-3a）。図形だけ先に引く画も作れるが、それは語句の at を
    // 早めれば書ける。ここでずらすと、シートに書いた時刻と画に出る時刻が食い違い、
    // 耳で刻みを詰める作業（Issue #37）が狂う
    const { timeline } = build({
      time: 0,
      text: 'AB',
      parts: [
        { text: 'A', at: 0 },
        { text: 'B', at: 1.5, decor: ['band'] },
      ],
    });

    // startTime() は「親から見た位置」なので、根の直下の子を見る
    // （図形の組み立ては 1 本のタイムラインとして丸ごと差し込まれる）
    const starts = timeline
      .getChildren(false)
      .filter((child): child is gsap.core.Timeline => child instanceof gsap.core.Timeline)
      .filter((child) => child.getChildren(true).some((t) => Object.hasOwn(t.vars, '--decor-grow')))
      .map((child) => child.startTime());

    expect(starts).toHaveLength(1);
    expect(starts[0]).toBeCloseTo(1.5);
    timeline.kill();
  });

  it('行に書いた図形は、刻んだ語句には出ない', () => {
    // partsOf が継がせないことの、組み立て側から見た姿（domain/lyrics.test.ts と対）。
    // **この形の入力はパーサが入口で弾く**ので、ここが見ているのは
    // 「手で組んだ行でも継がない」という domain の不変条件の方
    const { targets, timeline } = build({
      time: 0,
      text: 'AB',
      decor: ['band'],
      parts: [
        { text: 'A', at: 0 },
        { text: 'B', at: 1 },
      ],
    });

    expect(targets.map((target) => target.decorClasses)).toEqual([[], []]);
    timeline.kill();
  });
});

describe('語句に添える英字（M8-3c）', () => {
  it('書いた語句にだけ当て先を頼み、中身をそのまま渡す', () => {
    const { targets, timeline } = build({
      time: 0,
      text: 'AB',
      parts: [
        { text: 'A', at: 0, sub: 'LIKE MAGIC' },
        { text: 'B', at: 1 },
      ],
    });

    expect(targets.map((target) => target.subTexts)).toEqual([['LIKE MAGIC'], []]);
    timeline.kill();
  });

  it('英字は語句と同じ時刻から始まる', () => {
    // 図形と同じ（M8-3a の理由をそのまま踏襲）。語句・図形・英字が同時に動き出す
    const { timeline } = build({
      time: 0,
      text: 'AB',
      parts: [
        { text: 'A', at: 0 },
        { text: 'B', at: 1.5, sub: 'INFINITE' },
      ],
    });

    const starts = timeline
      .getChildren(false)
      .filter((child): child is gsap.core.Timeline => child instanceof gsap.core.Timeline)
      .filter((child) => child.getChildren(true).some((t) => Object.hasOwn(t.vars, '--sub-reveal')))
      .map((child) => child.startTime());

    expect(starts).toHaveLength(1);
    expect(starts[0]).toBeCloseTo(1.5);
    timeline.kill();
  });

  it('行に書いた英字は、刻んだ語句には出ない', () => {
    // 図形と同じ扱い（M8-3c）。この形の入力はパーサが入口で弾くので、ここが見ているのは
    // 「手で組んだ行でも継がない」という domain の不変条件の方
    const { targets, timeline } = build({
      time: 0,
      text: 'AB',
      sub: 'MAGIC',
      parts: [
        { text: 'A', at: 0 },
        { text: 'B', at: 1 },
      ],
    });

    expect(targets.map((target) => target.subTexts)).toEqual([[], []]);
    timeline.kill();
  });
});

describe('語句に一瞬だけ添える装飾（M10-1）', () => {
  it('書いた語句にだけ当て先を頼む', () => {
    const { targets, timeline } = build({
      time: 0,
      text: 'AB',
      parts: [
        { text: 'A', at: 0, spark: 'burst' },
        { text: 'B', at: 1 },
      ],
    });

    expect(targets.map((target) => target.sparkNames)).toEqual([['stage__spark--burst'], []]);
    timeline.kill();
  });

  it('知らない装飾名の当て先は作らない', () => {
    // 図形と同じ（未知の名前は既定に落ちず完全に消える）。当て先まで作ってしまうと、
    // **中身の無い箱が語句の上に残る**
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { targets, timeline } = build({ time: 0, text: 'A', spark: 'brust' });

    expect(targets[0].sparkNames).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('brust'));

    timeline.kill();
    warn.mockRestore();
  });

  it('装飾は語句と同じ時刻から始まる', () => {
    // 図形・英字と同じ（M8-3a の理由をそのまま踏襲）。**一過性の装飾では特に効く** —
    // 1 秒未満で終わるので、前倒しにすると語句が出る頃には消えている
    const { timeline } = build({
      time: 0,
      text: 'AB',
      parts: [
        { text: 'A', at: 0 },
        { text: 'B', at: 1.5, spark: 'underline' },
      ],
    });

    const starts = timeline
      .getChildren(false)
      .filter((child): child is gsap.core.Timeline => child instanceof gsap.core.Timeline)
      .filter((child) => child.getChildren(true).some((t) => Object.hasOwn(t.vars, '--spark-head')))
      .map((child) => child.startTime());

    expect(starts).toHaveLength(1);
    expect(starts[0]).toBeCloseTo(1.5);
    timeline.kill();
  });

  it('行に書いた装飾は、刻んだ語句には出ない', () => {
    // 図形・英字と同じ扱い。この形の入力はパーサが入口で弾くので、ここが見ているのは
    // 「手で組んだ行でも継がない」という domain の不変条件の方
    const { targets, timeline } = build({
      time: 0,
      text: 'AB',
      spark: 'burst',
      parts: [
        { text: 'A', at: 0 },
        { text: 'B', at: 1 },
      ],
    });

    expect(targets.map((target) => target.sparkNames)).toEqual([[], []]);
    timeline.kill();
  });

  it('動きを減らす設定では当て先ごと作らない', () => {
    // **図形・英字とは逆**（あちらは形を残して動きだけ畳む）。出さないと決めた以上、
    // 箱も破片も生えないのが正しい — 生えると、透明な要素が語句の上に積まれる
    const targets: DummyTarget[] = [];
    const timeline = buildLineTimeline(
      { time: 0, text: 'A', spark: 'burst' },
      (part) => {
        const target = dummyTarget(part.text.length);
        targets.push(target);
        return target;
      },
      { reducedMotion: true },
    );

    expect(targets[0].sparkNames).toEqual([]);
    timeline.kill();
  });
});
