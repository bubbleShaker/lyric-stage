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
        { textShadow: '0.06em 0 0 rgba(255, 48, 96, 0.9), -0.06em 0 0 rgba(0, 224, 255, 0.9)' },
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
          textShadow: '0.001em 0 0 rgba(255, 48, 96, 0), -0.001em 0 0 rgba(0, 224, 255, 0)',
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
} satisfies Record<string, EffectEntry>;

/** 登録済みの演出名。effects に足せば自動で増える */
export type EffectName = keyof typeof effects;

/** effect の指定が無いときに使う演出。存在しない名前を書くと型検査で落ちる */
export const DEFAULT_EFFECT: EffectName = 'fade';

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
 */
export function resolveEffect(name: string | undefined): { layout: EffectLayout | null; build: Effect } {
  if (name === undefined) return normalize(effects[DEFAULT_EFFECT]);

  if (!isEffectName(name)) {
    console.warn(`未知の演出名です: ${name}（既定の ${DEFAULT_EFFECT} を使います）`);
    return normalize(effects[DEFAULT_EFFECT]);
  }

  return normalize(effects[name]);
}
