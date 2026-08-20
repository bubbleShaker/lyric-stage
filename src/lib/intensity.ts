/**
 * 「今どれくらい盛り上がっているか」の受け渡し。
 *
 * 読み方（実音の解析）は `stage/loudness.ts` が知っていて、使う側（背景の星空）は
 * この型だけを見る。`lib/reduced-motion.ts` と同じ形にしてあるのは、
 * **描くだけの Starfield が音声解析のモジュールを名指ししないため**。
 */

/** 盛り上がりの強さを尋ねる関数。0（静か）〜1（振り切り） */
export type IntensityQuery = () => number;
