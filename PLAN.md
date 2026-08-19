# lyric-stage — 計画

曲に合わせて文字を「刻む」字幕演出ステージ。AviUtl の字幕演出を Web で再現し、GitHub Pages で公開する。

- 参考: 字幕演出を刻む【AviUtl】 https://youtu.be/JSFsIsjWINk
- 楽曲: 【魔王魂公式】シャイニングスター https://youtu.be/Qd01-6xVSHk
- 公開先: https://bubbleshaker.github.io/lyric-stage/

## 技術選定

| 採用 | 理由 |
|---|---|
| **GSAP 3 + SplitText** | 2025/04 に全プラグインが無料化。SplitText がテキストを文字/単語/行の `<span>` に分解し、timeline で 1 文字ずつ時間差アニメができる。字幕演出そのものの用途 |
| **Vite + TypeScript** | ビルドと dev サーバー。型があると演出定義の JSON スキーマを間違えにくい |
| **Web Audio / `<audio>.currentTime`** | 演出のマスタークロックは音声の再生位置。`requestAnimationFrame` で毎フレーム参照し、GSAP timeline の再生位置を同期させる |
| Canvas 2D | 背景の星空のみ。文字は DOM に任せる |

不採用: p5.js（文字の分解・配置を自前実装することになる）、three.js（3D フォント変換が必要で過剰）、anime.js（timeline は GSAP が上）

## 素材の扱い

- 楽曲は魔王魂の「シャイニングスター」。[利用ルール](https://maou.audio/rule/) に従い **クレジット「音楽：魔王魂」をページと README に明記**する。
- mp3 は `public/audio/` に置く（Web サイトの構成要素としての設置）。曲単品の再配布は規約で NG のため、README に「素材配布を目的としたものではない」旨を書き、加工版は置かない。
- **歌詞テキストはリポジトリに含めない。** `public/lyrics/*.json` は利用者が自分で用意する枠とし、リポジトリにはオリジナルのサンプル文言だけを入れる。

## マイルストーン

- [ ] **M0** Vite 雛形 + GitHub Actions で Pages へデプロイ。空のステージが表示される
- [ ] **M1** 音源の再生 UI（再生/停止・シーク・クレジット表示）
- [ ] **M2** タイムライン基盤。`lyrics.json`（time, text, effect）を読み、`audio.currentTime` に同期して行を出し入れする
- [ ] **M3** 演出プリセット第一弾（fade / typewriter / 一文字ずつ跳ねる）を GSAP SplitText で実装
- [ ] **M4** 演出プリセット第二弾（グリッチ・ズームイン・縦書き・文字分裂など、参考動画の「刻む」系）
- [ ] **M5** 背景演出（星空 Canvas、曲の盛り上がりに反応）
- [ ] **M6** タイミング入力ツール。再生しながらキーを叩くと行の time が記録され、JSON として書き出せる
- [ ] **M7** 仕上げ（レスポンシブ、OGP、README）

各マイルストーンごとに Issue → ブランチ → reviewer レビュー → PR → マージ。

## データ構造（M2 で確定させる）

```jsonc
{
  "title": "サンプル",
  "credit": "音楽：魔王魂",
  "audio": "audio/shining_star.mp3",
  "lines": [
    { "time": 12.4, "text": "ここに一行", "effect": "typewriter", "duration": 3.2 }
  ]
}
```

`time` は曲の先頭からの秒数。`effect` は演出プリセット名。`duration` を省いたら次の行の `time` まで表示。
