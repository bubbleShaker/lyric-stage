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
  /** 行に添える英字。M8-3c で足した。刻んだ行では使わない（`LyricPart.sub` を見よ） */
  sub?: string;
  /** 行に一瞬だけ添える装飾。M10-1 で足した。刻んだ行では使わない（`LyricPart.spark` を見よ） */
  spark?: string;
  /**
   * 画の明暗（M9-3a）。**この行から先ずっと続く。**
   *
   * `effect` / `place` / `decor` / `sub` と決定的に違うのは、これが**行の属性ではなく
   * 状態**だということ。書いた行で切り替わり、次に書き換えられるまで戻らない。
   * 行の属性（＝その行だけ反転）にすると次の行で必ず戻るので、**行間隔 2.25 秒の
   * 明滅**になる。画として落ち着かないうえ、`MIN_POLARITY_INTERVAL` の話にも直結する。
   *
   * 読むのは `createPolarityTrack` / `polarityAt`。行が出ていない時刻（`NO_LINE`）でも
   * 極性は決まるので、`activeLineIndexAt` とは別の経路になる。
   */
  polarity?: Polarity;
}

/**
 * 画の明暗（M9-3a / Issue #57）。**名前は「地が何でできているか」。**
 *
 * `normal` / `invert` にすると、どちらが今の見えなのか名前から読めない
 * （M8-2 で色を役割名で持たせたのと同じ判断 — 配色を変えた時に名前が嘘にならない形）。
 *
 * 語彙をここが持つのは `effect` / `place` / `decor` と違う点。あちらは
 * 「どんな名前が実在するか」を `stage/` のレジストリが持ち、domain は形だけを見る。
 * 極性は**実装が 2 状態しか取りえない**（画を裏返すか否か）ので、増える余地が無い。
 */
export const POLARITIES = ['paper', 'ink'] as const;

export type Polarity = (typeof POLARITIES)[number];

/** 何も書かなければこちら。M9-1 で決めた「退色した紙に黒い文字」がこの状態 */
export const DEFAULT_POLARITY: Polarity = 'paper';

/**
 * 反転が切り替わる最短の間隔（秒）。
 *
 * **全画面の反転は相対輝度の変化が桁違い**で、WCAG 2.3.1 の general flash threshold
 * （変化 0.1 以上）を軽く超える。閾値が適用されるのは「1 秒に 3 回以上」なので、
 * 1 秒空ければ最大 1Hz に収まり、3 回に届かない。
 *
 * **`domain/beat.ts` の `MIN_FLASH_INTERVAL` とは守り方が違う。** あちらは
 * `createFlashPulse` が下限を下回る値を返さない＝**細かく刻めない形**にしてあるが、
 * 極性はデータで書くものなので、壁を置ける場所が入口（`parseLyricSheet`）しかない。
 */
export const MIN_POLARITY_INTERVAL = 1;

/** 極性が切り替わる点。**切り替わらない行はここに現れない** */
export interface PolarityChange {
  readonly time: number;
  readonly polarity: Polarity;
}

/**
 * 極性の道筋。シートから一度だけ作り、毎フレーム読む。
 *
 * 行の列をそのまま毎フレーム遡ると、極性を書いていない行が続くほど探索が伸びる
 * （`activeLineIndexAt` が二分探索にしてある理由と同じ問題を作り直すことになる）。
 * 変化点だけを抜いておけば、読む側は二分探索で済む。**`BeatPulse` を一度組み立てて
 * 毎フレーム `pulseAt` で読むのと同じ形。**
 */
