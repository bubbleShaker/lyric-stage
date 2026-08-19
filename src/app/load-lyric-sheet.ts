import { assetUrl } from '../lib/asset';
import { parseLyricSheet, type LyricSheet } from '../domain/lyrics';

/**
 * public/lyrics/<name>.json を読み込む。
 *
 * name は URL の ?lyrics= から来るため、パス区切りや .. を含むものは弾く。
 * 外から与えられた文字列をそのまま URL に埋めない。
 */
export async function loadLyricSheet(name: string): Promise<LyricSheet> {
  if (!/^[\w-]+$/.test(name)) {
    throw new Error(`歌詞ファイル名に使えない文字が含まれています: ${name}`);
  }

  const response = await fetch(assetUrl(`lyrics/${name}.json`));
  if (!response.ok) {
    throw new Error(`歌詞ファイルを読み込めませんでした (${response.status})`);
  }

  return parseLyricSheet(await response.json());
}

/** URL の ?lyrics=xxx で歌詞ファイルを切り替える。既定は sample */
export function lyricSheetNameFromLocation(search: string): string {
  return new URLSearchParams(search).get('lyrics') ?? 'sample';
}
