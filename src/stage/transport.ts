import type { Playback } from './playback';

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

/**
 * 再生コントロールの見た目を Playback に繋ぐ。
 * 状態を持つのは Playback 側だけで、ここは「映すだけ」に徹する。
 *
 * 戻り値を呼ぶと購読と rAF ループを止める（今は使っていないが、
 * M2 で app 層の ticker に一本化する時にここを差し替える）。
 */
export function mountTransport(player: Playback, el: TransportElements): () => void {
  // シークバーを操作している間は再生位置での上書きを止める。
  // これをしないと、つまみを動かした瞬間に再生位置へ引き戻される。
  // input で立てて change で倒すので、ポインタでもキーボードでも同じ経路になる。
  let scrubbing = false;

  const render = () => {
    const { duration, currentTime } = player;
    const status = player.currentStatus;

    el.toggle.textContent = player.paused ? '再生' : '停止';
    el.time.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;

    if (!scrubbing) {
      el.seek.max = String(duration || 0);
      el.seek.value = String(currentTime);
    }
    el.seek.setAttribute('aria-valuetext', formatTime(Number(el.seek.value)));

    // 再生ボタンは読み込み中でも押せるようにする。iOS Safari は preload を無視し
    // play() が呼ばれるまでメタデータを取りに行かないため、loadedmetadata を
    // 待って disabled にすると永久に再生できなくなる。
    el.toggle.disabled = status === 'error';
    // シークは長さが分かってから
    el.seek.disabled = duration <= 0;

    if (status === 'error') {
      el.message.textContent =
        '音源が見つかりません。README の手順で public/audio/ に mp3 を置いてください。';
      el.root.dataset.state = 'error';
    } else if (status === 'ready') {
      el.message.textContent = '';
      el.root.dataset.state = 'ready';
    } else {
      el.message.textContent = '再生ボタンで音源を読み込みます。';
      el.root.dataset.state = 'loading';
    }
  };

  const onClick = () => {
    // 自動再生ポリシーで拒否された場合など、play() の reject を握り潰さない
    player.toggle().catch((error: unknown) => {
      el.message.textContent = '再生できませんでした。もう一度お試しください。';
      console.error(error);
    });
  };

  // input は操作中に連続して飛ぶ。ここでは時間表示のプレビューだけ更新する
  const onInput = () => {
    scrubbing = true;
    el.time.textContent = `${formatTime(Number(el.seek.value))} / ${formatTime(player.duration)}`;
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

  // 再生中は毎フレーム表示を更新する。timeupdate イベントは 250ms 程度しか
  // 発火せずカクつくため、M2 のタイムラインと同じ rAF ループで回す。
  let frame = 0;
  const tick = () => {
    if (!player.paused) render();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  render();

  return () => {
    cancelAnimationFrame(frame);
    unsubscribe();
    el.toggle.removeEventListener('click', onClick);
    el.seek.removeEventListener('input', onInput);
    el.seek.removeEventListener('change', onChange);
  };
}
