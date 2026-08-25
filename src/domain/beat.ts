/**
 * 拍の格子（M8-4 / Issue #49）— 「いつ叩くか」を時刻から決める純粋関数。
 *
 * ## なぜ実音の立ち上がりではなく格子か
 *
 * 盛り上がりの強さ（`stage/loudness.ts`）は平滑化（アタック 0.45 / リリース 0.08）を
 * 通った連続値なので、**立ち上がりが鈍っていて拍の頭を取れない**。平滑化を外せば
 * 今度は背景（`GrainField`）が痙攣する（M5-2 で平滑化を入れた理由そのもの）。
 *
 * そこで **格子が「いつ」を、実音が「どれだけ」を決める**。格子はこの曲について
 * 既に測ってある（79.85 BPM / 1 小節 3.0055 秒。`work.ts` の `BEAT_GRID`）し、
 * 純粋関数なので**音の無い `effect-preview.html` でもそのまま動く**。
 *
 * ## 明滅の安全はここが仕組みで守る
 *
 * 光過敏性発作の誘因を避けるため、WCAG 2.3.1 は 3Hz を超える明滅を禁じている。
 * 79.85 BPM は 1.33Hz（拍）/ 2.66Hz（8 分）と閾値のすぐ下で、**刻みを細かくすると
 * 踏み越える**。`createFlashPulse` は下限（`MIN_FLASH_INTERVAL`）を下回る刻みを
 * 受け付けず、下回る場合は間隔を倍にして粗い刻みへ落とす。値をどこかに書いて
 * 守るのではなく、**細かく刻めない形**にしてある。
 *
 * **下限が掛かるのは光るものだけ。** 揺れは 8 分（2.66Hz）で刻む — あれは明滅では
 * ないので発作の閾値の話に乗らず、前庭系への配慮は `prefers-reduced-motion`
 * （振れ幅ごと 0 に畳む）が受け持つ。両方に同じ下限を掛けると、光の都合で
 * 動きまで粗くなる。**光る側が `FlashPulse` という別の型を要求する**ので、
 * 素の `BeatPulse` を光らせる配線は型検査が止める。
 */

/**
 * 拍の並び。**曲固有の実測値**なので、この型の値は `work.ts` が持つ
 * （`LOUDNESS_RANGE` と同じ立場）。
 */
export interface BeatGrid {
  /** 1 分あたりの拍数 */
  readonly bpm: number;
  /**
   * 拍の頭が来る時刻（秒）。ここから 1 拍ごとに拍が並ぶ。
   *
   * どの拍を書いてもよい（1 拍ずれても格子そのものは同じ）。**どの時間軸の
   * 秒数かに注意** — 曲の先頭起点で書いた格子を、区間で切り出した後の
   * 時間軸で使うときは `shiftBeatGrid` で起点を付け替える。
   */
  readonly origin: number;
}

/**
 * **光るもの**を叩く間隔の下限（秒）。0.4 秒 = 2.5Hz で、WCAG 2.3.1 の 3Hz に
 * 余裕を持たせてある。
 *
 * **これは「守るべき値」ではなく「越えられない壁」**。`createFlashPulse` がこれを
 * 下回る刻みを返さないので、BPM を上げても分割を細かくしても越えられない。
 */
export const MIN_FLASH_INTERVAL = 0.4;

/** 1 拍の長さ（秒） */
export function secondsPerBeat(grid: BeatGrid): number {
  return 60 / grid.bpm;
}

/**
 * 拍を `division` 分割した間隔（秒）。
 *
 * @param division 1 なら拍ごと、2 なら 8 分ごと。1 以上の有限な数
 */
export function pulseInterval(grid: BeatGrid, division: number): number {
  if (!Number.isFinite(grid.bpm) || grid.bpm <= 0) {
    throw new RangeError(`BPM は正の有限な数でなければなりません: ${grid.bpm}`);
  }
  if (!Number.isFinite(division) || division < 1) {
    throw new RangeError(`分割は 1 以上の有限な数でなければなりません: ${division}`);
  }

  const interval = secondsPerBeat(grid) / division;

  // **0 になりうる**（レビュー指摘 🟡）。bpm と division が両方とも極端に大きいと
  // 非正規化数の下方あふれで 0 に潰れる（60 / 1e308 / 1e308 === 0）。ここを通すと
  // flashInterval の「下限を上回るまで倍にする」が 0 を倍にし続けて**タブが固まる**。
  // 有限性だけを見ていては届かないので、結果そのものを見る
  if (interval <= 0) {
    throw new RangeError(`刻みが短すぎて表せません: bpm ${grid.bpm} / 分割 ${division}`);
  }

  return interval;
}

/**
 * 光るものを叩く間隔。`MIN_FLASH_INTERVAL` を下回らない。
 *
 * 下回るときは**間隔を倍にして粗い刻みへ落とす**。倍にする（＝ 1 つ飛ばしにする）
 * ので、落ちた後の拍も元の格子の上に載ったまま — 音楽から外れた中途半端な周期に
 * ならない。間隔そのものを下限へ丸める形だと、拍の格子から滑って曲とずれていく。
 */
export function flashInterval(grid: BeatGrid, division: number): number {
  let interval = pulseInterval(grid, division);
  // 下限を上回るまで倍にする。**pulseInterval が正の有限値だけを返すので必ず止まる**
  // （0 が通ると倍にし続けて止まらない。だからあちらは結果そのものを見ている）
  while (interval < MIN_FLASH_INTERVAL) interval *= 2;

  return interval;
}

