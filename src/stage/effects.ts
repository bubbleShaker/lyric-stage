import gsap from 'gsap';

/**
 * 演出が触ってよいもの。
 *
 * 引数を並べず 1 個のオブジェクトにしているのは、SplitText が words / lines も
 * 作れるため。後で足すときに、それを使わない既存の演出を書き換えずに済む。
 */
export interface EffectTarget {
  /** 行そのものの要素。縦書きのようにレイアウトを変える演出が使う */
  readonly root: HTMLElement;
  /** SplitText が分解した 1 文字ずつの要素 */
  readonly chars: Element[];
}

/**
 * 1 行分の演出。その行の登場アニメーションを組み立てて返す。
 *
 * 副作用は持たない。root のレイアウトを変えたい演出は、自分で DOM を触らず
 * EffectDef の layout で宣言する（下記）。
 */
export type Effect = (target: EffectTarget) => gsap.core.Timeline;

/**
 * 演出が要求する組み方。writing-mode のような「補間できないが行全体を変える」
 * 指定はアニメーションではないので、演出が自分で当てず宣言だけする。
 *
 * 当てるのも外すのも LyricStage の仕事。付ける側と外す側を同じ所に置くと、
 * 「縦書きの次の行が横書きに戻らない」類の消し忘れが構造的に起きなくなる。
 */
export type EffectLayout = 'vertical';

/** レイアウトごとの CSS クラス。中身は src/style.css が持つ */
export const LAYOUT_CLASS: Record<EffectLayout, string> = {
  vertical: 'stage__text--vertical',
};

/** レイアウトの要求を伴う演出。伴わない演出は Effect をそのまま書く */
export interface EffectDef {
  readonly layout: EffectLayout;
  readonly build: Effect;
}

/**
 * レジストリに書ける形。
 *
 * ほとんどの演出はレイアウトを要求しないので、関数をそのまま書けるようにしている。
 * 全エントリを { build: ... } で包むと、1 つの例外のために 7 つが読みにくくなる。
 */
export type EffectEntry = Effect | EffectDef;

/** どちらの書き方で登録されていても EffectDef の形に揃える */
function normalize(entry: EffectEntry): { layout: EffectLayout | null; build: Effect } {
  return typeof entry === 'function'
    ? { layout: null, build: entry }
    : { layout: entry.layout, build: entry.build };
}

/** 演出が返すタイムラインの型（gsap を値として import せずに参照するため） */
export type EffectTimeline = ReturnType<Effect>;

/**
 * 文字送り（1 文字目の開始から最後の文字の開始まで）の合計の上限。
 *
 * 本編の行間隔は最短 2.25 秒しかないので、文字数の多い行で 1 文字ごとの遅延を
 * 固定にすると、最後の文字が出る前に次の行へ切り替わってしまう。
 *
 * 「2.25 秒」は曲に由来する値だが、この定数自体は演出の作り（どの演出でも
 * 出揃うのは 1 秒以内）を決めるものなので stage 層に置く。曲を差し替えて
 * 行間隔が縮んだら、src/lyric-sheets.test.ts の「演出が行間隔より早く終わる」
 * 検査が落ちて気付ける。
 *
 * export しているのは effects.test.ts が「総時間がこの値で頭打ちになる」ことを
 * 検査するため。表示側は参照しないので、縮めたい時はテストだけ見れば足りる。
 */
export const MAX_STAGGER_SPAN = 0.8;

/**
 * 1 文字ごとの遅延を決める。
 *
 * 短い行では preferred（その演出らしく見える間隔）をそのまま使い、
 * 長い行だけ合計が MAX_STAGGER_SPAN に収まるよう詰める。
 * 文字数に依らず「行が変わる前に出揃う」ことを保証するのが狙い。
 */
export function staggerFor(count: number, preferred: number): number {
  if (count <= 1) return 0;
  return Math.min(preferred, MAX_STAGGER_SPAN / (count - 1));
}

/**
 * `glitch` の色ずれに使う 2 色（暖色側・寒色側）。
 *
 * **パレット（`palette.ts`）には置かない。** あちらは「明度の段 + 差し色」で、
 * CSS と canvas の両方から使う色を集めた表。この 2 つは色収差を作るための対で、
 * 明度の段のどれとも対応せず、`style.css` からも使わない（`PALETTE` に足すと
 * 検査が `:root` にも同じ名前の宣言を要求する ＝ 誰も読まない変数が増える）。
 *
 * **M9-1（Issue #53）で地の明暗を反転したとき、この 2 色も選び直した。**
 * 元は `#ff3060` / `#00e0ff` で、暗い地に対しては 5.5:1 / 12.4:1 とどちらも強く
 * 出ていた。明るい地では 3.2:1 / **1.4:1** になり、**寒色側だけがほぼ消える** —
 * 左右に均等にずれた残像という狙いが、色の側から崩れる（下の「負のゼロ」を
 * 避けている苦労が、対称性という点では同じ所で無駄になる）。
 * 今の 2 色は地に対して 4.35:1 / 4.32:1 で、**左右がほぼ同じ強さで出る**。
 */
