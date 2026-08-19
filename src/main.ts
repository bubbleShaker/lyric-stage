import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { loadLyricSheet, lyricSheetNameFromLocation } from './app/load-lyric-sheet';
import { mountLyricTimeline } from './app/lyric-timeline';
import { Ticker } from './app/ticker';
import { assetUrl } from './lib/asset';
import { AudioPlayer } from './stage/audio-player';
import { LyricStage } from './stage/lyric-stage';
import { mountTransport } from './stage/transport';
import { AUDIO_PATH, DEFAULT_SHEET_NAME } from './work';
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
const player = new AudioPlayer(assetUrl(AUDIO_PATH));
const stage = new LyricStage(required<HTMLDivElement>('stage-text'));

const transport = mountTransport(player, {
  root: required('transport'),
  toggle: required<HTMLButtonElement>('transport-toggle'),
  seek: required<HTMLInputElement>('transport-seek'),
  time: required('transport-time'),
  message: required('transport-message'),
});

// 毎フレームの駆動はここで一括して行う（rAF はアプリ全体で 1 本）。
// 購読解除の関数は捨てている。ページの寿命 = アプリの寿命なので破棄しない。
ticker.subscribe(transport.render);
ticker.start();

loadLyricSheet(lyricSheetNameFromLocation(location.search, DEFAULT_SHEET_NAME))
  .then((sheet) => {
    mountLyricTimeline(player, ticker, sheet, stage);
  })
  .catch((error: unknown) => {
    // 再生コントロール側のメッセージ欄とは別の場所に出す。
    // あちらは毎フレーム書き換わるので、書いてもすぐ消えてしまう。
    required('stage-message').textContent = '歌詞ファイルを読み込めませんでした。';
    console.error(error);
  });
