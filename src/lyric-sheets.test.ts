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

  it('どの演出も次の行が来る前に出揃う', () => {
    // 演出の所要時間は文字数で決まり、猶予は行間隔で決まる。どちらも実データ側で
    // 変わりうる（M6 のタイミング入力ツールで time を詰めたときなど）ので、
    // 定数を書かずにシートから測る。
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

/** 演出にとって最も条件が厳しい組み合わせ（最長の行と最短の猶予）を測る */
function worstCase(lines: readonly LyricLine[]) {
  const gaps = lines.map((line, index) => {
    const untilNext = index + 1 < lines.length ? lines[index + 1].time - line.time : Infinity;
    // duration が指定されていれば、次の行を待たずにその行は消える
    return Math.min(untilNext, line.duration ?? Infinity);
  });

  return {
    shortestGap: Math.min(...gaps),
    longestText: Math.max(...lines.map((line) => line.text.length)),
  };
}

/** 演出の長さを測るだけなので、文字要素の代わりにダミーを渡せば足りる */
function dummyChars(count: number): Element[] {
  return Array.from({ length: count }, () => ({}) as unknown as Element);
}
