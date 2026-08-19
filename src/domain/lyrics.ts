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
}

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
  const { time, text, effect, duration } = line;

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

  return { time, text, ...(effect ? { effect } : {}), ...(duration ? { duration } : {}) };
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