export interface PolarityTrack {
  /**
   * 最初の変化点より前の極性。**「行の無い時刻」に状態を置ける唯一の場所。**
   *
   * 変化点は行に載るので、必ずどこかの行の時刻に立つ。**作品の頭には行が無い**
   * （`WORK_WINDOW` は助走を 1 小節ぶん取ってあり、`lyric-sheets.test.ts` が
   * 「いきなり歌から始まらない」を保証している）ので、`sliceSheet` が区間の外から
   * 持ち越した極性を行へ載せると、**助走のあいだだけ既定の極性で始まって
   * 最初の行で裏返る**。持ち越しはここに置く。
   */
  readonly initial: Polarity;
  /** 切り替わる点（時刻の昇順） */
  readonly changes: readonly PolarityChange[];
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
  /**
   * 語句に添える英字（M8-3c）。語句の上に小さく置く。
   *
   * **`decor` と違い、中身そのものを持つ。** 図形は「帯か罫か」を名前で選ぶので
   * レジストリが実体を持てるが、英字は語句ごとに違う文字列なので、`stage/` 側に
   * 置けるのは見せ方（大きさ・字間・伸び方）だけになる。
   *
   * **図形と同じく、行からは継がない**（`partsOf` を見よ）。継ぐと刻んだ行の
   * 全語句に同じ英字が並び、画が埋まる。
   *
   * **ここに書いた字がそのまま描かれる。** 大文字で出したければ大文字で書くこと
   * （CSS の `text-transform` は使わない）。書体のサブセットはこの文字列から
   * 作るので、CSS で字を作り替えると**検査が見ている集合と実際に描く字がずれる**。
   */
  sub?: string;
  /**
   * 語句に一瞬だけ添える装飾の名前（M10-1）。出て、消える。
   *
   * **`decor` と違い、列ではなく 1 つ。** 帯と罫は重ねられるが、一瞬の装飾を 2 つ
   * 重ねると 1 秒足らずの間に別々の動きが同時に走って、何が起きたのか読めない
   * （理由は `stage/spark.ts`）。
   *
   * **`decor` / `sub` と同じく、行からは継がない**（`partsOf` を見よ）。継ぐと
   * 刻んだ行の全語句が同時に弾けて、置く語句を選ぶという狙いと逆になる。
   *
   * 名前の語彙（どれが実在するか）はここでは持たない。レジストリは
   * `stage/spark.ts` にあり、綴りの間違いは `src/lyric-sheets.test.ts` が落とす。
   */
  spark?: string;
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
  /**
   * シートが始まる時点の極性（M9-3a）。**書くのは `sliceSheet` だけ**で、JSON には
   * 現れない（作者が書くのは行の `polarity`）。
   *
   * 区間で切り出すと、区間の外で立てた極性は行ごと落ちる。かといって生き残った
   * 最初の行へ載せ替えると、**行が始まるまでの助走のあいだだけ既定の極性になる**。
   * 状態は行より前から在りうるので、行とは別に持つ場所が要る。
   */
  polarity?: Polarity;
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
  /** 添える英字。無ければ undefined（空文字は入口で弾いてある） */
  readonly sub: string | undefined;
  /** 一瞬だけ添える装飾。無ければ undefined。**列ではなく 1 つ**（M10-1） */
  readonly spark: string | undefined;
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
      {
        text: line.text,
        at: 0,
        effect: line.effect,
        place: line.place,
        decor: line.decor ?? [],
        sub: line.sub,
        spark: line.spark,
      },
    ];
  }

  return line.parts.map((part) => ({
    text: part.text,
    at: part.at,
    effect: part.effect ?? line.effect,
    place: part.place ?? line.place,
    // **decor と sub は行から継がない**（M8-3a / M8-3c）。effect と place は
    // 「この語句だけ変えたい」時に書く上書きだが、図形と英字は置く語句を選ぶもの。
    // 行から配ると刻んだ行の全語句に同じものが出て、画を締めるどころか埋めることになる
    decor: part.decor ?? [],
    sub: part.sub,
    spark: part.spark,
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

  // **明滅の安全はここが最後の砦**（M9-3a）。行ごとの検証では届かない —
  // 極性は状態なので、速すぎるかどうかは「隣の行に何が書いてあるか」で決まる。
  // 整列の後でなければ間隔そのものが意味を持たない
  const rapid = findRapidPolarityFlip(createPolarityTrack({ title, lines: parsed }));
  if (rapid !== null) {
    throw new LyricSheetError(
      `${rapid.time} 秒の polarity の切り替えが前の切り替えから ${MIN_POLARITY_INTERVAL} 秒以内です` +
        '（全画面の反転は明滅なので、光過敏性発作を避けるため間隔を空けます）',
    );
  }

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
    ['time', 'text', 'effect', 'duration', 'place', 'parts', 'decor', 'sub', 'spark', 'polarity'],
    `lines[${index}]`,
  );

  const { time, text, effect, duration, place, parts, decor, sub, spark, polarity } = line;

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
  // 図形は行から語句へ継がない（partsOf を見よ）。刻んだ行に行の decor を書くと
  // **検証も型も検査も通るのに、画には何も出ない**。継がないと決めた以上、
  // 継がない指定を書けてしまう方を塞ぐ（`decor: []` を書き掛けとして弾くのと同じ立場）
  if (parts !== undefined && decor !== undefined) {
    throw new LyricSheetError(
      `lines[${index}] は語句に刻まれているので、decor は語句の側に書きます`,
    );
  }
  // 英字も図形と同じ扱い（M8-3c）。継がないと決めた以上、書けてしまう方を塞ぐ
  if (parts !== undefined && sub !== undefined) {
    throw new LyricSheetError(`lines[${index}] は語句に刻まれているので、sub は語句の側に書きます`);
  }
  // 一瞬の装飾も同じ（M10-1）
  if (parts !== undefined && spark !== undefined) {
    throw new LyricSheetError(
      `lines[${index}] は語句に刻まれているので、spark は語句の側に書きます`,
    );
  }
  // **語彙をここで見るのは `effect` / `place` / `decor` と違う点。** あちらは名前が
  // 実在するかを `stage/` のレジストリに任せ（綴り間違いは lyric-sheets.test.ts が落とす）、
  // domain は形だけを見る。極性は取りうる状態が 2 つしかなく増える余地が無いので、
  // 語彙ごと domain が持つ。**刻んだ行でもここに書く** — 画を裏返すのは画面ぜんぶに
  // 掛かる操作で、語句という単位に意味が無い（`parsePart` の許す項目に polarity は無い）
  if (polarity !== undefined && !isPolarity(polarity)) {
    throw new LyricSheetError(
      `lines[${index}].polarity が ${POLARITIES.join(' / ')} のどれでもありません: ${JSON.stringify(polarity)}`,
    );
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
    ...(sub !== undefined ? { sub: parseSub(sub, `lines[${index}]`) } : {}),
    ...(spark !== undefined ? { spark: parseSpark(spark, `lines[${index}]`) } : {}),
    ...(polarity !== undefined ? { polarity } : {}),
  };
}

/** 極性の名前かどうか。列を唯一の出どころにするので、名前を足せば検証も付いてくる */
function isPolarity(value: unknown): value is Polarity {
  return POLARITIES.includes(value as Polarity);
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

  rejectUnknownKeys(value, ['text', 'at', 'effect', 'place', 'decor', 'sub', 'spark'], where);

  const { text, at, effect, place, decor, sub, spark } = value;

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
    ...(sub !== undefined ? { sub: parseSub(sub, where) } : {}),
    ...(spark !== undefined ? { spark: parseSpark(spark, where) } : {}),
  };
}

