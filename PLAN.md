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
- **mp3 の取得はブラウザから手動で行う。** 魔王魂のサーバーはスクリプトからの直接ダウンロードを 403 で拒否する設定になっており、これは意図的な保護なので迂回しない。手順は README の「音源の配置」。ファイルが置かれるまで公開サイトは「音源が見つかりません」と表示する。
- **音源と歌詞は作品の一部としてリポジトリに含める**（2026-08-19 に方針変更）。鑑賞者が素材を選ぶ UI は作らず、1 つの作品として固定する。
- 歌詞テキストは公式の歌詞ページから作者自身がコピーして `public/lyrics/` の JSON に貼る。

## マイルストーン

- [x] **M0** Vite 雛形 + GitHub Actions で Pages へデプロイ。空のステージが表示される
- [x] **M1** 音源の再生 UI（再生/停止・シーク・クレジット表示）
- [x] **M2** タイムライン基盤。`lyrics.json`（time, text, effect）を読み、`audio.currentTime` に同期して行を出し入れする
- [ ] **M3** 演出プリセット第一弾（fade / typewriter / 一文字ずつ跳ねる）を GSAP SplitText で実装
- [ ] **M4** 演出プリセット第二弾（グリッチ・ズームイン・縦書き・文字分裂など、参考動画の「刻む」系）
- [ ] **M5** 背景演出（星空 Canvas、曲の盛り上がりに反応）
- [ ] **M6** タイミング入力ツール。再生しながらキーを叩くと行の time が記録され、JSON として書き出せる
- [ ] **M7** 仕上げ（レスポンシブ、OGP、README）

各マイルストーンごとに Issue → ブランチ → reviewer レビュー → PR → マージ。

## レイヤー分け（M2 の入り口で引く線）

演出が増えても崩れないように、依存の向きを先に決めておく。

- `domain/` — GSAP も DOM も import しない。`LyricLine` 型、JSON の検証、「`currentTime` から今表示すべき行を決める」純粋関数。外側に求める口（`Playback` / `LyricPresenter`）も `domain/ports.ts` に置く。**依存の矢印を全て内向きに揃えるため**
- `app/` — `Ticker`（rAF はアプリ全体で 1 本）、歌詞ロード、domain の判定結果を presenter に渡す配線
- `stage/` — GSAP + SplitText による描画、`<audio>` のラッパ。GSAP に依存してよいのはここだけ。port の実装を提供する
- `main.ts` — 各層を組み立てて起動するだけ（文言もアニメーション定義も持たない）

決めたこと:
- **クレジット表記は HTML を正とする。** 歌詞 JSON には `credit` を持たせない（表示位置が固定で、シートごとに変える必要が無いため）
- 音源パスは当面 `main.ts` にハードコード。複数曲に対応する時に JSON へ移す

演出プリセットは `switch (effect)` で分岐せず、`Record<EffectName, (chars: Element[]) => gsap.core.Timeline>` のレジストリにする。**新しい演出＝ファイルを 1 つ足すだけ**にするため。

注意点（レビュー指摘）:
- JS 内の `fetch('/audio/x.mp3')` は Vite が書き換えないので Pages で 404 になる。`import.meta.env.BASE_URL` を前置するユーティリティを M1 で用意する
- 行を出し入れするたびに SplitText インスタンスの `revert()` を呼ばないと DOM ノードが増え続ける。ライフサイクル管理は stage 層に持たせる
- クレジット表記を HTML と JSON のどちらを正にするか M2 で決める（現状は HTML にハードコード）

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
