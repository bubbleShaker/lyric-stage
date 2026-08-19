/**
 * public/ 配下のファイルへの URL を作る。
 *
 * Vite は index.html や CSS の中の絶対パスにはビルド時 base を足してくれるが、
 * JS の中に書いた文字列（fetch や new Audio の引数）には何もしない。
 * そのため '/audio/x.mp3' と書くと GitHub Pages では
 * https://user.github.io/audio/x.mp3 を見に行って 404 になる。
 * import.meta.env.BASE_URL には vite.config.ts の base が入っているので、
 * これを必ず前置する。
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL; // 例: '/lyric-stage/'（末尾は必ず / になる）
  return `${base}${path.replace(/^\/+/, '')}`;
}