/**
 * 叩き方。`createBeatPulse` で組み立て、`pulseAt` で読む。
 *
 * **光らせてよいとは限らない。** 明滅に使う値は `FlashPulse` の方（下限を通した印を
 * 持つ）で、光る側はそちらしか受け取らない。
 */
export interface BeatPulse {
  /** 拍の頭が来る時刻（秒） */
  readonly origin: number;
  /** 叩く間隔（秒） */
  readonly interval: number;
  /**
   * 叩いてから静まるまでの長さ。**間隔に対する割合**（0 より大きく 1 以下）。
   *
   * 秒で持つと、上の安全装置が間隔を倍にしたときに余韻だけが元の長さのまま残り、
   * 「叩いた後にずっと静か」な間延びした画になる。割合なら刻みに追従する。
   */
  readonly decay: number;
}

export interface BeatPulseOptions {
  /** 1 なら拍ごと、2 なら 8 分ごと */
  readonly division: number;
  /** 余韻の長さ（間隔に対する割合） */
  readonly decay: number;
}

export function createBeatPulse(grid: BeatGrid, { division, decay }: BeatPulseOptions): BeatPulse {
  return { origin: grid.origin, interval: pulseInterval(grid, division), decay: validDecay(decay) };
}

/**
 * 下限を通した印。**この宣言の外からは書けない。**
 *
 * `unique symbol` はこのモジュールの中でしか参照できないので、`FlashPulse` の形を
 * 手で書き写して作ることができない。**素の真偽値では印にならない**
 * （レビュー指摘 🔴）— TypeScript は構造的部分型なので、`safeToFlash: true` と
 * 書いたオブジェクトリテラルがそのまま `FlashPulse` として通り、
 * `{ interval: 0.05 }`（20Hz）を光る側へ渡す配線が無警告でコンパイルできてしまう。
 * 安全の柱が「値ではなく型で守る」である以上、ここは本当に偽造できない形にする。
 */
declare const flashSafe: unique symbol;

/**
 * 明滅に使ってよい叩き方。**`createFlashPulse` からしか作れない。**
 *
 * 光らせる関数がこの型を要求することで、**下限を通していない `BeatPulse` を
 * 光らせる配線をコンパイルで止める**（揺れ用の 8 分の刻みを、うっかり
 * フラッシュへ配線してしまう事故が実際に起こりうる形をしている）。
 */
export interface FlashPulse extends BeatPulse {
  readonly [flashSafe]: true;
}

/**
 * 光るものの叩き方。間隔は必ず `MIN_FLASH_INTERVAL` 以上になる
 * （細かく書いても粗い刻みへ落ちるだけで、越えられない）。
 */
export function createFlashPulse(grid: BeatGrid, { division, decay }: BeatPulseOptions): FlashPulse {
  // 印を打てるのはここだけ（`flashSafe` は宣言だけで値を持たないので `as` で被せる）。
  // **下限を通した後にしか打たない**という約束が、この 1 か所に閉じている
  return {
    origin: grid.origin,
    interval: flashInterval(grid, division),
    decay: validDecay(decay),
  } as FlashPulse;
}

function validDecay(decay: number): number {
  if (!Number.isFinite(decay) || decay <= 0 || decay > 1) {
    throw new RangeError(`余韻は 0 より大きく 1 以下の割合でなければなりません: ${decay}`);
  }

  return decay;
}

/**
 * その時刻の衝撃の強さ（0〜1）。拍の頭で 1、余韻の終わりで 0。
 *
 * 落ち方を二乗にしているのは、叩かれた直後だけが強く、あとは素早く引くため。
 * 直線で落とすと「明るさが往復している」だけに見えて、叩かれた感じが出ない。
 *
 * **負の時刻でも正しく回る。** `WindowedPlayback.currentTime` は区間の手前で
 * 実際に負を返す（助走の 1 小節ぶん）ので、そこも拍が刻まれる方が画として正しい
 * （`grainSetIndex` は負を 0 に畳んでいるが、あちらは「歌の前はちらつかない方が
 * 正しい」という別の判断）。
 */
export function pulseAt(pulse: BeatPulse, time: number): number {
  const phase = positiveMod(time - pulse.origin, pulse.interval);
  const progress = phase / (pulse.interval * pulse.decay);

  if (progress >= 1) return 0;

  return (1 - progress) ** 2;
}

/**
 * その時刻が何回目の打拍にあたるか。起点より前は負になる。
 *
 * 叩くたびに揺れる向きを変えるために使う（`stage/beat-impact.ts`）。
 * 打拍そのものの強さは `pulseAt` が持つので、こちらは「何回目か」だけを答える。
 */
export function pulseIndexAt(pulse: BeatPulse, time: number): number {
  return Math.floor((time - pulse.origin) / pulse.interval);
}

/**
 * 格子の起点を別の時間軸へ付け替える。
 *
 * 曲の先頭起点で測った格子を、区間で切り出した後の時間軸（`WORK_WINDOW.start` が
 * 0 になる）で使うためのもの。`sliceSheet` が歌詞の `time` に対して行うのと
 * 同じ付け替えを、格子に対して行う。`WHOLE_SONG`（start 0）なら素通し。
 */
export function shiftBeatGrid(grid: BeatGrid, seconds: number): BeatGrid {
  return { bpm: grid.bpm, origin: grid.origin - seconds };
}

/** 剰余を必ず 0 以上で返す。JS の % は左辺の符号を引き継ぐ */
function positiveMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
