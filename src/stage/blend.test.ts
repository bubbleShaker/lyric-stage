import { describe, expect, it } from 'vitest';
// **コメントを落としてから走査する助関数**（M9-3a で `test-support/` へ括り出した）。
// ここが素の CSS を見ていた頃は、`.scene` の説明が `.stage__lines` を名指ししている
// せいで**`.scene` の規則本体を「`.stage__lines` の規則」として拾っていた**
// （選択子の手前の `[^{}]*` がコメントを飲み込む。詳しくは css-rules.ts）
import { classRule as rulesFor } from '../test-support/css-rules';

/**
 * 歌詞の層を地に刷り重ねる合成（M9-2 / Issue #55）を見張る。
 *
 * **見張る理由は、間違いが「何も起きない」形で出るから。** `mix-blend-mode` は
 * 一番近い重ね合わせ文脈の中でしか混ざらない。`.stage__lines` は `perspective`
 * （M8-5 の遠近）で既に文脈を作っている ＝ 外側との縁が切れているので、**中の要素
 * （`.stage__text` / `.stage__decor--band` など）に書いても混ざる相手が同じ箱の中に
 * しか居ない。** 例外も検査の赤も出ず、ただ乗算が効かないだけになる。
 *
 * 分離の理屈は画を見ても分からない（「効いていない」と「効いた結果ほぼ同じ」が
 * 見分けられない — 乗算は黒い文字をほとんど変えないので、なおさら）。
 * M8-4 が「揺らすのは `.stage__lines` であって構図の枠ではない」を検査に持たせたのと
 * 同じ判断で、当て先そのものを機械に見張らせる。
 */
describe('歌詞の層の合成', () => {
  /**
   * そのクラスの規則のどれかが合成の指定を持つか。
   *
   * **`multiply` に限定しない**（レビュー指摘 🟢）。落としたいのは「分離の内側に
   * 合成を書くこと」であって、書かれた合成の種類ではない — `darken` と書いても
   * 同じく効かないのに、`multiply` だけを見ていると素通りする。
   */
  function blends(className: string): boolean {
    return rulesFor(className).some((body) => /mix-blend-mode:\s*(?!normal)\S/.test(body));
  }

  it('乗算は .stage__lines に当たっている', () => {
    // 当て先ごと消えても画は出る（乗算が効かないだけ）ので、まず在ることを見る
    expect(blends('stage__lines')).toBe(true);
  });

  // **修飾子付きのクラスも並べる**（レビュー指摘 🟡）。rulesFor の `(?![\w-])` は
  // `.stage__decor` と `.stage__decor--band` を別物として扱うので、
  // 素の名前だけを並べると **「帯にだけ効かせたい」という一番自然な誤り**
  // （コメント自身が「効くのは帯」と書いている以上、次に触る人はまず帯を疑う）が
  // すり抜ける。実際、この列挙に足すまでは帯へ書いても検査が通った
  it.each([
    'stage__text',
    'stage__text--vertical',
    'stage__frame',
    'stage__decor',
    'stage__decor--band',
    'stage__decor--rule',
    'stage__decor--box',
    'stage__sub',
    'stage__sub__text',
  ])('乗算を %s に当てない（分離の内側なので効かない）', (className) => {
    // 「文字に効かせたいのだから文字に書く」は自然な直感で、しかも
    // **書いても何も起こらない**（例外も出ない）。ここで落とす
    expect(blends(className)).toBe(false);
  });

  it('分離を作っている perspective が .stage__lines に残っている', () => {
    // **分離を作っているのは perspective であって transform ではない**
    // （レビュー指摘 🔴。当初はここで transform を見ていたが、`transform: none` は
    // スタッキング文脈を作らないのに `/transform:/` は素通りさせてしまう ＝
    // 「分離が壊れる」まさにその変異を見逃す検査だった）。
    //
    // ここから perspective が消えると分離の境目が動き、拍の膜や画面に敷く図形と
    // 混ざる範囲そのものが変わる。none も落とすため値まで見る
    const rules = rulesFor('stage__lines');

    expect(rules.some((body) => /perspective:\s*(?!none)\S/.test(body))).toBe(true);
  });
});
