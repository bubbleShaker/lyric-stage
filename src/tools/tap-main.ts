/**
 * 収録ページ（tap.html）の組み立て。
 *
 * 本編の main.ts と同じく、各層を繋ぐだけで判断は持たない。
 * 音の再生・シークは本編と同じ AudioPlayer / mountTransport をそのまま使う
 * （収録のためだけの再生系を別に持つと、本編と挙動がずれる）。
 */

import { loadLyricSheet, lyricSheetNameFromLocation } from '../app/load-lyric-sheet';
import { Ticker } from '../app/ticker';
import { assetUrl } from '../lib/asset';
import { requiredElement } from '../lib/dom';
import { AudioPlayer } from '../stage/audio-player';
import { mountTransport } from '../stage/transport';
import { AUDIO_PATH, DEFAULT_SHEET_NAME } from '../work';
import { mountTapTool } from './tap-tool';
// 様式を持ち込むのは組み立てる側（本編の main.ts が style.css を持つのと同じ）
import './tap-tool.css';

const player = new AudioPlayer(new Audio(), assetUrl(AUDIO_PATH));
const ticker = new Ticker();

const transport = mountTransport(player, {
  root: requiredElement('transport'),
  toggle: requiredElement<HTMLButtonElement>('transport-toggle'),
  seek: requiredElement<HTMLInputElement>('transport-seek'),
  time: requiredElement('transport-time'),
  message: requiredElement('transport-message'),
});

ticker.subscribe(transport.render);
ticker.start();

const hint = requiredElement('tap-hint');

// 読み込んだ JSON は loadLyricSheet の中で parseLyricSheet を通っている。
// 収録はその検証済みのシートを土台にする（検証を二重には持たない）
loadLyricSheet(lyricSheetNameFromLocation(location.search, DEFAULT_SHEET_NAME))
  .then((sheet) => {
    document.title = `収録: ${sheet.title}`;
    mountTapTool(sheet, player, {
      list: requiredElement('tap-list'),
      hint,
      progress: requiredElement('tap-progress'),
      exportButton: requiredElement<HTMLButtonElement>('tap-export'),
      output: requiredElement<HTMLTextAreaElement>('tap-output'),
    });
  })
  .catch((error: unknown) => {
    hint.textContent = '歌詞ファイルを読み込めませんでした。';
    console.error(error);
  });
