import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { loadLyricSheet, lyricSheetNameFromLocation } from './app/load-lyric-sheet';
import { mountLyricTimeline } from './app/lyric-timeline';
import { Ticker } from './app/ticker';
import { assetUrl } from './lib/asset';
import { AudioPlayer } from './stage/audio-player';
import { LyricStage } from './stage/lyric-stage';
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

// ここは composition root。各層を組み立てて起動するだけで、
// 演出の中身も歌詞の判定ロジックも持たない。
const ticker = new Ticker();
const player = new AudioPlayer(assetUrl('audio/maou_14_shining_star.mp3'));
const stage = new LyricStage(required<HTMLDivElement>('stage-text'));
const message = required('transport-message');

mountTransport(player, ticker, {
  root: required('transport'),
  toggle: required<HTMLButtonElement>('transport-toggle'),
  seek: required<HTMLInputElement>('transport-seek'),
  time: required('transport-time'),
  message,
});

ticker.start();

loadLyricSheet(lyricSheetNameFromLocation(location.search))
  .then((sheet) => {
    document.title = `${sheet.title} — lyric-stage`;
    mountLyricTimeline(player, ticker, sheet, stage);
  })
  .catch((error: unknown) => {
    message.textContent = '歌詞ファイルを読み込めませんでした。';
    console.error(error);
  });
