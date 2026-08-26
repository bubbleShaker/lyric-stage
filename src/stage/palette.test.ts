import { describe, expect, it } from 'vitest';
import { PALETTE, cssVariableName, withAlpha, type PaletteName } from './palette';
// ?raw は対象ファイルを文字列として読み込む Vite の機能（font-subset.test.ts と同じ）
import styleCss from '../style.css?raw';

/**
 * 配色が `palette.ts` と `style.css` で割れていないかを見る（M8-2 / Issue #41）。
 *
 * 色は canvas（TS）と画面（CSS）の両方から要るので、どこか 1 か所に置いても
 * もう一方には必ず「写し」が出る。**写しがある以上、いつか片方だけ直る。**
 * しかもその壊れ方は「背景の粒だけ古い色のまま」のような、画面を開いて
 * 見比べないと気付けない類のもの — 機械に見張らせるしかない。
 *
 * 見張るのは 2 つ:
 *
 * 1. 宣言が一致しているか（写しがズレていないか）
 * 2. **16 進カラーが `:root` の外に現れていないか**（そもそも写しを増やさせない）
 *
 * 2 が本題。M8-2 より前は `#05060d` が `--stage-bg` と `.transport__toggle` の
 * `color` に直書きされていて、変数が既にあるのに使われていなかった。
 * 1 だけでは、この「変数を通さずに書かれた色」を捕まえられない。
 */

/**
 * コメントを落とした `style.css`。
 *
 * **このファイルはコメントで色を名指しする書き方をする**（「地（#0a0a0c）との差が
 * 小さすぎて」のような説明が実際に入る）。素で走査すると、そういう説明を 1 行
 * 足しただけで「変数を通さない色がある」と落ちる。**説明を書くことが検査に
 * 引っかかる**のは、コメントを厚く書くこのリポジトリの流儀と正面からぶつかる。
 */
const withoutComments = styleCss.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * `:root { ... }` の中身。ここだけが色を宣言してよい場所。
 *
 * **`:root` は 1 つとは限らない前提で全部拾う**（レビュー指摘 🟡）。`@media (...) {
 * :root { ... } }` の中に書いた色が「`:root` の外」と判定されて、**色の置き場所の
 * 検査が誤検知で落ちる**のを防ぐ。
 *
 * `[^{}]*` で中身に括弧を含まない塊だけを見るので、`@media` の閉じ括弧まで
 * 飲み込むこともない（`[\s\S]*?` に `\n\}` を当てる書き方は、`@media` の中の
 * `:root` が先に来ると内側の閉じに当たらず外まで伸びていた）。
 *
 * **ただし「値が一致しているか」の方は、上書きを足すと今も落ちる。これは意図。**
 * `PALETTE` は 1 組しか持てず（起動時に読む形にしていないので、そもそも切り替えを
 * 表現できない）、CSS にだけテーマの上書きを足すと **canvas がそれを追えないまま
 * 画面と背景の配色が割れる**。テーマを入れるなら、その時に「色をどう切り替えるか」を
 * `palette.ts` の側で決め直すことになる — 検査が落ちるのはその合図。
 */
const rootBlocks = [...withoutComments.matchAll(/:root\s*\{([^{}]*)\}/g)].map(([, body]) => body);

/**
 * `style.css` に書かれた `--stage-*` の宣言（名前 → 値）。
 *
 * **`--stage-` で始まる変数はすべて色、という規約に乗っている。** 色でないもの
 * （`--stage-gap` のような寸法）を足すと「PALETTE に無い色」で落ちるので、
 * その時は接頭辞を分けること。今この規約が保つのは、色以外の変数が
 * `--font-display` / `--size-*` / `--place-*` と別の名前空間に居るから。
 */
function declaredVariables(): Map<string, string> {
  const found = new Map<string, string>();
  for (const body of rootBlocks) {
    for (const [, name, value] of body.matchAll(/(--stage-[\w-]+):\s*([^;]+);/g)) {
      found.set(name, value.trim());
    }
  }
  return found;
}

const names = Object.keys(PALETTE) as PaletteName[];

