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

/** 盛り上がりの強さを尋ねる関数。0（静か）〜1（振り切り） */
export type IntensityQuery = () => number;

/** 常に静かと答える。解析を挿さない場所のため */
export const silentIntensity: IntensityQuery = () => 0;

/**
 * AudioContext の作り方。
 *
 * 注入するのは `systemPixelRatio` と同じ理由。**特にここは「繋ぎ忘れると音が消える」
 * という、目で見ても分からない不変条件を抱えている**ので、偽物を差し込んで
 * 配線そのものを検査できるようにしておく価値が大きい。
 */
export type AudioContextFactory = () => AudioContext;

export const systemAudioContext: AudioContextFactory = () => new AudioContext();

export interface Loudness {
  /** 今の強さ。読むだけで状態は進まない */
  readonly level: IntensityQuery;
  /**
   * 解析を始める。**ユーザー操作（再生ボタンのクリック）から呼ぶこと。**
   * ブラウザは操作なしに音を出すことを禁じており、AudioContext も
   * suspended で作られる。2 回目以降は再開だけを試みる。
   */
  start(): void;
  /** 毎フレーム呼んで解析値を取り込む。level() はこれが進めた値を返す */
  sample(): void;
}

/** 解析の細かさ。1024 なら 44.1kHz で 1 ビン ≒ 43Hz、低音域に 4〜5 本入る */
const FFT_SIZE = 1024;

/** ここまでを「低音域」とみなす */
const BASS_MAX_HZ = 200;

/**
 * 生の値をどこからどこまでで 0〜1 に伸ばすか。
 *
 * **実測で決めた値。** 本編の mp3 は低音がほぼ鳴りっぱなしで、低音域の平均は
 * イントロ 0.73 / A メロ・サビ 0.91 / ラスサビ 0.95 と高い側に密集する（市販曲の
 * マスタリングでは普通）。0〜1 をそのまま使うと常に振り切って盛り上がりが見えないので、
 * **中央値のあたりを 0 に置いて、そこから上だけを見る**。
 * こうするとイントロは暗いまま、拍ごとのキックで脈打ち、ラスサビが一番明るくなる。
 * 曲を差し替えたらここも測り直す（開発時は window.loudness で覗ける）。
 */
const QUIET = 0.85;
const LOUD = 0.98;

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
export function toIntensity(raw: number): number {
  const scaled = (raw - QUIET) / (LOUD - QUIET);
  return Math.min(1, Math.max(0, scaled));
}

/** 前の値へ寄せる。上がる時は速く、下がる時はゆっくり */
export function smoothLevel(previous: number, target: number): number {
  const coefficient = target > previous ? ATTACK : RELEASE;
  return previous + (target - previous) * coefficient;
}

export function createLoudness(
  media: HTMLMediaElement,
  createContext: AudioContextFactory,
): Loudness {
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let bins = new Uint8Array(0);
  let current = 0;

  return {
    level: () => current,

    start(): void {
      if (context) {
        // 一時停止から戻る時のため。resume は Promise を返すが待つ必要は無い
        void context.resume();
        return;
      }

      try {
        const created = createContext();
        const source = created.createMediaElementSource(media);
        const node = created.createAnalyser();
        node.fftSize = FFT_SIZE;

        // **destination まで繋ぐこと。** createMediaElementSource に繋いだ時点で
        // 音の出口が AudioContext 側へ付け替わるので、繋がないと音が消える
        // （解析は動くので原因が分かりにくい）
        source.connect(node);
        node.connect(created.destination);

        bins = new Uint8Array(node.frequencyBinCount);
        context = created;
        analyser = node;
        void created.resume();
      } catch (error) {
        // 解析は演出の足し。使えない環境でも音と歌詞と星空は動かす
        console.warn('音の解析を始められませんでした。背景は音に反応しません', error);
      }
    },

    sample(): void {
      if (!analyser || !context) return;

      analyser.getByteFrequencyData(bins);
      const raw = bassLevel(bins, context.sampleRate, analyser.fftSize);
      current = smoothLevel(current, toIntensity(raw));
    },
  };
}
