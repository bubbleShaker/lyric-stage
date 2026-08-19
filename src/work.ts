/**
 * この作品固有の値。
 *
 * 「?lyrics= を読む」「public/lyrics/<name>.json を取る」といった仕組みは
 * どの曲でも同じなので、曲名やファイル名はそちら（app 層）に置かない。
 * 複数曲に対応するときは、ここを差し替えるか JSON へ移す。
 */

/** 作品本編の歌詞シート名。?lyrics= の指定が無いときはこれを読む */
export const DEFAULT_SHEET_NAME = 'shining-star';

/** 音源。public/ からの相対パス */
export const AUDIO_PATH = 'audio/maou_14_shining_star.mp3';
