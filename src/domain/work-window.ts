/**
 * 作品として見せる区間。
 *
 * 音源は曲の全長のまま置く（加工版は素材の利用ルールで置けない）ので、
 * 「作品はここからここまで」という切り出しはデータ側が持つ。
 *
 * 歌詞（sliceSheet）と再生位置（WindowedPlayback）の両方が使うので、
 * どちらか一方のファイルではなくここに置く。
 */
export interface WorkWindow {
  /** 曲の先頭からの秒数 */
  readonly start: number;
  /** 曲の先頭からの秒数。start より後でなければならない */
  readonly end: number;
}

/**
 * 曲を丸ごと 1 つの作品として扱う区間。
 *
 * 区間を切らない場合の**特別扱いを消すため**に置く。これを渡せば
 * sliceSheet は素通し、WindowedPlayback は素の Playback と同じ振る舞いになるので、
 * 組み立てる側が「区間があるとき」「無いとき」で配線を分けなくて済む。
 */
export const WHOLE_SONG: WorkWindow = { start: 0, end: Infinity };
