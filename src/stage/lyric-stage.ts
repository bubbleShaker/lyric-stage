import { SplitText } from 'gsap/SplitText';
import type { LyricLine, ResolvedPart } from '../domain/lyrics';
import type { LyricPresenter } from '../domain/ports';
import type { ReducedMotionQuery } from '../lib/reduced-motion';
import { resolveComposition } from './composition';
import { DECOR_BASE_CLASS, DECOR_LAYOUT_CLASS } from './decor';
import { LAYOUT_CLASS, type EffectLayout, type EffectTimeline } from './effects';
import { buildLineTimeline, type PartTarget } from './line-timeline';

/**
 * 1 行ぶんの語句を画面に出す係。
 *
 * **語句ごとに枠を 1 つ立てる**（M8-5）。枠が構図（位置・大きさ・傾き）を持ち、
 * 中の要素を演出が動かす。分けている理由は所有権 — GSAP は要素の transform を
 * 自分のものとして扱うので、構図を同じ要素に置くと取り合いになり、
 * 前の語句の寄せ方が次に残る（M8-1 で実測した）。
 *
 * 行が変わるたびに枠ごと捨てて作り直す。M8-1 まではただ 1 つの枠を使い回して
 * いたので「当てたクラスを外す」「置いたカスタムプロパティを消す」後始末が
 * 要ったが、**要素ごと捨てるならその手当ては丸ごと不要になる**。消し忘れの
 * 起きようがない形にした。
 *
 * `#stage-lines` の中身はこのクラスの所有物として扱う。他所から足した要素は
 * 次の行で消える。
 */
export class LyricStage implements LyricPresenter {
  private readonly root: HTMLElement;
  private readonly prefersReducedMotion: ReducedMotionQuery;
  private timeline: EffectTimeline | null = null;
  /** 今出している語句の分割。縁を切るために控える（clear() を見よ） */
  private splits: SplitText[] = [];

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
  constructor(root: HTMLElement, prefersReducedMotion: ReducedMotionQuery) {
    this.root = root;
    this.prefersReducedMotion = prefersReducedMotion;
  }

  show(line: LyricLine): void {
    this.clear();

    // 設定は行を出すたびに読む。曲の途中で OS の設定を変えても次の行から効く
    // （購読して切り替える作りにしても、演出は 1 秒未満で終わるので違いが出ない）
    // 返ってくるタイムラインは止まっている（GSAP 自身の時計には乗らない）。
    // 進めるのは render() だけ ＝ 音の再生位置
    this.timeline = buildLineTimeline(line, (part, layout) => this.appendPart(part, layout), {
      reducedMotion: this.prefersReducedMotion(),
    });
  }

  /** 行の頭からの経過秒に合わせて描く。進める役はこれだけ */
  render(offset: number): void {
    // 負の値（行が始まる前）は 0 に潰す。gsap は後ろ側を端で頭打ちにするが、
    // 負の位置は「最後まで進んだ状態」と解釈されうる
    this.timeline?.time(Math.max(0, offset));
  }

  /** 何も表示しない状態に戻す */
  clear(): void {
    // kill() で GSAP のティッカーから外す。revert() で元の姿に戻す必要は無い —
    // 動かしていた要素ごと、この後の replaceChildren() で消えるため
    this.timeline?.kill();
    this.timeline = null;

    // SplitText は分割のために要素を作り替えるだけでなく、指定によっては
    // フォントの読み込み完了（document.fonts）や ResizeObserver を購読する。
    // 今の指定（type: 'chars' / autoSplit 既定）では購読しないので要素ごと
    // 捨てれば足りるが、**それは分割の指定に依存した安全**でしかない。
    // 指定を増やした時に購読が積み上がらないよう、ここで必ず縁を切る
    for (const split of this.splits) split.kill();
    this.splits = [];

    this.root.replaceChildren();
  }

  /** 語句 1 つぶんの枠を立てて、演出の当て先を返す */
  private appendPart(part: ResolvedPart, layout: EffectLayout | null): PartTarget {
    const frame = document.createElement('div');
    frame.className = 'stage__frame';

    const composition = resolveComposition(part.place);
    frame.classList.add(...composition.classes);
    for (const [name, value] of Object.entries(composition.vars)) {
      frame.style.setProperty(name, value);
    }

    const text = document.createElement('div');
    text.className = 'stage__text';
    // 歌詞は外部 JSON から来るので、必ず textContent で入れる（innerHTML は使わない）
    text.textContent = part.text;

    // レイアウトは分割より先に当てる。SplitText は分割時の組み方を前提に
    // 要素を作るので、後から縦書きにすると型を lines に広げたときに破綻する
    if (layout !== null) text.classList.add(LAYOUT_CLASS[layout]);

    frame.append(text);
    // 分割は木に繋いでから。SplitText は文字の位置を測るので、
    // 繋ぐ前だとレイアウトが決まっておらず測れない
    this.root.append(frame);

    const split = SplitText.create(text, { type: 'chars' });
    this.splits.push(split);

    return {
      frame,
      root: text,
      chars: split.chars,
      createDecor: (className) => this.insertDecor(text, className, layout),
    };
  }

  /**
   * 図形 1 つぶんの当て先を、語句の枠の中・**文字の直前**に挿す（M8-3a）。
   *
   * 枠は `transform-style: preserve-3d` を持つので、同じ奥行きにある要素の重なりは
   * 木の順で決まる（z-index は効かない）。文字より前に置けば奥に描かれる。
   * 順序を呼ぶ側の都合に委ねない。
   *
   * **ただし「必ず」ではない。** 木の順が効くのは同じ奥行きにある間だけで、
   * 奥から迫る演出（`rushIn` / `swing`）の最中は文字の方が奥へ行く。面の図形は
   * そこで文字を隠すので、噛み合わせは `DecorEntry.solid` として持ち、
   * `src/lyric-sheets.test.ts` が落とす。
   *
   * 頭に挿す（prepend）のではなく文字の直前に挿すのは、**シートに書いた順が
   * そのまま奥から手前の順になる**ようにするため。頭に挿すと順が逆になり、
   * 重ねた図形どうしが被ったときにどちらが上か読めなくなる。
   */
  private insertDecor(
    text: HTMLElement,
    className: string,
    layout: EffectLayout | null,
  ): HTMLElement {
    const decor = document.createElement('div');
    decor.className = DECOR_BASE_CLASS;
    decor.classList.add(className);
    // 図形は文字の兄弟なので writing-mode が届かない。伸びる向きと敷く辺を
    // 揃えるために、組み方はクラスで別に伝える（stage/decor.ts）
    if (layout !== null) decor.classList.add(DECOR_LAYOUT_CLASS[layout]);

    text.before(decor);

    return decor;
  }
}
