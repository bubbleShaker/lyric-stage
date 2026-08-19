import { assetUrl } from '../lib/asset';
import { parseLyricSheet, type LyricSheet } from '../domain/lyrics';

/**
 * 歌詞ファイル名として許すのは英数字・アンダースコア・ハイフンだけ。
 * URL から来た文字列をそのままパスに埋めると、`../` などで
 * 意図しない場所を読みに行かせられる。ホワイトリストで弾く。
 */
export function isValidSheetName(name: string): boolean {
  return /^[\w-]+$/.test(name);
}

/** 作品本編の歌詞シート。?lyrics= の指定が無いときはこれを読む */
export const DEFAULT_SHEET_NAME = 'shining-star';

/** URL の ?lyrics=xxx で歌詞ファイルを切り替える。既定は本編 */
export function lyricSheetNameFromLocation(search: string): string {
  return new URLSearchParams(search).get('lyrics') || DEFAULT_SHEET_NAME;
}

/** public/lyrics/<name>.json を読み込む */
export async function loadLyricSheet(name: string): Promise<LyricSheet> {
  if (!isValidSheetName(name)) {
    throw new Error('歌詞ファイル名に使えない文字が含まれています');
  }

  const response = await fetch(assetUrl(`lyrics/${name}.json`));
  if (!response.ok) {
    throw new Error(`歌詞ファイルを読み込めませんでした (${response.status})`);
  }

  return parseLyricSheet(await response.json());
}
