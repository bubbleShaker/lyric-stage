// ?raw は対象ファイルを文字列として読み込む Vite の機能（palette.test.ts と同じ）
import css from '../style.css?raw';

/**
 * `style.css` の規則を選択子から引く（検査用）。
 *
 * ## なぜ検査が CSS を読むのか
 *
 * このリポジトリには「JS が進み具合や状態を書き、それが何を意味するかは CSS が決める」
 * という分担がいくつもある（M8-3a の `--decor-grow`、M8-4 の `--beat-flash`、
 * M9-3a の `data-polarity`）。**CSS 側が読み忘れると、値は毎フレーム正しく書かれて
 * いるのに画だけが静止する** — 例外も型検査の赤も出ないので、機械に見張らせるしかない。
 * 当て先そのものが要（M9-2 の `mix-blend-mode`、M8-4 の揺らす箱）という規則も同じ。
 *
 * ## なぜ括り出したか
 *
 * 同じ 3 行が decor / beat-impact / screen-decor / blend の 4 か所に複製されていた。
 * M9-2 で「引き金は数ではなく、**1 か所直すのに複数を触ることになった時**」と決めて
 * あり、M9-3a でそれが引かれた（下のコメント除去は 4 か所すべてに要る修正だった）。
 */

/**
 * コメントを落とした CSS。**走査の前に必ず落とす。**
 *
 * このリポジトリは規約の理由をコメントに長く書くので、素で走査すると
 * **選択子の手前の `[^{}]*` がコメントを丸ごと飲み込む**。飲み込んだ先の `{` は
 * 次の規則のものなので、**関係のない規則の中身が「その選択子の規則」として返る**。
 *
 * 実害が 2 度出ている:
 * - M8-2（`palette.test.ts`）: 色を名指しするコメントを 1 行足すと検査が落ちた
 * - M9-3a: `.scene` の説明が `.stage__lines` と `body` を名指ししているせいで、
 *   `blend.test.ts` の `rulesFor('stage__lines')` と、極性の検査の
 *   「body は背景を持たない」が、どちらも `.scene` の規則本体を拾っていた
 */
const source = css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * その選択子を含む規則の**中身**（宣言部分）をすべて返す。
 *
 * @param selectorPart 選択子の一部を表す正規表現の断片。クラス名を渡すときは
 *   `classRule` を使うこと（`.` の付け忘れと前方一致の両方を防げる）
 */
export function rulesMatching(selectorPart: string): string[] {
  const pattern = new RegExp(`([^{}]*${selectorPart}[^{}]*)\\{([^}]*)\\}`, 'g');

  return [...source.matchAll(pattern)].map(([, , body]) => body);
}

/**
 * クラス名を含む規則の中身。
 *
 * **`(?![\w-])` で修飾子を別物として扱う** — `.stage__decor` と
 * `.stage__decor--band` は別の規則。M9-2 のレビュー指摘 🟡 のとおり、
 * 否定側の検査（「ここには書かないこと」）では修飾子付きの名前も並べて挙げること。
 * 素の名前だけを並べると「帯にだけ効かせたい」という一番自然な誤りがすり抜ける。
 */
export function classRule(className: string): string[] {
  return rulesMatching(`\\.${className}(?![\\w-])`);
}
