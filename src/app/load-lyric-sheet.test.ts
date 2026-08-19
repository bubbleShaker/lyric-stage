import { describe, expect, it } from 'vitest';
import { isValidSheetName, lyricSheetNameFromLocation } from './load-lyric-sheet';

describe('isValidSheetName', () => {
  it('英数字・アンダースコア・ハイフンだけを通す', () => {
    expect(isValidSheetName('sample')).toBe(true);
    expect(isValidSheetName('my-lyrics_02')).toBe(true);
  });

  it('パスを辿ろうとする名前を弾く', () => {
    expect(isValidSheetName('../secret')).toBe(false);
    expect(isValidSheetName('a/b')).toBe(false);
    expect(isValidSheetName('..')).toBe(false);
    expect(isValidSheetName('%2e%2e')).toBe(false);
  });

  it('別のリソースを指す名前を弾く', () => {
    expect(isValidSheetName('https://example.com/x')).toBe(false);
    expect(isValidSheetName('sample.json')).toBe(false);
  });

  it('空文字や記号を弾く', () => {
    expect(isValidSheetName('')).toBe(false);
    expect(isValidSheetName('a b')).toBe(false);
    expect(isValidSheetName('歌詞')).toBe(false);
  });
});

describe('lyricSheetNameFromLocation', () => {
  it('指定が無ければ sample', () => {
    expect(lyricSheetNameFromLocation('')).toBe('sample');
    expect(lyricSheetNameFromLocation('?other=1')).toBe('sample');
  });

  it('空の指定でも sample に落とす', () => {
    expect(lyricSheetNameFromLocation('?lyrics=')).toBe('sample');
  });

  it('指定された名前を返す', () => {
    expect(lyricSheetNameFromLocation('?lyrics=shining')).toBe('shining');
  });
});
