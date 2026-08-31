import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { loadLyricSheet, lyricSheetNameFromLocation } from './app/load-lyric-sheet';
import { createBeatPulse, createFlashPulse, shiftBeatGrid } from './domain/beat';
import { createFadeCurve } from './domain/fade';
import { createPolarityTrack, sliceSheet, withPrelude } from './domain/lyrics';
import { mountLyricTimeline } from './app/lyric-timeline';
import { Ticker } from './app/ticker';
import { assetUrl } from './lib/asset';
import { requiredElement } from './lib/dom';
import { systemReducedMotion } from './lib/reduced-motion';
import { AudioPlayer } from './stage/audio-player';
import type { Backdrop } from './stage/backdrop';
import { mountBeatImpact } from './stage/beat-impact';
import { loadDeclaredFonts } from './stage/display-font';
import { GrainField } from './stage/grain-field';
import { GraphField } from './stage/graph-field';
import { LyricStage } from './stage/lyric-stage';
import { createLoudness, systemAudioContext } from './stage/loudness';
import { ScaledCanvas, systemPixelRatio } from './stage/scaled-canvas';
import { mountScenePolarity } from './stage/scene-polarity';
import { mountScreenDecor } from './stage/screen-decor';
import { mountTransport } from './stage/transport';
import { mountTransportIdle } from './stage/transport-idle';
import { WindowedPlayback } from './stage/windowed-playback';
import { mountWorkFade } from './stage/work-fade';
import {
  AUDIO_PATH,
  BEAT_GRID,
  DEFAULT_SHEET_NAME,
  LOUDNESS_RANGE,
  WORK_FADE,
  preludeFor,
  workWindowFor,
} from './work';
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
const lines = requiredElement('stage-lines');
const stage = new LyricStage(lines, prefersReducedMotion);

// 画を裏返す枠（M9-3a / Issue #57）。中身は index.html が持ち、ここは掴むだけ。
// **画に属するものはすべてこの中**（背景・画面の図形・歌詞・再生コントロール・
// クレジット）。外に出したものは裏返らず、暗くなった地の上に取り残される
const scene = requiredElement('scene');

// 画面に敷く図形（M8-3b / Issue #45）。分割線と四隅のマークは静的なので、
// 敷いたら以降は触らない（動きが無いので prefersReducedMotion も要らない）。
// .stage の中ではなく枠の直下に置くのは、あちらが「中の要素はすべて absolute で
// ある前提」で組まれているため（style.css）。返り値のレイヤーは M8-4 が光の膜を敷く先
const screenDecor = mountScreenDecor(scene);

// ビート同期の衝撃（M8-4 / Issue #49）。**格子が「いつ」を、実音が「どれだけ」を決める。**
// 格子は曲の先頭起点で測ってあるので、区間で切り出した時間軸へ起点を付け替える
// （歌詞に対して sliceSheet が行う付け替えと同じこと）。
//
// 光るのは拍ごと、揺れるのは 8 分ごと。**下限（2.5Hz）が掛かるのは光る側だけ** —
// 揺れは明滅ではないので発作の閾値の話に乗らず、前庭系への配慮は
// prefersReducedMotion が受け持つ（domain/beat.ts）。createFlashPulse でしか
// 作れない型を光る側が要求するので、8 分の刻みを取り違えて渡すと型検査が止める
const beatGrid = shiftBeatGrid(BEAT_GRID, workWindow.start);
const beatImpact = mountBeatImpact(
  { layer: screenDecor, lines },
  {
    flash: createFlashPulse(beatGrid, { division: 1, decay: 0.5 }),
    shake: createBeatPulse(beatGrid, { division: 2, decay: 0.45 }),
  },
  prefersReducedMotion,
  loudness.level,
);

