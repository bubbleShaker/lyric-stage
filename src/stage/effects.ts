import gsap from 'gsap';

/**
 * 1 行分の演出。SplitText が分解した文字要素を受け取り、
 * その行の登場アニメーションを組み立てて返す。
 */
export type Effect = (chars: Element[]) => gsap.core.Timeline;

/** 演出が返すタイムラインの型（gsap を値として import せずに参照するため） */
export type EffectTimeline = ReturnType<Effect>;

/**
 * 演出プリセットの一覧。
 *
 * 表示側は switch で分岐せず、この表を引くだけにする。
 * こうすると新しい演出を足すときに既存のコードを触らずに済む（開放閉鎖の原則）。
 * M3 でここに「刻む」系の演出を追加していく。
 */
export const effects: Record<string, Effect> = {
  /** 下からふわりと出る。effect の指定が無いときの既定 */
  fade: (chars) =>
    gsap.timeline().from(chars, {
      opacity: 0,
      yPercent: 40,
      duration: 0.6,
      ease: 'power3.out',
      stagger: 0.04,
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
