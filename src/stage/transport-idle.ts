import type { Playback } from '../domain/ports';

/**
 * 再生中に操作が途切れたら、再生コントロールを画から退ける（M8-1）。
 *
 * M8-1 で構図が画面の下端まで使うようになり、`.stage` の padding で一括して
 * 避ける手（M4-2）が使えなくなった。代わりに**コントロールの側が退く**。
 *
 * `mountTransport` には足さない。あちらは「Playback を映すだけ」で、こちらは
 * 「人が操作しているか」を見る別の関心事。混ぜると、映す側のテストに
 * タイマーとポインタの事情が持ち込まれる。
 */

/** 最後の操作から隠すまでの待ち時間。短すぎるとシークの途中で消える */
export const IDLE_DELAY_MS = 2000;

/**
 * 隠してよいかの判断に要る事実。
 *
 * DOM もタイマーも出てこない純粋な形にしてある。「どういう時に隠れるか」が
 * 1 か所に書かれ、ブラウザ無しで検査できる。
 */
export interface TransportActivity {
  /** 音が鳴っているか。**止まっている間は隠さない**（操作したいのは大抵そのとき） */
  readonly playing: boolean;
  /** 最後の操作から待ち時間が過ぎたか */
  readonly waited: boolean;
  /** コントロールの中にキーボードのフォーカスがあるか */
  readonly focused: boolean;
  /** ポインタがコントロールの上にあるか */
  readonly hovered: boolean;
}

export function shouldHideTransport(activity: TransportActivity): boolean {
  const { playing, waited, focused, hovered } = activity;
  // focused を外さないのは、キーボードだけで操作している人から
  // 「今どこにフォーカスがあるか」が見えなくなるため
  return playing && waited && !focused && !hovered;
}

export interface TransportIdleOptions {
  readonly root: HTMLElement;
  readonly player: Playback;
  readonly delayMs?: number;
}

/**
 * 判断を DOM に繋ぐ。`data-idle` を書くだけで、見た目は CSS が持つ。
 *
 * 戻り値を呼ぶと後始末する。
 */
export function mountTransportIdle({
  root,
  player,
  delayMs = IDLE_DELAY_MS,
}: TransportIdleOptions): () => void {
  let waited = false;
  let timer = 0;

  // タッチ端末はタップした要素に :hover を残すことがある（sticky hover）ので、
  // ホバーを持つ環境でだけ hover を見る。これを見ないと、再生ボタンをタップした指が
  // 離れた後もコントロールが「触られている」ことになり、**タッチ端末でだけ退かない**。
  // style.css の @media (hover: hover) と同じ判断。マウスを後から挿しても追従するよう、
  // 問い合わせ結果は都度読む
  const hover = window.matchMedia('(hover: hover)');

  const apply = () => {
    const hide = shouldHideTransport({
      playing: !player.paused,
      waited,
      // :focus-within と :hover は CSS 側の状態だが、判断には値として要る。
      // ここだけ DOM に直接聞く
      focused: root.contains(document.activeElement),
      hovered: hover.matches && root.matches(':hover'),
    });

    // 前回と違う時だけ書き込む。apply は pointermove ごとに走るので、同じ値でも
    // 代入すると毎イベント setAttribute が走る（transport.ts の setText / setAttr と同じ方針）
    const next = String(hide);
    if (root.dataset.idle !== next) root.dataset.idle = next;
  };

  /** 操作があった。数え直して、いま一度出す */
  const wake = () => {
    waited = false;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      waited = true;
      apply();
    }, delayMs);
    apply();
  };

  // window で拾うのは、**コントロールの外を触った時にも戻ってほしい**ため。
  // 画面のどこかを触った人は大抵コントロールを探している。
  // タッチ端末には pointermove がほとんど来ないので pointerdown も見る。
  //
  // ポインタ系は passive で登録する。毎フレーム飛ぶうえ preventDefault は呼ばないので、
  // 宣言しておくとブラウザがスクロールの処理をこちらの待ち合わせ無しに進められる
  window.addEventListener('pointermove', wake, { passive: true });
  window.addEventListener('pointerdown', wake, { passive: true });
  window.addEventListener('keydown', wake);
  // focusin / focusout は focus と違って親まで上がってくるので root で拾える
  root.addEventListener('focusin', wake);
  root.addEventListener('focusout', wake);

  // 再生・停止そのものも「操作」として扱う。**止まった時に出てこないと困る** —
  // 作品が終端で自動的に止まったときは人が何も触っていないので、これが無いと
  // 隠れたまま戻らない。
  //
  // ただし購読は再生位置が進むたびにも鳴る（timeupdate は毎秒 4 回ほど飛ぶ）。
  // そのまま wake に繋ぐと待ち時間が数え直され続け、**再生中は永久に隠れない**。
  // 止まっているかどうかが変わった時だけ起こす
  let wasPaused = player.paused;
  const unsubscribe = player.subscribe(() => {
    if (player.paused === wasPaused) return;
    wasPaused = player.paused;
    wake();
  });

  wake();

  return () => {
    window.clearTimeout(timer);
    window.removeEventListener('pointermove', wake);
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
    root.removeEventListener('focusin', wake);
    root.removeEventListener('focusout', wake);
    unsubscribe();
  };
}
