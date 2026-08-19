import { defineConfig } from 'vite';

// GitHub Pages は https://<user>.github.io/<repo>/ というサブパスで配信されるため、
// base を指定しないと /assets/... を絶対パスで探しに行って 404 になる。
export default defineConfig({
  base: '/lyric-stage/',
});