/**
 * 語句に添える英字（M8-3c）。**形だけを見る**（何を書くかは作者の領分）。
 *
 * 形の決まりそのものは `parseTrimmed` が持つ（`decor` / `spark` と同じ）。
 * 英字は字間を広く空けて置くので、**前後の空白 1 つが数 px のずれになる**。
 */
function parseSub(value: unknown, owner: string): string {
  return parseTrimmed(value, `${owner}.sub`);
}

/**
 * 一瞬だけ添える装飾の名前（M10-1）。**形だけを見る**（実在するかは `stage/spark.ts`）。
 *
 * **`decor` と違い列ではない**ので、重複を落とす手当ても要らない。
 */
function parseSpark(value: unknown, owner: string): string {
  return parseTrimmed(value, `${owner}.spark`);
}

/**
 * 空でなく、前後に空白の無い文字列。
 *
 * 装飾の名前（`decor` / `spark`）と英字（`sub`）が同じ形を求める。**空白を弾く理由も
 * 同じ** — `' band '` は実在の名前と見分けが付かないのに、語彙の側では未知の名前として
 * 静かに落ちる。英字なら字間 0.42em の分だけ位置がずれる。どちらも画面では
 * 「なぜか出ない／ずれる」にしか見えず、原因に辿り着けない。
 *
 * **理由を分けて出す** — 「空でない文字列ではありません」だけだと、目に見えない
 * 空白を探す手掛かりが無い。
 */
