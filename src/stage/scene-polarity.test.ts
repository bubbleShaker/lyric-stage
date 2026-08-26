import { describe, expect, it } from 'vitest';
import html from '../../index.html?raw';
import { rulesMatching } from '../test-support/css-rules';
import { POLARITY_ATTR } from './scene-polarity';

/**
 * 画を裏返す枠（M9-3a / Issue #57）の当て先を見張る。
 *
 * **見張る理由は、間違いのどれもが「何も起きない」か「静かに別物になる」形で出るから。**
 * 反転そのものは画を見れば分かるが、下の 3 つは目で気付けない:
 *
 * - 属性を CSS が読み忘れる → 極性は毎フレーム正しく書かれているのに画が動かない
 *   （M8-3a の `--decor-grow` と同じ壊れ方）
 * - `isolation` が消える → 反転していない間だけ背景と画面の図形が沈む
 * - 背景が `body` に戻る → 反転しても地の色だけが元のまま残る
 */
describe('画の明暗の切り替え', () => {
  /**
   * 素の `.scene`（極性の属性を伴わない規則）。
   *
   * `classRule` の `(?![\w-])` は属性選択子を排除しないので、`.scene[...]` まで
   * 拾ってしまう。**反転していない側に filter が書かれていないこと**を見るには、
   * 属性の付いた規則と分けて数える必要がある。
   */
  const bareScene = (): string[] => rulesMatching("\\.scene(?!\\[)(?![\\w-])");

  it('反転は極性の属性を当てにした規則が持つ', () => {
    // 属性を読む規則が無ければ、JS が毎フレーム正しく書いても画は静止したまま
    const rules = rulesMatching(`\\.scene\\[${POLARITY_ATTR}='ink'\\]`);

    expect(rules.some((body) => /filter:\s*invert\(/.test(body))).toBe(true);
  });

  it('反転していない側には filter を書かない', () => {
    // 素の .scene に filter を書くと、極性に関わらず常に裏返る。
    // **画を見れば分かる**間違いだが、`invert(0)` のような「効かない filter」を
    // 置くと、常時 3D と合成の扱いが変わったまま画は同じという形になる
    const rules = bareScene();

    expect(rules.some((body) => /filter:/.test(body))).toBe(false);
  });

  it('枠は極性に関わらずスタッキング文脈を作る', () => {
    // **isolation が消えると、反転していない間だけ壊れる。** filter が付いている
    // 側は filter 自身が文脈を作るので、ink の画を見ている限り気付けない。
    // paper に戻した時に、負の z-index の子（背景 -2・画面の図形 -1）が枠の外へ
    // 抜けて枠の背景の下に沈む ＝ 背景と分割線が両方消える
    const rules = bareScene();

    expect(rules.some((body) => /isolation:\s*isolate/.test(body))).toBe(true);
  });

  it('枠は画面いっぱいに固定されている', () => {
    // filter の有無で fixed な子孫の包含ブロックが body ⇄ 枠 と切り替わる。
    // 矩形が同じでなければ、極性を切り替えた瞬間に再生コントロールが飛ぶ
    const rules = bareScene();

    expect(rules.some((body) => /position:\s*fixed/.test(body) && /inset:\s*0/.test(body))).toBe(
      true,
    );
  });

  it('地の色は枠が持ち、body は持たない', () => {
    // **html が背景を持たないと body の背景は root へ伝播し、body 自身のものでは
    // なくなる。** その状態で反転しても地の色だけが元のまま残る。
    // 例外も検査の赤も出ないので、ここでしか捕まらない
    expect(bareScene().some((body) => /background:/.test(body))).toBe(true);
    expect(rulesMatching('(?:^|[\\s,}])body').some((body) => /background/.test(body))).toBe(false);
  });

  /**
   * `<div class="scene">` の中身（対応する閉じタグまで）。
   *
   * **`lastIndexOf('</div>')` では終端にならない**（レビュー指摘 🔴）。枠の外へ出した
   * 要素が `div` だと、その要素自身の閉じタグが終端になって**外に出したものが中に
   * 入って見える**。実際、`.transport` を外へ移す変異でこの検査は緑のままだった
   * （`canvas` / `main` / `footer` が捕まっていたのは div ではないという偶然）。
   * `.transport` は M9-1 が名指しした守りたい要素そのものなので、入れ子を数える。
   */
  function sceneContent(): string {
    const start = html.indexOf('<div class="scene"');
    expect(start).toBeGreaterThanOrEqual(0);

    let depth = 0;
    const tag = /<(\/?)div\b/g;
    tag.lastIndex = start;

    for (let match = tag.exec(html); match !== null; match = tag.exec(html)) {
      depth += match[1] === '/' ? -1 : 1;
      if (depth === 0) return html.slice(start, match.index);
    }

    throw new Error('.scene の閉じタグが見つかりません');
  }

  it.each(['class="backdrop"', 'class="stage"', 'class="transport"', 'class="credit"'])(
    '%s は枠の中に居る',
    (marker) => {
      // 枠の外に出したものは裏返らず、暗くなった地の上に取り残される。
      // **再生コントロールとクレジットも中**（M9-1 が「不透明度による減光は地の明暗に
      // 対して非対称」「透過は明暗が逆でないと厚みとして読めない」と名指しした 2 か所が、
      // 外に置くとそのまま動的に再発する）
      expect(html).toContain(marker);
      expect(sceneContent()).toContain(marker);
    },
  );

  it('極性の初期値を HTML に焼き込まない', () => {
    // **書くと、歌詞が読めなかった時にその値のまま貼り付く**（レビュー指摘 🔴）。
    // mountScenePolarity は歌詞シートが揃った後に組み立てられるので、
    // `.catch` の経路（読み込み失敗）では一度も書かれない。
    // 属性の名前も定数と突き合わせる — 定数だけ変えると HTML と CSS が静かに割れる
    expect(sceneContent()).not.toContain(POLARITY_ATTR);
  });
});
