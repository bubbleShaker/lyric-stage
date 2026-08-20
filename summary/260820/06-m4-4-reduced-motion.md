# M4-4: prefers-reduced-motion への対応

Issue [#18](https://github.com/bubbleShaker/lyric-stage/issues/18)

## 何をしたか

M4-1 のレビュー指摘への対応。`zoom` / `shatter` / `glitch` / `zoomLine` は画面の広い範囲が
急に動くので、前庭系の症状（めまい・吐き気）を誘発しうる部類にあたる。OS の
「視差効果を減らす」設定（`prefers-reduced-motion: reduce`）を尊重するようにした。

これで **M4 が完了**（M4-1 〜 M4-4）。

## `gsap.matchMedia()` を使わなかった

PLAN には M4-1 の時点で「stage 層で `gsap.matchMedia()` を使って fade に落とす」と
書いていたが、実装時に変更した。

`gsap.matchMedia()` の価値は **クエリが変わった瞬間に走行中のトゥイーンを revert する**ことで、
そのために context を張る。今回の演出は 1 秒未満で行ごとに作り直すので、
**組み立てる時に 1 回クエリを読めば同じ結果**になる。context を持ち込まないぶん
`LyricStage` も gsap の文脈抜きで組み立てられる。

## 責務を 3 つに割る

| 層 | 持つもの | 実際のコード |
|---|---|---|
| `stage/effects.ts` | どの演出に落とすか | `resolveEffect(name, { reducedMotion })` |
| `stage/lyric-stage.ts` | いつ読むか | `show()` のたびに `this.prefersReducedMotion()` |
| `lib/reduced-motion.ts` | どう読むか | `systemReducedMotion()` / `neverReduceMotion` |

`effects.ts` は `window` にも `matchMedia` にも触らないままなので、
**この判断はブラウザ無しでテストできる**。`LyricStage` は読み方を関数で受け取る。

```ts
constructor(root: HTMLElement, prefersReducedMotion: ReducedMotionQuery)
```

**既定値は置かない**（レビュー指摘で直した）。最初は `= () => false` を既定にしていたが、
それだと新しい所で組み立てた時に渡し忘れてもエラーにならず、**アクセシビリティの機能が
静かに無効になる**。今は本編が `systemReducedMotion()`、開発用の `effect-preview.html` が
`neverReduceMotion` を明示的に渡す。開発用ページで素の演出が出るのは
**「減らさないという選択」**であって、既定値の副作用ではない、という形になった。

行を出すたびに読むので、**曲の途中で OS の設定を変えても次の行から効く**。
購読して切り替える作りにしても、演出は 1 秒未満で終わるので違いが出ない。

## 落とし先は `fade` ではなく `calm`（新設）

`fade` は控えめとはいえ `yPercent: 40` の移動がある。動きを減らす設定への答えとしては
半端なので、**行ごと不透明度だけ変える** `calm` を足してそちらに落とした。

```ts
calm: ({ root }) =>
  gsap.timeline().from(root, { opacity: 0, duration: 0.4, ease: 'power1.out' }),
```

レジストリに普通の演出として登録してあるので、シートから直接指定してもよい
（静かに出したい行のため）。演出単体の検査（`effects.test.ts` の `it.each`）にも自動で乗る。

## `layout` は落とさない

ここが今回の設計の肝。

`writing-mode` は**動きではなくレイアウトの指定**なので、動きを減らす設定でも縦書きは
縦書きのまま読めるべき。一緒に落とすと、縦書き前提で決めた文字サイズや段組み
（`style.css` の `.stage__text--vertical`）ごと外れて、ただ横組みになってしまう。

```ts
return reducedMotion
  ? { layout: resolved.layout, build: normalize(effects[REDUCED_MOTION_EFFECT]).build }
  : resolved;
```

M4-2 で `resolveEffect` を `{ layout, build }` を返す形にしておいたので、
**`build` だけ差し替えれば済んだ**。「レイアウトの宣言」と「動きの組み立て」を分けた設計が、
別の理由でもう一度効いた形。

## レビューで直したこと

- **`LyricStage` の第 2 引数を必須にした**（上記）。fail-open な既定値は、配線忘れが
  型検査でもテストでも捕まらない形だった
- **未知の演出名の警告に実際の落とし先を書くようにした。** 動きを減らす設定では `calm` が
  使われるのに「既定の fade を使います」と出ていた。綴りの間違いを調べている人を誤導する。
  警告を出す場所を `resolveEffect` に上げ、文言を検査する（`calm` を含み `fade` を含まない）
  テストも足した
- **「レイアウトは落とさない」「設定を渡さない呼び出しの意味が変わっていない」を
  レジストリ全体で回すようにした。** `vertical` / `shatter` 決め打ちだと、レイアウトの
  種類や演出が増えたときに主張の範囲が狭まる
- **「落とし先が動かない」検査を deny list から allow list に反転した。** 動かすプロパティを
  数え上げる形（`x` / `scale` / …）だと `top` や `width` のような数え漏れが素通りする。
  **書いてよいキーを列挙する**方が「静かであること」という意図に一致し、抜け道が無い
  （`parent` / `overwrite` / `runBackwards` は gsap が自分で足す帳簿なので許可側に入れた）
- `resolveEffect` の第 2 引数を真偽値からオブジェクト（`{ reducedMotion: true }`）に。
  `resolveEffect('shatter', true)` は呼び出し側で何が true か読めない

## 確認したこと

- `npm test`（72 件、M4-3 から +7）/ `npm run build`（`tsc` 込み）
- 実ブラウザで Chromium の `reducedMotion: 'reduce'` をエミュレートし、
  演出の真っ最中（seek してから 200〜250ms 後）の計算後スタイルを通常時と比較した

| 行 / 演出 | 通常 | 動きを減らす |
|---|---|---|
| 夢に眠る幻が掌に降り注ぐ（`shatter`） | 動いた文字 12/12 | **0/12** |
| シャイニングスター綴れば（`zoomLine`） | root が `matrix(1.5841, …)` | **`none`** |
| 一滴の光（`zoom`） | 動いた文字 4/4 | **0/4** |
| さざなみの音に癒やされてく（`vertical`） | 動いた文字 13/13 / `writing-mode: vertical-rl` | **0/13** / **`vertical-rl` のまま** |

最後の行が、狙いどおり「動きだけ止まって組み方は残る」ことの実測にあたる。

開発用ページ（`effect-preview.html`）も `reducedMotion: 'reduce'` で開いて確認した。
`shatter` の文字が 6/6 動く＝OS 設定に関わらず素の演出が出ている。
**ここは待ち時間で測ると当てにならない**（dev サーバー経由だと読み込みが遅く、
計測する頃には演出が終わっている）。`gsap.globalTimeline.pause()` → `.time(0.2)` の
コマ送りで測ること。

## テストで押さえたこと

いずれも `Object.keys(effects)` で回しているので、演出やレイアウトが増えても追従する。

- どの演出も `calm` に落ちる
- 未指定・未知の名前でも `calm` に落ちる／警告に実際の落とし先が出る
- `layout` は落とさない（動きを減らしても、減らさない時と同じレイアウトになる）
- **落とし先そのものが動かない** — タイムラインの子から `vars` のキーを集め、
  許可した以外のキー（＝何かを動かす指定）が現れないことを見る。
  「`calm` に落ちている」だけだと、その `calm` がいつの間にか動くようになっても気付けない
- 設定を渡さない既存の呼び出しの意味が変わっていない

`getChildren()` が空でないことも併せて見ている。中身を読めていないと
「動かすプロパティが 1 つも無い」が素通りしてしまうため。

## 残り

- **M5** 背景演出（星空 Canvas）。背景も動くので、そこでも同じ設定を読む必要がある。
  `ReducedMotionQuery` を渡す形は今回と揃えられる。CSS 側は現状 `opacity` の
  transition しか無いので `@media (prefers-reduced-motion: reduce)` は要らないが、
  Canvas を入れる時に再確認する（reviewer の指摘）
- 動きを減らす時も `SplitText` で全文字を span に分けている。`calm` は `chars` を使わないので、
  `build` が文字を使わない時は分割を省く余地がある（`zoomLine` も同じ性質）。
  読み上げやテキスト選択にも関わるので、M5 以降の宿題（reviewer の指摘）
- **M6** タイミング入力ツール
- **M7** 仕上げ（レスポンシブ、OGP、README）
