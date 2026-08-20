import { SplitText } from 'gsap/SplitText';
import type { LyricLine } from '../domain/lyrics';
import type { LyricPresenter } from '../domain/ports';
import { resolveEffect, type EffectTimeline } from './effects';

/**
 * 1 行ぶんの文字を画面に出す係。
 *
 * SplitText は元の要素を作り替えるので、行を差し替えるたびに revert() で
 * 元の姿に戻さないと <div> が積み重なって増え続ける。その後始末をここに閉じ込める。
 *
 * 合わせて **行と行の間で root を初期状態へ戻す**責任も持つ。演出は root に
 * クラスを付けたりインラインスタイルを残したりしてよく、その後始末を書かなくてよい
 * （縦書きの次の行が横書きに戻らない、といった消し忘れを構造的に無くすため）。
 */
export class LyricStage implements LyricPresenter {
  private readonly root: HTMLElement;
  /** 演出が汚す前の class。clear() のたびにここへ戻す */
  private readonly baseClassName: string;
  private split: SplitText | null = null;
  private timeline: EffectTimeline | null = null;

  // tsconfig の erasableSyntaxOnly が有効なので、コンストラクタ引数に
  // private を付ける書き方（パラメータプロパティ）は使えない。明示的に代入する。
  constructor(root: HTMLElement) {
    this.root = root;
    this.baseClassName = root.className;
  }

  show(line: LyricLine): void {
    this.clear();

    // 歌詞は外部 JSON から来るので、必ず textContent で入れる（innerHTML は使わない）
    this.root.textContent = line.text;

    this.split = SplitText.create(this.root, { type: 'chars' });
    this.timeline = resolveEffect(line.effect)({ root: this.root, chars: this.split.chars });
  }

  /** 何も表示しない状態に戻す */
  clear(): void {
    this.timeline?.kill();
    this.timeline = null;
    this.split?.revert();
    this.split = null;
    this.root.textContent = '';

    // SplitText.revert() が戻すのは root の中身だけで、演出が root 自身に付けた
    // クラスやインラインスタイルは残る。ここで初期状態に引き戻す
    this.root.className = this.baseClassName;
    this.root.removeAttribute('style');
  }
}
