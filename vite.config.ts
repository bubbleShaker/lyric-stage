import { defineConfig } from 'vitest/config';

// GitHub Pages は https://<user>.github.io/<repo>/ というサブパスで配信されるため、
// base を指定しないと /assets/... を絶対パスで探しに行って 404 になる。
export default defineConfig({
  base: '/lyric-stage/',
  test: {
    // Vitest は既定で CSS の import を空の stub に差し替える（描画しないので普通は正しい）。
    // ただし ?raw も巻き込まれて空文字になり、src/stage/composition.test.ts の
    // 「レジストリのクラス名が style.css に実在するか」が**常に緑になってしまう**。
    // 描画はしないが、中身は読めるようにしておく。
    css: true,
  },
});
