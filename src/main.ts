import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { assetUrl } from './lib/asset';
import { AudioPlayer } from './stage/audio-player';
import { mountTransport } from './stage/transport';
import './style.css';

// GSAP のプラグインは使う前に gsap 本体へ登録する。登録することで gsap 側が
// プラグインの存在を知り、tween からその機能を呼べるようになる。
gsap.registerPlugin(SplitText);

/** id で要素を取る。無ければ即座に落として原因を分かりやすくする */
function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
}

// --- ステージのタイトル演出（M3 で演出プリセットに置き換える） ---
const stageText = required<HTMLDivElement>('stage-text');
stageText.textContent = 'lyric stage';

// SplitText は元のテキストを 1 文字ずつ <div> に分解してくれる。
// 分解後の要素配列 (split.chars) に対してまとめて gsap.from を掛け、
// stagger で 1 文字ずつ時間をずらすのが「刻む」演出の基本形。
const split = SplitText.create(stageText, { type: 'chars' });

gsap.from(split.chars, {
  opacity: 0,
  yPercent: 60,
  duration: 0.8,
  ease: 'power3.out',
  stagger: 0.06,
});

// --- 音声 ---
const player = new AudioPlayer(assetUrl('audio/maou_14_shining_star.mp3'));

mountTransport(player, {
  root: required('transport'),
  toggle: required<HTMLButtonElement>('transport-toggle'),
  seek: required<HTMLInputElement>('transport-seek'),
  time: required('transport-time'),
  message: required('transport-message'),
});
