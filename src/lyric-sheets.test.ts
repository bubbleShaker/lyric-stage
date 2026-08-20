import { describe, expect, it } from 'vitest';
import { parseLyricSheet, type LyricLine } from './domain/lyrics';
import { effects, isEffectName, resolveEffect } from './stage/effects';
import { DEFAULT_SHEET_NAME } from './work';
// Vite の ?raw は対象ファイルを文字列として読み込む。fs を使わずに済むので
// Node の型定義をアプリ側の tsconfig に持ち込まなくてよい。
import sampleJson from '../public/lyrics/sample.json?raw';
import shiningStarJson from '../public/lyrics/shining-star.json?raw';

/**
 * 公開する歌詞シートそのものを検証する。app 層のユニットテストではなく、
 * public/ に置いた成果物の中身を確かめるものなので src/ の直下に置いている。
 *
 * JSON は手で書き換えることも生成し直すこともあるので、壊れていたら
 * ブラウザで開く前に気付けるようにしておく。parser は本番と同じものを使う。
 */
const SHEET_SOURCES: Record<string, string> = {
  'shining-star': shiningStarJson,
  sample: sampleJson,
};

/** mp3 の実測の長さ（276.56 秒）。音源を差し替えたらここも更新する */
const AUDIO_DURATION_SECONDS = 276.5;

it('既定の歌詞シートが実在する', () => {
  // 名前だけ変えて JSON を置き忘れると、本番だけ 404 になって気付けない
  expect(Object.keys(SHEET_SOURCES)).toContain(DEFAULT_SHEET_NAME);
});

describe.each(Object.entries(SHEET_SOURCES))('%s.json', (_name, source) => {
  it('本番の parser で読める', () => {
    expect(() => parseLyricSheet(JSON.parse(source))).not.toThrow();
  });

  const sheet = parseLyricSheet(JSON.parse(source));

  it('title と行がある', () => {
    expect(sheet.title).not.toBe('');
    expect(sheet.lines.length).toBeGreaterThan(0);
  });

  it('time が昇順で重複していない', () => {
    // parseLyricSheet は整列してから返すので、並びは JSON の生の順で確かめる
    const times = (JSON.parse(source).lines as { time: number }[]).map((line) => line.time);
    expect(times).toStrictEqual([...new Set(times)].sort((a, b) => a - b));
  });

  it('空の行が無い', () => {
    expect(sheet.lines.every((line) => line.text.trim() !== '')).toBe(true);
  });
});

