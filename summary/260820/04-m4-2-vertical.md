# M4-2: Effect の型を広げて縦書きを足す

Issue [#14](https://github.com/bubbleShaker/lyric-stage/issues/14) / PR [#15](https://github.com/bubbleShaker/lyric-stage/pull/15) / コミット `55c3f30`

## 何をしたか

M4-1 で先送りしていた型の拡張を行い、縦書きを実装した。

```ts
// 前
export type Effect = (chars: Element[]) => gsap.core.Timeline;
// 後
export interface EffectTarget { readonly root: HTMLElement; readonly chars: Element[]; }
export type Effect = (target: EffectTarget) => gsap.core.Timeline;
```

`(chars, root)` と位置引数を並べる案は採らなかった。SplitText は `words` / `lines` も作れるので、
**後で足すときにそれを使わない既存の演出を書き換えずに済む**形にしたかったため。

追加した演出:

| 名前 | 中身 |
|---|---|
| `vertical` | 縦書きにして上から一文字ずつ降ろす |
| `zoomLine` | **行全体**が手前から迫って着地。`chars` を一切使わない |

`zoomLine` が `chars` を使わずに書けたことが、型を広げた意味の実証になっている。

## 設計の肝: 演出は DOM を触らない

`writing-mode` は補間できるプロパティではなくレイアウトの指定なので、gsap では動かせない。

最初の実装では演出自身に `root.classList.add()` させ、`LyricStage.clear()` が
`root.className = baseClassName` で戻す形にした。レビューで
**「付けるのは演出・外すのは stage」という非対称**を指摘され、作り直した。

この非対称があると「root は自由に汚してよい」という**規約でしか守れない不変条件**が要る。
規約は破られる。責務の配置で潰すべきだった。

レジストリのエントリに `{ layout, build }` の形も書けるようにし、
**当てるのも外すのも `LyricStage`** に寄せた。

```ts
export type EffectLayout = 'vertical';
export const LAYOUT_CLASS: Record<EffectLayout, string> = { vertical: 'stage__text--vertical' };
export interface EffectDef { readonly layout: EffectLayout; readonly build: Effect; }
export type EffectEntry = Effect | EffectDef;   // レイアウト不要な 7 つは関数のまま
```

union にしたのは、全エントリを `{ build: ... }` で包むと
**1 つの例外のために残り 7 つが読みにくくなる**ため。`resolveEffect` が
`{ layout, build }` の形に揃えて返すので、表示側に分岐は増えていない。

### 副産物 2 つ

1. **レイアウトの決定が SplitText より前になった。** 分割は組み方が決まった後に行われる必要がある
   （`type: 'lines'` を足したとき、横組みで測った行区切りで縦組みを表示することになる）
2. テストのダミー root がただの `{}` で済むようになった（演出が DOM を触らなくなったため）

## 詰まった点: 高さを削ると縦書きが読めなくなる

レビューで「縦書きが再生コントロールに重なる。横持ちのスマホで約 50px 食い込む」と指摘され、
計算も実測も合っていた。`.stage` は `place-items: center` なので下の余白は
`(画面高 - テキスト高) / 2` にしかならず、`.transport` は画面下から約 105px を占める。

最初は `max-height` を `calc(100dvh - 14rem)` に絞って対応した。**これが間違いだった。**
812×375 で 1 段 2 文字 × 12 段になり、縦書きとして読めなくなった（実測で判明）。

**縦組みは高さが行の伸びる向き**なので、高さを削ると段が増えるだけで何も解決しない。
`.stage` の `padding-bottom: 8rem` で**場所を空ける**方が正しい。
代償として歌詞の中心は画面中央よりやや上になるが、これは横書きの行にも一律に効くので
むしろ望ましい。

併せて縦組みの文字サイズも高さに追従させた。

```css
/* 横組みは幅だけで決めてよいが、縦組みは幅だけで決めると低い画面で段だらけになる */
font-size: clamp(1.5rem, min(7vw, 8dvh), 5rem);
```

### `max-height: 100%` は grid の中では効かない

`.stage` の内側の高さに合わせたくて `max-height: min(70dvh, 32rem, 100%)` と書いたところ、
**高さが青天井になった**（1280×720 でテキスト下端が 1012px）。grid の中では百分率の解決先が
定まらず、`max-height` ごと無効になる。`calc(100dvh - 10rem)` と明示的に書く。

## レビュー指摘のうち、実測では再現しなかったもの

「`clear()` の `kill()` が gsap の transform キャッシュ（`el._gsap`）を置き去りにし、
`zoomLine` の再生中に行が切り替わると次の行が拡大したまま止まる」という指摘があった。
reviewer 自身も「という筋がある」と留保付きだったので、鵜呑みにせず再現を試みた。

```
kill + removeAttribute  再生中: matrix(2.5915, ...) / 2 本目の着地: matrix(1, 0, 0, 1, 0, 0)
revert                  再生中: matrix(2.5915, ...) / 2 本目の着地: matrix(1, 0, 0, 1, 0, 0)
```

**再現しなかった。** gsap は新しい `.from()` を組む時に要素の現在値を読み直すため、
古いキャッシュは効かない。ただし `revert()` の方が `.from()` の後始末として意味が合う
（「トゥイーンを当てる前の姿」に戻す）ので、そちらに変えた。

## 確認したこと

- `npm test`（59 件、M4-1 から +3）/ `npm run build`（`tsc` 込み）
- **縦書きの次の行が横書きに戻る** — 812×375 / 320×568 / 1280×720 の 3 画面で
  `writing-mode` が `horizontal-tb`、`className` が `stage__text`、インラインスタイルが空に戻る
- 同じ 3 画面で縦書きが再生コントロールと重ならず、かつ読める段組みになる（3 段 / 2 段 / 4 段）

## M4-3 への申し送り

- 本編には `I'll believe of my sensation` のような Latin の行がある。`writing-mode: vertical-rl` で
  `text-orientation` を指定しないと Latin は横倒しになる（日本語の縦組みの慣例どおり）。
  縦書きをどの行に当てるかと併せて決める
- `zoomLine` の再生中は行が画面より大きくなり再生コントロールに重なるが、
  手前から迫る演出の性質そのものなので直さない
