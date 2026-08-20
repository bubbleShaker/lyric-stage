/**
 * 曲の盛り上がりを実音から読む。
 *
 * Web Audio に触れるのはここだけ。低音域（キックとベース）のエネルギーを 0〜1 に均して返す。
 * 全帯域の音量を使うと歌とシンバルで常時飽和して、盛り上がりの差が出ない。
 *
 * 解析の対象は `<audio>` 要素。要素そのものは composition root（main.ts）が持ち、
 * 再生の制御（AudioPlayer）と解析（ここ）が別々の側面から使う。
 * AudioPlayer に解析まで持たせると「音を鳴らす」以上のことを知り始める。
 */

import type { IntensityQuery } from '../lib/intensity';

/**
 * AudioContext の作り方。
 *
 * 注入するのは `systemPixelRatio` と同じ理由。**特にここは「繋ぎ忘れると音が消える」
 * という、目で見ても分からない不変条件を抱えている**ので、偽物を差し込んで
 * 配線そのものを検査できるようにしておく価値が大きい。
 */
export type AudioContextFactory = () => AudioContext;

export const systemAudioContext: AudioContextFactory = () => new AudioContext();

/**
 * 3 つとも**メソッドではなくプロパティ**として宣言している。
 * `ticker.subscribe(loudness.sample)` のように関数だけを取り出して渡せることを
 * 契約の一部にするため（メソッド形だと this を使う実装も正当になり、
 * 取り出した瞬間に壊れる。しかも Ticker は例外を握るので気づきにくい）。
 */
export interface Loudness {
  /** 今の強さ。読むだけで状態は進まない */
  readonly level: IntensityQuery;
  /**
   * 解析を始める。**ユーザー操作（再生ボタンのクリック）から呼ぶこと。**
   * ブラウザは操作なしに音を出すことを禁じており、AudioContext も
   * suspended で作られる。2 回目以降は再開だけを試みる。
   */
  readonly start: () => void;
  /** 毎フレーム呼んで解析値を取り込む。level() はこれが進めた値を返す */
  readonly sample: () => void;
}

/**
 * 生の値のどこからどこまでを 0〜1 に伸ばすか。**曲ごとに測り直す値**なので、
 * 音源のパスや既定の歌詞シートと同じく `src/work.ts` が持つ。
 */
export interface LoudnessRange {
  /** これ以下は「静か」（0） */
  readonly quiet: number;
  /** これ以上で振り切る（1） */
  readonly loud: number;
}

/** 解析の細かさ。1024 なら 44.1kHz で 1 ビン ≒ 43Hz、低音域に 4〜5 本入る */
const FFT_SIZE = 1024;

/** ここまでを「低音域」とみなす */
const BASS_MAX_HZ = 200;

/**
 * 平滑化の係数。**アタックは速く、リリースは遅く。**
 *
 * 生の値は毎フレーム暴れるので、そのまま星に渡すと痙攣する。上がる時に速いのは
 * キックの立ち上がりを鈍らせないため、下がる時に遅いのは拍の合間に暗転しないため。
 * フレームレートに依存する（60fps 前提）が、可変レートでも破綻はしない。
 */
const ATTACK = 0.45;
const RELEASE = 0.08;

/**
 * これを下回ったら 0 に落とす。
 *
 * 指数で減衰する値は厳密には 0 にならないので、無音でも「前回と違う強さ」が
 * 何分も続く。すると背景が**止まった絵を毎フレーム描き直し続ける**ことになり、
 * M5-1 で入れた「同じ入力なら描かない」が効かなくなる。
 */
const SILENCE = 0.001;

/**
 * 低音域の平均。`getByteFrequencyData` の結果（0〜255）を 0〜1 で返す。
 *
 * ビン 1 本が受け持つ幅は sampleRate / fftSize。何 Hz までを見るかを本数に直す。
 */
export function bassLevel(bins: ArrayLike<number>, sampleRate: number, fftSize: number): number {
  const hzPerBin = sampleRate / fftSize;
  const count = Math.min(bins.length, Math.max(1, Math.round(BASS_MAX_HZ / hzPerBin)));

  let total = 0;
  for (let i = 0; i < count; i += 1) total += bins[i];

  return total / count / 255;
}

/** 生の値を「静か 0 〜 振り切り 1」へ伸ばす */
export function toIntensity(raw: number, range: LoudnessRange): number {
  const scaled = (raw - range.quiet) / (range.loud - range.quiet);
  return Math.min(1, Math.max(0, scaled));
}

/** 前の値へ寄せる。上がる時は速く、下がる時はゆっくり */
export function smoothLevel(previous: number, target: number): number {
  const coefficient = target > previous ? ATTACK : RELEASE;
  const next = previous + (target - previous) * coefficient;
  return next < SILENCE ? 0 : next;
}

export function createLoudness(
  media: HTMLMediaElement,
  createContext: AudioContextFactory,
  range: LoudnessRange,
): Loudness {
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let bins = new Uint8Array(0);
  let current = 0;
  /** 一度でも失敗したら諦める。押すたびに AudioContext を作ると数個で上限に当たる */
  let failed = false;

  const start = (): void => {
    if (context) {
      // 一時停止から戻る時のため。resume は Promise を返すが待つ必要は無い
      void context.resume();
      return;
    }
    if (failed) return;

    let created: AudioContext | null = null;
    try {
      created = createContext();

      // **投げうる操作は付け替えより前に済ませる。**
      // createMediaElementSource を呼んだ時点で音の出口が AudioContext 側へ移るので、
      // その後で失敗すると「音だけ消えて復旧できない」状態になる
      const node = created.createAnalyser();
      node.fftSize = FFT_SIZE;

      const source = created.createMediaElementSource(media);

      // **destination まで繋ぐこと。** 繋がないと音が消える
      // （解析は動くので背景は正しく反応し、原因が分かりにくい）
      source.connect(node);
      node.connect(created.destination);

      bins = new Uint8Array(node.frequencyBinCount);
      context = created;
      analyser = node;
      void created.resume();
    } catch (error) {
      // 解析は演出の足し。使えない環境でも音と歌詞と星空は動かす
      failed = true;
      void created?.close();
      console.warn('音の解析を始められませんでした。背景は音に反応しません', error);
    }
  };

  const sample = (): void => {
    if (!analyser || !context) return;

    analyser.getByteFrequencyData(bins);
    const raw = bassLevel(bins, context.sampleRate, analyser.fftSize);
    current = smoothLevel(current, toIntensity(raw, range));
  };

  return { level: () => current, start, sample };
}
