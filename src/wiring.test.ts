import { describe, expect, it } from 'vitest';
// Vite の ?raw で組み立ての側をそのまま文字列として読む
// （font-subset.test.ts が index.html を読むのと同じ手）
import mainTs from './main.ts?raw';
import effectPreviewHtml from '../effect-preview.html?raw';

/**
 * composition root の配線のうち、**落としても全テストが緑のまま画面だけが変わる**ものを見る。
 *
 * 配線そのものは DOM が要って検査できない（jsdom 未導入）ので、「呼んでいること」だけを
 * 文字列で確かめる。置き場所を `stage/` ではなくここにしたのは依存の向きのため
 * （レビュー指摘 🟡）— `main.ts` は合成する側で、`stage/` は合成される側。
 * stage のユニットテストが composition root を知ると、その向きがテストの中で逆流する。
 *
 * **走査の前にコメントを落とす**（レビュー指摘 🔴）。このリポジトリはコメントで関数名を
 * 名指しする流儀なので、素で見ると呼び出しを消してコメントに書き換えただけで緑のまま通る。
 * まさにこの検査が塞ごうとしている「説明を 1 行足しただけで緑になる」穴が、
 * 検査自身に空いていた。
 */
function withoutComments(source: string): string {
  return (
    source
      // ブロックコメント（/* */ と HTML の <!-- -->）
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      // 行コメント。URL の // を巻き込まないよう、行頭からの空白の後だけを見る
      .replace(/^[^\S\n]*\/\/.*$/gm, '')
  );
}

describe('画面に敷く図形（M8-3b）', () => {
  // この 1 行が消えても、型検査もほかの検査も全部緑のまま**画面から図形だけが消える**
  // （M8-3a で「作品のどこかに図形が置かれている」を検査にしたのと同じ穴）
  const calls = /mountScreenDecor\(/;

  it('本編（main.ts）が敷いている', () => {
    expect(withoutComments(mainTs)).toMatch(calls);
  });

  it('演出プレビュー（effect-preview.html）も敷いている', () => {
    // あちらは tsconfig の include の外なので、型検査もテストも届かない
    // （ページ自身のコメントがそう宣言している）。腐ると「密度を判断する道具」が
    // 本番と違う画を出し、構図や図形の濃さを誤って決めることになる
    expect(withoutComments(effectPreviewHtml)).toMatch(calls);
  });
});
