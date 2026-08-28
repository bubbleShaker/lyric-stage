import { describe, expect, it } from 'vitest';
import { parseLyricSheet, partsOf } from './domain/lyrics';
import { TEXT_CLASS } from './stage/effects';
import { SUB_CLASS } from './stage/sub-text';
// ?raw は対象ファイルを文字列として読み込む Vite の機能。fs を使わずに済むので
// Node の型定義をアプリ側の tsconfig に持ち込まなくてよい（lyric-sheets.test.ts と同じ）
import indexHtml from '../index.html?raw';
import styleCss from './style.css?raw';

/**
 * サブセット化した書体（M8-2a / Issue #39）が、作品に出る文字を実際に持っているかを見る。
 *
 * 日本語フォントは素で数 MB あるので「作品に出る文字だけ」に絞って public/fonts/ に置いた
 * （tools/subset-font.mjs）。**絞った以上、歌詞を書き換えるとサブセットは静かに古びる。**
 *
 * 足りない文字は**目では気付けない**。ブラウザは字が無いと font-family の次の候補へ
 * 1 文字ずつ落ちるので、その字だけ別の書体で「それらしく」出る（豆腐の四角にすらならない）。
 * 公開ページだけが崩れて、テストは全部緑 — 機械に見張らせるしかない類の壊れ方。
 *
 * とくに WORK_WINDOW を広げるときに踏みやすい（[Issue #37](https://github.com/bubbleShaker/lyric-stage/issues/37)
 * で 7 行へ、[Issue #69](https://github.com/bubbleShaker/lyric-stage/issues/69) で 10 行へ広げた）。
 * **区間を広げるだけなら作り直しは要らない** — 下の突き合わせは区間ではなく
 * 公開する全シートを見ているので、歌詞の字は最初から入っている。要るのは
 * **歌詞や英字を書き換えたとき**。
 *
 * charset.txt はサブセット化の副産物で、**出来上がった woff2 の cmap から読み戻したもの**。
 * woff2 をここで解くのではなく人が読める一覧と突き合わせるのは、「フォントが何を持って
 * いるか」を差分に出すため。
 */

/**
 * 検査の起点は **style.css**。ここが何を宣言しているかから全部を引く。
 *
 * ファイル名を直に import してはいけない（レビュー指摘 🟡）。書体を差し替えたとき、
 * CSS は新しい woff2 を指しているのに検査だけが古い charset.txt を見たまま緑になる
 * （消し忘れたファイルは残っているので「実在する」検査も通ってしまう）。
 *
 * **@font-face は 1 つとは限らない。** M8-2 で語句ごとに太さの差を付けるなら、その太さの
 * face が増える（レビュー指摘 🟡）。1 件目だけを見る作りだと、2 つ目の書体は charset も
 * preload も実在も検査されないまま緑になる。
 */
interface FontFaceRule {
  family: string;
  weight: string | undefined;
  /** @font-face の src に書いた woff2 のパス */
  url: string;
  /** woff2 のファイル名から拡張子を落としたもの。charset.txt を引く鍵になる */
  name: string;
}

const fontFaces: FontFaceRule[] = [...styleCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].flatMap(
  ([, body]) => {
    const url = /url\(['"]?([^'")]*\.woff2)['"]?\)/.exec(body)?.[1];
    const family = /font-family:\s*['"]?([^'";]+?)['"]?\s*;/.exec(body)?.[1];
    if (url === undefined || family === undefined) return [];

    return [
      {
        family,
        weight: /font-weight:\s*([^;]+);/.exec(body)?.[1].trim(),
        url,
        name: url.slice(url.lastIndexOf('/') + 1).replace(/\.woff2$/, ''),
      },
    ];
  },
);

