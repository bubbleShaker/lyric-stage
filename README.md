# lyric-stage

曲に合わせて文字を「刻む」字幕演出ステージ。AviUtl の字幕演出を Web で再現する試み。

**公開先: https://bubbleshaker.github.io/lyric-stage/**

## 使用素材

- 楽曲: **シャイニングスター** / **音楽：魔王魂** — https://maou.audio/14_shining_star/

楽曲は [魔王魂の音楽利用のルール](https://maou.audio/rule/) に従って使用しています。
このリポジトリは音楽素材の配布を目的としたものではありません。楽曲を利用したい場合は
必ず魔王魂の公式サイトから入手してください。

### 音源の配置

魔王魂のサーバーは `curl` などスクリプトからの直接ダウンロードを拒否する設定になっているため、
mp3 は **ブラウザから手動で** 取得して配置してください。

1. https://maou.audio/14_shining_star/ を開く
2. 「シャイニングスター」の **mp3** をダウンロードする
3. ファイル名を `maou_14_shining_star.mp3` にして `public/audio/` に置く

音源が無い場合、ページは再生コントロールにエラーメッセージを出すだけで、他の動作は変わりません。

## 開発

```bash
npm install
npm run dev      # http://localhost:5173/lyric-stage/
npm run build
```

main への push で GitHub Actions が GitHub Pages へデプロイします。

## 技術

- [GSAP 3](https://gsap.com/) + SplitText — テキストを 1 文字ずつに分解して時間差アニメーション
- Vite + TypeScript

計画とマイルストーンは [PLAN.md](./PLAN.md) を参照。
