import gsap from 'gsap';
import type { EffectLayout, EffectTimeline } from './effects';

/**
 * 語句に貼り付く図形（M8-3a / Issue #43）— 帯・罫・枠。
 *
 * `effects.ts`（動き）・`composition.ts`（構図）と**直交する第 3 の軸**として持つ。
 * 演出名に畳むと 7 演出 × 3 図形で組み合わせが爆発する（M8-1 で `place` を
 * `effect` に畳まなかったのと同じ理由）。シートには名前だけを書き、
 * 「その名前が実在するか」と「どう見えるか」はこちらが持つ。
 *
 * ## 進み具合だけを渡し、その意味は CSS が決める
 *
 * ここが組むタイムラインは `--decor-grow` を 0 → 1 に動かすだけで、**それが
 * 「どちらへ伸びるか」は書かない**。伸びる向きは組み方で変わる（横組みは横へ、
 * 縦組みは下へ）ので、JS 側にも書くと**同じ判断が CSS と 2 か所**に生まれる。
 * 図形の形はもともと CSS が持っているのだから、向きもそちらに寄せた方が破れない。
 *
 * ```
 * decor.ts          「0 → 1 まで 0.42 秒で進む」
 * style.css         「band にとって進むとは scaleX のこと（縦組みなら scaleY）」
 * ```
 *
 * gsap の CSSPlugin はカスタムプロパティも動かせる。ただし**未設定のプロパティは
 * 開始値を読めない**（`getPropertyValue` が空文字を返す）ので、`from` ではなく
 * `fromTo` で両端を書く。
 */

/** 図形 1 つを組み立てる。当て先は `LyricStage` が枠の中に立てた要素 */
export type DecorBuild = (element: HTMLElement) => EffectTimeline;

export interface DecorEntry {
  /** 当てる CSS クラス。形と向きはすべてここに預けている */
  readonly className: string;
  readonly build: DecorBuild;
}

/**
 * 進み具合を 0 から 1 へ動かすだけのタイムライン。
 *
 * 図形はどれも「引かれて現れる」ので、`ease` は減速だけ（`power3.out`）。
 * 文字より先に置いて画を締める役なので、演出（0.5〜0.7 秒）より少し速い。
 */
function grow(duration: number): DecorBuild {
  return (element) =>
    gsap.timeline().fromTo(
      element,
      { '--decor-grow': 0 },
      {
        '--decor-grow': 1,
        duration,
        ease: 'power3.out',
      },
    );
}

export const decors = {
  /**
   * 帯 — 語句の後ろに敷く面。左右へ少しはみ出す。
   *
   * 文字PV の骨格そのもの。地の上に浮いている語句を画面に留める重しになる。
   */
  band: { className: 'stage__decor--band', build: grow(0.42) },

  /** 罫 — 語句の下（縦組みなら脇）を走る細い線。帯より軽く、視線の流れを作る */
  rule: { className: 'stage__decor--rule', build: grow(0.34) },

  /** 枠 — 語句を囲む輪郭線。拭き取るように現れる（意味の与え方は style.css） */
  box: { className: 'stage__decor--box', build: grow(0.5) },
} satisfies Record<string, DecorEntry>;

export type DecorName = keyof typeof decors;

/**
 * 組み方に応じて図形にも当てるクラス。
 *
 * 図形は語句の**外**（枠の中、文字の兄弟）に置くので、文字に当たる
 * `writing-mode` は届かない。伸びる向きと敷く辺を組み方に合わせるため、
 * 図形にも別のクラスで組み方を伝える。
 *
 * `effects.ts` の `LAYOUT_CLASS` と対になる。クラス名が `style.css` に実在するかは
 * `decor.test.ts` が見張る（M8-1 のレビュー指摘と同じ穴）。
 */
export const DECOR_LAYOUT_CLASS: Record<EffectLayout, string> = {
  vertical: 'stage__decor--vertical',
};

export function isDecorName(name: string): name is DecorName {
  // Object.hasOwn で自前のキーだけを見る（effects.ts の isEffectName と同じ理由）
  return Object.hasOwn(decors, name);
}

/** resolveDecor の任意指定。`resolveEffect` の ResolveOptions と揃えてある */
export interface ResolveDecorOptions {
  /** OS の「視差効果を減らす」設定が有効か */
  readonly reducedMotion?: boolean;
}

/**
 * 名前の列から、当てるクラスと組み立てる関数の列を作る。
 *
 * **知らない名前は落として警告する。** 演出（`resolveEffect`）は既定に落とすが、
 * 図形に既定は無い — 帯と枠のどちらを意図したかは名前でしか分からないので、
 * 適当な図形を出すより出さない方が誤解が無い。歌詞は図形が無くても読める。
 * 綴りの間違いそのものは `src/lyric-sheets.test.ts` が名指しで落とす。
 *
 * **動きを減らす設定では、動きだけを畳んで図形は残す。** #41 で粒と光を消さず
 * 時刻を 0 に畳んだのと同じ判断。図形は構図の一部で、消すと画が別物になる。
 */
export function resolveDecor(
  names: readonly string[],
  { reducedMotion = false }: ResolveDecorOptions = {},
): DecorEntry[] {
  return names.flatMap((name) => {
    if (!isDecorName(name)) {
      console.warn(`未知の図形名です: ${name}（この図形は出しません）`);
      return [];
    }

    const entry = decors[name];

    return [reducedMotion ? { className: entry.className, build: still } : entry];
  });
}

/**
 * 動きを減らす設定での組み立て。伸びる過程を飛ばし、出来上がった姿を出すだけ。
 *
 * `set` で終値に飛ばしてから不透明度だけを動かす。図形そのものは消さない。
 */
const still: DecorBuild = (element) =>
  gsap
    .timeline()
    .set(element, { '--decor-grow': 1 })
    .fromTo(element, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none' }, 0);
