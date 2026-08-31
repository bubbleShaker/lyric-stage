import { describe, expect, it } from 'vitest';
import {
  activeLineIndexAt,
  createPolarityTrack,
  DEFAULT_POLARITY,
  findRapidPolarityFlip,
  lineSpanAt,
  MIN_POLARITY_INTERVAL,
  NO_LINE,
  parseLyricSheet,
  partsOf,
  polarityAt,
  sliceSheet,
  withPrelude,
  type LyricLine,
  type LyricSheet,
} from './lyrics';
import { WHOLE_SONG, type WorkWindow } from './work-window';

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

describe('parseLyricSheet（英字 = sub）', () => {
  const parseLine = (line: object) =>
    parseLyricSheet({ title: 'テスト', lines: [{ time: 0, text: 'AB', ...line }] }).lines[0];

  it('英字をそのまま保持する', () => {
    // 何を書くかは作者の領分。ここが見るのは形だけで、大文字化もしない
    // （CSS の text-transform を使わないのと同じ理由 — 描く字と、書体のサブセットが
    // 見ている字を一致させておく）
    expect(parseLine({ sub: 'SPELL IT OUT' }).sub).toBe('SPELL IT OUT');
    expect(parseLine({ parts: [{ text: 'A', at: 0, sub: 'MAGIC' }] }).parts?.[0].sub).toBe('MAGIC');
  });

  it('中身の無い指定を弾く', () => {
    expect(() => parseLine({ sub: '' })).toThrow();
    expect(() => parseLine({ sub: '   ' })).toThrow();
    expect(() => parseLine({ sub: 42 })).toThrow();
  });

  it('前後に空白の付いた英字を弾く', () => {
    // 英字は字間を大きく空けて置くので、前後の空白 1 つが数 px のずれになる。
    // 画面では「なぜか位置がずれている」にしか見えない
    expect(() => parseLine({ sub: ' MAGIC' })).toThrow();
    expect(() => parseLine({ sub: 'MAGIC ' })).toThrow();
  });

  it('刻んだ行に行の英字を書いた指定を弾く', () => {
    // 図形と同じ扱い（M8-3c）。英字は行から継がないので、書いても画には何も出ない
    expect(() => parseLine({ sub: 'MAGIC', parts: [{ text: 'AB', at: 0 }] })).toThrow();
  });
});

