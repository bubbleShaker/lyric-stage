import { describe, expect, it } from 'vitest';
import { parseLyricSheet } from './domain/lyrics';
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
});
