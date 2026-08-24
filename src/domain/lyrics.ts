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
  /** 語句ごとの刻み。M8-5 で足した。省略時は行がそのまま 1 語句 */
  parts?: LyricPart[];
  /** 行に貼り付く図形。M8-3a で足した。刻んだ行では使わない（`LyricPart.decor` を見よ） */
  decor?: string[];
}

/**
 * 行を分けた語句 — **その行の中で、いつ・どこに・どう出るか。**
 *
 * 日本語は語の切れ目に空白が無いので、SplitText の `words` では意味のある単位に
 * 割れない（`chars` しか当てにできない）。区切りは人が決めてデータに書く。
 *
 * 語句は**行が終わるまで画面に残る**。出るたびに画が埋まっていくのが文字PV の型で、
 * 消えるのは行が変わる時にまとめて。
 */
export interface LyricPart {
  text: string;
  /**
   * 出る時刻。**行の `time` からの相対秒。**
   *
   * 絶対時刻で書くと、行の `time` を実測に差し替えた時（M6-3）に語句の刻みが
   * 全部書き直しになる。行に対する相対なら、行ごと動かしても刻みは生き残る。
   */
  at: number;
  /** 語句の演出。省略時は行の `effect` を継ぐ */
  effect?: string;
  /** 語句の構図。省略時は行の `place` を継ぐ（＝同じ場所に重なる） */
  place?: LyricPlacement;
  /**
   * 語句に貼り付く図形の名前（M8-3a）。帯・罫・枠。
   *
   * **`effect` や `place` と違い、行からは継がない**（`partsOf` を見よ）。継ぐと
   * 刻んだ行の語句すべてに同じ帯が出て画が埋まり、**図形を足した狙いと逆になる**。
   * 図形は「この語句をここに留める」ための重みなので、置く語句を選ぶ側の指定になる。
   *
   * 名前の語彙（どれが実在するか）はここでは持たない。レジストリは
   * `stage/decor.ts` にあり、綴りの間違いは `src/lyric-sheets.test.ts` が落とす。
   */
  decor?: string[];
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

/**
 * 表示側が受け取る語句。行から継いだ分まで埋まっている。
 *
 * `LyricPart` と分けているのは、**書く側の省略**（`effect` を書かなければ行に従う）と
 * **出す側の必要**（何を当てるかは必ず決まっている）が別のものだから。
 * 表示側に `?? line.effect` を書かせると、継承の規則が画面を触る所へ散る。
 */
export interface ResolvedPart {
  readonly text: string;
  readonly at: number;
  readonly effect: string | undefined;
  readonly place: LyricPlacement | undefined;
  /** 貼り付く図形の名前。**無ければ空の配列**（undefined ではない） */
  readonly decor: readonly string[];
}

/**
 * 行を語句の列として見る。
 *
 * **`parts` が無い行は「`at: 0` の 1 語句だけの行」**として扱う。こうすると
 * 表示側に「刻んである行」と「刻んでいない行」の分岐が要らなくなり、
 * 既存の 51 行と開発用シートを書き換えずに済む。
 */
export function partsOf(line: LyricLine): ResolvedPart[] {
  if (line.parts === undefined) {
    return [
      { text: line.text, at: 0, effect: line.effect, place: line.place, decor: line.decor ?? [] },
    ];
  }

  return line.parts.map((part) => ({
    text: part.text,
    at: part.at,
    effect: part.effect ?? line.effect,
    place: part.place ?? line.place,
    // **decor だけは行から継がない**（M8-3a）。effect と place は「この語句だけ
    // 変えたい」時に書く上書きだが、図形は置く語句を選ぶもの。行から配ると
    // 刻んだ行の全語句に同じ帯が出て、画を締めるどころか埋めることになる
    decor: part.decor ?? [],
  }));
}

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

  // 綴りを間違えた項目は名指しで落とす（place / parts の中と同じ番人）。
  // 黙って落とすと、`parst` と書いた行が**検証も刻みも素通りして 1 語句で出る**。
  // 画面には歌詞が出ているので、書いた本人にも原因が分からない
  rejectUnknownKeys(
    line,
    ['time', 'text', 'effect', 'duration', 'place', 'parts', 'decor'],
    `lines[${index}]`,
  );

  const { time, text, effect, duration, place, parts, decor } = line;

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
  // 必ずこの行にも足すこと（place は M8-1、parts は M8-5 で足した）
  return {
    time,
    text,
    ...(effect ? { effect } : {}),
    ...(duration ? { duration } : {}),
    ...(place !== undefined ? { place: parsePlacement(place, `lines[${index}]`) } : {}),
    ...(parts !== undefined ? { parts: parseParts(parts, `lines[${index}]`) } : {}),
    ...(decor !== undefined ? { decor: parseDecor(decor, `lines[${index}]`) } : {}),
  };
}