const FRINGE_WARM = '216, 27, 96';
const FRINGE_COOL = '10, 124, 140';

/**
 * 演出プリセットの一覧。
 *
 * 表示側は switch で分岐せず、この表を引くだけにする。
 * こうすると新しい演出を足すときに既存のコードを触らずに済む（開放閉鎖の原則）。
 *
 * どれも gsap の `.from()` で書いている。`.from()` は「この状態から現在の CSS へ」
 * という向きなので、演出ごとに終了状態（＝素の見た目）を書かなくて済む。
 *
 * 型注釈ではなく `satisfies` を付けているのは、Effect であることを確かめつつ
 * 「どんな名前が登録済みか」を型に残すため。注釈を書くと Record<string, Effect> に
 * 広がってしまい、既定の演出名を打ち間違えても型検査を通ってしまう。
 */
export const effects = {
  /** 下からふわりと出る。effect の指定が無いときの既定 */
  fade: ({ chars }) =>
    gsap.timeline().from(chars, {
      opacity: 0,
      yPercent: 40,
      duration: 0.6,
      ease: 'power3.out',
      stagger: staggerFor(chars.length, 0.04),
    }),

  /**
   * 1 文字ずつ打ち込まれる。
   *
   * 文字自体はほぼ瞬時に現れる（duration が短い）。等間隔で置かれていく
   * リズムそのものがタイプライターらしさなので、ease は付けない。
   */
  typewriter: ({ chars }) =>
    gsap.timeline().from(chars, {
      opacity: 0,
      duration: 0.01,
      ease: 'none',
      stagger: staggerFor(chars.length, 0.08),
    }),

  /**
   * 1 文字ずつ跳ねて出る。
   *
   * back.out は目標値を一度追い越してから戻るイージング。この行き過ぎが
   * 跳ね返りに見える。足元を軸に潰れて伸びるよう transformOrigin を下端に置く。
   */
  bounce: ({ chars }) =>
    gsap.timeline().from(chars, {
      opacity: 0,
      yPercent: 90,
      scale: 0.7,
      transformOrigin: '50% 100%',
      duration: 0.5,
      ease: 'back.out(2.6)',
      stagger: staggerFor(chars.length, 0.05),
    }),

  /**
   * 信号が乱れたように、ずれた残像を残して定位置に収まる。
   *
   * 2 本のトゥイーンを同じ時刻（第 3 引数の 0）から重ねている。
   * 1 本目が文字そのものの位置ずれ、2 本目が RGB がずれた残像。
   */
  glitch: ({ chars }) =>
    gsap
      .timeline()
      .from(chars, {
        opacity: 0,
        // 値に関数を書くと gsap が対象ごとに呼ぶので、文字 1 つずつ違うずれ方になる。
        // ここで gsap.utils.random(-60, 60) と直に書くと、全文字が同じ値になってしまう。
        // 単位が xPercent（文字自身の幅に対する割合）なのは shatter と同じ理由
        xPercent: () => gsap.utils.random(-60, 60),
        skewX: () => gsap.utils.random(-30, 30),
        duration: 0.3,
        // steps(4) は滑らかに動かさず 4 段階で飛ばすイージング。
        // 連続していない動きがデジタルなノイズに見える
        ease: 'steps(4)',
        stagger: staggerFor(chars.length, 0.03),
      })
      .fromTo(
        chars,
        // 残像は素の見た目に無い（＝影が付いていない）ので .from() では書けない。
        // 始点と終点の両方を、影の数と単位を揃えて明示する
        {
          textShadow: `0.06em 0 0 rgba(${FRINGE_WARM}, 0.9), -0.06em 0 0 rgba(${FRINGE_COOL}, 0.9)`,
        },
        {
          // 終点のずれ幅をゼロちょうどにしない。gsap は影のような複合文字列を
          // 「並んだ数値の列」として補間するが、負のゼロ（-0em）だけ読み違えて
          // 桁が変わり、左右のずれが非対称になる。0.001em は 1px の 1/100 未満なので
          // 見た目はゼロと変わらないまま、この読み違いを避けられる。
          //
          // 再現条件（gsap 3.15 / Chromium 141）: 実 DOM 要素に対して
          // 0.06em → 0em、-0.06em → -0em を補間させ、中間地点の
          // getComputedStyle(el).textShadow を見ると 2.1px / -0.21px になる
          // （本来は対称の 2.1px / -2.1px）。終点を -0.001em にすると対称に戻る。
          // ダミーオブジェクト相手では起きないので CSSPlugin 側の癖。
          // ＝ effects.test.ts では捕まえられず、目視でしか確認できない
          textShadow: `0.001em 0 0 rgba(${FRINGE_WARM}, 0), -0.001em 0 0 rgba(${FRINGE_COOL}, 0)`,
          duration: 0.45,
          ease: 'power2.out',
          stagger: staggerFor(chars.length, 0.03),
        },
        0,
      ),

  /**
   * 画面手前から一気に縮んで着地する。
   *
   * expo.out は最初だけ猛烈に速く、あとはほぼ止まって見えるイージング。
   * この急ブレーキが「拍に当たって止まる」手触りになる。
   */
  zoom: ({ chars }) =>
    gsap.timeline().from(chars, {
      opacity: 0,
      scale: 3.4,
      duration: 0.5,
      ease: 'expo.out',
      stagger: staggerFor(chars.length, 0.03),
    }),

  /**
   * 散らばった破片が集まって行になる（文字が割れて飛ぶ演出の逆再生）。
   *
   * 行の外まで飛ばすので、はみ出した文字で横スクロールが出ないよう
   * body の overflow: hidden に頼っている（src/style.css）。
   *
   * 飛距離を px でなく xPercent / yPercent（＝文字自身の大きさに対する割合）で
   * 書いているのは、文字サイズが clamp(1.75rem, 7vw, 5rem) で 28px〜80px まで
   * 変わるため。px 固定だと狭い画面で飛びすぎ、広い画面で控えめになってしまう。
   */
  shatter: ({ chars }) =>
    gsap.timeline().from(chars, {
      opacity: 0,
      xPercent: () => gsap.utils.random(-260, 260),
      yPercent: () => gsap.utils.random(-200, 200),
      rotation: () => gsap.utils.random(-120, 120),
      scale: 0.3,
      duration: 0.7,
      ease: 'power4.out',
      // 数値でなくオブジェクトを渡すと順序を指定できる。'random' は左から順ではなく
      // ばらばらの順に着地させる指定で、破片が寄り集まる感じになる。
      // 合計の長さは each × (文字数 - 1) のままなので、上限の考え方は変わらない
      stagger: { each: staggerFor(chars.length, 0.03), from: 'random' },
    }),

  /**
   * 縦書きにして、上から一文字ずつ降ろす。
   *
   * writing-mode は補間できるプロパティではない（レイアウトの指定であって
   * アニメーションではない）ので gsap では動かさず、layout の宣言で
   * LyricStage に CSS クラスを当てさせる。段組みや字間の調整も込みで
   * style.css の .stage__text--vertical が持つ。
   *
   * この宣言は SplitText より前に効く。文字への分割は組み方が決まった後で
   * 行われる必要がある（type: 'lines' を足したとき、横組みで測った行区切りで
   * 縦組みを表示することになるため）。
   */
  vertical: {
    layout: 'vertical',
    build: ({ chars }) =>
      gsap.timeline().from(chars, {
        opacity: 0,
        // 縦組みなので「上から降りてくる」向きが文字の進行方向と揃う
        yPercent: -70,
        duration: 0.5,
        ease: 'power3.out',
        stagger: staggerFor(chars.length, 0.05),
      }),
  },

  /**
   * 行全体が手前から迫って着地する。
   *
   * 文字ごとに拡大する zoom と違い、行が 1 枚の板として飛び込んでくる。
   * chars を一切使わないので、行の要素を受け取れるようになって初めて書けた演出。
   */
  zoomLine: ({ root }) =>
    gsap.timeline().from(root, {
      opacity: 0,
      scale: 6,
      duration: 0.6,
      ease: 'expo.out',
    }),

  /**
   * ずっと奥から手前へ迫って止まる（M8-5 の遠近感）。
   *
   * `z` は画面の奥行き方向の移動。**親に `perspective` が張られていないと
   * ただの平行移動になって何も起きない**ので、`.stage__lines` の
   * `perspective` と、そこから語句まで繋がる `transform-style: preserve-3d` が
   * 効いていることが前提（src/style.css）。zoom の `scale` と違い、
   * 遠くの文字ほど小さく・中央寄りに見えるので、画面の隅に置いた語句が
   * 隅の方から飛んでくる。
   *
   * ぼかしを併せているのは被写界深度の模倣。ピントが合いながら着地する。
   * `.from()` ではなく `.fromTo()` なのは、素の見た目の `filter` が `none` で、
   * `blur(14px)` → `none` は補間できないため（`blur(0px)` を明示する）。
   */
  rushIn: ({ chars }) =>
    gsap.timeline().fromTo(
      chars,
      { opacity: 0, z: -1400, filter: 'blur(14px)' },
      {
        opacity: 1,
        z: 0,
        filter: 'blur(0px)',
        duration: 0.55,
        ease: 'power3.out',
        stagger: staggerFor(chars.length, 0.04),
      },
    ),

  /**
   * 奥を向いていた面が正面へ振り向く（M8-5 の遠近感）。
   *
   * `rotationY` は縦軸まわりの回転。`rushIn` と同じく親の `perspective` が要る。
   * 回転の軸を左端（`transformOrigin`）に置くと、扉が開くように見える。
   *
   * 語句を 1 枚の面として回す（`chars` を使わない）。文字ごとに回すと
   * 面が割れて、奥行きのある 1 枚という手触りが消える。
   */
  swing: ({ root }) =>
    gsap.timeline().from(root, {
      opacity: 0,
      rotationY: -78,
      z: -260,
      transformOrigin: '0% 50%',
      duration: 0.6,
      ease: 'power3.out',
    }),

  /**
   * 何も動かさず、行ごと静かに現れる。
   *
   * 「動きを減らす」設定のときに他の演出の代わりに使われる（REDUCED_MOTION_EFFECT）。
   * 位置も大きさも変えず、文字ごとの時間差も付けない。fade は控えめとはいえ
   * yPercent: 40 の移動があるので、動きを減らす設定への答えとしては半端になる。
   *
   * シートから直接指定してもよい（静かに出したい行のために）。
   */
  calm: ({ root }) =>
    gsap.timeline().from(root, {
      opacity: 0,
      duration: 0.4,
      ease: 'power1.out',
    }),
} satisfies Record<string, EffectEntry>;

