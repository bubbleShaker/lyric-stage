import { describe, expect, it } from 'vitest';
import {
  activeLineIndexAt,
  NO_LINE,
  parseLyricSheet,
  sliceSheet,
  type LyricLine,
  type LyricSheet,
} from './lyrics';
import { WHOLE_SONG } from './work-window';

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

describe('sliceSheet', () => {
  // 時刻の付け替えを目で追えるよう、区間の開始を切りのいい 100 にしてある
  const sheet: LyricSheet = {
    title: 'テスト',
    lines: [
      { time: 10, text: 'A' },
      { time: 90, text: 'B', duration: 5 },
      { time: 100, text: 'C' },
      { time: 110, text: 'D', duration: 4 },
      { time: 118, text: 'E' },
      { time: 130, text: 'F' },
    ],
  };
  const window = { start: 100, end: 120 };

  it('区間に重なる行だけを残す', () => {
    expect(sliceSheet(sheet, window).lines.map((line) => line.text)).toEqual(['C', 'D', 'E']);
  });

  it('時刻を区間の先頭からの秒数に付け替える', () => {
    expect(sliceSheet(sheet, window).lines.map((line) => line.time)).toEqual([0, 10, 18]);
  });

  it('区間を跨いで出続けている行は、区間の頭に置き直して残す', () => {
    // 95〜105 まで出ている行。time が区間の外だからと落とすと開幕の歌詞が抜ける
    const across: LyricSheet = { title: 't', lines: [{ time: 95, text: 'X', duration: 10 }] };
    expect(sliceSheet(across, window).lines).toEqual([{ time: 0, text: 'X', duration: 5 }]);
  });

  it('区間の終わりをはみ出す duration は切り詰める', () => {
    const over: LyricSheet = { title: 't', lines: [{ time: 115, text: 'X', duration: 30 }] };
    expect(sliceSheet(over, window).lines[0].duration).toBe(5);
  });

  it('duration の無い行は無いまま残す（次の行まで／作品の終わりまで）', () => {
    expect(sliceSheet(sheet, window).lines[0]).toEqual({ time: 0, text: 'C' });
  });

  it('区間の終わりちょうどで始まる行は含めない', () => {
    const edge: LyricSheet = { title: 't', lines: [{ time: 120, text: 'X' }] };
    expect(sliceSheet(edge, window).lines).toEqual([]);
  });

  it('丸めて 0 になるほどしか残らない行は、行ごと落とす', () => {
    // duration だけ落とすと「次の行まで表示」に化けて、元より長く出ることになる
    const sliver: LyricSheet = { title: 't', lines: [{ time: 119.9996, text: 'X', duration: 1 }] };
    expect(sliceSheet(sliver, window).lines).toEqual([]);
  });

  it('区間の開始ちょうどで終わる行は含めない', () => {
    const edge: LyricSheet = { title: 't', lines: [{ time: 95, text: 'X', duration: 5 }] };
    expect(sliceSheet(edge, window).lines).toEqual([]);
  });

  it('effect は持ち越す（構図や演出の割り当てを収録や切り出しで失わない）', () => {
    const withEffect: LyricSheet = { title: 't', lines: [{ time: 105, text: 'X', effect: 'zoom' }] };
    expect(sliceSheet(withEffect, window).lines[0].effect).toBe('zoom');
  });

  it('元のシートを書き換えない', () => {
    const before = structuredClone(sheet);
    sliceSheet(sheet, window);
    expect(sheet).toEqual(before);
  });

  it('付け替えた時刻に浮動小数の埃が残らない', () => {
    const real: LyricSheet = { title: 't', lines: [{ time: 179.78, text: 'X', duration: 3.01 }] };
    const sliced = sliceSheet(real, { start: 176.77, end: 203.82 });
    expect(sliced.lines[0]).toEqual({ time: 3.01, text: 'X', duration: 3.01 });
  });

  it('切り出した結果も time の昇順を保つ（activeLineIndexAt の前提）', () => {
    const times = sliceSheet(sheet, window).lines.map((line) => line.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('sliceSheet（曲を丸ごと扱う WHOLE_SONG）', () => {
  // 区間を切らない場合の特別扱いを消すための値。素通しでなければ意味が無い
  const sheet: LyricSheet = {
    title: 'テスト',
    lines: [
      { time: 0, text: 'A' },
      { time: 10, text: 'B', duration: 5 },
      { time: 30, text: 'C', effect: 'zoom' },
    ],
  };

  it('何も変えずに返す', () => {
    expect(sliceSheet(sheet, WHOLE_SONG)).toEqual(sheet);
  });
});
