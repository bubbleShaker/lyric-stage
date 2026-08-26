import { describe, expect, it } from 'vitest';
// ?raw は対象ファイルを文字列として読み込む Vite の機能（palette.test.ts と同じ）
import css from '../style.css?raw';

/**
 * 歌詞の層を地に刷り重ねる合成（M9-2 / Issue #55）を見張る。
 *
 * **見張る理由は、間違いが「何も起きない」形で出るから。** `mix-blend-mode` は
 * 一番近い重ね合わせ文脈の中でしか混ざらない。`.stage__lines` は拍の揺れ（M8-4）の
 * `transform` で既に文脈を作っている ＝ 外側との縁が切れているので、**中の要素
 * （`.stage__text` / `.stage__decor`）に書いても混ざる相手が同じ箱の中にしか居ない。**
 * 例外も検査の赤も出ず、ただ乗算が効かないだけになる。
 *
 * 分離の理屈は画を見ても分からない（「効いていない」と「効いた結果ほぼ同じ」が
 * 見分けられない — 乗算は黒い文字をほとんど変えないので、なおさら）。
 * M8-4 が「揺らすのは `.stage__lines` であって構図の枠ではない」を検査に持たせたのと
 * 同じ判断で、当て先そのものを機械に見張らせる。
 */
describe('歌詞の層の合成', () => {
  /**
   * そのクラスを含む規則の中身を返す。
   *
   * **この形の助関数は decor / beat-impact / screen-decor の各テストにもある。**
   * 共通化していないのは、どれも「自分が見張りたい規則」だけを見るための 3 行で、
   * 括り出すと当て先の宣言（`?raw` の import）まで共有することになるため。
   * 5 つ目が要るようなら、その時に `test-support/` へ括り出すこと。
   */
  function rulesFor(className: string): string[] {
    const pattern = new RegExp(`([^{}]*\\.${className}(?![\\w-])[^{}]*)\\{([^}]*)\\}`, 'g');

    return [...css.matchAll(pattern)].map(([, , body]) => body);
  }

  /** そのクラスの規則のどれかが合成の指定を持つか */
  function blends(className: string): boolean {
    return rulesFor(className).some((body) => /mix-blend-mode:\s*multiply/.test(body));
  }

  it('乗算は .stage__lines に当たっている', () => {
    // 当て先ごと消えても画は出る（乗算が効かないだけ）ので、まず在ることを見る
    expect(blends('stage__lines')).toBe(true);
  });

  it.each(['stage__text', 'stage__frame', 'stage__decor', 'stage__sub'])(
    '乗算を %s に当てない（分離の内側なので効かない）',
    (className) => {
      // 「文字に効かせたいのだから文字に書く」は自然な直感で、しかも
      // **書いても何も起こらない**（例外も出ない）。ここで落とす
      expect(blends(className)).toBe(false);
    },
  );

  it('分離を作っている transform が .stage__lines に残っている', () => {
    // 乗算の当て先がここである理由は「この箱が文脈を作っているから」ではなく、
    // **「この箱**しか**外と接していないから」**。もし揺れが別の要素へ移されて
    // ここから transform が消えると、分離の境目が動いて乗算の意味も変わる
    // （拍の膜や画面に敷く図形と混ざる範囲が変わる）。
    // beat-impact.test.ts は「向きの変数を読んでいるか」を見ているが、
    // それは transform が**在る**ことまでは見ていない
    expect(rulesFor('stage__lines').some((body) => /transform:/.test(body))).toBe(true);
  });
});