/** 登録済みの演出名。effects に足せば自動で増える */
export type EffectName = keyof typeof effects;

/** effect の指定が無いときに使う演出。存在しない名前を書くと型検査で落ちる */
export const DEFAULT_EFFECT: EffectName = 'fade';

/**
 * 「動きを減らす」設定のときに、シートの指定に代えて使う演出。
 *
 * zoom / shatter / glitch / zoomLine は画面の広い範囲が急に動くので、
 * 前庭系の症状（めまい・吐き気）を誘発しうる部類にあたる。
 */
export const REDUCED_MOTION_EFFECT: EffectName = 'calm';

/**
 * 外から来た文字列が登録済みの演出名かどうか。
 *
 * Object.hasOwn で自前のキーだけを見る。単に effects[name] と書くと
 * 'toString' や '__proto__' のような Object.prototype 由来の値まで拾ってしまい、
 * 外部 JSON の effect 名で関数でないものを呼び出してしまう。
 */
export function isEffectName(name: string): name is EffectName {
  return Object.hasOwn(effects, name);
}

/**
 * 演出名から「当てるレイアウト」と「組み立てる関数」を取り出す。
 *
 * 呼び出し側（LyricStage）は layout を当ててから build を呼ぶ。
 * どちらの書き方で登録されていても同じ形で返るので、表示側に分岐は要らない。
 *
 * reducedMotion が真なら build だけを calm に差し替える。**layout は落とさない** —
 * writing-mode は動きではなくレイアウトの指定なので、動きを減らす設定でも
 * 縦書きは縦書きのまま読めるべき。ここで一緒に落とすと、縦書きを前提に
 * 決めた文字サイズや段組み（style.css）ごと外れてしまう。
 *
 * 設定を読むのは呼び出し側の仕事。この関数は「読んだ結果をどう反映するか」だけを持ち、
 * window にも matchMedia にも触らないので、ブラウザ無しでテストできる。
 */
