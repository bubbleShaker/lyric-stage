import type { WorkWindow } from './work-window';

/**
 * 歌詞タイムラインの型と判定ロジック。
 *
 * このファイルは DOM も GSAP も import しない。「今この秒数なら何行目を出すか」
 * という判断だけを持つので、ブラウザ無しでテストできる。
 * 演出が増えてもここは変わらない。
 */

export interface LyricLine {
  /** 曲の先頭からの秒数 */
  time: number;
  text: string;
  /** 演出プリセット名。M3 でレジストリの key になる */
  effect?: string;
  /** 表示し続ける秒数。省略時は次の行が始まるまで */
  duration?: number;
  /** 行の構図。M8-1 で足した */
  place?: LyricPlacement;
}

/**
 * 行の構図 — **画面のどこに・どのくらいの大きさで・どの傾きで置くか。**
 *
 * `effect`（動き）とは直交する軸として持たせている。同じ `fade` でも右上に
 * 置きたい行と中央に置きたい行があるので、演出名の側に畳むと
 * 7 演出 × 9 配置で組み合わせが爆発する。
 *
 * `at` と `size` の**語彙**（どんな名前が実在するか）はここでは持たない。
 * レジストリは `stage/composition.ts` にあり、綴りの間違いは
 * `src/lyric-sheets.test.ts` が名指しで落とす。`effect` と同じ分担で、
 * domain 側が CSS の語彙を知らずに済む。
 */
export interface LyricPlacement {
  /** 名前付きのアンカー（`'top-left'` など）。基準点を画面のどこに取るか */
  at: string;
  /** 文字の大きさの段階（`'sm'` など） */
  size: string;
  /**
   * アンカーからのずらし幅。**画面の幅・高さに対する割合。**
   *
   * アンカーだけだと 9 通りに整いすぎるので、文字PV らしい「絶妙にずらした」
   * 配置のための微調整。px で書かないのは文字サイズが画面幅で変わるため（M4-1）。
   */
  nudge?: { x?: number; y?: number };
  /** 傾き（度）。時計回りが正 */
  tilt?: number;
}

/**
 * ずらし幅（画面に対する割合）と傾き（度）の上限。
 *
 * 桁を間違えて `5` や `500` と書いても CSS はエラーにならず、**行が画面の外に
 * 出て何も表示されない**という原因の分かりにくい壊れ方をする。入口で塞ぐ。
 */
export const MAX_NUDGE = 0.25;
export const MAX_TILT = 30;

export interface LyricSheet {
  title: string;
  /** time の昇順に整列済み */
  lines: LyricLine[];
}

/** どの行も表示しない状態を表す番号 */
export const NO_LINE = -1;

class LyricSheetError extends Error {
  constructor(message: string) {
    super(`歌詞データが不正です: ${message}`);
    this.name = 'LyricSheetError';
  }
}

/**
 * fetch した JSON を検証して LyricSheet にする。
 * 外から来たデータは信用せず、ここで形を確かめてから内側に入れる。
 */
export function parseLyricSheet(data: unknown): LyricSheet {
  if (typeof data !== 'object' || data === null) {
    throw new LyricSheetError('オブジェクトではありません');
  }

  const source = data as Record<string, unknown>;
  const { title, lines } = source;

  if (typeof title !== 'string') throw new LyricSheetError('title が文字列ではありません');
  if (!Array.isArray(lines)) throw new LyricSheetError('lines が配列ではありません');

  const parsed = lines.map((line, index) => parseLyricLine(line, index));

  // 以降の判定は昇順であることを前提にするので、ここで必ず整列させる
  parsed.sort((a, b) => a.time - b.time);

  return { title, lines: parsed };
}

function parseLyricLine(value: unknown, index: number): LyricLine {
  if (typeof value !== 'object' || value === null) {
    throw new LyricSheetError(`lines[${index}] がオブジェクトではありません`);
  }

  const line = value as Record<string, unknown>;
  const { time, text, effect, duration, place } = line;

  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
    throw new LyricSheetError(`lines[${index}].time が 0 以上の数値ではありません`);
  }
  if (typeof text !== 'string') {
    throw new LyricSheetError(`lines[${index}].text が文字列ではありません`);
  }
  if (effect !== undefined && typeof effect !== 'string') {
    throw new LyricSheetError(`lines[${index}].effect が文字列ではありません`);
  }
  if (duration !== undefined && (typeof duration !== 'number' || !(duration > 0))) {
    throw new LyricSheetError(`lines[${index}].duration が正の数値ではありません`);
  }

  // ここで組み直すので、**知らない項目は黙って落ちる**。新しい項目を足したら
  // 必ずこの行にも足すこと（place は M8-1 で足した）
  return {
    time,
    text,
    ...(effect ? { effect } : {}),
    ...(duration ? { duration } : {}),
    ...(place !== undefined ? { place: parsePlacement(place, index) } : {}),
  };
}

