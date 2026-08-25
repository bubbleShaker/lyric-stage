/**
 * 日本語フォントを「この作品に出る文字だけ」に絞って woff2 に落とす（M8-2a / Issue #39）。
 *
 *   node tools/subset-font.mjs <input.ttf> <出力名>
 *   例: node tools/subset-font.mjs .fonts-src/ZenKakuGothicNew-Black.ttf zen-kaku-gothic-new-black
 *
 * 日本語フォントは素で 3〜6 MB ある。Google Fonts の CDN を直に読めば向こうが
 * 自動でサブセットしてくれるが、**公開ページが外部への接続に依存する**ので、
 * ここで自前に落としてから public/fonts/ に置く（音源と同じ扱い）。
 *
 * 出力は 2 つ:
 *   public/fonts/<出力名>.woff2       … 実際に読ませるフォント
 *   public/fonts/<出力名>.charset.txt … **出来上がった woff2 が実際に持っている**文字の一覧
 *
 * charset.txt は**検査のために吐く**。歌詞シートを書き換えてサブセットを作り直すのを
 * 忘れると、その文字だけが公開ページで別の書体に化ける。
 * src/font-subset.test.ts がシートの文字とこの一覧を突き合わせて落とす。
 *
 * **charset.txt はサブセットの後に、出来上がった woff2 の cmap から読み戻して書く**
 * （レビュー指摘 🔴）。「入れたかった文字」を先に書くと穴が 2 つ空く:
 *   - pyftsubset が落ちても charset.txt だけが新しくなり、woff2 は古いまま残る。
 *     この状態で検査は全部緑になる（守るはずだった壊れ方をそのまま通す）
 *   - pyftsubset は**元フォントに無い文字を黙って捨てる**。--text-file に載せても
 *     cmap には入らないので、「入れたかった一覧」は嘘をつく
 * 読み戻せば charset.txt は「フォントが実際に持っている文字」という不変条件になり、
 * どちらの穴も同時に塞がる。
 *
 * 事前に fonttools が要る（この環境では pipx で入れてある）:
 *   pipx install "fonttools[woff]"
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const LYRICS_DIR = 'public/lyrics';
const OUTPUT_DIR = 'public/fonts';

/**
 * 歌詞に出ない、けれど入れておく文字。
 *
 * - ASCII の可読部は全部（英字の行があり、記号は歌詞を書き換えたときに出やすい）
 * - 約物と全角空白は、歌詞の書き換えで真っ先に増える所
 *
 * 数十文字ぶんの字形は woff2 で 1 KB にも満たないので、けちらず入れておく。
 * ここを削って字を欠けさせる方がずっと高くつく。
 */
const EXTRA_CHARS = [
  ...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCodePoint(0x20 + i)),
  ...'　、。，．・：；？！ー〜…「」『』（）',
].join('');

/**
 * 歌詞シート 1 枚に出る文字をすべて集める。
 *
 * 行の text・語句（parts）の text・添える英字（sub / M8-3c）を見る。
 * **シートに描かれる項目が増えたら、ここにも足すこと** — このファイルは .mjs なので
 * TS の domain（`partsOf`）を読めず、シートの構造を読み直している。取り残されると、
 * 新しい項目に書いた文字だけがサブセットから漏れる。
 *
 * 普通は `src/font-subset.test.ts` が domain 経由で見ているので、漏れればそちらが落ちる。
 * **ただし `sub`（英字）はこの網に掛からない**（レビュー指摘 🟡）— `sub` は ASCII に
 * 限る約束（`src/lyric-sheets.test.ts`）で、ASCII の可読部は下の EXTRA_CHARS が
 * 無条件に入れているため、ここが `sub` を拾い忘れても突き合わせは永久に緑になる。
 * 約束を緩める（日本語や記号を許す）なら、その時に網も戻ってくる。
 */
function charsOfSheet(sheet) {
  const texts = [sheet.title ?? ''];
  for (const line of sheet.lines ?? []) {
    texts.push(line.text ?? '', line.sub ?? '');
    for (const part of line.parts ?? []) texts.push(part.text ?? '', part.sub ?? '');
  }
  return texts.join('');
}

/**
 * public/lyrics/ の**全シート**から文字を集める。
 *
 * WORK_WINDOW（今はラスサビ 3 行）で絞らないのは、区間を広げた瞬間に
 * 字が欠けるのを避けるため。Issue #37 で 7 行へ戻すときにサブセットを
 * 作り直す必要が無くなる。?lyrics=sample の開発用シートも同じ理由で入れる。
 * 全 51 行でもユニークな文字は 300 程度で、woff2 なら数十 KB に収まる。
 */
function collectChars() {
  const sheets = readdirSync(LYRICS_DIR).filter((name) => name.endsWith('.json'));
  const source = sheets
    .map((name) => charsOfSheet(JSON.parse(readFileSync(join(LYRICS_DIR, name), 'utf8'))))
    .join('');

  // コードポイント順に並べた重複なしの一覧。並べておくと差分が読める
  return [...new Set([...source, ...EXTRA_CHARS])]
    .filter((char) => !/\s/.test(char) || char === ' ' || char === '　')
    .sort((a, b) => a.codePointAt(0) - b.codePointAt(0))
    .join('');
}