function parseTrimmed(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LyricSheetError(`${where} が空でない文字列ではありません`);
  }
  if (value.trim() !== value) {
    throw new LyricSheetError(`${where} の前後に空白があります: 「${value}」`);
  }

  return value;
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

  const names = value.map((name, order) => parseTrimmed(name, `${where}[${order}]`));

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
 * シートから極性の道筋を作る。**行は time の昇順に並んでいること。**
 *
 * **同じ極性を続けて書いても変化点にはならない。** 「切り替えた回数」を数えるのが
 * `findRapidPolarityFlip` の役目なので、ここで実効の変化だけに絞っておかないと、
 * 画は何も変わらないのに安全の検査だけが落ちる。**始まりの極性と同じことを書いた
 * 最初の行も同じ**（`sliceSheet` が持ち越した極性を、その行がもう一度書いている形）。
 */
export function createPolarityTrack(sheet: LyricSheet): PolarityTrack {
  const initial = sheet.polarity ?? DEFAULT_POLARITY;
  const changes: PolarityChange[] = [];
  let current = initial;

  for (const line of sheet.lines) {
    if (line.polarity === undefined || line.polarity === current) continue;
    current = line.polarity;
    changes.push({ time: line.time, polarity: current });
  }

  return { initial, changes };
}

/**
 * その時刻の極性。最初の変化点より前は `track.initial`。
 *
 * **0 より前でも正しく回る。** `WindowedPlayback.currentTime` は 0 で下げ止まるので
 * 本編では起こらないが、`effect-preview.html` は自前の時計で回すし、時刻を
 * 受け取るだけの純粋関数がそこで破れるのは筋が悪い。
 */
