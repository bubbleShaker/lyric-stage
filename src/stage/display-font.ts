/**
 * CSS で宣言した書体を、演出を組み立てる前に読み終える（M8-2a / Issue #39）。
 *
 * **これが要るのは SplitText が文字の位置を測るから。** M8-5 の演出は 1 文字ずつの
 * 座標に依存していて、測った後に書体が差し替わると字幅が変わり、測った位置と実際が
 * ずれる。`font-display` をどう設定しても防げない — `block` は「読み終わるまで
 * 描かない」だけで、**レイアウトは代替の書体の寸法で確定する**ので、測定は
 * 代替の寸法で行われてしまう（レビュー指摘 🟡）。待つ以外に手が無い。
 *
 * 家族名も太さもここには書かない。`document.fonts` を舐めれば「CSS が宣言した face」が
 * そのまま取れるので、**書体を差し替えても、太さを足しても、ここは変わらない**。
 * 名前を書き写すと style.css と二重管理になり、ずれた時に黙って待たなくなる。
 */

/** FontFace のうち、ここが使う口だけ。テストから差し替えられるように細く切る */
export interface LoadableFont {
  load(): Promise<unknown>;
}

/**
 * 宣言された書体をすべて読む。**決して失敗しない。**
 *
 * 書体は作品の見た目であって本体ではないので、読めなくても歌詞と音は動かす
 * （背景の星空を try で囲っているのと同じ判断）。読み込みが返って来ないまま
 * 止まる場合に備えて上限も置く。上限を越えたら代替の書体のまま先へ進み、
 * 後から届いたぶんはブラウザが差し替える。
 */
export function loadDeclaredFonts(fonts: Iterable<LoadableFont>, timeoutMs = 3000): Promise<void> {
  const all = Promise.all([...fonts].map((font) => font.load().catch(() => undefined))).then(
    () => undefined,
  );

  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });

  // 先に揃ったら見張りを解く。ブラウザでは空振りするだけだが、
  // テストの偽タイマーでは残った予約が次の検査へ漏れる
  return Promise.race([all, limit]).finally(() => clearTimeout(timer));
}
