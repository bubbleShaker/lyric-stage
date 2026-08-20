import gsap from 'gsap';

/**
 * 1 行分の演出。SplitText が分解した文字要素を受け取り、
 * その行の登場アニメーションを組み立てて返す。
 */
export type Effect = (chars: Element[]) => gsap.core.Timeline;

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
  fade: (chars) =>
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
  typewriter: (chars) =>
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
  bounce: (chars) =>
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
  glitch: (chars) =>
    gsap
      .timeline()
      .from(chars, {
        opacity: 0,
        // 値に関数を書くと gsap が対象ごとに呼ぶので、文字 1 つずつ違うずれ方になる。
        // ここで gsap.utils.random(-40, 40) と直に書くと、全文字が同じ値になってしまう
        x: () => gsap.utils.random(-40, 40),
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
          // 見た目はゼロと変わらないまま、この読み違いを避けられる
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
  zoom: (chars) =>
    gsap.timeline().from(chars, {
      opacity: 0,
      scale: 3.4,
      transformOrigin: '50% 50%',
      duration: 0.5,
      ease: 'expo.out',
      stagger: staggerFor(chars.length, 0.03),
    }),

  /**
   * 散らばった破片が集まって行になる（文字が割れて飛ぶ演出の逆再生）。
   *
   * 行の外まで飛ばすので、はみ出した文字で横スクロールが出ないよう
   * body の overflow: hidden に頼っている。
   */
  shatter: (chars) =>
    gsap.timeline().from(chars, {
      opacity: 0,
      x: () => gsap.utils.random(-180, 180),
      y: () => gsap.utils.random(-140, 140),
      rotation: () => gsap.utils.random(-120, 120),
      scale: 0.3,
      duration: 0.7,
      ease: 'power4.out',
      // 数値でなくオブジェクトを渡すと順序を指定できる。'random' は左から順ではなく
      // ばらばらの順に着地させる指定で、破片が寄り集まる感じになる。
      // 合計の長さは each × (文字数 - 1) のままなので、上限の考え方は変わらない
      stagger: { each: staggerFor(chars.length, 0.03), from: 'random' },
    }),
} satisfies Record<string, Effect>;

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

export function resolveEffect(name: string | undefined): Effect {
  if (name === undefined) return effects[DEFAULT_EFFECT];

  if (!isEffectName(name)) {
    console.warn(`未知の演出名です: ${name}（既定の ${DEFAULT_EFFECT} を使います）`);
    return effects[DEFAULT_EFFECT];
  }

  return effects[name];
}