describe(`${DEFAULT_SHEET_NAME}.json`, () => {
  const sheet = parseLyricSheet(JSON.parse(SHEET_SOURCES[DEFAULT_SHEET_NAME]));

  it('曲の長さに収まっている', () => {
    const last = sheet.lines[sheet.lines.length - 1];
    expect(last.time).toBeLessThan(AUDIO_DURATION_SECONDS);
  });

  it('歌い出しより前には何も置かれていない', () => {
    expect(sheet.lines[0].time).toBeGreaterThan(10);
  });

  it('知らない演出名が書かれていない', () => {
    // 未知の名前でも既定の演出に落ちて動いてしまうので、綴りの間違いは
    // 画面を見ても気付けない。ここで名指しして落とす。
    // （sample.json は「未知の名前は fade に落ちる」ことを見せる行を意図的に持つので対象外）
    const unknown = sheet.lines
      .map((line) => line.effect)
      .filter((name): name is string => name !== undefined && !isEffectName(name));

    expect(unknown).toStrictEqual([]);
  });

  it('全ての行に演出が書かれている', () => {
    // 本編シートは全行に effect を明示する規約にしている。省略しても既定の fade で
    // 動いてしまうので、「意図して fade を選んだ行」と「割り当てを忘れた行」が
    // 画面を見ても区別できない。ここで書き忘れを名指しして落とす。
    const missing = sheet.lines.filter((line) => line.effect === undefined).map((line) => line.text);

    expect(missing).toStrictEqual([]);
  });

  it('同じ歌詞の行には同じ演出が当たっている', () => {
    // 1 番・2 番・ラスサビの対応する行を同じ演出で揃える、という割り当ての方針
    // （M4-3 で決めた）。繰り返しを「型」として見せることで曲の構成が画で分かる。
    // 方針を変えるときは、この検査ごと書き換える。
    const byText = new Map<string, Set<string | undefined>>();
    for (const line of sheet.lines) {
      const seen = byText.get(line.text) ?? new Set();
      seen.add(line.effect);
      byText.set(line.text, seen);
    }

    const inconsistent = [...byText]
      .filter(([, seen]) => seen.size > 1)
      .map(([text, seen]) => `${text}: ${[...seen].map((e) => e ?? '(未指定)').join(' / ')}`);

    expect(inconsistent).toStrictEqual([]);
  });

  it('最後の行が消える時刻を持っている', () => {
    // 最後の行だけは「次の行の time」が無いので、duration を書かないと曲の終わりまで
    // 出しっぱなしになる（アウトロの約 41 秒）。下の「次の行が来る前に出揃う」も
    // 最終行だけは猶予を Infinity として扱うので、ここで別に見る。
    const last = sheet.lines[sheet.lines.length - 1];

    expect(last.duration).toBeDefined();
  });

  it('縦書きの行にラテン文字が含まれていない', () => {
    // writing-mode: vertical-rl は text-orientation を指定しないとラテン文字を
    // 横倒しにする（日本語縦組みの慣例どおり）。本編には
    // "I'll believe of my sensation" のような行があるので、CSS で場合分けするより
    // 縦書きを日本語の行にだけ当てる方針にした（M4-3 で決めた）。
    //
    // 演出名ではなく layout で判定する。守りたいのは「縦組みになる行」であって
    // 「vertical という名前の行」ではないので、縦書き系の演出が増えても追従する。
    // 数字も同じ理由で横倒しになるので併せて見る。
    const latin = sheet.lines
      .filter((line) => resolveEffect(line.effect).layout === 'vertical')
      .filter((line) => /[\p{Script=Latin}\p{Nd}]/u.test(line.text))
      .map((line) => line.text);

    expect(latin).toStrictEqual([]);
  });

  it('縦書きは行が長く留まる所にだけ当たっている', () => {
    // 縦組みは画が大きく変わるぶん場面転換として効くが、行が数秒ごとに入れ替わる
    // 区間で使うと組み方が毎行変わって落ち着かない。そこで「6 秒前後の伸ばしの行に
    // だけ当てる」と決めた（M4-3）。文章で書くだけだと、M6 で time を詰め直した時に
    // 縦書きの行が短い区間へ静かに紛れ込むので検査にしておく。
    const hasty = sheet.lines
      .map((line, index) => ({ line, gap: gapAfter(sheet.lines, index) }))
      .filter(({ line }) => resolveEffect(line.effect).layout === 'vertical')
      .filter(({ gap }) => gap < 5)
      .map(({ line, gap }) => `${line.text}: ${gap.toFixed(2)} 秒`);

    expect(hasty).toStrictEqual([]);
  });

  it('各行の演出がその行の猶予に収まる', () => {
    // 割り当てが確定したので、実際の組み合わせ（その行に当てた演出 × その行の文字数
    // × その行の猶予）で測る。下の「どの演出も」はレジストリ全体の安全網で、
    // 実在しない最悪の組み合わせを見ているぶんこちらより厳しい。
    const overrun = sheet.lines
      .map((line, index) => {
        const timeline = resolveEffect(line.effect).build({
          root: {} as HTMLElement,
          chars: dummyChars(line.text.length),
        });
        const duration = timeline.duration();
        timeline.kill();
        return { line, duration, gap: gapAfter(sheet.lines, index) };
      })
      .filter(({ duration, gap }) => duration >= gap)
      .map(({ line, duration, gap }) => `${line.text}: ${duration} 秒 / 猶予 ${gap} 秒`);

    expect(overrun).toStrictEqual([]);
  });

  it('どの演出も次の行が来る前に出揃う', () => {
    // 演出の所要時間は文字数で決まり、猶予は行間隔で決まる。どちらも実データ側で
    // 変わりうる（M6 のタイミング入力ツールで time を詰めたときなど）ので、
    // 定数を書かずにシートから測る。
    //
    // こちらは「最長の行 × 最短の猶予」という実在しない組み合わせで全演出を測る
    // 安全網。まだ割り当てていない演出も含めて、どこに振っても破綻しないことを見る。
    // 実際の組み合わせは上の「各行の演出がその行の猶予に収まる」が測っているので、
    // 伸ばしの行専用のゆっくりした演出を足したくなったら、この検査の方を緩める。
    const worst = worstCase(sheet.lines);

    for (const name of Object.keys(effects)) {
      // レジストリには関数と { layout, build } の 2 通りが書けるので resolveEffect で揃える
      const timeline = resolveEffect(name).build({
        root: {} as HTMLElement,
        chars: dummyChars(worst.longestText),
      });
      expect(timeline.duration(), `${name} が ${worst.shortestGap} 秒に収まらない`).toBeLessThan(
        worst.shortestGap,
      );
      timeline.kill();
    }
  });
});

/** その行が画面に出ていられる秒数。次の行が来るか duration が切れるかの早い方 */
function gapAfter(lines: readonly LyricLine[], index: number): number {
  const untilNext = index + 1 < lines.length ? lines[index + 1].time - lines[index].time : Infinity;
  // duration が指定されていれば、次の行を待たずにその行は消える
  return Math.min(untilNext, lines[index].duration ?? Infinity);
}

/** 演出にとって最も条件が厳しい組み合わせ（最長の行と最短の猶予）を測る */
function worstCase(lines: readonly LyricLine[]) {
  const gaps = lines.map((_line, index) => gapAfter(lines, index));

  return {
    shortestGap: Math.min(...gaps),
    longestText: Math.max(...lines.map((line) => line.text.length)),
  };
}

/** 演出の長さを測るだけなので、文字要素の代わりにダミーを渡せば足りる */
function dummyChars(count: number): Element[] {
  return Array.from({ length: count }, () => ({}) as unknown as Element);
}
