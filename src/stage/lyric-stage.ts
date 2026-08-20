import { SplitText } from 'gsap/SplitText';
import type { LyricLine } from '../domain/lyrics';
import type { LyricPresenter } from '../domain/ports';
import { LAYOUT_CLASS, resolveEffect, type EffectLayout, type EffectTimeline } from './effects';

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
 * `#stage-text` の class と style はこのクラスの所有物として扱う。
 * 他所から触ると clear() が踏み潰す。
 */
export class LyricStage implements LyricPresenter {
  private readonly root: HTMLElement;
  private split: SplitText | null = null;
  private timeline: EffectTimeline | null = null;
  /** 今あてているレイアウト。clear() で同じものを外すために控える */
  private layout: EffectLayout | null = null;

  // tsconfig の erasableSyntaxOnly が有効なので、コンストラクタ引数に
  // private を付ける書き方（パラメータプロパティ）は使えない。明示的に代入する。
  constructor(root: HTMLElement) {
    this.root = root;
  }

  show(line: LyricLine): void {
    this.clear();

    // 歌詞は外部 JSON から来るので、必ず textContent で入れる（innerHTML は使わない）
    this.root.textContent = line.text;

    const { layout, build } = resolveEffect(line.effect);

    // レイアウトは分割より先に当てる。SplitText は分割時の組み方を前提に
    // 要素を作るので、後から縦書きにすると型を lines に広げたときに破綻する
    if (layout !== null) {
      this.root.classList.add(LAYOUT_CLASS[layout]);
      this.layout = layout;
    }

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
  }
}
