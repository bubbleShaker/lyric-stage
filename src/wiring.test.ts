import { describe, expect, it } from 'vitest';
// Vite の ?raw で組み立ての側をそのまま文字列として読む
// （font-subset.test.ts が index.html を読むのと同じ手）
import mainTs from './main.ts?raw';
import lyricStageTs from './stage/lyric-stage.ts?raw';
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
  // （M8-3a で「作品のどこかに図形が置かれている」を検査にしたのと同じ穴）。
  //
  // **探すのは行頭の呼び出しに限る**（レビュー指摘 🟢）。剥がす側だけを頼りにすると、
  // 行末コメント（`const x = f(); // mountScreenDecor(...) は M8-4 で戻す`）への退避が
  // すり抜ける。剥がす側を強めて URL の // まで巻き込むより、探す側を狭める方が確実
  // — 呼び出しはどちらのページでも文の頭にある
  //
  // **返り値を受ける形も許す**（M8-4）。光の膜を敷く先としてレイヤーを掴むように
  // なったので、`const screenDecor = ...` の形が本番の書き方になった
  const calls = /^[^\S\n]*(const \w+ = )?mountScreenDecor\(/m;

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

describe('ビート同期の衝撃（M8-4）', () => {
  // 光の膜を敷くのも、毎フレームの書き込み口を作るのもこの 1 行。落としても
  // 型検査も他の検査も緑のまま、**画面が拍で叩かれなくなるだけ**
  // （M8-3b の mountScreenDecor と同じ穴・同じ手）
  const mounts = /^[^\S\n]*(const \w+ = )?mountBeatImpact\(/m;

  it('本編（main.ts）が組み立てている', () => {
    expect(withoutComments(mainTs)).toMatch(mounts);
  });

  it('演出プレビュー（effect-preview.html）も組み立てている', () => {
    // 拍で叩かれている中に語句が置かれた画を見ないと、演出の動きが
    // 足りているかを判断できない（背景・図形をこのページに出したのと同じ理由）
    expect(withoutComments(effectPreviewHtml)).toMatch(mounts);
  });

  it('毎フレーム、作品の再生位置を渡している', () => {
    // 演出の時計は音の再生位置（M8-5 の 🔴）。**GSAP 自身の時計や実時間で回すと、
    // シークや停止で拍だけが置いていかれる。**本編は player.currentTime を渡すこと
    // （プレビューは音が無いので経過時間で回す。あちらは別の判断）
    // **毎フレームであることも見る**（レビュー指摘 🟢）。呼び出しだけを探すと、
    // ticker の外へ出して 1 回だけ呼ぶ形にしても緑のまま通る
    expect(withoutComments(mainTs)).toMatch(
      /ticker\.subscribe\(\(\) => beatImpact\.render\(player\.currentTime\)\)/,
    );
  });
});

describe('語句に添えるものの取り付け（M8-3a / M8-3c）', () => {
  // `LyricStage` の DOM 配線には単体テストが無い（jsdom 未導入。PLAN の M8-1 の宿題）。
  // 図形と英字は「当て先を作って返す」形なので、**木に繋ぐ 1 行を落としても
  // 組み立ては最後まで通り、gsap も文句を言わず、画面からその要素だけが消える**。
  // 返り値だけを見る line-timeline.test.ts では届かないので、ここで組み立てを見る
  // （レビュー指摘 🟡。M8-3b の mountScreenDecor と同じ穴・同じ手）。
  const source = withoutComments(lyricStageTs);

  // **数ではなく一覧で書く**（再レビュー指摘 🟡）。`text.before(` を 2 回数える形にすると、
  // 次の添え物を足すときに数字だけ書き換える作業になり、その瞬間に
  // 「繋ぎ忘れていないか」を見る目が失われる（font-subset.test.ts で同じ形を捨てたばかり）。
  //
  // **行ごとに見るのは、箱と字に分かれた M8-3c の配線が 1 行では表せないため**
  // （再レビュー指摘 🟡）。`box.append(glyphs)` を落とすと**英字が一切出なくなるのに
  // 型検査も全テストも通る**、という穴が実際に空いていた
  const wiring: [string, RegExp][] = [
    // 当て先の親は文字（`text`）。**文字の直前**に挿すことで、シートに書いた順が
    // そのまま奥から手前の順になる（`prepend` だと逆になる。stage/lyric-stage.ts）
    ['図形を文字の直前に挿す', /^[^\S\n]*text\.before\(decor\)/m],
    ['英字の箱を文字の直前に挿す', /^[^\S\n]*text\.before\(box\)/m],
    ['英字の字を箱に入れる', /^[^\S\n]*box\.append\(glyphs\)/m],
    // クラスの取り違え（箱に SUB_TEXT_CLASS、字に SUB_CLASS）も型検査を通る。
    // 拭き取りが掛からない・位置が決まらないという形で画だけが壊れる
    ['英字の箱に箱のクラスを当てる', /box\.className = SUB_CLASS/],
    ['英字の字に字のクラスを当てる', /glyphs\.className = SUB_TEXT_CLASS/],
    // 板（M13-5）。**素の字は色を透かしてある**ので、板を木に繋ぎ忘れると
    // 語句が丸ごと消えるのに型検査も全テストも通る（英字の箱と同じ穴）
    ['板を文字の中に足す', /^[^\S\n]*char\.append\(piece\)/m],
    ['切った字にクラスを当てる（色を透かす）', /char\.classList\.add\(SLICE_TEXT_CLASS\)/],
    ['板にクラスを当てる（色を持ち直す）', /piece\.className = SLICE_CLASS/],
    // 帯に切る式。**i 枚目は上を i/n、下を (n-1-i)/n だけ削る** — 逆にすると
    // 5 枚が同じ所を写して 1 枚にしか見えない
    ['板を帯に切る', /clipPath = `inset\(\$\{\(index \* 100\) \/ count\}% 0 \$\{\(\(count - 1 - index\) \* 100\) \/ count\}% 0\)`/],
  ];

  it.each(wiring)('%s', (_label, pattern) => {
    expect(source).toMatch(pattern);
  });
});