/** 構図の**形**だけを確かめる。名前が実在するかは stage/composition.ts の担当 */
function parsePlacement(value: unknown, index: number): LyricPlacement {
  const where = `lines[${index}].place`;

  if (!isPlainObject(value)) throw new LyricSheetError(`${where} がオブジェクトではありません`);

  // 構図は行ごとに手で書くので、`tlit` のような綴り間違いが起きる。黙って落とすと
  // 範囲の検証も素通りして「なぜか傾かない行」になるだけなので、ここで名指しして落とす
  rejectUnknownKeys(value, ['at', 'size', 'nudge', 'tilt'], where);

  const { at, size, nudge, tilt } = value;

  if (typeof at !== 'string' || at === '') {
    throw new LyricSheetError(`${where}.at が空でない文字列ではありません`);
  }
  // at と size はどちらも必須。省略を許すと「意図してその配置を選んだ行」と
  // 「割り当てを忘れた行」が画面を見ても区別できない（M4-3 で effect に課したのと同じ理由）
  if (typeof size !== 'string' || size === '') {
    throw new LyricSheetError(`${where}.size が空でない文字列ではありません`);
  }
  if (tilt !== undefined && !isWithin(tilt, MAX_TILT)) {
    throw new LyricSheetError(`${where}.tilt が ±${MAX_TILT}（度）に収まる数値ではありません`);
  }

  return {
    at,
    size,
    ...(nudge !== undefined ? { nudge: parseNudge(nudge, where) } : {}),
    ...(tilt !== undefined ? { tilt } : {}),
  };
}

function parseNudge(value: unknown, where: string): { x?: number; y?: number } {
  if (!isPlainObject(value)) throw new LyricSheetError(`${where}.nudge がオブジェクトではありません`);

  rejectUnknownKeys(value, ['x', 'y'], `${where}.nudge`);

  const { x, y } = value;

  // 空の nudge は「書いたのに何も指定していない」状態。書き掛けを見逃さないよう弾く
  if (x === undefined && y === undefined) {
    throw new LyricSheetError(`${where}.nudge に x も y もありません`);
  }

  for (const [axis, amount] of [
    ['x', x],
    ['y', y],
  ] as const) {
    if (amount !== undefined && !isWithin(amount, MAX_NUDGE)) {
      throw new LyricSheetError(`${where}.nudge.${axis} が ±${MAX_NUDGE} に収まる数値ではありません`);
    }
  }

  return { ...(x !== undefined ? { x: x as number } : {}), ...(y !== undefined ? { y: y as number } : {}) };
}

/** 綴り間違いを黙って落とさないための番人 */
function rejectUnknownKeys(value: Record<string, unknown>, allowed: string[], where: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));

  if (unknown.length > 0) {
    throw new LyricSheetError(`${where} に知らない項目があります: ${unknown.join(', ')}`);
  }
}

/** 配列と null を弾く。typeof だけだとどちらも 'object' を名乗る */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWithin(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

/**
 * 再生位置 time のときに表示すべき行の番号を返す。該当が無ければ NO_LINE。
 *
 * - 行は time 以上、次の行の time 未満の間だけ表示する
 * - duration があればそちらが優先で、切れたら次の行が来るまで何も出さない（間）
 *
 * lines は昇順前提なので、二分探索で「time 以下の最後の行」を求めている。
 * 行数が増えても毎フレームの計算量が増えないようにするため。
 */
export function activeLineIndexAt(lines: readonly LyricLine[], time: number): number {
  let low = 0;
  let high = lines.length - 1;
  let candidate = NO_LINE;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= time) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (candidate === NO_LINE) return NO_LINE;

  const line = lines[candidate];
  if (line.duration !== undefined && time >= line.time + line.duration) {
    return NO_LINE;
  }

  return candidate;
}

/**
 * 浮動小数の埃を落とす（1ms の格子）。
 *
 * 区間の開始を引くと `179.78 - 176.77 = 3.0100000000000193` のような値になる。
 * 聴いて分かる差ではないので丸める。収録ツールの格子（10ms）より細かいので、
 * 実測して入れた値をここで粗くすることはない。
 */
function trim(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/** 行が画面に出ている区間の終わり。duration が無ければ次の行が始まるまで */
function displayEnd(lines: readonly LyricLine[], index: number): number {
  const line = lines[index];
  if (line.duration !== undefined) return line.time + line.duration;
  const next = lines[index + 1];
  // 最終行で duration も無ければ、曲が終わるまで出続ける
  return next ? next.time : Infinity;
}

/**
 * シートを作品の区間で切り出し、時刻を**区間の先頭からの秒数に付け替える**。
 *
 * 切り出した後は「区間の外」という概念そのものが消えるので、これを通した後の
 * 歌詞・再生位置・背景はすべて同じ 0 起点の時間軸で揃う。区間を知っているのは
 * この関数と、再生位置を読み替える WindowedPlayback だけになる。
 *
 * 元のシートは書き換えない（行は複製して返す）。
 */
export function sliceSheet(sheet: LyricSheet, workWindow: WorkWindow): LyricSheet {
  const lines: LyricLine[] = [];

  sheet.lines.forEach((line, index) => {
    const end = displayEnd(sheet.lines, index);
    // 表示区間が作品の区間と少しでも重なる行を残す。「time が区間内」で選ぶと、
    // 区間の頭を跨いで出続けている行が消え、開幕だけ歌詞が抜ける
    if (end <= workWindow.start || line.time >= workWindow.end) return;

    // 跨いで始まっている行は、区間の頭で出ていることにする
    const time = trim(Math.max(line.time, workWindow.start) - workWindow.start);
    // duration は組み直すので、元の値はここで一度落とす
    const { duration: _original, ...rest } = line;
    const copy: LyricLine = { ...rest, time };

    if (line.duration !== undefined) {
      // 区間の外まで出し続けても見えないので、はみ出した分は削る。
      // 併せて、頭を削られた行の残り時間もここで正しくなる
      const clipped = trim(Math.min(end, workWindow.end) - workWindow.start - time);
      // 丸めて 0 になるほど短い区間まで残っている行は、**行ごと落とす**。
      // duration だけ落とすと「次の行まで表示」に化けて、元より長く出ることになる
      if (clipped <= 0) return;
      copy.duration = clipped;
    }

    lines.push(copy);
  });

  return { title: sheet.title, lines };
}