/** 出来上がった woff2 が実際に持っている文字を cmap から読み戻す */
function charsInFont(fontPath) {
  // ttx は fonttools 同梱のダンプ道具（pyftsubset と同じ pipx の venv に入る）。
  // -t cmap で cmap テーブルだけを XML にして標準出力へ出す。
  // 追加の依存を増やさずにフォントの中身を確かめられる
  const xml = execFileSync('ttx', ['-q', '-t', 'cmap', '-o', '-', fontPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  // cmap は複数のサブテーブル（プラットフォーム別）を持ち、同じ文字が何度も出る。
  //
  // **code の値を Unicode として読めるのは、サブテーブルがすべて Unicode だから。**
  // pyftsubset は既定で legacy / symbol の cmap を落とすので今の出力は
  // platformID 0/3 と 3/1 の 2 枚だけ（実測）。--legacy-cmap や --symbol-cmap を
  // 足すと MacRoman のバイト値が Unicode として読まれ、**持っていない文字を
  // 持っていると主張する** charset.txt ができるので、その時はここも直すこと
  const codes = [...xml.matchAll(/code="0x([0-9a-fA-F]+)"/g)].map((m) => parseInt(m[1], 16));

  return [...new Set(codes)]
    .sort((a, b) => a - b)
    .map((code) => String.fromCodePoint(code))
    .join('');
}

const [input, outputName] = process.argv.slice(2);
if (input === undefined || outputName === undefined) {
  console.error('usage: node tools/subset-font.mjs <input.ttf> <出力名>');
  process.exit(1);
}

// 出力名はそのままパスに繋ぐので、上の階層へ抜ける綴りを弾く。
// execFileSync は shell を通さないのでコマンドの注入は起きないが、
// public/fonts の外へ書けてしまうのは道具として行儀が悪い
if (!/^[a-z0-9-]+$/.test(outputName)) {
  console.error(`出力名は英小文字・数字・ハイフンだけにすること: ${outputName}`);
  process.exit(1);
}

mkdirSync(OUTPUT_DIR, { recursive: true });

const outputPath = join(OUTPUT_DIR, `${outputName}.woff2`);
const charsetPath = join(OUTPUT_DIR, `${outputName}.charset.txt`);

// pyftsubset へ渡す「入れたい文字」。charset.txt とは別のファイルに書く。
// **この一覧を charset.txt にしてはいけない**（冒頭の注記を見よ）。
//
// 置き場所は public/ の外。finally で消しているが、Ctrl-C で残ると
// 次の vite build が dist/fonts/ へ運んで公開してしまう
const requestPath = join(tmpdir(), `lyric-stage-${outputName}.charset.txt`);
const requested = collectChars();
writeFileSync(requestPath, requested, 'utf8');

try {
  execFileSync(
    'pyftsubset',
    [
      input,
      `--text-file=${requestPath}`,
      `--output-file=${outputPath}`,
      '--flavor=woff2',
      // 縦書きの演出（effects.ts の vertical）で字形が要る。vert / vrt2 を落とすと
      // 句読点や長音が横組みのままの向きで出る。既定の一覧には入っていないので足す。
      // `+=` にするのは、`=` だと既定の集合を丸ごと**置き換えて** rclt / curs などを
      // 落としてしまうため（今の書体では失うものが無いが、差し替えたときに効く）
      '--layout-features+=vert,vrt2,vkrn,vpal,vhal,palt',
      // 足りない文字を「見えない空白」ではなく四角で出させる。ただし
      // **この書体には効かない** — Zen Kaku Gothic New の .notdef は輪郭を持たない。
      // そもそもブラウザは字が無いと .notdef を描く前に font-family の次の候補へ
      // 1 文字ずつ落ちるので、**漏れは目では気付けない**（別の書体でそれらしく出る）。
      // 頼れるのは src/font-subset.test.ts だけ。フラグは別の書体に替えたときの保険
      '--notdef-outline',
    ],
    { stdio: 'inherit' },
  );
} finally {
  rmSync(requestPath, { force: true });
}

// ここまで来た＝サブセットが成功した。**出来上がったフォントから**一覧を書き戻す
const charset = charsInFont(outputPath);
writeFileSync(charsetPath, charset, 'utf8');

const dropped = [...requested].filter((char) => !charset.includes(char));
if (dropped.length > 0) {
  // 元フォントが持っていない文字。黙って捨てられると公開ページで化けるので名指しする
  console.warn(`元のフォントに無かった文字（${dropped.length} 字）: ${dropped.join('')}`);
}

const size = readFileSync(outputPath).length;
console.log(
  `${basename(outputPath)}: ${charset.length} 文字 / ${(size / 1024).toFixed(1)} KB\n` +
    `  charset: ${charsetPath}`,
);