// 頭と終わりのフェード（M12-2 / Issue #70）。**画と音を同じ曲線で開け閉めする。**
// 長さは区間から取る（WHOLE_SONG なら無限＝尻のフェードは効かない）。音量の口を
// loudness から取っているのは、解析のグラフを立てた時点で**音の出口があちら側へ
// 移る**ため（要素の volume が効くかはブラウザ任せになる。stage/loudness.ts）
const workFade = mountWorkFade(
  requiredElement('work-fade'),
  createFadeCurve(workWindow.end - workWindow.start, WORK_FADE),
  loudness.setVolume,
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
// フェードは区間に収めた後の位置で決める（keepInWindow より後に置くこと）。
// 画と音の両方をここが動かす
ticker.subscribe(() => workFade.render(player.currentTime));
// 解析値の取り込みは背景より先。同じフレームの値を背景が読む
ticker.subscribe(loudness.sample);
// 拍の衝撃も同じフレームの解析値を読む。時計は曲の再生位置なので、
// シークすれば瞬きも揺れも一緒に飛ぶ（背景と同じ扱い）
ticker.subscribe(() => beatImpact.render(player.currentTime));

// 背景は装飾。canvas を塞ぐブラウザや context を作れない状況でも、
// 歌詞と音（作品の本体）は動かなければならないので、失敗をここで受け止める。
// 背景が出ないことより、真っ黒な画面に死んだ再生コントロールだけが残る方が悪い。
//
// **層ごとに独立して受け止める**（M11 のレビュー指摘 🟡）。1 つの try で囲むと、
// 新しい層の失敗が既存の層を道連れにする（構築順が先なので、グラフが落ちれば
// 粒も出ない）。購読も層ごとに分ける — Ticker は購読者単位でしか例外を握らないので、
// 1 本にまとめると片方が毎フレーム投げたときにもう片方も止まる。
//
// **どの描き手を使うかを決めているのはこの塊だけ**（M8-2 / Issue #41）。
// Backdrop という口の実装なので、Starfield（M5 の星空）に戻すのもここで済む。
// 1 枚に合成せず canvas ごと分けているのは、層ごとに描き直しの判定を持たせるため
// （粒は 12 コマ/秒、グラフは毎フレーム）。重なりの順は CSS が決める（src/style.css）
function mountBackdrop(canvasId: string, create: (surface: ScaledCanvas) => Backdrop): void {
  try {
    const backdrop = create(
      new ScaledCanvas(requiredElement<HTMLCanvasElement>(canvasId), systemPixelRatio),
    );
    // 背景の時計も曲の再生位置。シークすれば粒のちらつきもグラフの漂いも一緒に飛ぶ
    ticker.subscribe(() => backdrop.render(player.currentTime));
  } catch (error) {
    console.warn(`背景（${canvasId}）を出せませんでした。歌詞と音はそのまま動きます`, error);
  }
}

// 奥から手前へ。ここでの順は購読の順でしかなく、見えの重なりは CSS の z-index が決める
mountBackdrop(
  'backdrop-graph',
  (surface) => new GraphField(surface, prefersReducedMotion, loudness.level),
);
mountBackdrop('backdrop', (surface) => new GrainField(surface, prefersReducedMotion, loudness.level));

ticker.start();

// 歌詞と書体が揃ってから演出を組み立てる。**書体を待つのは見た目のためではない**
// （M8-2a）。SplitText は 1 文字ずつの位置を測ってから動かすので、測った後に書体が
// 差し替わると字幅が変わって位置がずれる。loadDeclaredFonts は決して失敗しないので、
// 下の catch に来るのは歌詞を読めなかった時だけ。
//
// **揃う前でも再生ボタンは押せるままにしてある**（レビュー指摘 🟡 を検討した上での判断）。
// 押されて音だけ先に進んでも、歌詞の判定は毎フレーム「今は何行目か」を聞き直す作りなので
// （app/lyric-timeline.ts）、後から刺さった時点の正しい状態がそのまま揃う。行を取りこぼす
// のではなく、揃うまで何も出ないだけ。逆にボタンを disabled にすると、transport.ts が
// 避けている罠（iOS Safari は play() を呼ぶまでメタデータを取りに行かない）を
// この待ちで作り直すことになる
Promise.all([loadLyricSheet(sheetName), loadDeclaredFonts(document.fonts)])
  .then(([sheet]) => {
    // 区間で切り出し、時刻を区間の先頭起点に付け替える。以降 domain は
    // 「作品の何秒目か」しか扱わない（WHOLE_SONG なら素通し）
    // 序（M14-2）は歌詞シートに書かない（理由は work.ts の PRELUDE）。
    // **切り出した後の軸で挿す** — 序の時刻は「作品の何秒目か」で書いてある
    const staged = withPrelude(sliceSheet(sheet, workWindow), preludeFor(sheetName));
    mountLyricTimeline(player, ticker, staged, stage);

    // 画の明暗（M9-3a / Issue #57）。**変化点だけを抜いて一度だけ組み立てる** —
    // 行の列を毎フレーム遡ると、極性を書いていない行が続くほど探索が伸びる。
    // 歌詞と同じ時計（音の再生位置）で回すので、シークすれば極性も一緒に飛ぶ。
    // 歌詞が読めなければ極性も切り替わらない（既定の paper のまま）が、
    // それは「歌詞の無い画」として正しい姿
    const polarity = mountScenePolarity(scene, createPolarityTrack(staged));
    ticker.subscribe(() => polarity.render(player.currentTime));
  })
  .catch((error: unknown) => {
    // 再生コントロール側のメッセージ欄とは別の場所に出す。
    // あちらは毎フレーム書き換わるので、書いてもすぐ消えてしまう。
    requiredElement('stage-message').textContent = '歌詞ファイルを読み込めませんでした。';
    console.error(error);
  });