/** 語句の列。空でないこと・時刻が 0 以上で昇順であることまで見る */
function parseParts(value: unknown, owner: string): LyricPart[] {
  const where = `${owner}.parts`;

  if (!Array.isArray(value)) throw new LyricSheetError(`${where} が配列ではありません`);
  // 空配列を通すと「語句がある行」なのに何も出ない行になる。書き掛けとして弾く
  if (value.length === 0) throw new LyricSheetError(`${where} が空です`);

  const parts = value.map((part, order) => parsePart(part, `${where}[${order}]`));

  // 並べ替えず、順序が崩れていたら落とす。**書いた順＝出る順**でないと、
  // 語句を読み進める向きと画に出る向きがずれても JSON を見ても気付けない
  for (let i = 1; i < parts.length; i += 1) {
    if (parts[i].at < parts[i - 1].at) {
      throw new LyricSheetError(`${where}[${i}].at が前の語句より前にあります`);
    }
  }

  return parts;
}

function parsePart(value: unknown, where: string): LyricPart {
  if (!isPlainObject(value)) throw new LyricSheetError(`${where} がオブジェクトではありません`);

  rejectUnknownKeys(value, ['text', 'at', 'effect', 'place', 'decor'], where);

  const { text, at, effect, place, decor } = value;

  if (typeof text !== 'string' || text.trim() === '') {
    throw new LyricSheetError(`${where}.text が空でない文字列ではありません`);
  }
  // at は必須。省略を許すと「行の頭で出す」に落ちて、刻みを書き忘れた語句が
  // 静かに重なる。刻むために足した項目なので、書かせる
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) {
    throw new LyricSheetError(`${where}.at が 0 以上の数値ではありません`);
  }
  if (effect !== undefined && typeof effect !== 'string') {
    throw new LyricSheetError(`${where}.effect が文字列ではありません`);
  }

  return {
    text,
    at,
    ...(effect ? { effect } : {}),
    ...(place !== undefined ? { place: parsePlacement(place, where) } : {}),
    ...(decor !== undefined ? { decor: parseDecor(decor, where) } : {}),
  };
}

/**
 * 貼り付く図形の名前の列。**形だけを見る**（実在するかは `stage/decor.ts` の担当）。
 *
 * 列にしてあるのは「帯 + 罫」のように重ねられるようにするため。順序に意味は無い。
 */
function parseDecor(value: unknown, owner: string): string[] {
  const where = `${owner}.decor`;

  if (!Array.isArray(value)) throw new LyricSheetError(`${where} が配列ではありません`);
  // 空配列は「書いたのに何も指定していない」状態。省略と同じ意味にしかならないので、
  // 書き掛けとして弾く（place.nudge が空のときと同じ扱い）
  if (value.length === 0) throw new LyricSheetError(`${where} が空です`);

  const names = value.map((name, order) => {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new LyricSheetError(`${where}[${order}] が空でない文字列ではありません`);
    }
    return name;
  });

  // 同じ図形を 2 度書くと、**同じ場所にぴったり重なって 1 つにしか見えない**。
  // 画面では気付けないので入口で落とす
  const duplicated = [...new Set(names.filter((name, order) => names.indexOf(name) !== order))];
  if (duplicated.length > 0) {
    throw new LyricSheetError(`${where} に同じ名前が 2 度あります: ${duplicated.join(', ')}`);
  }

  return names;
}

/**
 * 構図の**形**だけを確かめる。名前が実在するかは stage/composition.ts の担当。
 *
 * `owner` は「どこの place か」を指す文字列（`lines[3]` / `lines[3].parts[1]`）。
 * 行と語句のどちらからも呼ばれるので、番号ではなく道筋を受け取る
 */
function parsePlacement(value: unknown, owner: string): LyricPlacement {
  const where = `${owner}.place`;

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

    // 語句の at は行の time からの相対秒なので、**頭を削った分だけ前に詰める**。
    // 詰めないと、既に歌い終えた語句まで削った秒数だけ遅れて出直す。
    // 区間の頭より前に出るはずだった語句は 0 に揃える（＝頭から出ている扱い）。
    // 語句は行が終わるまで残る積み上げなので、落とすのではなく詰めるのが正しい
    if (line.parts !== undefined) {
      const cut = trim(Math.max(line.time, workWindow.start) - line.time);
      copy.parts = line.parts.map((part) => ({ ...part, at: trim(Math.max(0, part.at - cut)) }));
    }

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
