/**
 * id で要素を取る。無ければ即座に落として原因を分かりやすくする。
 *
 * 組み立て（composition root）でしか使わない。HTML と TypeScript は
 * 別々に編集されるので、id を書き換えたときの取りこぼしを起動時に見つける。
 */
export function requiredElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
}
