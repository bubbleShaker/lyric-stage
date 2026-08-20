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
 */
const MAX_STAGGER_SPAN = 0.8;

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
 */
export const effects: Record<string, Effect> = {
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
};

export const DEFAULT_EFFECT = 'fade';

export function resolveEffect(name: string | undefined): Effect {
  if (name === undefined) return effects[DEFAULT_EFFECT];

  // Object.hasOwn で自前のキーだけを見る。単に effects[name] と書くと
  // 'toString' や '__proto__' のような Object.prototype 由来の値まで拾ってしまい、
  // 外部 JSON の effect 名で関数でないものを呼び出してしまう。
  if (!Object.hasOwn(effects, name)) {
    console.warn(`未知の演出名です: ${name}（既定の ${DEFAULT_EFFECT} を使います）`);
    return effects[DEFAULT_EFFECT];
  }

  return effects[name];
}