export function polarityAt(track: PolarityTrack, time: number): Polarity {
  const { changes } = track;
  let low = 0;
  let high = changes.length - 1;
  let found = track.initial;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (changes[mid].time <= time) {
      found = changes[mid].polarity;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

/**
 * 間隔が `MIN_POLARITY_INTERVAL` に満たない切り替えを探す。無ければ null。
 *
 * **入口（`parseLyricSheet`）と作品の検査（`lyric-sheets.test.ts`）が同じこれを呼ぶ。**
 * 分けて書くと片方だけが下限を持ったまま古くなる。
 *
 * 作品の側でも見るのは、**`sliceSheet` が間隔を縮めうる**ため。区間の頭を跨いで
 * 始まっている行は時刻 0 に詰められるので、元は 1 秒離れていた切り替えが
 * 切り出した後には 0.1 秒差になりうる。生のシートを通した検証だけでは届かない。
 */
export function findRapidPolarityFlip(track: PolarityTrack): PolarityChange | null {
  const { changes } = track;

  for (let i = 1; i < changes.length; i += 1) {
    if (changes[i].time - changes[i - 1].time < MIN_POLARITY_INTERVAL) return changes[i];
  }

  return null;
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

/**
 * 行が画面に出ている長さ（秒）。**行の頭を 0 とする尺度**（M13-1 / Issue #74）。
 *
 * 終わりの時刻ではなく長さを返すのは、これを受け取る側（`buildLineTimeline`）が
 * 行の頭からの相対時間で組み立てているため。時刻で渡すと、受け取った所で必ず
 * `- line.time` を書くことになり、引き算の置き忘れが「行の中の時間だけ数十秒ずれる」
 * という形で出る。
 *
 * **`Infinity` を返しうる。** duration を持たない最終行がそれで、
 * `sliceSheet` を通した作品のシートでは起きない（区間の終わりで閉じるため）が、
 * 素のシートを直接読む所（開発用ページ）では起こる。
 */
export function lineSpanAt(lines: readonly LyricLine[], index: number): number {
  return displayEnd(lines, index) - lines[index].time;
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

  // **極性は状態なので、切り出すと区間の外で立てた分が失われる**（M9-3a）。
  // 区間の頭での実効極性を控えて、切り出したシートの始まりの極性として持たせる。
  // 放置すると「区間を広げただけで途中から画が裏返る」という、原因の分かりにくい
  // ずれ方をする（時刻の付け替えと違って、失敗しても例外も検査の赤も出ない）。
  //
  // **行へ載せ替えるのでは足りない**（レビュー指摘 🔴）。区間の頭には行が無い
  // （WORK_WINDOW は助走を 1 小節ぶん取ってある）ので、最初の行に載せると
  // **助走のあいだだけ既定の極性で始まり、歌い出しで画が裏返る**。
  // 同じ壊れ方が、規模を小さくして残るだけだった
  const carried = polarityAt(createPolarityTrack(sheet), workWindow.start);

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

  // **切り出した後の最終行には次の行が無い**（M13-1 / Issue #74）。duration を持たない
  // ままだと表示長さが `Infinity` になり、行の中で時間を測る側 — 漂い（M13-2）・退場・
  // カメラ — が尺を決められない。区間の終わりで閉じておけば、切り出したシートは
  // 「区間の外まで出ている行は無い」という形で閉じる。
  //
  // **書くのは最後の 1 行だけ。** 全行に配ると `lineSpanAt` が「次の行まで」ではなく
  // 「区間の終わりまで」を返し、どの行も同じ長さになる（duration は次の行より優先される）。
  //
  // `WHOLE_SONG`（素通し）では end が `Infinity` なのでここには入らない。
  // **元のシートと等しいものが返る**という性質はそのまま保たれる。
  //
  // **丸めて 0 以下になるほど短い行は、閉じるのではなく落とす**（レビュー指摘 🟡）。
  // `duration: 0` を書くと `activeLineIndexAt` が必ず `NO_LINE` を返す ＝ シートには
  // 載っているのに一度も画に出ない行になる。しかも 0 は `parseLyricSheet` が弾く値なので、
  // 「切り出した結果は入口を通せる形」という性質まで破れる。**duration を持つ行に対して
  // 上のループがしている手当て（`clipped <= 0` なら行ごと落とす）と同じ**。
  // 落とした結果あらわれた新しい最終行も、同じ規則で閉じる
  if (Number.isFinite(workWindow.end)) {
    while (lines.length > 0) {
      const last = lines[lines.length - 1];
      if (last.duration !== undefined) break;

      const remaining = trim(workWindow.end - workWindow.start - last.time);
      if (remaining <= 0) {
        lines.pop();
        continue;
      }

      lines[lines.length - 1] = { ...last, duration: remaining };
      break;
    }
  }

  // 既定と同じなら項目ごと持たない。**`WHOLE_SONG`（素通し）で元のシートと
  // 等しいものが返る**という性質を保つため（`sliceSheet` の説明を見よ）
  return {
    title: sheet.title,
    lines,
    ...(carried !== DEFAULT_POLARITY ? { polarity: carried } : {}),
  };
}