describe('parseLyricSheet（一過性の装飾 = spark）', () => {
  const parseLine = (line: object) =>
    parseLyricSheet({ title: 'テスト', lines: [{ time: 0, text: 'AB', ...line }] }).lines[0];

  it('名前をそのまま保持する', () => {
    // **実在するかは見ない**（語彙は stage/spark.ts の担当。effect / place / decor と同じ分担）。
    // 綴りの間違いは src/lyric-sheets.test.ts が名指しで落とす
    expect(parseLine({ spark: 'burst' }).spark).toBe('burst');
    expect(parseLine({ parts: [{ text: 'A', at: 0, spark: 'ghost' }] }).parts?.[0].spark).toBe(
      'ghost',
    );
  });

  it('列で書いた指定を弾く', () => {
    // **図形と決定的に違う点**（M10-1）。一瞬の装飾を重ねると、1 秒足らずの間に
    // 別々の動きが同時に走って何が起きたか読めない。列を書けてしまうと、
    // 「1 つだけ」という決めごとがデータ側から破れる
    expect(() => parseLine({ spark: ['burst'] })).toThrow();
  });

  it('中身の無い指定を弾く', () => {
    expect(() => parseLine({ spark: '' })).toThrow();
    expect(() => parseLine({ spark: '   ' })).toThrow();
    expect(() => parseLine({ spark: 42 })).toThrow();
  });

  it('前後に空白の付いた名前を弾く', () => {
    // `' burst '` は実在の名前と見分けが付かないのに、語彙の側では未知の名前として
    // 静かに落ちる（decor と同じ理由）
    expect(() => parseLine({ spark: ' burst' })).toThrow();
    expect(() => parseLine({ spark: 'burst ' })).toThrow();
  });

  it('刻んだ行に行の装飾を書いた指定を弾く', () => {
    // 図形・英字と同じ扱い。行から継がないので、書いても画には何も出ない
    expect(() => parseLine({ spark: 'burst', parts: [{ text: 'AB', at: 0 }] })).toThrow();
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

  it('**英字も行から継がない**', () => {
    // 図形と同じ扱い（M8-3c）。継ぐと刻んだ行の語句すべてに同じ英字が並び、
    // 添え物どころか画を埋める
    const line = {
      time: 0,
      text: 'AB',
      parts: [{ text: 'A', at: 0 }, { text: 'B', at: 1, sub: 'MAGIC' }],
    };

    expect(partsOf(line).map((part) => part.sub)).toEqual([undefined, 'MAGIC']);
  });

  it('刻んでいない行は行の英字をそのまま持つ', () => {
    expect(partsOf({ time: 0, text: 'A', sub: 'MAGIC' })[0].sub).toBe('MAGIC');
  });

  it('**一過性の装飾も行から継がない**', () => {
    // 図形・英字と同じ扱い（M10-1）。継ぐと刻んだ行の語句が全部同時に弾けて、
    // 置く語句を選ぶという狙いと逆になる
    const line = {
      time: 0,
      text: 'AB',
      parts: [{ text: 'A', at: 0 }, { text: 'B', at: 1, spark: 'burst' }],
    };

    expect(partsOf(line).map((part) => part.spark)).toEqual([undefined, 'burst']);
  });

  it('刻んでいない行は行の装飾をそのまま持つ', () => {
    expect(partsOf({ time: 0, text: 'A', spark: 'burst' })[0].spark).toBe('burst');
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

  it('最終行に duration を足さない', () => {
    // **区間を切る時だけの手当て**（M13-1）。素通しには「作品の終わり」が無いので、
    // ここで閉じると `WHOLE_SONG` で元のシートと等しいものが返るという性質が壊れる
    expect(sliceSheet(sheet, WHOLE_SONG).lines[2].duration).toBeUndefined();
  });
});

/**
 * 切り出した最終行を区間の終わりで閉じる（M13-1 / Issue #74）。
 *
 * 閉じないと `lineSpanAt` が `Infinity` を返し、行の中で時間を測る側 — 漂い（M13-2）・
 * 退場・カメラ — が尺を決められない。**画面には歌詞が出たまま、動きだけが静かに
 * 出なくなる**ので、目で気付ける壊れ方ではない。
 */
describe('sliceSheet（最終行を閉じる）', () => {
  const window: WorkWindow = { start: 10, end: 20 };

  it('duration を持たない最終行は区間の終わりで閉じる', () => {
    const sheet: LyricSheet = { title: 't', lines: [{ time: 12, text: 'A' }] };
    const sliced = sliceSheet(sheet, window);

    expect(sliced.lines[0]).toEqual({ time: 2, text: 'A', duration: 8 });
    expect(lineSpanAt(sliced.lines, 0)).toBe(8);
  });

  it('最終行が duration を持っていれば触らない', () => {
    // 作者が「ここで消す」と書いた行を、区間の終わりまで伸ばしてはいけない
    const sheet: LyricSheet = { title: 't', lines: [{ time: 12, text: 'A', duration: 3 }] };

    expect(sliceSheet(sheet, window).lines[0].duration).toBe(3);
  });

  it('最終行より前の行は次の行までのまま', () => {
    // **配るのは最後の 1 行だけ。** 全行に配ると duration が次の行より優先されるので、
    // どの行も「区間の終わりまで」になり、行の長さが全部同じになる
    const sheet: LyricSheet = {
      title: 't',
      lines: [
        { time: 12, text: 'A' },
        { time: 15, text: 'B' },
      ],
    };
    const sliced = sliceSheet(sheet, window);

    expect(sliced.lines[0].duration).toBeUndefined();
    expect(lineSpanAt(sliced.lines, 0)).toBe(3);
    expect(lineSpanAt(sliced.lines, 1)).toBe(5);
  });

  it('丸めて 0 以下になる最終行は、閉じるのではなく落とす', () => {
    // `duration: 0` を書くと activeLineIndexAt が必ず NO_LINE を返す ＝ **シートには
    // 載っているのに一度も画に出ない行**になる。しかも 0 は parseLyricSheet が弾く値
    // （レビュー指摘 🟡）。duration を持つ行に対してループがしている手当てと同じ
    const sheet: LyricSheet = {
      title: 't',
      lines: [
        { time: 12, text: 'A' },
        { time: 19.9996, text: 'Z' },
      ],
    };
    const sliced = sliceSheet(sheet, window);

    // Z は落ち、あらわれた新しい最終行（A）が区間の終わりで閉じる
    expect(sliced.lines).toEqual([{ time: 2, text: 'A', duration: 8 }]);
  });

  it('行が 1 つも残らなければ何もしない', () => {
    const sheet: LyricSheet = { title: 't', lines: [{ time: 40, text: 'A' }] };

    expect(sliceSheet(sheet, window).lines).toEqual([]);
  });
});

describe('lineSpanAt', () => {
  it('duration があればそれ、無ければ次の行まで', () => {
    const lines: LyricLine[] = [
      { time: 0, text: 'A' },
      { time: 5, text: 'B', duration: 2 },
      { time: 10, text: 'C' },
    ];

    expect(lineSpanAt(lines, 0)).toBe(5);
    expect(lineSpanAt(lines, 1)).toBe(2);
  });

  it('duration を持たない最終行は無限', () => {
    // **受け取る側は有限を前提にしない**（stage/drift.ts が弾く）。作品のシートは
    // sliceSheet が閉じるのでここには落ちないが、素のシートを読む所では起こる
    const lines: LyricLine[] = [{ time: 0, text: 'A' }];

    expect(lineSpanAt(lines, 0)).toBe(Infinity);
  });
});

describe('極性（polarity）の変化点', () => {
  it('何も書かなければ変化点は無く、どの時刻も既定の極性', () => {
    const track = createPolarityTrack({ title: 't', lines: [
      { time: 0, text: 'A' },
      { time: 5, text: 'B' },
    ] });

    expect(track.changes).toEqual([]);
    expect(track.initial).toBe(DEFAULT_POLARITY);
    expect(polarityAt(track, 7)).toBe(DEFAULT_POLARITY);
  });

  it('書いた行から先が続く（次の行で戻らない）', () => {
    const track = createPolarityTrack({ title: 't', lines: [
      { time: 0, text: 'A' },
      { time: 5, text: 'B', polarity: 'ink' },
      { time: 10, text: 'C' },
      { time: 15, text: 'D' },
    ] });

    expect(polarityAt(track, 4.9)).toBe('paper');
    expect(polarityAt(track, 5)).toBe('ink');
    // **ここが行の属性との分かれ目。** 行が変わっても戻らない
    expect(polarityAt(track, 20)).toBe('ink');
  });

  it('同じ極性を続けて書いても変化点にならない', () => {
    // 画は何も変わらないので、数えると安全の検査（findRapidPolarityFlip）だけが
    // 落ちることになる
    const track = createPolarityTrack({ title: 't', lines: [
      { time: 0, text: 'A', polarity: 'ink' },
      { time: 0.2, text: 'B', polarity: 'ink' },
      { time: 0.4, text: 'C', polarity: 'ink' },
    ] });

    expect(track.changes).toEqual([{ time: 0, polarity: 'ink' }]);
    expect(findRapidPolarityFlip(track)).toBeNull();
  });

  it('行が出ていない時刻でも極性は決まる', () => {
    // duration で切れた「間」。activeLineIndexAt は NO_LINE を返すが、
    // 画そのものは在るので極性は要る
    const lines: LyricLine[] = [{ time: 0, text: 'A', duration: 1, polarity: 'ink' }];

    expect(activeLineIndexAt(lines, 3)).toBe(NO_LINE);
    expect(polarityAt(createPolarityTrack({ title: 't', lines }), 3)).toBe('ink');
  });

  it('0 より前でも落ちない', () => {
    // **本編では起こらない**（WindowedPlayback.currentTime は 0 で下げ止まる。
    // レビュー指摘 🟡 で、「区間の手前で負を返す」という既存の思い込みが
    // 誤りだと分かった）。effect-preview.html は自前の時計で回すし、
    // 時刻を受け取るだけの純粋関数がそこで破れるのは筋が悪いので防御として残す
    const track = createPolarityTrack({ title: 't', lines: [{ time: 0, text: 'A', polarity: 'ink' }] });

    expect(polarityAt(track, -3)).toBe(DEFAULT_POLARITY);
  });

  it('始まりの極性は最初の変化点より前のすべての時刻に効く', () => {
    // **行の無い時刻に状態を置ける唯一の場所**（レビュー指摘 🔴）。
    // sliceSheet の持ち越しがここに載る
    const track = createPolarityTrack({
      title: 't',
      polarity: 'ink',
      lines: [{ time: 5, text: 'A', polarity: 'paper' }],
    });

    expect(polarityAt(track, 0)).toBe('ink');
    expect(polarityAt(track, 4.9)).toBe('ink');
    expect(polarityAt(track, 5)).toBe('paper');
  });

  it('始まりと同じ極性を書いた行は変化点にならない', () => {
    const track = createPolarityTrack({
      title: 't',
      polarity: 'ink',
      lines: [{ time: 5, text: 'A', polarity: 'ink' }],
    });

    expect(track.changes).toEqual([]);
  });

  it('何度でも往復できる', () => {
    const track = createPolarityTrack({ title: 't', lines: [
      { time: 0, text: 'A', polarity: 'ink' },
      { time: 5, text: 'B', polarity: 'paper' },
      { time: 10, text: 'C', polarity: 'ink' },
    ] });

    expect(track.changes.map((change) => change.polarity)).toEqual(['ink', 'paper', 'ink']);
    expect(polarityAt(track, 12)).toBe('ink');
  });
});

describe('極性の切り替えの間隔（明滅の安全）', () => {
  it('下限を下回る切り替えを見つける', () => {
    const track = createPolarityTrack({ title: 't', lines: [
      { time: 0, text: 'A', polarity: 'ink' },
      { time: 0.5, text: 'B', polarity: 'paper' },
    ] });

    expect(findRapidPolarityFlip(track)).toEqual({ time: 0.5, polarity: 'paper' });
  });

  it('ちょうど下限なら通す', () => {
    const track = createPolarityTrack({ title: 't', lines: [
      { time: 0, text: 'A', polarity: 'ink' },
      { time: MIN_POLARITY_INTERVAL, text: 'B', polarity: 'paper' },
    ] });

    expect(findRapidPolarityFlip(track)).toBeNull();
  });

  it('最初の切り替えには間隔が掛からない（既定からの立ち上がり）', () => {
    const track = createPolarityTrack({ title: 't', lines: [{ time: 0.1, text: 'A', polarity: 'ink' }] });

    expect(findRapidPolarityFlip(track)).toBeNull();
  });

  it('切り出しても間隔は縮まない', () => {
    // **かつては縮みえた**（レビュー指摘 🟡）。区間の頭を跨いで始まる行は時刻 0 へ
    // 詰められるので、極性を行に載せていた頃は「元は 1.1 秒差 → 切り出すと 0.6 秒差」に
    // なった。今は**区間の頭より前で立った極性がシートの `initial` に畳まれる**ので、
    // 詰められた行は変化点にならない（＝ 詰めで縮む相手が居ない）。
    //
    // 区間の中に居る行どうしは一様に同じ秒数だけ前へ動くので間隔が変わらず、
    // 頭を跨ぐ行はどの並びでも高々 1 つ。**この 2 つで縮む経路が尽きている**
    const sheet: LyricSheet = {
      title: 't',
      lines: [
        { time: 9.5, text: 'A', polarity: 'ink' },
        { time: 10.6, text: 'B', polarity: 'paper' },
      ],
    };
    // 生のシートは通る（1.1 秒差）
    expect(findRapidPolarityFlip(createPolarityTrack(sheet))).toBeNull();

    const sliced = sliceSheet(sheet, { start: 10, end: 20 });
    expect(sliced.polarity).toBe('ink');
    expect(createPolarityTrack(sliced).changes).toEqual([{ time: 0.6, polarity: 'paper' }]);
    expect(findRapidPolarityFlip(createPolarityTrack(sliced))).toBeNull();
  });

  it('parseLyricSheet が速すぎる切り替えを落とす', () => {
    expect(() =>
      parseLyricSheet({
        title: 't',
        lines: [
          { time: 0, text: 'A', polarity: 'ink' },
          { time: 0.3, text: 'B', polarity: 'paper' },
        ],
      }),
    ).toThrow(/polarity/);
  });

  it('整列の後で数える（書いた順が時刻の順とは限らない）', () => {
    // 行の順を入れ替えて書いても、間隔は整列した後の時刻で決まる
    expect(() =>
      parseLyricSheet({
        title: 't',
        lines: [
          { time: 0.3, text: 'B', polarity: 'paper' },
          { time: 0, text: 'A', polarity: 'ink' },
        ],
      }),
    ).toThrow(/polarity/);
  });
});

describe('parseLyricSheet（極性 = polarity）', () => {
  function parseLine(line: Record<string, unknown>): LyricLine {
    return parseLyricSheet({ title: 't', lines: [line] }).lines[0];
  }

  it('極性を読み取る', () => {
    expect(parseLine({ time: 0, text: 'A', polarity: 'ink' }).polarity).toBe('ink');
  });

  it('書かなければ項目ごと持たない', () => {
    expect(parseLine({ time: 0, text: 'A' })).toEqual({ time: 0, text: 'A' });
  });

  it('知らない名前を落とす', () => {
    expect(() => parseLine({ time: 0, text: 'A', polarity: 'invert' })).toThrow(/polarity/);
  });

  it('文字列でない値を落とす', () => {
    expect(() => parseLine({ time: 0, text: 'A', polarity: true })).toThrow(/polarity/);
  });

  it('語句の側には書けない（画を裏返すのは画面ぜんぶに掛かる操作）', () => {
    expect(() =>
      parseLine({
        time: 0,
        text: 'A',
        parts: [{ text: 'あ', at: 0, polarity: 'ink' }],
      }),
    ).toThrow(/知らない項目/);
  });
});

describe('sliceSheet（極性の持ち越し）', () => {
  const window = { start: 10, end: 20 };

  it('区間の外で立てた極性を最初の行へ移す', () => {
    // 放置すると「区間を広げただけで途中から画が裏返る」形になる。
    // A に duration を持たせて区間の頭より前に消しているのは、そうしないと
    // A 自身が生き残ってしまい（下の検査を見よ）持ち越しの経路を通らないため
    const sheet: LyricSheet = {
      title: 't',
      lines: [
        { time: 0, text: 'A', duration: 5, polarity: 'ink' },
        { time: 12, text: 'B' },
        { time: 15, text: 'C' },
      ],
    };

    const sliced = sliceSheet(sheet, window);
    // **行ではなくシートに載る**（レビュー指摘 🔴）。行に載せると、区間の頭から
    // 最初の行までの助走のあいだだけ既定の極性になり、歌い出しで画が裏返る
    expect(sliced.polarity).toBe('ink');
    expect(sliced.lines.map((line) => line.polarity)).toEqual([undefined, undefined]);
    // 区間の頭（0 秒）から既に裏返っている
    expect(polarityAt(createPolarityTrack(sliced), 0)).toBe('ink');
  });

  it('区間の頭を跨いで出ている行は、自分の極性ごと生き残る', () => {
    // duration の無い行は次の行まで出続けるので、区間の頭で表示中＝切り出しに残る。
    // このとき持ち越しの出番は無い（本人が切り替えの当事者としてそこに居る）
    const sheet: LyricSheet = {
      title: 't',
      lines: [
        { time: 0, text: 'A', polarity: 'ink' },
        { time: 12, text: 'B' },
      ],
    };

    const sliced = sliceSheet(sheet, window);
    expect(sliced.lines.map((line) => line.polarity)).toEqual(['ink', undefined]);
    // その行は区間の頭より前から極性を立てているので、持ち越しにも同じ値が載る。
    // **二重に載っても変化点は生まれない**（始まりと同じことを書いた行は数えない）
    expect(sliced.polarity).toBe('ink');
    expect(createPolarityTrack(sliced).changes).toEqual([]);
  });

  it('持ち越しの後で最初の行が戻すと、そこが変化点になる', () => {
    const sheet: LyricSheet = {
      title: 't',
      lines: [
        { time: 0, text: 'A', duration: 5, polarity: 'ink' },
        { time: 12, text: 'B', polarity: 'paper' },
      ],
    };

    const track = createPolarityTrack(sliceSheet(sheet, window));
    expect(polarityAt(track, 0)).toBe('ink');
    expect(polarityAt(track, 2)).toBe('paper');
  });

  it('区間の外が既定の極性なら項目ごと足さない', () => {
    // **`WHOLE_SONG` で元のシートと等しいものが返る**という性質を保つため
    const sheet: LyricSheet = { title: 't', lines: [{ time: 12, text: 'B' }] };
    const sliced = sliceSheet(sheet, window);

    // duration は最終行なので区間の終わりで閉じられる（M13-1。下の「最終行を閉じる」を見よ）
    expect(sliced.lines[0]).toEqual({ time: 2, text: 'B', duration: 8 });
    expect('polarity' in sliced).toBe(false);
  });

  it('区間の中で立てた極性はそのまま残る', () => {
    const sheet: LyricSheet = {
      title: 't',
      lines: [
        { time: 12, text: 'B' },
        { time: 15, text: 'C', polarity: 'ink' },
      ],
    };

    expect(sliceSheet(sheet, window).lines.map((line) => line.polarity)).toEqual([
      undefined,
      'ink',
    ]);
  });
});

describe('withPrelude', () => {
  /**
   * 切り出した後のシート（作品の何秒目か、の軸）。
   *
   * **型を明示する**（レビュー指摘 🟢）。書かないと構造的に通っているだけで、
   * `LyricSheet` / `LyricLine` が広がった日に検査の側が追随しない
   */
  const sliced: LyricSheet = { title: 'w', lines: [{ time: 9.02, text: '魔法が使えるような' }] };
  const prelude: LyricLine = {
    time: 3.01,
    text: '魔法が使えるような',
    duration: 6.01,
    veil: 'single',
  };

  it('序が無ければそのまま返す', () => {
    // 本編以外のシート（`preludeFor` が null を返す）はここを素通りする
    expect(withPrelude(sliced, null)).toBe(sliced);
  });

  it('序を頭に挿す', () => {
    const withIt = withPrelude(sliced, prelude);

    expect(withIt.lines).toStrictEqual([prelude, ...sliced.lines]);
  });

  it('元のシートを書き換えない', () => {
    withPrelude(sliced, prelude);

    expect(sliced.lines).toHaveLength(1);
  });

  it('極性はそのまま持ち越す', () => {
    // 序は状態を変えない。持ち越しを落とすと、**序のあいだだけ画が既定の明暗に戻る**
    const inked = { ...sliced, polarity: 'ink' as const };

    expect(withPrelude(inked, prelude).polarity).toBe('ink');
  });

  it('歌い出しに食い込む序は受け取らない', () => {
    // 据えた一文の上に歌の 1 行目が重なると、読めない 2 つの文が重なった画になる。
    // 例外も検査の赤も出ない壊れ方なので、入口で塞ぐ
    expect(() => withPrelude(sliced, { ...prelude, duration: 6.02 })).toThrow(/食い込/u);
  });

  it('負の時刻の序は受け取らない', () => {
    expect(() => withPrelude(sliced, { ...prelude, time: -1 })).toThrow(/time/u);
  });

  it('歌い出しより後ろの序は受け取らない', () => {
    // **食い込みとは別の壊れ方**（レビュー指摘 🟡）。食い込みの判定は終わりの時刻しか
    // 見ないので、`duration` の無い序を歌の後ろに置くとそこを素通りする。
    // 並びが崩れると `activeLineIndexAt` の二分探索が**例外を投げずに別の行を返す**
    const { duration: _duration, ...noDuration } = prelude;

    expect(() => withPrelude(sliced, { ...noDuration, time: 12 })).toThrow(/後ろ/u);
  });

  it('型が見ない決まりも同じ門で落ちる', () => {
    // 序は work.ts の定数なので型は付いているが、**型が見ない決まりが門の側にある**。
    // 通さないと「JSON に書けば落ちる値が、序に書いたときだけ通る」穴が残る
    expect(() => withPrelude(sliced, { ...prelude, duration: 0 })).toThrow(/duration/u);
    expect(() =>
      withPrelude(sliced, {
        ...prelude,
        place: { at: 'middle-right', size: 'md', nudge: { x: -9 } },
      }),
    ).toThrow(/nudge/u);
  });

  it('挿した後のシートで明滅の間隔を見る', () => {
    // 序が極性を持つと、そこは新しい変化点になる。**JSON を通らない行なので、
    // parseLyricSheet の壁の後ろから入る** — 挿した後にもう一度測って止める。
    // 歌い出し（9.02）の 0.52 秒前に裏返すと、間隔が MIN_POLARITY_INTERVAL を割る
    const flipped: LyricSheet = { title: 'w', lines: [{ ...sliced.lines[0], polarity: 'paper' }] };
    const { duration: _duration, ...noDuration } = prelude;

    expect(() =>
      withPrelude(flipped, { ...noDuration, time: 8.5, polarity: 'ink' }),
    ).toThrow(/polarity/u);
  });

  it('行の無いシートにも挿せる', () => {
    // 歌詞が 1 行も残らない区間（開発中に起こりうる）でも、序だけは出る
    const empty = { title: 'w', lines: [] };

    expect(withPrelude(empty, prelude).lines).toStrictEqual([prelude]);
  });
});
