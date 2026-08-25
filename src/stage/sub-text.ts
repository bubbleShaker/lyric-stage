import gsap from 'gsap';
import type { EffectTimeline } from './effects';

/**
 * 語句に添える英字サブテキスト（M8-3c / Issue #47）。
 *
 * 語句の**上**に、小さく字間を空けて置く小見出し。文字PV の画で
 * 「日本語の語句 + 小さな英字」の組は、帯や枠と並ぶ骨格のひとつ。
 *
 * ## 図形（`decor.ts`）とは兄弟だが、レジストリを持たない
 *
 * 図形は「帯か罫か」を名前で選ぶのでレジストリが実体を持てるが、英字は語句ごとに
 * 違う文字列なので、**中身はシートが持つ**（`LyricPart.sub`）。ここが持てるのは
 * 見せ方だけ ＝ クラス 1 つと、進み具合を動かす関数 1 つ。
 *
 * ## 進み具合だけを渡し、その意味は CSS が決める
 *
 * `--sub-reveal` を 0 → 1 に動かすだけで、**それが何を意味するかは書かない**
 * （`decor.ts` と同じ分担）。今の style.css は「左から拭き取るように現れる」に
 * 割り当てているが、それは形を持っている側の決めごと。
 *
 * ## 縦組みでも英字は回さない
 *
 * 図形（`DECOR_LAYOUT_CLASS`）と違い、組み方ごとの変種を持たない。縦組みの中で
 * ラテン文字を回すと、M4-3 で決着させた話（`vertical-rl` はラテン文字を横倒しに
 * するので、**縦書きは日本語の行にだけ当てる**）を蒸し返すことになる。
 * 縦組みの語句でも英字は横組みのまま段の頭（上）に載る — 縦組みの小見出しとしては
 * これが慣例どおりの形でもある。
 */

/**
 * 英字の当て先に付けるクラス。
 *
 * 打ち間違えると `position: absolute` も書体も外れ、**英字が通常フローの箱として
 * 語句を押し下げる**（図形の `DECOR_BASE_CLASS` と同じ壊れ方）。
 * `sub-text.test.ts` が `style.css` に実在することを見張る。
 */
export const SUB_CLASS = 'stage__sub';

/**
 * 箱の中で**字そのもの**を包む要素に付けるクラス。拭き取りはこちらに掛かる。
 *
 * 分けているのは clip-path が**要素の箱で切る**ため。箱は枠（＝語句）の幅に
 * 張ってあるので、そのまま切ると**語句より長い英字のはみ出した分が永久に
 * 描かれない**。今のシートはどれも語句より短いので出ていないが、長い英字を
 * 書いた瞬間に「なぜか尻が出ない」になり、しかも **`getBoundingClientRect` は
 * クリップ後の見えを返さないので実測でも捕まらない**（レビュー指摘 🔴）。
 * 字だけを包む要素に切り替えれば、切る範囲が字の幅と一致する。
 *
 * 副産物として、**拭き取りの時間が字の上をまるごと進む**ようになった。
 * 箱で切っていた頃は、中央寄せだと字の左右にある空きを拭う時間まで含んでいて、
 * 0.38 秒と書いてあるのに実際は 150ms で描き終わっていた。
 */
export const SUB_TEXT_CLASS = 'stage__sub__text';

/**
 * 拭き取るように現れるタイムライン。
 *
 * 図形（0.34〜0.5 秒）より少し速い。英字は語句を読む前に画の隅に収まっている方が
 * 添え物らしく、遅れて出ると語句と主従が入れ替わる。
 *
 * gsap の CSSPlugin はカスタムプロパティも動かせるが、**未設定のプロパティは
 * 開始値を読めない**ので `from` ではなく `fromTo` で両端を書く（`decor.ts` と同じ）。
 *
 * 当て先は**箱**（`SUB_CLASS`）。カスタムプロパティは継承するので、拭き取りを
 * 掛けている内側の要素（`SUB_TEXT_CLASS`）にそのまま届く。
 */
export function buildSubText(
  element: HTMLElement,
  { reducedMotion = false }: BuildSubTextOptions = {},
): EffectTimeline {
  // 動きを減らす設定では、拭き取る過程を飛ばして出来上がった姿を出すだけにする。
  // **英字そのものは消さない** — #41 で粒と光を消さずに時刻を 0 に畳んだのと、
  // #43 で図形を残して伸びる動きだけを畳んだのと同じ判断
  if (reducedMotion) {
    return gsap
      .timeline()
      .set(element, { '--sub-reveal': 1 })
      .fromTo(element, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none' }, 0);
  }

  return gsap
    .timeline()
    .fromTo(element, { '--sub-reveal': 0 }, { '--sub-reveal': 1, duration: 0.38, ease: 'power3.out' });
}

export interface BuildSubTextOptions {
  /** OS の「視差効果を減らす」設定が有効か */
  readonly reducedMotion?: boolean;
}