// eager + ?raw で「実在するファイル」をビルド時に列挙して中身まで持ってくる。
// glob にするのはツール側（public/lyrics/*.json を全部読む）と同じ集合にするため。
// 名指しだと、シートを 1 枚足したときにサブセットを作り直し忘れても緑になる
const charsets = import.meta.glob('../public/fonts/*.charset.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const woff2Files = Object.keys(import.meta.glob('../public/fonts/*.woff2'));
const sheets = import.meta.glob('../public/lyrics/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** パスの束から、ファイル名で 1 つ引く */
function pick(files: Record<string, unknown>, name: string): string | undefined {
  const hit = Object.entries(files).find(([path]) => path.endsWith(`/${name}`));
  return hit === undefined ? undefined : (hit[1] as string);
}

/** 公開する歌詞シートに出る文字（描かれない空白を除く） */
function charsInSheets(): Set<string> {
  const chars = new Set<string>();
  for (const source of Object.values(sheets) as string[]) {
    const sheet = parseLyricSheet(JSON.parse(source));
    // 画に描かれる文字列はすべて domain（partsOf）経由で拾う。**項目が増えたら
    // ここにも足す** — 語句の英字（sub / M8-3c）はその 1 つ目で、
    // tools/subset-font.mjs 側にも同じ追加が要る（あちらは .mjs なので domain を読めない）
    const texts = [
      sheet.title,
      ...sheet.lines.flatMap((line) =>
        partsOf(line).flatMap((part) => [part.text, ...(part.sub === undefined ? [] : [part.sub])]),
      ),
    ];
    for (const char of texts.join('')) {
      // 改行・タブは字形が要らないので、ツール側も入れていない。
      // 半角空白と全角空白はグリフを持つので対象に含める
      if (/\s/.test(char) && char !== ' ' && char !== '　') continue;
      chars.add(char);
    }
  }
  return chars;
}

describe('書体のサブセット', () => {
  it('style.css が @font-face を宣言している', () => {
    // 0 件でも下の describe.each が「検査対象なし」で静かに緑になる。
    // src/stage/display-font.ts の待ちも、宣言が無ければ何も待たずに素通りするので、
    // **このモジュールが存在する理由ごと無言で消える**（レビュー指摘 🟡）
    expect(fontFaces.length).toBeGreaterThan(0);
  });

  describe.each(fontFaces)('$name', (face) => {
    it('対応する charset.txt がある', () => {
      expect(pick(charsets, `${face.name}.charset.txt`)).toBeDefined();
    });

    it('公開する歌詞シートの文字をすべて持っている', () => {
      const covered = new Set([...(pick(charsets, `${face.name}.charset.txt`) ?? '')]);
      // charset.txt を作り損ねて空になると下の突き合わせは「全部足りない」で落ちるが、
      // シートが空のときだけは素通りするので、規模も別に見ておく
      expect(covered.size).toBeGreaterThan(100);

      // WORK_WINDOW では絞らない。区間はいつでも広げられるべきもので、
      // 「今は画に出ないから無くていい」にすると広げた瞬間に崩れる。
      // sample.json（?lyrics=sample）も公開物なので一緒に見る
      const missing = [...charsInSheets()].filter((char) => !covered.has(char));

      expect(missing).toStrictEqual([]);
    });

    it('woff2 が public/ に実在する', () => {
      // 名前を間違えると 404 になり、OS 標準の書体のまま公開される
      const names = woff2Files.map((path) => path.slice(path.lastIndexOf('/') + 1));

      expect(names).toContain(`${face.name}.woff2`);
    });

    it('index.html で preload されている', () => {
      // preload と @font-face がずれると、preload は使われないまま捨てられ
      // （Chrome が警告を出すだけ）、書体は演出が始まってから読み込まれる。
      // **画面には出るので、目で見ても気付けない種類のずれ**
      const preloaded = [...indexHtml.matchAll(/<link[^>]*rel="preload"[^>]*href="([^"]*)"/g)].map(
        (m) => m[1],
      );

      expect(preloaded).toContain(face.url);
    });
  });
});

/**
 * 専用の書体（`var(--font-display)`）を実際に使っている規則。
 *
 * **コメントを落としてから走査する。** このリポジトリはコメントで変数名を名指しする
 * 流儀なので、素で当てると説明を 1 行足しただけで当て先が増えたことになる
 * （`palette.test.ts` / `decor.test.ts` が同じ手当てをしている）。
 *
 * **入れ子は扱えない**（レビュー指摘 🟡）。`@media` の中や CSS ネスト（`&`）の中で
 * この書体を使うと、セレクタとして at-rule が報告される（落ちるので気付ける）か、
 * 宣言がセレクタ側に吸われて見落とす。今の `style.css` はどちらも使っていないので
 * 予防的な注記だが、**使い始めたらこの走査を組み直すこと**。
 */
