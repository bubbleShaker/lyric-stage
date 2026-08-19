import { describe, expect, it } from 'vitest';
import { parseLyricSheet } from '../domain/lyrics';
import { DEFAULT_SHEET_NAME } from './load-lyric-sheet';
// Vite の ?raw は対象ファイルを文字列として読み込む。fs を使わずに済むので
// Node の型定義をアプリ側の tsconfig に持ち込まなくてよい。
import sampleJson from '../../public/lyrics/sample.json?raw';
import shiningStarJson from '../../public/lyrics/shining-star.json?raw';

/**
 * 公開する歌詞シートそのものを検証する。
 *
 * JSON は手で書き換えることも生成し直すこともあるので、壊れていたら
 * ブラウザで開く前に気付けるようにしておく。parseLyricSheet は本番と同じものを使う。
 */
const sheets = {
  [DEFAULT_SHEET_NAME]: parseLyricSheet(JSON.parse(shiningStarJson)),
  sample: parseLyricSheet(JSON.parse(sampleJson)),
};

/** mp3 の長さ。これを超える time があったら曲の外を指している */
const AUDIO_DURATION_SECONDS = 276.5;

describe.each(Object.entries(sheets))('%s.json', (_name, sheet) => {
  it('title と行がある', () => {
    expect(sheet.title).not.toBe('');
    expect(sheet.lines.length).toBeGreaterThan(0);
  });

  it('time が重複せずに増えていく', () => {
    const times = sheet.lines.map((line) => line.time);
    expect(times).toStrictEqual([...new Set(times)].sort((a, b) => a - b));
  });

  it('空の行が無い', () => {
    expect(sheet.lines.every((line) => line.text.trim() !== '')).toBe(true);
  });
});

describe(`${DEFAULT_SHEET_NAME}.json`, () => {
  const sheet = sheets[DEFAULT_SHEET_NAME];

  it('曲の長さに収まっている', () => {
    const last = sheet.lines[sheet.lines.length - 1];
    expect(last.time).toBeLessThan(AUDIO_DURATION_SECONDS);
  });

  it('歌い出しより前には何も置かれていない', () => {
    expect(sheet.lines[0].time).toBeGreaterThan(10);
  });
});
