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

/** URL の ?lyrics=xxx で歌詞ファイルを切り替える。既定は sample */
export function lyricSheetNameFromLocation(search: string): string {
  return new URLSearchParams(search).get('lyrics') || 'sample';
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
