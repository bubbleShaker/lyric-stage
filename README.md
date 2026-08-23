# lyric-stage

曲に合わせて文字を「刻む」字幕演出ステージ。AviUtl の字幕演出を Web で再現する試み。

**公開先: https://bubbleshaker.github.io/lyric-stage/**

## 使用素材

- 楽曲: **シャイニングスター** / **音楽：魔王魂** — https://maou.audio/14_shining_star/

楽曲は [魔王魂の音楽利用のルール](https://maou.audio/rule/) に従って使用しています。
音源はこの作品を再生するための構成要素として置くもので、音楽素材の配布を目的とはしていません。
楽曲を利用したい場合は必ず魔王魂の公式サイトから入手してください。

- 書体: **Zen Kaku Gothic New** (Black) — https://fonts.google.com/specimen/Zen+Kaku+Gothic+New

書体は [SIL Open Font License 1.1](https://openfontlicense.org/) です。ライセンス全文は
`public/fonts/zen-kaku-gothic-new.LICENSE.txt` に置いてあり、フォントと一緒に配信されます
（OFL は再配布にライセンス文の同梱を求めます）。歌詞に出る文字だけに絞ってあるので、
このリポジトリの woff2 を汎用のフォントとして使うことはできません。

## 歌詞ファイル

表示する文字は `public/lyrics/*.json` に置きます。既定では作品本編の `shining-star.json` が
読み込まれ、`?lyrics=名前` を付けると切り替わります（`sample` は動作確認用の文言）。

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

`?lyrics=` は制作中に別のシートを試すための切り替えです。

### `effect` に書ける演出

| 名前 | 見え方 |
|---|---|
| `fade` | 下からふわりと出る（`effect` を省いたときの既定） |
| `typewriter` | 1 文字ずつ等間隔に打ち込まれる |
| `bounce` | 1 文字ずつ跳ねて出る |
| `glitch` | ずれた残像を残して定位置に収まる |
| `zoom` | 文字が手前から縮んで着地する |
| `zoomLine` | 行全体が 1 枚の板として迫って着地する |
| `shatter` | 散らばった破片が集まって行になる |
| `vertical` | 縦書きにして上から降ろす（ラテン文字は横倒しになるので日本語の行向け） |
| `calm` | 何も動かさず、行ごと静かに現れる |

知らない名前を書いた行は `fade` で表示されます（コンソールに警告が出ます。下の
「動きを減らす設定」が有効なときは `calm`）。

### 動きを減らす設定

OS で「視差効果を減らす」（`prefers-reduced-motion: reduce`）を有効にしていると、
シートの指定に関わらず全ての行が `calm` で表示されます。`zoom` / `shatter` / `glitch` /
`zoomLine` は画面の広い範囲が急に動くため、前庭系の症状を誘発しうるためです。

縦書き（`vertical`）の**組み方はそのまま**保たれます。`writing-mode` は動きではなく
レイアウトの指定なので、動きを減らす設定でも縦書きは縦書きのまま読めるべき、という判断です。

## time はどう決めたか

`shining-star.json` の各行の `time` は、公式 MV
[【魔王魂公式】シャイニングスター](https://youtu.be/Qd01-6xVSHk) の焼き込み字幕に合わせています。

MV の動画本体は YouTube 側の制限で取得できないため、代わりに storyboard
（1.986 秒ごとのサムネイル 144 枚）から字幕が切り替わるフレームを読み取り、各行の開始時刻を
約 2 秒幅の区間に絞り込みました。その区間を、mp3 のスペクトルフラックスの自己相関から求めた
拍の格子（79.85 BPM / 1 小節 3.0055 秒）に載せて確定させています。

MV は 2 行を 1 枚の字幕にまとめて表示するので、2 行組の 2 行目は組の中央を拍に丸めた位置に
置いています。動画は mp3 より 5.4 秒長いものの、余りは末尾のクレジットで先頭は一致するため
（最初の歌い出しが両方とも 19 秒台）、オフセット補正は入れていません。

**未確認**: 魔王魂の利用ルールが明文化しているのは主に**音源**の利用条件です。歌詞テキストを
Web ページに掲載してよいかは規約の文面から読み切れないため、確認が必要です。

## 作者向け: 音源を入れ直すとき

魔王魂のサーバーは `curl` などスクリプトからの直接ダウンロードを拒否する設定になっているため、
mp3 は **ブラウザから手動で** 取得します。

1. https://maou.audio/14_shining_star/ を開く
2. 「シャイニングスター」の **mp3** をダウンロードする
3. ファイル名を `maou_14_shining_star.mp3` にして `public/audio/` に置き、コミットする

差し替えるたびに履歴へ全バイトが積み上がるので、投入は一度で済ませます（Git LFS は使わないこと。
Actions のチェックアウト設定次第でポインタファイルが公開され、再生できなくなる）。

## 作者向け: 書体を作り直すとき

日本語フォントは素で 3〜6 MB あるので、**歌詞に出る文字だけ**に絞って `public/fonts/` に
置いています（Zen Kaku Gothic New Black は 3.4 MB → 29 KB）。Google Fonts の CDN を直に
読まないのは、公開ページを外部への接続に依存させないためです。

歌詞シートに**サブセットに無い文字**を足すと、その文字だけが崩れます。しかも
**目では気付けません** — ブラウザは字が無いと `font-family` の次の候補へ 1 文字ずつ落ちるので、
豆腐（□）にすらならず「その字だけ別の書体で、それらしく」出ます。
`npm test`（`src/font-subset.test.ts`）が歌詞と `*.charset.txt` を突き合わせて落とすので、
赤くなったら下の手順で作り直してください。

```bash
pipx install "fonttools[woff]"   # 初回のみ。pyftsubset と ttx が要る

mkdir -p .fonts-src
curl -o .fonts-src/ZenKakuGothicNew-Black.ttf \
  https://raw.githubusercontent.com/google/fonts/b8f2790b12018153309b61335c4887ce939fde37/ofl/zenkakugothicnew/ZenKakuGothicNew-Black.ttf

# 追跡しているのは加工後の woff2 だけなので、元が本物かはここでしか確かめられない
echo "795819a979184981842994d8f4eb9e14ce443d687bd5e731d6ca67ded8f92261  .fonts-src/ZenKakuGothicNew-Black.ttf" | sha256sum -c

node tools/subset-font.mjs .fonts-src/ZenKakuGothicNew-Black.ttf zen-kaku-gothic-new
```

URL に `main` ではなくコミット SHA を書いているのは、**手元の woff2 が本当にこの ttf 由来かを
後から確かめられるようにする**ためです（バイナリは目で読めないので、出どころは書き残すしかない）。
上流を新しくするときは SHA と sha256 の両方を更新します。

書体そのものを選び直すときは `npm run dev` で
`http://localhost:5173/lyric-stage/font-preview.html` を開きます。候補を同じ歌詞・同じ組み方で
並べたページで、**選ばれなかった候補の woff2 は追跡していない**ので、上と同じ手順で
候補ぶんを作ってから開いてください（候補の一覧はそのページの中にあります）。

差し替えたら `src/style.css` の `letter-spacing` / `line-height` / `--size-base` も測り直します。
書体ごとに字面（em に対する字の大きさ）が違うので、同じ数値でも見え方は揃いません。

## 開発

```bash
npm install
npm run dev      # http://localhost:5173/lyric-stage/
npm test         # 公開する歌詞シートと書体のサブセットも検証する
npm run build
```

main への push で GitHub Actions が GitHub Pages へデプロイします。

## 技術

- [GSAP 3](https://gsap.com/) + SplitText — テキストを 1 文字ずつに分解して時間差アニメーション
- Vite + TypeScript

計画とマイルストーンは [PLAN.md](./PLAN.md) を参照。
