import type { AudioPlayer } from './audio-player';

/** 12.34 秒 → "0:12" */
function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
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
 * 再生コントロールの見た目を AudioPlayer に繋ぐ。
 * 状態を持つのは AudioPlayer 側だけで、ここは「映すだけ」に徹する。
 */
export function mountTransport(player: AudioPlayer, el: TransportElements): void {
  // シークバーをドラッグしている間は再生位置での上書きを止める。
  // これをしないと、つまみを掴んだ瞬間に再生位置へ引き戻される。
  let scrubbing = false;

  const render = () => {
    const { duration, currentTime } = player;

    el.toggle.textContent = player.paused ? '再生' : '停止';
    el.toggle.setAttribute('aria-label', player.paused ? '再生' : '停止');
    el.time.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;

    if (!scrubbing) {
      el.seek.max = String(duration || 0);
      el.seek.value = String(currentTime);
    }

    const ready = player.currentStatus === 'ready';
    el.toggle.disabled = !ready;
    el.seek.disabled = !ready;

    if (player.currentStatus === 'error') {
      el.message.textContent =
        '音源が見つかりません。README の手順で public/audio/ に mp3 を置いてください。';
      el.root.dataset.state = 'error';
    } else {
      el.message.textContent = ready ? '' : '音源を読み込んでいます…';
      el.root.dataset.state = ready ? 'ready' : 'loading';
    }
  };

  el.toggle.addEventListener('click', () => {
    // 自動再生ポリシーで拒否された場合など、play() の reject を握り潰さない
    player.toggle().catch((error: unknown) => {
      el.message.textContent = '再生できませんでした。もう一度お試しください。';
      console.error(error);
    });
  });

  el.seek.addEventListener('pointerdown', () => {
    scrubbing = true;
  });
  el.seek.addEventListener('input', () => {
    el.time.textContent = `${formatTime(Number(el.seek.value))} / ${formatTime(player.duration)}`;
  });
  const commitSeek = () => {
    if (!scrubbing) return;
    scrubbing = false;
    player.currentTime = Number(el.seek.value);
  };
  el.seek.addEventListener('pointerup', commitSeek);
  el.seek.addEventListener('change', commitSeek);

  player.subscribe(render);

  // 再生中は毎フレーム表示を更新する。timeupdate イベントは 250ms 程度しか
  // 発火せずカクつくため、M2 のタイムラインと同じ rAF ループで回す。
  const tick = () => {
    if (!player.paused || scrubbing) render();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  render();
}
