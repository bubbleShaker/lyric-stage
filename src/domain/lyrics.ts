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

/**
 * 作品として見せる区間。曲の先頭からの秒数で表す。
 *
 * 音源は曲の全長のまま置く（加工版は素材の利用ルールで置けない）ので、
 * 「作品はここからここまで」という切り出しはデータ側が持つ。
 */
export interface WorkWindow {
  readonly start: number;
  readonly end: number;
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
export function sliceSheet(sheet: LyricSheet, window: WorkWindow): LyricSheet {
  const lines: LyricLine[] = [];

  sheet.lines.forEach((line, index) => {
    const end = displayEnd(sheet.lines, index);
    // 表示区間が作品の区間と少しでも重なる行を残す。「time が区間内」で選ぶと、
    // 区間の頭を跨いで出続けている行が消え、開幕だけ歌詞が抜ける
    if (end <= window.start || line.time >= window.end) return;

    // 跨いで始まっている行は、区間の頭で出ていることにする
    const time = trim(Math.max(line.time, window.start) - window.start);
    // duration は組み直すので、元の値はここで一度落とす
    const { duration: _original, ...rest } = line;
    const copy: LyricLine = { ...rest, time };

    if (line.duration !== undefined) {
      // 区間の外まで出し続けても見えないので、はみ出した分は削る。
      // 併せて、頭を削られた行の残り時間もここで正しくなる。
      // 丸めて 0 になるほど短い区間は間として書かない（duration: 0 は不正なデータ）
      const clipped = trim(Math.min(end, window.end) - window.start - time);
      if (clipped > 0) copy.duration = clipped;
    }

    lines.push(copy);
  });

  return { title: sheet.title, lines };
}
