import type { Playback } from '../domain/ports';

/** 12.34 秒 → "0:12" */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface TransportElements {
  root: HTMLElement;
  toggle: HTMLButtonElement;
  seek: HTMLInputElement;
  time: HTMLElement;
  message: HTMLElement;
}

export interface TransportHandle {
  /** 表示を最新の状態に合わせる。毎フレーム呼ばれる想定 */
  render(): void;
  dispose(): void;
}

/**
 * 再生コントロールの見た目を Playback に繋ぐ。
 * 状態を持つのは Playback 側だけで、ここは「映すだけ」に徹する。
 *
 * 毎フレーム誰が呼ぶかはここでは決めない（rAF は app 層の Ticker が持つ）。
 * render を外に返し、駆動は組み立て側に任せる。
 */
export function mountTransport(player: Playback, el: TransportElements): TransportHandle {
  // シークバーを操作している間は再生位置での上書きを止める。
  // これをしないと、つまみを動かした瞬間に再生位置へ引き戻される。
  // input で立てて change で倒すので、ポインタでもキーボードでも同じ経路になる。
  let scrubbing = false;

  // 毎フレーム同じ文字列を代入し直すと、role="status" の読み上げが繰り返される。
  // 前回と違う時だけ書き込む。
  const setText = (target: HTMLElement, text: string) => {
    if (target.textContent !== text) target.textContent = text;
  };
  const setAttr = (target: Element, name: string, value: string) => {
    if (target.getAttribute(name) !== value) target.setAttribute(name, value);
  };

  const render = () => {
    const { duration, currentTime } = player;
    const status = player.currentStatus;

    setText(el.toggle, player.paused ? '再生' : '停止');
    setText(el.time, `${formatTime(currentTime)} / ${formatTime(duration)}`);

    if (!scrubbing) {
      setAttr(el.seek, 'max', String(duration || 0));
      el.seek.value = String(currentTime);
    }
    setAttr(el.seek, 'aria-valuetext', formatTime(Number(el.seek.value)));

    // 再生ボタンは読み込み中でも押せるようにする。iOS Safari は preload を無視し
    // play() が呼ばれるまでメタデータを取りに行かないため、loadedmetadata を
    // 待って disabled にすると永久に再生できなくなる。
    el.toggle.disabled = status === 'error';
    // シークは長さが分かってから
    el.seek.disabled = duration <= 0;

    if (status === 'error') {
      setText(
        el.message,
        '音源が見つかりません。README の手順で public/audio/ に mp3 を置いてください。',
      );
      el.root.dataset.state = 'error';
    } else if (status === 'ready') {
      setText(el.message, '');
      el.root.dataset.state = 'ready';
    } else {
      setText(el.message, '再生ボタンで音源を読み込みます。');
      el.root.dataset.state = 'loading';
    }
  };

  const onClick = () => {
    // 自動再生ポリシーで拒否された場合など、play() の reject を握り潰さない
    player.toggle().catch((error: unknown) => {
      setText(el.message, '再生できませんでした。もう一度お試しください。');
      console.error(error);
    });
  };

  // input は操作中に連続して飛ぶ。ここでは時間表示のプレビューだけ更新する
  const onInput = () => {
    scrubbing = true;
    setText(el.time, `${formatTime(Number(el.seek.value))} / ${formatTime(player.duration)}`);
  };

  // change は「値の確定」で、ドラッグを離した時もキー操作の後も飛ぶ
  const onChange = () => {
    scrubbing = false;
    player.seek(Number(el.seek.value));
    render();
  };

  el.toggle.addEventListener('click', onClick);
  el.seek.addEventListener('input', onInput);
  el.seek.addEventListener('change', onChange);

  const unsubscribe = player.subscribe(render);

  render();

  return {
    render,
    dispose: () => {
      unsubscribe();
      el.toggle.removeEventListener('click', onClick);
      el.seek.removeEventListener('input', onInput);
      el.seek.removeEventListener('change', onChange);
    },
  };
}