export function resolveEffect(
  name: string | undefined,
  { reducedMotion = false }: ResolveOptions = {},
): { layout: EffectLayout | null; build: Effect } {
  const entry = lookupEffect(name);

  if (entry === null) {
    // 落とし先を実際に使う名前で書く。動きを減らす設定では calm が使われるので、
    // ここで既定の fade を名乗ると、綴りの間違いを調べている人を誤導する
    const fallback = reducedMotion ? REDUCED_MOTION_EFFECT : DEFAULT_EFFECT;
    console.warn(`未知の演出名です: ${name}（${fallback} を使います）`);
  }

  const resolved = normalize(entry ?? effects[DEFAULT_EFFECT]);

  return reducedMotion
    ? { layout: resolved.layout, build: normalize(effects[REDUCED_MOTION_EFFECT]).build }
    : resolved;
}

/** resolveEffect の任意指定。真偽値を裸で並べると呼び出し側で意味が読めないため */
export interface ResolveOptions {
  /** OS の「視差効果を減らす」設定が有効か */
  readonly reducedMotion?: boolean;
}

/** 名前からレジストリの登録を引く。未指定は既定、未知の名前は null（警告は呼び出し側） */
function lookupEffect(name: string | undefined): EffectEntry | null {
  if (name === undefined) return effects[DEFAULT_EFFECT];

  return isEffectName(name) ? effects[name] : null;
}
