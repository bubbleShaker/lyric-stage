import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import type { LyricLine, ResolvedPart } from '../domain/lyrics';
import type { LyricPresenter } from '../domain/ports';
import type { ReducedMotionQuery } from '../lib/reduced-motion';
import { CAMERA_CLASS, type Focus } from './camera';
import { resolveComposition } from './composition';
import { DECOR_BASE_CLASS, DECOR_LAYOUT_CLASS } from './decor';
import { DRIFT_CLASS } from './drift';
import { LAYOUT_CLASS, TEXT_CLASS, type EffectLayout, type EffectTimeline } from './effects';
import { buildLineTimeline, type PartTarget } from './line-timeline';
import {
  SPARK_BASE_CLASS,
  SPARK_ECHO_CLASS,
  SPARK_PIECE_CLASS,
  type SparkShape,
  type SparkTarget,
} from './spark';
import { SUB_CLASS, SUB_TEXT_CLASS } from './sub-text';

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
 *
 * **ただし要素そのものの inline style は別の持ち主が居る**（M8-4）。
 * `stage/beat-impact.ts` が拍ごとに `--beat-shake-x/y` を書く。子（中身）と
 * style で持ち主が分かれているだけなので今は無害だが、このクラスが root の
 * style を触り始めると取り合いになる（`.stage__frame` の transform を GSAP と
 * 分け合わないのと同じ線）。
 */
export class LyricStage implements LyricPresenter {
  private readonly root: HTMLElement;
  /**
   * 寄る・離れるを持つ層（M13-4）。**行をまたいで使い回す。**
   *
   * 語句の枠は行ごとに捨てて作り直すが、こちらは 1 枚あればよい。作り直すと、
   * 前の行の最後の寄せがそのまま次の行の頭に残る（transform は要素と一緒に消えるので、
   * 作り直せば必ず素の姿から始まる — つまり作り直す方が安全に見えるが、
   * **枠を測るのはこの箱の中**なので、行ごとに差し替えると測る基準まで作り直しになる）。
   * 据え直すのは `clear()` の仕事。
   */
  private readonly camera: HTMLElement;
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

