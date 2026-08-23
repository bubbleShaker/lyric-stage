import { describe, expect, it } from 'vitest';
import { PALETTE, cssVariableName, type PaletteName } from './palette';
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

/** `:root { ... }` の中身。ここだけが色を宣言してよい場所 */
const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(styleCss)?.[1];

/** `style.css` に書かれた `--stage-*` の宣言（名前 → 値） */
function declaredVariables(): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, value] of (rootBlock ?? '').matchAll(/(--stage-[\w-]+):\s*([^;]+);/g)) {
    found.set(name, value.trim());
  }
  return found;
}

const names = Object.keys(PALETTE) as PaletteName[];

describe('配色の単一の情報源', () => {
  it('style.css に :root がある', () => {
    // 見つけられないと、下の検査が「宣言 0 件」で静かに緑になる
    // （font-subset.test.ts が @font-face の件数を先に見ているのと同じ理由）
    expect(rootBlock).toBeDefined();
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
    // 白の透過（rgb(255 255 255 / 0.12)）は対象外にしてある。あれは
    // 「ガラスの厚み」を表す指定で、パレットの色ではない（下に敷いたものを
    // 透かすのが狙いなので、パレットのどの段とも対応しない）
    const outside = styleCss.replace(rootBlock ?? '', '');
    const hardcoded = outside.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];

    expect(hardcoded).toStrictEqual([]);
  });
});
