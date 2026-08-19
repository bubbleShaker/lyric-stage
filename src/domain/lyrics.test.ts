import { describe, expect, it } from 'vitest';
import { activeLineIndexAt, NO_LINE, parseLyricSheet, type LyricLine } from './lyrics';

describe('activeLineIndexAt', () => {
  const lines: LyricLine[] = [
    { time: 0, text: 'A' },
    { time: 10, text: 'B' },
    { time: 20, text: 'C', duration: 2 },
  ];

  it('最初の行が始まる前は何も表示しない', () => {
    expect(activeLineIndexAt([{ time: 5, text: 'A' }], 4.9)).toBe(NO_LINE);
  });

  it('行の開始ちょうどで、その行に切り替わる', () => {
    expect(activeLineIndexAt(lines, 10)).toBe(1);
  });

  it('次の行が来るまで表示し続ける', () => {
    expect(activeLineIndexAt(lines, 9.99)).toBe(0);
    expect(activeLineIndexAt(lines, 19.99)).toBe(1);
  });

  it('duration が切れたら間が空く', () => {
    expect(activeLineIndexAt(lines, 21.99)).toBe(2);
    expect(activeLineIndexAt(lines, 22)).toBe(NO_LINE);
    expect(activeLineIndexAt(lines, 100)).toBe(NO_LINE);
  });

  it('最後の行に duration が無ければ曲の終わりまで残る', () => {
    expect(activeLineIndexAt([{ time: 1, text: 'A' }], 9999)).toBe(0);
  });

  it('空の歌詞でも落ちない', () => {
    expect(activeLineIndexAt([], 0)).toBe(NO_LINE);
  });

  it('time が同じ行が並んだら後の行が勝つ', () => {
    const same: LyricLine[] = [
      { time: 5, text: '先' },
      { time: 5, text: '後' },
    ];
    expect(activeLineIndexAt(same, 5)).toBe(1);
  });

  it('duration が次の行を跨いでも、次の行の開始が優先される', () => {
    // duration は「早く消す」ためのもので、表示を延長する働きは無い
    const overlapping: LyricLine[] = [
      { time: 0, text: '長い', duration: 30 },
      { time: 10, text: '次' },
    ];
    expect(activeLineIndexAt(overlapping, 9.9)).toBe(0);
    expect(activeLineIndexAt(overlapping, 10)).toBe(1);
  });
});

describe('parseLyricSheet', () => {
  it('time の昇順に並べ替える', () => {
    const sheet = parseLyricSheet({
      title: 'テスト',
      lines: [
        { time: 30, text: '後' },
        { time: 10, text: '先' },
      ],
    });
    expect(sheet.lines.map((line) => line.text)).toEqual(['先', '後']);
  });

  it('省略可能な項目が無くても通る', () => {
    const sheet = parseLyricSheet({ title: 'テスト', lines: [{ time: 0, text: 'A' }] });
    expect(sheet.lines[0]).toEqual({ time: 0, text: 'A' });
  });

  it('effect と duration を保持する', () => {
    const sheet = parseLyricSheet({
      title: 'テスト',
      lines: [{ time: 0, text: 'A', effect: 'typewriter', duration: 3 }],
    });
    expect(sheet.lines[0].effect).toBe('typewriter');
    expect(sheet.lines[0].duration).toBe(3);
  });

  it('行が 0 件でも通る', () => {
    expect(parseLyricSheet({ title: '無題', lines: [] }).lines).toEqual([]);
  });

  it('数値でない time / duration を弾く', () => {
    expect(() => parseLyricSheet({ title: 'x', lines: [{ time: NaN, text: 'A' }] })).toThrow();
    expect(() =>
      parseLyricSheet({ title: 'x', lines: [{ time: Infinity, text: 'A' }] }),
    ).toThrow();
    expect(() =>
      parseLyricSheet({ title: 'x', lines: [{ time: 0, text: 'A', duration: NaN }] }),
    ).toThrow();
  });

  it('形が違うデータは弾く', () => {
    expect(() => parseLyricSheet(null)).toThrow();
    expect(() => parseLyricSheet({ lines: [] })).toThrow();
    expect(() => parseLyricSheet({ title: 'x', lines: {} })).toThrow();
    expect(() => parseLyricSheet({ title: 'x', lines: [{ time: '0', text: 'A' }] })).toThrow();
    expect(() => parseLyricSheet({ title: 'x', lines: [{ time: -1, text: 'A' }] })).toThrow();
    expect(() => parseLyricSheet({ title: 'x', lines: [{ time: 0 }] })).toThrow();
    expect(() => parseLyricSheet({ title: 'x', lines: [{ time: 0, text: 'A', duration: 0 }] })).toThrow();
  });
});