const displayFontRules = [...styleCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)\{([^}]*)\}/g)]
  .filter(([, , body]) => body.includes('var(--font-display)'))
  .map(([, selector, body]) => ({ selector: selector.trim(), body }));

describe('書体の配線', () => {
  it('@font-face の家族名が --font-display の先頭と一致している', () => {
    // 片方だけ改名しても、woff2 は実在し preload も charset も一致し、
    // display-font.ts は face を読み込んで待ちすらする（宣言された face を舐めるだけで、
    // 使われるかは見ていない）。**全部緑のまま公開ページだけ游ゴシックで出る**
    // （レビュー指摘 🟡）
    const stack = /--font-display:\s*([^;]+);/.exec(styleCss)?.[1];
    const first = /^\s*['"]?([^'",]+?)['"]?\s*(,|$)/.exec(stack ?? '')?.[1];

    expect(first).toBe(fontFaces[0]?.family);
  });

  it('書体を使う要素の太さが face の太さと一致している', () => {
    // 持っていない太さを指定すると、ブラウザが字形を機械的に太らせ／細らせて
    // （synthetic weight）画が濁る。style.css のコメントが警告している事故を
    // 機械に止めさせる。
    //
    // **書体を使う規則を全部見る**（M8-3c で英字が 2 つ目になった）。歌詞だけを
    // 見ていると、後から足した要素は font-weight を書き忘れても緑のまま
    // 既定の 400 で描かれる（この書体は 900 しか持っていないので必ず濁る）
    // 対象 0 件だと下の突き合わせは「間違いなし」で静かに緑になる。当て先の一覧を
    // 見る検査が別に落ちるとはいえ、このリポジトリの流儀に合わせて規模も見ておく
    expect(displayFontRules.length).toBeGreaterThan(0);

    const weights = fontFaces.map((face) => face.weight);
    const wrong = displayFontRules
      .map(({ selector, body }) => ({
        selector,
        weight: /font-weight:\s*([^;]+);/.exec(body)?.[1].trim(),
      }))
      .filter(({ weight }) => weight === undefined || !weights.includes(weight))
      .map(({ selector, weight }) => `${selector}: ${weight ?? '(未指定)'}`);

    expect(wrong).toStrictEqual([]);
  });

  it('書体は作品側の文字にだけ当たっている', () => {
    // --font-display を UI（:root や body、.transport）に書くと、サブセットに
    // 入れていない UI の文字（「再生」「読み込み中」）だけが下の候補に落ちて、
    // 1 つの UI に 2 つの書体が混ざる。「歌詞にだけ当てる」という設計上の約束を
    // 守るものが、書かないとコメントだけになる。
    //
    // **数ではなく当て先を見る**（M8-3c）。当初は「var(--font-display) は 1 回だけ」と
    // 数えていたが、それだと作品側に要素を足すたびに検査ごと書き換えることになり、
    // その時に「UI に広がっていないか」を見る目が失われる。当て先の一覧で書けば、
    // 足したことは差分に出るのに、UI へ漏れれば落ちる
    // 当て先はクラス名の定数から引く。直書きすると、改名したときに何が起きたのかを
    // 読み解く手間が増える（`sub-text.test.ts` は定数経由にしてある）
    expect(new Set(displayFontRules.map((rule) => rule.selector))).toStrictEqual(
      new Set([`.${TEXT_CLASS}`, `.${SUB_CLASS}`]),
    );
    // 宣言は 1 か所（:root）。増やすとどちらが効くかが並び順で決まる
    expect(styleCss.match(/--font-display:/g)).toHaveLength(1);
  });

  it('index.html のリンクが public/ を絶対パスで指していない', () => {
    // Vite が base（/lyric-stage/）を足すのは link / script / img など「取得のための属性」だけで、
    // **<a href> は書き換えない**。'/fonts/...' と書くと dev では通り、GitHub Pages でだけ
    // https://user.github.io/fonts/... を指して 404 になる（src/lib/asset.ts と同じ罠）。
    // 実際に踏んだので検査にした
    const absolute = [...indexHtml.matchAll(/<a\s[^>]*href="(\/[^"]*)"/g)].map((m) => m[1]);

    expect(absolute).toStrictEqual([]);
  });
});
