import { SplitText } from 'gsap/SplitText';
import type { LyricLine } from '../domain/lyrics';
import type { LyricPresenter } from '../domain/ports';
import type { ReducedMotionQuery } from '../lib/reduced-motion';
import { resolveComposition, type Composition } from './composition';
import { LAYOUT_CLASS, resolveEffect, type EffectLayout, type EffectTimeline } from './effects';

/**
 * このクラスが受け持つ 2 つの要素。
 *
 * **分かれているのは所有権のため。** GSAP は行の要素の transform を自分のものとして
 * 扱うので、構図（位置・傾き）を同じ要素に置くと取り合いになり、前の行の寄せ方が
 * 次の行に残る。枠は GSAP が決して触らない場所として空けてある。
 */
export interface LyricStageElements {
  /** 構図を当てる外側の枠。位置・大きさの段階・傾きを持つ */
  readonly frame: HTMLElement;
  /** 文字が入る要素。SplitText と演出が動かすのはこちらだけ */
  readonly text: HTMLElement;
}

/**
 * 1 行ぶんの文字を画面に出す係。
 *
 * SplitText は元の要素を作り替えるので、行を差し替えるたびに revert() で
 * 元の姿に戻さないと <div> が積み重なって増え続ける。その後始末をここに閉じ込める。
 *
 * 合わせて **演出が要求するレイアウトを当てるのと外すのの両方**を持つ。演出側は
 * 「縦書きにしたい」と宣言するだけで DOM を触らない。付ける側と外す側が同じ所に
 * あるので、「縦書きの次の行が横書きに戻らない」類の消し忘れが起こらない。
 *
 * `#stage-frame` と `#stage-text` の class と style はこのクラスの所有物として扱う。
 * 他所から触ると clear() が踏み潰す。
 */
export class LyricStage implements LyricPresenter {
  private readonly root: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly prefersReducedMotion: ReducedMotionQuery;
  private split: SplitText | null = null;
  private timeline: EffectTimeline | null = null;
  /** 今あてているレイアウト。clear() で同じものを外すために控える */
  private layout: EffectLayout | null = null;
  /** 今あてている構図。控える理由はレイアウトと同じ */
  private composition: Composition | null = null;

  /**
   * 「動きを減らす」設定の読み方は関数で受け取る。
   *
   * ここで window.matchMedia を直に呼ぶと、このクラスがブラウザ無しでは
   * 組み立てられなくなる。実際の読み方は組み立てる側が知っていればよい
   * （本編は systemReducedMotion、開発用ページは neverReduceMotion）。
   *
   * **既定値は置かない。** 「減らさない」を既定にすると、新しい所で組み立てた時に
   * 渡し忘れてもエラーにならず、動きを減らす設定が静かに無効になる。
   *
   * tsconfig の erasableSyntaxOnly が有効なので、コンストラクタ引数に
   * private を付ける書き方（パラメータプロパティ）は使えない。明示的に代入する。
   */
  constructor(elements: LyricStageElements, prefersReducedMotion: ReducedMotionQuery) {
    this.root = elements.text;
    this.frame = elements.frame;
    this.prefersReducedMotion = prefersReducedMotion;
  }

  show(line: LyricLine): void {
    this.clear();

    // 歌詞は外部 JSON から来るので、必ず textContent で入れる（innerHTML は使わない）
    this.root.textContent = line.text;

    // 設定は行を出すたびに読む。曲の途中で OS の設定を変えても次の行から効く
    // （購読して切り替える作りにしても、演出は 1 秒未満で終わるので違いが出ない）
    const { layout, build } = resolveEffect(line.effect, {
      reducedMotion: this.prefersReducedMotion(),
    });

    // レイアウトは分割より先に当てる。SplitText は分割時の組み方を前提に
    // 要素を作るので、後から縦書きにすると型を lines に広げたときに破綻する
    if (layout !== null) {
      this.root.classList.add(LAYOUT_CLASS[layout]);
      this.layout = layout;
    }

    // 構図も分割より先。演出は文字の位置を「今いる場所からの割合」で動かすので
    // （shatter の xPercent など）、置き場所と大きさが決まった後に組み立てる。
    // 当てる先は枠。行の要素に当てると GSAP と取り合いになる（LyricStageElements）
    const composition = resolveComposition(line.place);
    this.frame.classList.add(...composition.classes);
    for (const [name, value] of Object.entries(composition.vars)) {
      this.frame.style.setProperty(name, value);
    }
    this.composition = composition;

    this.split = SplitText.create(this.root, { type: 'chars' });
    this.timeline = build({ root: this.root, chars: this.split.chars });
  }

  /** 何も表示しない状態に戻す */
  clear(): void {
    // revert() は kill() と違い「トゥイーンを当てる前の姿」まで戻す。
    // 演出が root に残したインラインスタイルもこれで消える
    this.timeline?.revert();
    this.timeline = null;
    this.split?.revert();
    this.split = null;
    this.root.textContent = '';

    if (this.layout !== null) {
      this.root.classList.remove(LAYOUT_CLASS[this.layout]);
      this.layout = null;
    }

    if (this.composition !== null) {
      this.frame.classList.remove(...this.composition.classes);
      for (const name of Object.keys(this.composition.vars)) {
        this.frame.style.removeProperty(name);
      }
      this.composition = null;
    }
  }
}
