import { SplitText } from 'gsap/SplitText';
import type { LyricLine } from '../domain/lyrics';
import type { LyricPresenter } from '../domain/ports';
import { resolveEffect, type EffectTimeline } from './effects';

/**
 * 1 行ぶんの文字を画面に出す係。
 *
 * SplitText は元の要素を作り替えるので、行を差し替えるたびに revert() で
 * 元の姿に戻さないと <div> が積み重なって増え続ける。その後始末をここに閉じ込める。
 */
export class LyricStage implements LyricPresenter {
  private readonly root: HTMLElement;
  private split: SplitText | null = null;
  private timeline: EffectTimeline | null = null;

  // tsconfig の erasableSyntaxOnly が有効なので、コンストラクタ引数に
  // private を付ける書き方（パラメータプロパティ）は使えない。明示的に代入する。
  constructor(root: HTMLElement) {
    this.root = root;
  }

  show(line: LyricLine): void {
    this.clear();

    // 歌詞は外部 JSON から来るので、必ず textContent で入れる（innerHTML は使わない）
    this.root.textContent = line.text;

    this.split = SplitText.create(this.root, { type: 'chars' });
    this.timeline = resolveEffect(line.effect)(this.split.chars);
  }

  /** 何も表示しない状態に戻す */
  clear(): void {
    this.timeline?.kill();
    this.timeline = null;
    this.split?.revert();
    this.split = null;
    this.root.textContent = '';
  }
}