describe('配色の単一の情報源', () => {
  it('style.css に :root がある', () => {
    // 見つけられないと、下の検査が「宣言 0 件」で静かに緑になる
    // （font-subset.test.ts が @font-face の件数を先に見ているのと同じ理由）
    expect(rootBlocks.length).toBeGreaterThan(0);
  });

  it.each(names)('--stage-%s が PALETTE と同じ値を宣言している', (name) => {
    expect(declaredVariables().get(cssVariableName(name))).toBe(PALETTE[name]);
  });

  it('style.css に PALETTE に無い --stage-* の色が宣言されていない', () => {
    // 片方向だけ見ると、CSS にだけ足された色が TS から見えないまま増える。
    // **CSS 側で足した色は canvas から使えない**ので、背景と画面で配色が割れる
    const extra = [...declaredVariables().keys()].filter(
      (declared) => !names.some((name) => cssVariableName(name) === declared),
    );

    expect(extra).toStrictEqual([]);
  });

  it('16 進カラーは :root の中にしか書かれていない', () => {
    // 変数を通さずに書かれた色を止める。PALETTE を差し替えても
    // その 1 か所だけが古い色のまま残り、目で見つけるしかなくなる。
    //
    // 黒の透過（rgb(0 0 0 / 0.12)）は対象外にしてある。あれは
    // 「ガラスの厚み」を表す指定で、パレットの色ではない（下に敷いたものを
    // 透かすのが狙いなので、パレットのどの段とも対応しない）。
    // **M9-1 で白の透過から裏返した** — 透過は地との明暗が逆でないと厚みとして
    // 読めないので、あの 1 か所だけは地の明るさを直に前提にしている。
    //
    // **見ているのは 16 進の書き方だけ。** rgb() / hsl() / color-mix() で書いた
    // 色はすり抜ける。塞ぐには CSS を本当に解析するしかなく、そこまでの手間に
    // 見合わない — このファイルの色はすべて 16 進で書く、が実際の約束
    const outside = rootBlocks.reduce((css, body) => css.replace(body, ''), withoutComments);
    const hardcoded = outside.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];

    expect(hardcoded).toStrictEqual([]);
  });
});

describe('PALETTE の値', () => {
  it.each(Object.entries(PALETTE))('%s は #rrggbb の 6 桁で書かれている', (_name, color) => {
    // withAlpha は末尾に 2 桁足すだけなので、**6 桁であることが前提**。
    // 3 桁（#fff）を足すと withAlpha は '#fff80' という 5 文字を返し、
    // canvas はそれを無効な色として黙って捨てる（例外は出ない）。
    // 型（PaletteColor）が保証するのは「パレットの一員か」だけで、
    // 書式までは見ていない（レビュー指摘 🟡）
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('withAlpha', () => {
  // 期待値は色から組み立てる。値を直に書くと、調色しただけで withAlpha の
  // 検査が巻き添えで落ちる（見ているのは不透明度の付け方であって色ではない）
  it('不透明度を 2 桁足して #rrggbbaa にする', () => {
    expect(withAlpha(PALETTE.dim, 1)).toBe(`${PALETTE.dim}ff`);
    expect(withAlpha(PALETTE.dim, 0)).toBe(`${PALETTE.dim}00`);
  });

  it('1 桁になる不透明度も 2 桁で書く', () => {
    // 0.02 * 255 = 5.1 → '5'。padStart が無いと '#rrggbb5' の 8 文字になり、
    // **canvas は無効な色を黙って捨てる**（例外にならず、直前の塗り色のまま描かれる）
    expect(withAlpha(PALETTE.dim, 0.02)).toBe(`${PALETTE.dim}05`);
  });

  it('0〜1 の外は端に丸める', () => {
    // 丸めないと toString(16) が 3 桁以上になり、色として解釈できない文字列になる。
    // 呼び出し側が音量（0〜1 のはずの値）を掛け算した結果を渡すので、
    // わずかに 1 を超えることが実際にある
    expect(withAlpha(PALETTE.ink, 1.4)).toBe(`${PALETTE.ink}ff`);
    expect(withAlpha(PALETTE.ink, -0.3)).toBe(`${PALETTE.ink}00`);
  });
});
