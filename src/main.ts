import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { loadLyricSheet, lyricSheetNameFromLocation } from './app/load-lyric-sheet';
import { sliceSheet } from './domain/lyrics';
import { mountLyricTimeline } from './app/lyric-timeline';
import { Ticker } from './app/ticker';
import { assetUrl } from './lib/asset';
import { requiredElement } from './lib/dom';
import { systemReducedMotion } from './lib/reduced-motion';
import { AudioPlayer } from './stage/audio-player';
import { LyricStage } from './stage/lyric-stage';
import { createLoudness, systemAudioContext } from './stage/loudness';
import { ScaledCanvas, systemPixelRatio } from './stage/scaled-canvas';
import { Starfield } from './stage/starfield';
import { mountTransport } from './stage/transport';
import { mountTransportIdle } from './stage/transport-idle';
import { WindowedPlayback } from './stage/windowed-playback';
import { AUDIO_PATH, DEFAULT_SHEET_NAME, LOUDNESS_RANGE, workWindowFor } from './work';
import './style.css';

// GSAP のプラグインは使う前に gsap 本体へ登録する。登録することで gsap 側が
// プラグインの存在を知り、tween からその機能を呼べるようになる。
gsap.registerPlugin(SplitText);

// ここは composition root。各層を組み立てて起動するだけで、
// 演出の中身も歌詞の判定ロジックも持たない。
const ticker = new Ticker();

// 音の要素はここが持つ。再生の制御（AudioPlayer）と解析（Loudness）が
// 同じ音を別々の側面から使うため、どちらか一方の持ち物にはしない
const media = new Audio();
const loudness = createLoudness(media, systemAudioContext, LOUDNESS_RANGE);

// どのシートを見るかは URL で決まる。区間はシートに固有の値なので、対応付けは work.ts が持つ
const sheetName = lyricSheetNameFromLocation(location.search, DEFAULT_SHEET_NAME);
const workWindow = workWindowFor(sheetName);

// 音源は全長のまま置き、切り出しはここで包んで行う。以降のすべて
// （再生コントロール・歌詞・背景）は「0 秒から始まる作品」だけを見る
const player = new WindowedPlayback(new AudioPlayer(media, assetUrl(AUDIO_PATH)), workWindow);

// OS の「視差効果を減らす」設定。読み方だけを渡し、いつ読むかは受け取った側が決める。
// 文字も背景も動くので、同じ設定を両方へ渡す
const prefersReducedMotion = systemReducedMotion();
const stage = new LyricStage(
  { frame: requiredElement('stage-frame'), text: requiredElement('stage-text') },
  prefersReducedMotion,
);

const toggle = requiredElement<HTMLButtonElement>('transport-toggle');
const transportRoot = requiredElement('transport');

const transport = mountTransport(player, {
  root: transportRoot,
  toggle,
  seek: requiredElement<HTMLInputElement>('transport-seek'),
  time: requiredElement('transport-time'),
  message: requiredElement('transport-message'),
});

// 構図が画面の下端まで使うので、再生中に操作が途切れたらコントロールを画から退ける。
// 解除の関数は捨てている（ページの寿命 = アプリの寿命）
mountTransportIdle({ root: transportRoot, player });

// AudioContext はユーザー操作を起点にしないと動き出せない（音の自動再生と同じ制限）。
// 再生ボタンのクリックに相乗りする。mountTransport 側の再生処理とは独立
toggle.addEventListener('click', () => {
  loudness.start();
});

// 解析の効き（静かな区間とサビの値の開き）は実音を聴きながらでないと決められないので、
// 開発時だけ覗けるようにしておく。import.meta.env.DEV は本番ビルドで false に
// 畳まれ、この塊ごと消える（effect-preview.html が window.gsap を出すのと同じ趣旨）
if (import.meta.env.DEV) {
  (window as unknown as { loudness: typeof loudness }).loudness = loudness;
}

// 毎フレームの駆動はここで一括して行う（rAF はアプリ全体で 1 本）。
// 購読解除の関数は捨てている。ページの寿命 = アプリの寿命なので破棄しない。
// 区間の終わりで止めるのは毎フレーム見張る。timeupdate は 250ms 程度の粗さでしか
// 飛ばないので、任せると終端を行き過ぎて最後の 1 行が切れて見える
ticker.subscribe(() => {
  player.keepInWindow();
});
ticker.subscribe(transport.render);
// 解析値の取り込みは背景より先。同じフレームの値を背景が読む
ticker.subscribe(loudness.sample);

// 背景は装飾。canvas を塞ぐブラウザや context を作れない状況でも、
// 歌詞と音（作品の本体）は動かなければならないので、失敗をここで受け止める。
// 星が出ないことより、真っ黒な画面に死んだ再生コントロールだけが残る方が悪い
try {
  const canvas = new ScaledCanvas(requiredElement<HTMLCanvasElement>('backdrop'), systemPixelRatio);
  const backdrop = new Starfield(canvas, prefersReducedMotion, loudness.level);
  // 背景の時計も曲の再生位置。シークすれば星の瞬きも一緒に飛ぶ
  ticker.subscribe(() => backdrop.render(player.currentTime));
} catch (error) {
  console.warn('背景の星空を出せませんでした。歌詞と音はそのまま動きます', error);
}

ticker.start();

loadLyricSheet(sheetName)
  .then((sheet) => {
    // 区間で切り出し、時刻を区間の先頭起点に付け替える。以降 domain は
    // 「作品の何秒目か」しか扱わない（WHOLE_SONG なら素通し）
    mountLyricTimeline(player, ticker, sliceSheet(sheet, workWindow), stage);
  })
  .catch((error: unknown) => {
    // 再生コントロール側のメッセージ欄とは別の場所に出す。
    // あちらは毎フレーム書き換わるので、書いてもすぐ消えてしまう。
    requiredElement('stage-message').textContent = '歌詞ファイルを読み込めませんでした。';
    console.error(error);
  });
