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

## 歌詞ファイル

表示する文字は `public/lyrics/*.json` に置きます。既定では `sample.json`（動作確認用の文言）が
読み込まれ、`?lyrics=名前` を付けると切り替わります。

```
https://bubbleshaker.github.io/lyric-stage/?lyrics=sample
```

```jsonc
{
  "title": "シートの名前",
  "lines": [
    // time: 曲の先頭からの秒数 / duration: 表示し続ける秒数（省略時は次の行まで）
    { "time": 12.4, "text": "ここに一行", "effect": "fade", "duration": 3.2 }
  ]
}
```

**歌詞テキストはリポジトリに含めません。** `sample.json` 以外の JSON は `.gitignore` で
除外してあるので、自分で用意したファイルが誤ってコミットされることはありません
（公開サイトに載せたい場合のみ `git add -f` で明示的に追加してください）。

各行の `time` は M6 で作るタイミング入力ツールで記録できるようにする予定です。

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
