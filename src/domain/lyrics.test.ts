import { describe, expect, it } from 'vitest';
import {
  activeLineIndexAt,
  NO_LINE,
  parseLyricSheet,
  partsOf,
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

describe('parseLyricSheet（構図 = place）', () => {
  /** 1 行だけのシートを読ませて、その行を返す */
  const parseLine = (line: object) =>
    parseLyricSheet({ title: 'テスト', lines: [{ time: 0, text: 'A', ...line }] }).lines[0];

  it('構図をそのまま保持する', () => {
    // parseLyricLine は項目を組み直すので、**書き忘れると黙って落ちる**。
    // 落ちても JSON は valid のままで画面も出るため、この検査でしか気付けない
    const place = { at: 'top-left', size: 'xl', nudge: { x: 0.05, y: -0.1 }, tilt: -4 };

    expect(parseLine({ place }).place).toEqual(place);
  });

  it('nudge と tilt は省略できる', () => {
    expect(parseLine({ place: { at: 'middle-center', size: 'md' } }).place).toEqual({
      at: 'middle-center',
      size: 'md',
    });
  });

  it('at と size は省略できない', () => {
    // 省略を許すと「意図してその配置を選んだ行」と「割り当てを忘れた行」が
    // 画面を見ても区別できない
    expect(() => parseLine({ place: { size: 'md' } })).toThrow();
    expect(() => parseLine({ place: { at: 'top-left' } })).toThrow();
    expect(() => parseLine({ place: { at: '', size: 'md' } })).toThrow();
  });

  it('構図の形が違うものを弾く', () => {
    expect(() => parseLine({ place: null })).toThrow();
    expect(() => parseLine({ place: 'top-left' })).toThrow();
    // 配列も typeof では 'object' を名乗るので、素通しにならないことを見る
    expect(() => parseLine({ place: ['top-left', 'md'] })).toThrow();
    expect(() => parseLine({ place: { at: 'top-left', size: 'md', nudge: 0.1 } })).toThrow();
  });

  it('画面の外へ出るずらし幅と傾きを弾く', () => {
    // 桁を間違えても CSS はエラーにならず、行が画面外に出て**何も表示されない**
    // という原因の分かりにくい壊れ方をする
    const base = { at: 'top-left', size: 'md' };

    expect(() => parseLine({ place: { ...base, nudge: { x: 5 } } })).toThrow();
    expect(() => parseLine({ place: { ...base, nudge: { y: -0.3 } } })).toThrow();
    expect(() => parseLine({ place: { ...base, nudge: { x: NaN } } })).toThrow();
    expect(() => parseLine({ place: { ...base, tilt: 90 } })).toThrow();
    expect(() => parseLine({ place: { ...base, tilt: '4deg' } })).toThrow();
  });

  it('綴りを間違えた項目を弾く', () => {
    // 構図は行ごとに手で書くので綴り間違いが起きる。黙って落とすと範囲の検証も
    // 素通りして「なぜか傾かない行」になるだけで、画面を見ても原因が分からない
    const base = { at: 'top-left', size: 'md' };

    expect(() => parseLine({ place: { ...base, tlit: 4 } })).toThrow();
    expect(() => parseLine({ place: { ...base, nudge: { X: 0.05 } } })).toThrow();
  });

  it('中身の無い nudge を弾く', () => {
    expect(() => parseLine({ place: { at: 'top-left', size: 'md', nudge: {} } })).toThrow();
  });

  it('傾き 0 とずらし幅 0 は指定として残す', () => {
    // 0 を falsy として落とすと「傾けないと決めた行」が「未指定」に化ける
    const place = { at: 'top-left', size: 'md', nudge: { x: 0 }, tilt: 0 };

    expect(parseLine({ place }).place).toEqual(place);
  });
});

describe('parseLyricSheet（語句 = parts）', () => {
  /** 1 行だけのシートを読ませて、その行を返す */
  const parseLine = (line: object) =>
    parseLyricSheet({ title: 'テスト', lines: [{ time: 0, text: 'AB', ...line }] }).lines[0];

  it('語句をそのまま保持する', () => {
    // parseLyricLine は項目を組み直すので、**書き忘れると黙って落ちる**
    const parts = [
      { text: 'A', at: 0, effect: 'zoom', place: { at: 'top-left', size: 'md' } },
      { text: 'B', at: 1.5 },
    ];

    expect(parseLine({ parts }).parts).toEqual(parts);
  });

  it('at が無い語句を弾く', () => {
    // 刻むために足した項目なので省略させない。0 に落とすと、刻みを書き忘れた
    // 語句が行の頭で静かに重なる
    expect(() => parseLine({ parts: [{ text: 'A' }] })).toThrow();
    expect(() => parseLine({ parts: [{ text: 'A', at: -1 }] })).toThrow();
    expect(() => parseLine({ parts: [{ text: 'A', at: '1.5' }] })).toThrow();
  });

  it('中身の無い語句を弾く', () => {
    expect(() => parseLine({ parts: [{ text: '', at: 0 }] })).toThrow();
    expect(() => parseLine({ parts: [{ text: '  ', at: 0 }] })).toThrow();
    expect(() => parseLine({ parts: [] })).toThrow();
    expect(() => parseLine({ parts: {} })).toThrow();
  });

  it('順番が前後した語句を弾く', () => {
    // 並べ替えて助けない。**書いた順＝出る順**でないと、JSON を読む向きと
    // 画に出る向きがずれていても気付けない
    expect(() =>
      parseLine({
        parts: [
          { text: 'A', at: 2 },
          { text: 'B', at: 1 },
        ],
      }),
    ).toThrow();
  });

  it('同時に出る語句は許す', () => {
    const parts = [
      { text: 'A', at: 1 },
      { text: 'B', at: 1 },
    ];

    expect(parseLine({ parts }).parts).toHaveLength(2);
  });

  it('綴りを間違えた項目を弾く', () => {
    expect(() => parseLine({ parts: [{ text: 'A', at: 0, effects: 'zoom' }] })).toThrow();
    // 行の側も同じ番人を通る。`parst` が黙って落ちると、刻んだつもりの行が
    // 検証も刻みも素通りして 1 語句で出る
    expect(() => parseLine({ parst: [{ text: 'A', at: 0 }] })).toThrow();
    expect(() => parseLine({ palce: { at: 'top-left', size: 'md' } })).toThrow();
  });

  it('語句の構図も行と同じ検証を受ける', () => {
    // 行と語句で検証が食い違うと、語句に書いた時だけ画面外へ飛ぶ値が通ってしまう
    expect(() => parseLine({ parts: [{ text: 'A', at: 0, place: { size: 'md' } }] })).toThrow();
    expect(() =>
      parseLine({ parts: [{ text: 'A', at: 0, place: { at: 'top-left', size: 'md', tilt: 90 } }] }),
    ).toThrow();
  });
});

describe('parseLyricSheet（図形 = decor）', () => {
  const parseLine = (line: object) =>
    parseLyricSheet({ title: 'テスト', lines: [{ time: 0, text: 'AB', ...line }] }).lines[0];

  it('図形の名前をそのまま保持する', () => {
    // 実在する名前かどうかは見ない（語彙は stage/decor.ts の担当）。
    // ここが見るのは形だけ
    expect(parseLine({ decor: ['band', 'rule'] }).decor).toEqual(['band', 'rule']);
    expect(parseLine({ parts: [{ text: 'A', at: 0, decor: ['box'] }] }).parts?.[0].decor).toEqual([
      'box',
    ]);
  });

  it('配列でない指定を弾く', () => {
    expect(() => parseLine({ decor: 'band' })).toThrow();
    expect(() => parseLine({ decor: { band: true } })).toThrow();
  });

  it('中身の無い指定を弾く', () => {
    // 空配列は省略と同じ意味にしかならない。書き掛けとして落とす
    expect(() => parseLine({ decor: [] })).toThrow();
    expect(() => parseLine({ decor: [''] })).toThrow();
    expect(() => parseLine({ decor: ['  '] })).toThrow();
    expect(() => parseLine({ decor: [1] })).toThrow();
  });

  it('刻んだ行に行の図形を書いた指定を弾く', () => {
    // 図形は行から継がないので、書いても画には何も出ない（検証も型も検査も通る）。
    // 継がないと決めた以上、継がない指定を書けてしまう方を塞ぐ
    expect(() =>
      parseLine({ decor: ['band'], parts: [{ text: 'AB', at: 0 }] }),
    ).toThrow();
  });

  it('前後に空白の付いた名前を弾く', () => {
    // 実在の名前と見分けが付かないのに、語彙の側では未知の名前として静かに落ちる
    expect(() => parseLine({ decor: [' band'] })).toThrow();
    expect(() => parseLine({ decor: ['band '] })).toThrow();
  });

  it('同じ図形を 2 度書いた指定を弾く', () => {
    // 同じ場所にぴったり重なるので、画面では 1 つにしか見えない
    expect(() => parseLine({ decor: ['band', 'band'] })).toThrow();
  });
});

describe('partsOf', () => {
  it('刻んでいない行は 1 語句として返す', () => {
    // 表示側から「刻んである行」「刻んでいない行」の分岐を消すための正規化
    const line = { time: 0, text: 'A', effect: 'zoom', place: { at: 'top-left', size: 'md' } };

    expect(partsOf(line)).toEqual([
      { text: 'A', at: 0, effect: 'zoom', place: { at: 'top-left', size: 'md' }, decor: [] },
    ]);
  });

  it('語句が省いた演出と構図は行から継ぐ', () => {
    const place = { at: 'top-left', size: 'md' };
    const line = {
      time: 0,
      text: 'AB',
      effect: 'zoom',
      place,
      parts: [{ text: 'A', at: 0 }, { text: 'B', at: 1, effect: 'fade' }],
    };

    expect(partsOf(line)).toEqual([
      { text: 'A', at: 0, effect: 'zoom', place, decor: [] },
      { text: 'B', at: 1, effect: 'fade', place, decor: [] },
    ]);
  });

  it('語句の指定が行に勝つ', () => {
    const line = {
      time: 0,
      text: 'A',
      effect: 'zoom',
      place: { at: 'top-left', size: 'md' },
      parts: [{ text: 'A', at: 0, effect: 'fade', place: { at: 'bottom-right', size: 'xl' } }],
    };

    expect(partsOf(line)[0]).toEqual({
      text: 'A',
      at: 0,
      effect: 'fade',
      place: { at: 'bottom-right', size: 'xl' },
      decor: [],
    });
  });

  it('演出も構図も無い行でも落ちない', () => {
    expect(partsOf({ time: 0, text: 'A' })).toEqual([
      { text: 'A', at: 0, effect: undefined, place: undefined, decor: [] },
    ]);
  });

  it('刻んでいない行は行の図形をそのまま持つ', () => {
    // 1 語句の行として扱うので、行に書いた decor がその語句の decor になる
    const line = { time: 0, text: 'A', decor: ['band'] };

    expect(partsOf(line)[0].decor).toEqual(['band']);
  });

  it('**図形だけは行から継がない**', () => {
    // effect / place と違う扱い（M8-3a）。継ぐと刻んだ行の語句すべてに同じ帯が
    // 出て画が埋まり、図形を足した狙いと逆になる。この 1 行が消えると
    // 「なぜか全部の語句に帯が出る」になるので、方針そのものを検査にしておく
    const line = {
      time: 0,
      text: 'AB',
      decor: ['band'],
      parts: [{ text: 'A', at: 0 }, { text: 'B', at: 1, decor: ['rule'] }],
    };

    expect(partsOf(line).map((part) => part.decor)).toEqual([[], ['rule']]);
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

  it('頭を削られた行の語句は、削った分だけ前に詰める', () => {
    // at は行の time からの相対秒。行の頭が区間に合わせて動くのに at をそのままに
    // すると、**既に歌い終えた語句まで削った秒数だけ遅れて出直す**
    const across: LyricSheet = {
      title: 't',
      lines: [
        {
          time: 95,
          text: 'XYZ',
          duration: 10,
          parts: [
            { text: 'X', at: 0 },
            { text: 'Y', at: 3 },
            { text: 'Z', at: 8 },
          ],
        },
      ],
    };

    // 5 秒削られるので、区間の頭より前に出るはずだった X / Y は 0（頭から出ている扱い）。
    // 語句は行が終わるまで残る積み上げなので、落とすのではなく詰めるのが正しい
    expect(sliceSheet(across, window).lines[0].parts).toEqual([
      { text: 'X', at: 0 },
      { text: 'Y', at: 0 },
      { text: 'Z', at: 3 },
    ]);
  });

  it('頭を削らない行の語句はそのまま', () => {
    const inside: LyricSheet = {
      title: 't',
      lines: [{ time: 105, text: 'XY', parts: [{ text: 'X', at: 0 }, { text: 'Y', at: 2 }] }],
    };

    expect(sliceSheet(inside, window).lines[0].parts).toEqual([
      { text: 'X', at: 0 },
      { text: 'Y', at: 2 },
    ]);
  });

  it('語句を複製して返す（元のシートを書き換えない）', () => {
    const original: LyricSheet = {
      title: 't',
      lines: [{ time: 95, text: 'X', duration: 10, parts: [{ text: 'X', at: 8 }] }],
    };

    sliceSheet(original, window);

    expect(original.lines[0].parts).toEqual([{ text: 'X', at: 8 }]);
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
