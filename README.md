# lyric-stage

曲に合わせて文字を「刻む」字幕演出ステージ。AviUtl の字幕演出を Web で再現する試み。

**公開先: https://bubbleshaker.github.io/lyric-stage/**

## 使用素材

- 楽曲: **シャイニングスター** / **音楽：魔王魂** — https://maou.audio/14_shining_star/

楽曲は [魔王魂の音楽利用のルール](https://maou.audio/rule/) に従って使用しています。
音源はこの作品を再生するための構成要素として置くもので、音楽素材の配布を目的とはしていません。
楽曲を利用したい場合は必ず魔王魂の公式サイトから入手してください。

> **現状**: 音源と本編の歌詞はまだ投入していません。それまでの間、ページは
> 動作確認用の `sample.json` を再生コントロールのエラー表示とともに表示します。

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

`?lyrics=` は制作中に別のシートを試すための切り替えで、公開時の既定は作品本編のシートにします。

## 作者向け: 素材の投入手順（初回だけ）

鑑賞者が行う作業ではありません。作品として素材を固定するために、作者が一度だけ行います。

### 1. 音源

魔王魂のサーバーは `curl` などスクリプトからの直接ダウンロードを拒否する設定になっているため、
mp3 は **ブラウザから手動で** 取得します。

1. https://maou.audio/14_shining_star/ を開く
2. 「シャイニングスター」の **mp3** をダウンロードする
3. ファイル名を `maou_14_shining_star.mp3` にして `public/audio/` に置き、コミットする

スマホからでも、GitHub の Web UI（リポジトリ → `public/audio/` → Add file → Upload files）で
アップロードできます。差し替えるたびに履歴へ全バイトが積み上がるので、投入は一度で済ませます
（Git LFS は使わないこと。Actions のチェックアウト設定次第でポインタファイルが公開され、
再生できなくなる）。

### 2. 歌詞

歌詞は公式ページに掲載されているものを作者自身がコピーし、`public/lyrics/shining-star.json` の
`text` に貼り付けます。各行の `time` は M6 のタイミング入力ツールで記録できるようにする予定なので、
先にテキストだけ並べておけば大丈夫です。

なお、魔王魂の利用ルールが明文化しているのは主に**音源**の利用条件です。歌詞テキストを
Web ページに掲載してよいかは規約の文面から読み切れないため、公開前に確認してください。

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