    this.camera = document.createElement('div');
    this.camera.className = CAMERA_CLASS;
    this.root.append(this.camera);
  }

  show(line: LyricLine, span: number): void {
    this.clear();

    // 設定は行を出すたびに読む。曲の途中で OS の設定を変えても次の行から効く
    // （購読して切り替える作りにしても、演出は 1 秒未満で終わるので違いが出ない）
    // 返ってくるタイムラインは止まっている（GSAP 自身の時計には乗らない）。
    // 進めるのは render() だけ ＝ 音の再生位置
    this.timeline = buildLineTimeline(line, (part, layout) => this.appendPart(part, layout), {
      span,
      camera: this.camera,
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

    // **カメラは残して中身だけ捨てる**（M13-4）。捨てて作り直すと、次の行の枠を
    // 測る基準そのものが作り直しになる（`camera` の説明を見よ）。
    // 代わりに寄せを素へ戻す — **測るのはカメラが素の姿のときでなければならない**。
    // 前の行の寄せが残ったまま測ると、行を追うごとに倍率がずれていく
    gsap.set(this.camera, { clearProps: 'transform' });
    this.camera.replaceChildren();
  }

  /**
   * 語句 1 つぶんの枠を立てて、演出の当て先を返す。
   *
   * 木は `枠 > 漂う層 > (図形・英字・文字・一過性の装飾)` の 3 段（M13-2 で 1 段増えた）。
   * **段ごとに触る人が違う** — 枠は CSS（構図）、漂う層は漂い、文字は演出。
   * 同じ段を 2 人が触ると transform を奪い合う。
   */
  private appendPart(part: ResolvedPart, layout: EffectLayout | null): PartTarget {
    const frame = document.createElement('div');
    frame.className = 'stage__frame';

    const composition = resolveComposition(part.place);
    frame.classList.add(...composition.classes);
    for (const [name, value] of Object.entries(composition.vars)) {
      frame.style.setProperty(name, value);
    }

    // 漂う層（M13-2）。**語句の中身をまるごと包む**ので、図形も英字も装飾も一緒に漂う。
    // 添え物だけ取り残されると、語句に貼り付いているという前提（M8-3a）が崩れる
    const drift = document.createElement('div');
    drift.className = DRIFT_CLASS;

    const text = document.createElement('div');
    text.className = TEXT_CLASS;
    // 歌詞は外部 JSON から来るので、必ず textContent で入れる（innerHTML は使わない）
    text.textContent = part.text;

    // レイアウトは分割より先に当てる。SplitText は分割時の組み方を前提に
    // 要素を作るので、後から縦書きにすると型を lines に広げたときに破綻する
    if (layout !== null) text.classList.add(LAYOUT_CLASS[layout]);

    drift.append(text);
    frame.append(drift);
    // 分割は木に繋いでから。SplitText は文字の位置を測るので、
    // 繋ぐ前だとレイアウトが決まっておらず測れない
    this.camera.append(frame);

    const split = SplitText.create(text, { type: 'chars' });
    this.splits.push(split);

    return {
      frame,
      drift,
      root: text,
      chars: split.chars,
      focus: this.focusOn(frame),
      createDecor: (className) => this.insertDecor(text, className, layout),
      createSub: (sub) => this.insertSub(text, sub),
      createSpark: (spark) => this.appendSpark(drift, spark, part.text),
    };
  }

  /**
   * カメラが向く先を測る（M13-4）。**画面に対する割合**で返す。
   *
   * px ではなく割合にするのは、受け取る側（`stage/camera.ts`）に測り方を持たせない
   * ため。あちらは「画面の真ん中からどれだけずれているか」と「画面の幅の何割か」だけで
   * 寄る量を決められる。
   *
   * **カメラが素の姿であることが前提。** 寄せが残ったまま測ると、測った値に前の行の
   * 倍率が掛かる（`clear()` が毎行戻している）。
   *
   * **測れない時は画面の真ん中・幅 0 を返す。** `getBoundingClientRect` は要素が
   * 描かれていなければ 0 を返し、幅 0 の割り算は `Infinity` になる。`camera.ts` の
   * `zoomFor` が幅 0 を「寄らない」に倒すので、ここは素直に測った値を渡す。
   */
  private focusOn(frame: HTMLElement): Focus {
    const box = frame.getBoundingClientRect();
    const stage = this.camera.getBoundingClientRect();

    if (stage.width === 0 || stage.height === 0) return { x: 0.5, y: 0.5, width: 0, aspect: 1 };

    return {
      x: (box.left + box.width / 2 - stage.left) / stage.width,
      y: (box.top + box.height / 2 - stage.top) / stage.height,
      width: box.width / stage.width,
      aspect: stage.width / stage.height,
    };
  }

  /**
   * 一過性の装飾の当て先を、語句の**漂う層の末尾**に足す（M10-1 / 当て先は M13-2 で
   * 枠から漂う層へ移した — 語句が漂うのに装飾だけ枠に残ると、置いていかれる）。
   *
   * 図形（`insertDecor`）と英字（`insertSub`）は文字の**前**に挿して奥へ回すが、
   * こちらは後ろに足して**手前**に置く。添え物ではなく、語句の上で一瞬だけ起きる
   * 出来事なので、文字に隠れては意味が無い。
   *
   * **ただし「必ず手前」ではない**（レビュー指摘 🟡 を実測で確かめた）。`rushIn` は
   * 文字を `z: -1400` から動かすので手前・奥の関係は保たれるが、`swing` は語句を
   * 左端まわりに `rotationY: -78` で回すので、**右側ほど z が正になり文字が手前へ出る**。
   * 実測では `swing × ghost` で朱の複製が字の後ろに回り込む。
   *
   * 図形の `DecorEntry.solid` ほどの実害は無い（あちらは面が語句を丸ごと隠す）が、
   * **語句の複製を添える `ghost` だけは話が別**。複製は語句にぴったり重なって初めて
   * 影として読めるのに、演出が語句だけを変形すると**複製は取り残されて別の語に見える**
   * （`swing` の 0.08 秒では、回って縮んだ語句の横に等倍の複製が並ぶ）。
   * `src/lyric-sheets.test.ts` が組み合わせを落とす。
   *
   * 破片は数だけ立てて中身は入れない — 形は `style.css` が持つ。ただし
   * `echoesText` の案（`ghost`）だけは語句の文字を写す。**同じクラス
   * （`TEXT_CLASS`）を当てて写す**ので、書体・太さ・字間・行間は自動で揃う
   * （書き並べると、書体を変えた日に 2 か所を直すことになる）。
   *
   * **箱ごと支援技術から隠す**（レビュー指摘 🔴）。装飾は「読むものでも押すものでもない」
   * ので `pointer-events: none` と対になる指定だが、`ghost` では実害がある —
   * 写した複製は SplitText を通らない生のテキストなので、**同じ語句が 2 度読み上げられる**
   * （本文側は分割の過程で `aria-label` にまとまり 1 度しか読まれない）。
   * 図形（文字を持たない）と英字（作者が意図して置いた別の語）では出ていなかった問題。
   */
  private appendSpark(host: HTMLElement, spark: SparkShape, text: string): SparkTarget {
    const box = document.createElement('div');
    box.className = SPARK_BASE_CLASS;
    box.classList.add(spark.className);
    box.setAttribute('aria-hidden', 'true');

    const pieces = Array.from({ length: spark.pieces }, () => {
      const piece = document.createElement('div');
      piece.className = SPARK_PIECE_CLASS;

      if (spark.echoesText) {
        piece.classList.add(SPARK_ECHO_CLASS);
        // 歌詞と同じく外から来た文字列なので、必ず textContent で入れる
        piece.textContent = text;
      }

      box.append(piece);

      return piece;
    });

    host.append(box);

    return { box, pieces };
  }

  /**
   * 英字サブテキストの当て先を、語句の枠の中・文字の直前に挿す（M8-3c）。
   *
   * 図形と同じ位置（文字より奥）に置く。英字は語句の箱の外に載るので重なりは
   * 起きないが、**添え物が文字より手前に来ない**という並びをここで揃えておく。
   *
   * 組み方のクラスは当てない。縦組みでも英字は横組みのまま段の頭に載せる
   * （理由は `stage/sub-text.ts`）。
   */
  private insertSub(text: HTMLElement, sub: string): HTMLElement {
    const box = document.createElement('div');
    box.className = SUB_CLASS;

    // 箱の中に字そのものを包む要素を 1 枚立てる。拭き取り（clip-path）は
    // 箱ではなくこちらに掛かる — 箱は枠（＝語句）の幅なので、そのまま切ると
    // **語句より長い英字のはみ出した分が永久に描かれない**（stage/sub-text.ts）
    const glyphs = document.createElement('span');
    glyphs.className = SUB_TEXT_CLASS;
    // 歌詞と同じく外部 JSON から来る文字列なので、必ず textContent で入れる
    glyphs.textContent = sub;

    box.append(glyphs);
    text.before(box);

    // gsap が動かすのは箱の側。カスタムプロパティは継承するので、
    // 拭き取りを掛けている内側の要素にそのまま届く
    return box;
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
