import { describe, expect, it } from 'vitest';
import {
  createPolarityTrack,
  findRapidPolarityFlip,
  lineSpanAt,
  parseLyricSheet,
  partsOf,
  sliceSheet,
  withPrelude,
  type LyricLine,
  type ResolvedPart,
} from './domain/lyrics';
import { isAnchorName, isSizeName } from './stage/composition';
import { decors, isDecorName } from './stage/decor';
import { effects, isEffectName, resolveEffect } from './stage/effects';
import { CAMERA_MOVE } from './stage/camera';
import { EXIT_DURATION, exitStartFor } from './stage/exit';
import { isVeilName, kanjiOf } from './stage/kanji-veil';
import { buildLineTimeline, LINE_SETTLED } from './stage/line-timeline';
import { isSparkName, sparks, type SparkShape } from './stage/spark';
import { secondsPerBeat } from './domain/beat';
import { BEAT_GRID, DEFAULT_SHEET_NAME, PRELUDE, WORK_FADE, WORK_WINDOW } from './work';
// Vite の ?raw は対象ファイルを文字列として読み込む。fs を使わずに済むので
// Node の型定義をアプリ側の tsconfig に持ち込まなくてよい。
import sampleJson from '../public/lyrics/sample.json?raw';
import shiningStarJson from '../public/lyrics/shining-star.json?raw';

/**
 * 公開する歌詞シートそのものを検証する。app 層のユニットテストではなく、
 * public/ に置いた成果物の中身を確かめるものなので src/ の直下に置いている。
 *
 * JSON は手で書き換えることも生成し直すこともあるので、壊れていたら
 * ブラウザで開く前に気付けるようにしておく。parser は本番と同じものを使う。
 */
const SHEET_SOURCES: Record<string, string> = {
  'shining-star': shiningStarJson,
  sample: sampleJson,
};

/** mp3 の実測の長さ（276.56 秒）。音源を差し替えたらここも更新する */
const AUDIO_DURATION_SECONDS = 276.5;

it('既定の歌詞シートが実在する', () => {
  // 名前だけ変えて JSON を置き忘れると、本番だけ 404 になって気付けない
  expect(Object.keys(SHEET_SOURCES)).toContain(DEFAULT_SHEET_NAME);
});

describe.each(Object.entries(SHEET_SOURCES))('%s.json', (_name, source) => {
  it('本番の parser で読める', () => {
    expect(() => parseLyricSheet(JSON.parse(source))).not.toThrow();
  });

  const sheet = parseLyricSheet(JSON.parse(source));

  it('title と行がある', () => {
    expect(sheet.title).not.toBe('');
    expect(sheet.lines.length).toBeGreaterThan(0);
  });

  it('time が昇順で重複していない', () => {
    // parseLyricSheet は整列してから返すので、並びは JSON の生の順で確かめる
    const times = (JSON.parse(source).lines as { time: number }[]).map((line) => line.time);
    expect(times).toStrictEqual([...new Set(times)].sort((a, b) => a - b));
  });

  it('空の行が無い', () => {
    expect(sheet.lines.every((line) => line.text.trim() !== '')).toBe(true);
  });

  // 語句の規約はシートに依らないので、本編だけでなく全シートに課す。
  // 行の text は画面に出なくなった（出るのは parts 側）ぶん、
  // ここで一致を見張っておかないと静かに古びる
  it('語句に刻んだ行は、語句を繋ぐと行の歌詞に戻る', () => {
    const mismatched = sheet.lines
      .filter((line) => line.parts !== undefined)
      .map((line) => ({ line, joined: partsOf(line).map((part) => part.text).join('') }))
      .filter(({ line, joined }) => strip(joined) !== strip(line.text))
      .map(({ line, joined }) => `${line.text} ≠ ${joined}`);

    expect(mismatched).toStrictEqual([]);
  });

  it('知らない図形名が書かれていない', () => {
    // 未知の名前は既定に落ちるのではなく**完全に消える**ので、綴りの間違いは
    // 「なぜかその語句にだけ帯が出ない」という形になる。画面を見ても分からない。
    //
    // 演出やアンカーの検査と違って作品の区間に限らないのは、区間の外や開発用の
    // シートに書いた綴り間違いも、区間を広げた時にそのまま出てくるため
    const unknown = sheet.lines
      .flatMap((line) => partsOf(line))
      .flatMap((part) =>
        part.decor.filter((name) => !isDecorName(name)).map((name) => `${part.text}: ${name}`),
      );

    expect(unknown).toStrictEqual([]);
  });

  it('知らない装飾名が書かれていない', () => {
    // 一過性の装飾（M10-1）も図形と同じ — 未知の名前は既定に落ちず**完全に消える**。
    // しかもこちらは 1 秒足らずで消えるものなので、出ていないことに**目で気付く機会が
    // そもそも無い**（帯なら行が終わるまで残るぶん、まだ気付ける）
    const unknown = sheet.lines
      .flatMap((line) => partsOf(line))
      .filter((part) => part.spark !== undefined && !isSparkName(part.spark))
      .map((part) => `${part.text}: ${part.spark}`);

    expect(unknown).toStrictEqual([]);
  });

  it('知らない帳の名前が書かれていない', () => {
    // 帳（M14-1）も図形・装飾と同じで、未知の名前は既定に落ちず**完全に消える**。
    // 帳は画の主役になる大きさなので、消えると「一文が縦に出ているだけの行」になり、
    // しかもそれはそれで画として成立してしまう（間違いに気付く手掛かりが無い）
    const unknown = sheet.lines
      .flatMap((line) => partsOf(line))
      .filter((part) => part.veil !== undefined && !isVeilName(part.veil))
      .map((part) => `${part.text}: ${part.veil}`);

    expect(unknown).toStrictEqual([]);
  });

  it('帳を当てた行は語句に刻んでいない', () => {
    // **帳の前提は「一文を据え置くこと」**（`stage/kanji-veil.ts`）。語句を 1 つずつ
    // 映すカメラ（M13-4）と相反するので、混ぜずに行の単位で切り替えると決めた。
    //
    // 刻んだ行の語句に帳を当てても動きはする（型も綴りも通る）が、**カメラが次の語句へ
    // 移った先に、前の語句の帳だけが取り残される**。文章で書くだけだと M14-3 の
    // 割り当てで静かに破れるので検査にしておく
    const carved = sheet.lines
      .filter((line) => line.parts !== undefined)
      .filter((line) => partsOf(line).some((part) => part.veil !== undefined))
      .map((line) => line.text);

    expect(carved).toStrictEqual([]);
  });

  it('帳を当てた語句に漢字がある', () => {
    // 帳に出るのは漢字だけ（`kanjiOf`）。かなだけの語句に当てると、**箱は立つのに
    // 字が 1 つも無い**ので何も起きない。名前の綴りが正しいぶん、上の検査にも掛からない
    const empty = sheet.lines
      .flatMap((line) => partsOf(line))
      .filter((part) => part.veil !== undefined && kanjiOf(part.text).length === 0)
      .map((part) => `${part.text}: ${part.veil}`);

    expect(empty).toStrictEqual([]);
  });

  it('縦組みの語句に一過性の装飾を当てていない', () => {
    // 英字（M8-3c）と同じ理由。装飾の大きさの基準は「基準 × 段階」だが、縦組みの
    // --size-base は `.stage__text.stage__text--vertical` **自身への宣言**なので、
    // 兄弟である `.stage__spark` には届かない（1280×600 では狙いの 1.6 倍で出る）。
    //
    // 加えて、6 案のうち下線（underline）と四角（blocks）は**横組みの向きを前提に
    // 位置を決めている**。図形（DECOR_LAYOUT_CLASS）のように組み方ごとの変種を持つ道も
    // あるが、6 案 × 2 組み方の形を先に書くことになる。**当面は組み合わせを禁じる**
    const vertical = sheet.lines
      .flatMap((line) => partsOf(line))
      .filter((part) => part.spark !== undefined)
      .filter((part) => resolveEffect(part.effect).layout === 'vertical')
      .map((part) => `${part.text}: ${part.spark}`);

    expect(vertical).toStrictEqual([]);
  });

  it('一過性の装飾と図形が、同じ形の場所で重なっていない', () => {
    // `style.css` のコメント自身が警告している 2 組（レビュー指摘 🟡）。
    // どちらも**同じ寸法・同じ辺**に出るので、重ねると狙いが消える:
    // - `ripple`（広がる輪郭）× `box`（枠）→ 輪郭が二重に見え、どちらが広がったのか読めない
    // - `underline`（走る下線）× `rule`（罫）→ 二重線になり、走ったのか引かれたのか読めない
    //
    // **M10-2 で 19 語句へ割り当てる直前が一番踏みやすい**ので、割り当ての前に置く。
    // 綴りの検査と同じく、区間の外や開発用のシートにも課す
    const clashes: Record<string, string> = { ripple: 'box', underline: 'rule' };
    // 外から来た文字列で素のオブジェクトを引かない（`isSparkName` / `isEffectName` が
    // Object.hasOwn を使っているのと同じ規律。M10-2 で初めて実データがここを通る）
    const clashingDecor = (spark: string) => (Object.hasOwn(clashes, spark) ? clashes[spark] : null);

    const overlapped = sheet.lines
      .flatMap((line) => partsOf(line))
      .filter((part) => {
        if (part.spark === undefined) return false;
        const decor = clashingDecor(part.spark);
        return decor !== null && part.decor.includes(decor);
      })
      .map((part) => `${part.text}: ${part.spark} + ${part.decor.join(', ')}`);

    expect(overlapped).toStrictEqual([]);
  });

  it('語句の複製を添える装飾が、語句や文字を動かす演出に当たっていない', () => {
    // `ghost` は語句にぴったり重なって初めて「一拍ずれた影」として読める。ところが
    // 装飾は語句の**兄弟**なので、演出が語句や文字を動かすと付いてこない。
    //
    // 実測で 2 度踏んだ:
    // - `swing` の 0.08 秒 — 回って縮んだ語句の横に、等倍の複製が並ぶ（M10-1）
    // - `glitch` — 文字が ±60% ずれるので複製がどの字にも重ならず、自前の色ずれと
    //   合わさって帯・字・複製・残像の 4 層になり語句が読めない（M10-2）
    //
    // **画でしか気付けない噛み合わせ**なので、`DecorEntry.solid` × 奥行きと同じ手で
    // 実際に組み立てて見る。演出名の表にすると、演出を足した時に更新を忘れる
    const echoing = new Set(
      Object.entries(sparks)
        .filter(([, entry]) => entry.echoesText)
        .map(([name]) => name),
    );

    const stranded = sheet.lines
      .flatMap((line) => partsOf(line))
      .filter((part) => part.spark !== undefined && echoing.has(part.spark))
      .filter((part) => movesText(part.effect))
      .map((part) => `${part.text}: ${part.spark} + ${part.effect}`);

    expect(stranded).toStrictEqual([]);
  });

  it('面の図形が、奥行きを動かす演出の語句に当たっていない', () => {
    // 語句の枠は preserve-3d なので、図形と文字は**同じ 3D 空間に居る**。
    // 木の順（図形を文字より前に挿す）が効くのは同じ奥行きにある間だけで、
    // 奥から迫る演出（rushIn は文字を z: -1400 から、swing は語句ごと z: -260 から）
    // の最中は文字の方が奥へ行く。面の図形はそこで文字を丸ごと隠す。
    //
    // **画面でしか気付けない噛み合わせ**なので、演出のタイムラインが奥行きの
    // プロパティを動かすかどうかを実際に組み立てて見る（演出名を並べた表にすると、
    // 演出を足したときに更新を忘れる）。
    // 知らない図形名の検査と同じ理由で、作品の区間に限らず全シート・全行に課す
    const hidden = sheet.lines
      .flatMap((line) => partsOf(line))
      .filter((part) => part.decor.some((name) => isDecorName(name) && decors[name].solid))
      .filter((part) => movesInDepth(part.effect))
      .map((part) => `${part.text}: ${part.effect}`);

    expect(hidden).toStrictEqual([]);
  });

  it('図形と英字が同じ語句に重なっていない', () => {
    // どちらも「この語句をここに留める」ための重み（M8-3c）。重ねると 1 つの語句だけが
    // 極端に重くなり、語句ごとに軽重を付けるという刻みの狙い（M8-5）が消える。
    //
    // 見た目の理由もある — 枠（box）の輪郭は語句の箱より 0.18em 外まで出るので、
    // 語句の上に載る英字とぶつかる。方針と実害が同じ向きを向いているので検査にした。
    // 綴り間違いの検査と同じく、区間の外や開発用のシートにも課す（広げた時に出てくる）
    const overloaded = sheet.lines
      .flatMap((line) => partsOf(line))
      .filter((part) => part.sub !== undefined && part.decor.length > 0)
      .map((part) => `${part.text}: ${part.sub} + ${part.decor.join(', ')}`);

    expect(overloaded).toStrictEqual([]);
  });

  it('サブテキストが ASCII で書かれている', () => {
    // 「英字サブテキスト」は語句に添える小見出しで、字間を大きく空けて小さく置く。
    // 日本語を書くと歌詞との区別が付かないうえ、その大きさでは読めない。
    //
    // **見ているのは英字かどうかではなく ASCII かどうか**（数字や記号も通る）。
    // 書体のサブセットの都合に合わせてある — ASCII の可読部は
    // tools/subset-font.mjs の EXTRA_CHARS に必ず入っているので、この範囲に
    // 収まっている限りサブセットの作り直しが要らない。逆に、外れた文字を書いた時は
    // **作り直しを促すためにここで落とす**（公開ページで別の書体に落ちるのを防ぐ）
    const nonAscii = sheet.lines
      .flatMap((line) => partsOf(line))
      .filter((part) => part.sub !== undefined && /[^ -~]/.test(part.sub))
      .map((part) => `${part.text}: ${part.sub}`);

    expect(nonAscii).toStrictEqual([]);
  });

  it('サブテキストが語句より長くない', () => {
    // 英字の箱は語句（枠）の幅に張ってあり、寄せ方も枠から継ぐ。**語句より短い限り
    // 語句の縁と揃う**が、長いと右（行末の側）へあふれる。text-align: right でも
    // 左には回らない（実測）ので、右端に置いた語句では画面の外へ出る。
    //
    // 幅は測れない（DOM が要る）ので、**字送りから見積もる**。この書体の大文字の
    // 字送りは平均 0.636em（I=0.264 / W=0.831）なので、英字 1 文字は語句の
    // 0.2 × (0.636 + 字間 0.42) ≈ 0.21em、和文 1 文字は 1.02em。
    // **等しくなるのは 4.8 倍**で、W や M の多い語では 4.1 倍まで落ちる。
    //
    // **上限は 4 倍**（再レビュー指摘 🟡）。当初は 5 倍にして「余裕を持って」と
    // 書いていたが、5 倍は余裕どころか均衡点そのもので、15 文字の英字が
    // 実測 102% の幅で並んでも通っていた。
    //
    // なお**小さな段階や狭い画面では、英字の下限（0.62rem / style.css）が効いて
    // 「語句の 0.2 倍」という前提が崩れる**（sm はどの幅でも、md は 902px 未満で、
    // lg も携帯の幅では下限に当たる）。そこでは英字が見積もりより 4 割ほど広くなるので、
    // この 4 倍にはその分の余裕も含めてある。厳密に見たければ画面を見て決めること
    const tooLong = sheet.lines
      .flatMap((line) => partsOf(line))
      .filter((part) => part.sub !== undefined && part.sub.length > part.text.length * 4)
      // `?` は型の都合（filter では絞られない）。ASCII 縛りが外れたら、
      // UTF-16 単位で数えている `length` も見直しが要る
      .map((part) => `${part.text}(${part.text.length}) に ${part.sub}(${part.sub?.length})`);

    expect(tooLong).toStrictEqual([]);
  });

  it('縦組みの語句に英字を添えていない', () => {
    // 英字は組み方ごとの変種を持たない（回さない／`stage/sub-text.ts`）が、**大きさの
    // 基準までは追従できない**（レビュー指摘 🟡）。縦組みの `--size-base` は
    // `.stage__text.stage__text--vertical` 自身への宣言なので、兄弟である
    // `.stage__sub` には届かない。1280×600 では縦組みの基準 36px に対して英字は
    // 横組みの基準 57.6px で計算され、**狙いの 1.6 倍の大きさ**で出る。
    //
    // 図形（.stage__decor）も同じ構図だが、あちらは 0.28em のはみ出し幅に効くだけで
    // 済んでいる。こちらは font-size そのものなので、当面は組み合わせを禁じる。
    // 縦組みの語句に英字を添えたくなったら、基準の置き換えを枠の側へ移す話になる
    const vertical = sheet.lines
      .flatMap((line) => partsOf(line))
      .filter((part) => part.sub !== undefined)
      .filter((part) => resolveEffect(part.effect).layout === 'vertical')
      .map((part) => `${part.text}: ${part.sub}`);

    expect(vertical).toStrictEqual([]);
  });

  it('語句が行の猶予の中で出る', () => {
    // at は行の time からの相対秒。行が消えた後の時刻を書いても、その語句は
    // 一度も画に出ないまま終わる（画面を見ても「なぜか出ない語句」にしか見えない）
    const late = sheet.lines
      .flatMap((line, index) =>
        partsOf(line).map((part) => ({ line, part, gap: gapAfter(sheet.lines, index) })),
      )
      .filter(({ part, gap }) => part.at >= gap)
      .map(({ line, part, gap }) => `${line.text} の「${part.text}」: at=${part.at} / 猶予 ${gap} 秒`);

    expect(late).toStrictEqual([]);
  });
});

describe(`${DEFAULT_SHEET_NAME}.json`, () => {
  const sheet = parseLyricSheet(JSON.parse(SHEET_SOURCES[DEFAULT_SHEET_NAME]));

  it('曲の長さに収まっている', () => {
    const last = sheet.lines[sheet.lines.length - 1];
    expect(last.time).toBeLessThan(AUDIO_DURATION_SECONDS);
  });

  it('歌い出しより前には何も置かれていない', () => {
    expect(sheet.lines[0].time).toBeGreaterThan(10);
  });

  it('知らない演出名が書かれていない', () => {
    // 未知の名前でも既定の演出に落ちて動いてしまうので、綴りの間違いは
    // 画面を見ても気付けない。ここで名指しして落とす。
    // （sample.json は「未知の名前は fade に落ちる」ことを見せる行を意図的に持つので対象外）
    //
    // 語句（parts）の指定も partsOf 経由で一緒に見る。行に書いた名前だけを見ると、
    // 刻んだ行では実際に使われる名前が検査を素通りする
    const unknown = sheet.lines
      .flatMap((line) => partsOf(line).map((part) => part.effect))
      .filter((name): name is string => name !== undefined && !isEffectName(name));

    expect(unknown).toStrictEqual([]);
  });

  it('全ての行に演出が書かれている', () => {
    // 本編シートは全行に effect を明示する規約にしている。省略しても既定の fade で
    // 動いてしまうので、「意図して fade を選んだ行」と「割り当てを忘れた行」が
    // 画面を見ても区別できない。ここで書き忘れを名指しして落とす。
    const missing = sheet.lines.filter((line) => line.effect === undefined).map((line) => line.text);

    expect(missing).toStrictEqual([]);
  });

  it('同じ歌詞の行には同じ演出が当たっている', () => {
    // 1 番・2 番・ラスサビの対応する行を同じ演出で揃える、という割り当ての方針
    // （M4-3 で決めた）。繰り返しを「型」として見せることで曲の構成が画で分かる。
    // 方針を変えるときは、この検査ごと書き換える。
    //
    // **ここだけは partsOf を通していない**（他の演出系の検査は M8-5 で全部
    // 語句の層へ移した）。作品の区間だけを刻んである以上、同じ歌詞に「刻んだ版」と
    // 「刻んでいない版」が並ぶのは普通の状態で、語句の層で突き合わせると必ず落ちる。
    // 裏返すと、**語句の層では M4-3 の「型」を誰も見張っていない**（レビュー指摘 🟡）。
    // 区間を広げて同じ歌詞が 2 度刻まれたら、そこは目で揃えること
    const byText = new Map<string, Set<string | undefined>>();
    for (const line of sheet.lines) {
      const seen = byText.get(line.text) ?? new Set();
      seen.add(line.effect);
      byText.set(line.text, seen);
    }

    const inconsistent = [...byText]
      .filter(([, seen]) => seen.size > 1)
      .map(([text, seen]) => `${text}: ${[...seen].map((e) => e ?? '(未指定)').join(' / ')}`);

    expect(inconsistent).toStrictEqual([]);
  });

  it('同じ歌詞の行が 2 度刻まれていたら、語句の刻み方まで揃っている', () => {
    // 上の「同じ演出」を**語句の層へ延長したもの**（M12-1 / Issue #69 のレビュー指摘 🔴）。
    //
    // 上の検査が partsOf を通していないのは、作品の区間だけを刻んである以上
    // 「刻んだ版」と「刻んでいない版」が並ぶのが普通の状態だから。だからといって
    // 語句の層に見張りが無いままだと、**同じ歌詞を 2 度刻んだ時に片方だけ触っても
    // 全テストが緑**になる（M8-5 のレビューが「そこは目で揃えること」と申し送った所で、
    // M12-1 で区間を広げて `シャイニングスター綴れば` が実際に 2 度刻まれた）。
    // このリポジトリは palette.ts / charset.txt でも「写しである以上いつか片方だけ直る」
    // を機械に降ろしてきたので、ここも同じ扱いにする。
    //
    // **両方が刻まれている組だけを見る。** 片方が丸ごとの行なら、それは
    // 「区間の外なのでまだ刻んでいない」という普通の状態
    const byText = new Map<string, LyricLine[]>();
    for (const line of sheet.lines) {
      if (line.parts === undefined) continue;
      byText.set(line.text, [...(byText.get(line.text) ?? []), line]);
    }

    // 比べるのは **partsOf を通した後の姿**（行から継いだ effect / place も含めて、
    // 実際に画へ出るもの同士を突き合わせる）
    const inconsistent = [...byText]
      .filter(([, lines]) => lines.length > 1)
      .map(([text, lines]) => ({ text, shapes: lines.map((line) => JSON.stringify(partsOf(line))) }))
      .filter(({ shapes }) => new Set(shapes).size > 1)
      .map(({ text }) => text);

    expect(inconsistent).toStrictEqual([]);
  });

  it('最後の行が消える時刻を持っている', () => {
    // 最後の行だけは「次の行の time」が無いので、duration を書かないと曲の終わりまで
    // 出しっぱなしになる（アウトロの約 41 秒）。下の「次の行が来る前に出揃う」も
    // 最終行だけは猶予を Infinity として扱うので、ここで別に見る。
    const last = sheet.lines[sheet.lines.length - 1];

    expect(last.duration).toBeDefined();
  });

  it('縦書きの行にラテン文字が含まれていない', () => {
    // writing-mode: vertical-rl は text-orientation を指定しないとラテン文字を
    // 横倒しにする（日本語縦組みの慣例どおり）。本編には
    // "I'll believe of my sensation" のような行があるので、CSS で場合分けするより
    // 縦書きを日本語の行にだけ当てる方針にした（M4-3 で決めた）。
    //
    // 演出名ではなく layout で判定する。守りたいのは「縦組みになる行」であって
    // 「vertical という名前の行」ではないので、縦書き系の演出が増えても追従する。
    // 数字も同じ理由で横倒しになるので併せて見る。
    // 語句に刻んだ行では、縦書きになるかどうかは語句ごとに決まる（M8-5）ので
    // partsOf 経由で見る。行の effect だけを見ると、刻んだ行が素通りする
    const latin = sheet.lines
      .flatMap((line) => partsOf(line))
      .filter((part) => resolveEffect(part.effect).layout === 'vertical')
      .filter((part) => /[\p{Script=Latin}\p{Nd}]/u.test(part.text))
      .map((part) => part.text);

    expect(latin).toStrictEqual([]);
  });

  it('縦書きは行が長く留まる所にだけ当たっている', () => {
    // 縦組みは画が大きく変わるぶん場面転換として効くが、行が数秒ごとに入れ替わる
    // 区間で使うと組み方が毎行変わって落ち着かない。そこで「6 秒前後の伸ばしの行に
    // だけ当てる」と決めた（M4-3）。文章で書くだけだと、M6 で time を詰め直した時に
    // 縦書きの行が短い区間へ静かに紛れ込むので検査にしておく。
    // 語句に刻んだ行では、その語句が居られるのは「行の猶予 - 出る時刻」になる
    const hasty = sheet.lines
      .flatMap((line, index) =>
        partsOf(line).map((part) => ({ part, stay: gapAfter(sheet.lines, index) - part.at })),
      )
      .filter(({ part }) => resolveEffect(part.effect).layout === 'vertical')
      .filter(({ stay }) => stay < 5)
      .map(({ part, stay }) => `${part.text}: ${stay.toFixed(2)} 秒`);

    expect(hasty).toStrictEqual([]);
  });

  it('帳が滞在に収まって、字が全部出る', () => {
    // 帳は 1 字あたりの持ち時間に下限（`MIN_VEIL_SLOT` = 1 秒）を持ち、**収まらないなら
    // 丸ごと出さない**（明滅の安全。字を間引くと文の漢字が黙って欠けるため）。
    // つまり短い行に当てると、綴りも組み合わせも正しいのに**画には何も出ない**。
    //
    // **本番と同じ組み立て（`buildLineTimeline`）で測る**（レビュー指摘 🔴）。
    // 滞在を「行の猶予 - 語句が出る時刻」と手で書くと、本番が渡している
    // 「退場が始まるまで」（`exitStartFor` のぶん 0.4 秒短い）と食い違い、
    // **境界の割り当てが検査を通ったまま画から消える**。刻んだ行では食い違いはもっと大きい
    const silent = sheet.lines.flatMap((line, index) =>
      silentVeilsOf(line, gapAfter(sheet.lines, index)),
    );

    expect(silent).toStrictEqual([]);
  });

  it('各行の演出がその行の猶予に収まる', () => {
    // 割り当てが確定したので、実際の組み合わせ（その行に当てた演出 × その行の文字数
    // × その行の猶予）で測る。下の「どの演出も」はレジストリ全体の安全網で、
    // 実在しない最悪の組み合わせを見ているぶんこちらより厳しい。
    //
    // **本番と同じ組み立て（buildLineTimeline）で測る。** 語句を刻むと行の長さは
    // 「最後の語句が出る時刻 + その演出の長さ」になるので、演出単体を測っても
    // 刻みすぎに気付けない。DOM の代わりにダミーを渡せば、組み立てだけを借りられる。
    //
    // **見るのは尺ではなくラベル**（M13-2）。漂いが入って以降、タイムラインの尺は
    // 「行が出ている長さ」そのものになった（着地した語句が行の終わりまで漂うため）ので、
    // 尺を猶予と比べても必ず等しくなるだけで何も分からない。知りたいのは
    // 「最後の語句が出揃うのは行が変わる前か」で、それが `LINE_SETTLED` の立つ時刻
    const overrun = sheet.lines
      .map((line, index) => {
        const gap = gapAfter(sheet.lines, index);
        const timeline = buildLineTimeline(
          line,
          (part) => dummyTarget(part.text.length, kanjiOf(part.text).length),
          { span: gap, camera: {} },
        );
        const settled = timeline.labels[LINE_SETTLED];
        timeline.kill();
        // **ラベルが消えたら落とす**（レビュー指摘 🟡）。型の上は number だが、
        // `addLabel` を落とせば実行時は undefined になる。`undefined >= gap` は false
        // なので、**この検査だけが黙って無効化されたまま緑になる**
        expect(settled).toBeTypeOf('number');
        return { line, settled, gap };
      })
      .filter(({ settled, gap }) => settled >= gap)
      .map(({ line, settled, gap }) => `${line.text}: ${settled} 秒 / 猶予 ${gap} 秒`);

    expect(overrun).toStrictEqual([]);
  });

  it('語句は次の語句が出るまでに出揃う', () => {
    // **退場（M13-3）が入って初めて要る検査**（レビュー指摘 🟡）。語句は次の語句が
    // 出る時刻から引き始めるので、そこまでに出揃っていないと**出切らないうちに
    // 引き始める** ＝ 「一瞬映って消えた」になる。
    //
    // 上の「行の猶予に収まる」は行ぜんぶが出揃う時刻しか見ないので、**語句の間隔と
    // 出揃う時刻の関係は誰も見ていなかった**。本編の余裕は 0.126 秒しかない
    // （最短の間隔 0.751 秒 対 `スター` の 0.625 秒）ので、Issue #37 で耳を頼りに
    // `at` を詰めた日に静かに破れる
    const hasty = sheet.lines.flatMap((line) =>
      partsOf(line).flatMap((part, order, all) => {
        const next = all[order + 1];
        if (next === undefined) return [];

        const appears = settledOf(part);
        const gap = next.at - part.at;

        return appears <= gap ? [] : [`${part.text}: 出揃うまで ${appears} 秒 / 次まで ${gap} 秒`];
      }),
    );

    expect(hasty).toStrictEqual([]);
  });

  it('退場が行の終わりをはみ出さない', () => {
    // M13-3。はみ出すと**引き切る前に行が切り替わって DOM ごと捨てられる** ＝
    // 不透明度が残ったまま消える一瞬のポップになる。
    //
    // 上の「行の猶予に収まる」は退場の 0.4 秒を見ていないので、`at` を行末へ寄せた
    // 語句はそこを通り抜ける（再レビューの指摘 🟡）
    const overrun = sheet.lines.flatMap((line, index) => {
      const span = lineSpanAt(sheet.lines, index);

      return partsOf(line).flatMap((part, order, all) => {
        const leaves = exitStartFor(settledOf(part), all[order + 1]?.at, span);
        if (leaves === null) return [];

        const ends = leaves + EXIT_DURATION;

        return ends <= span ? [] : [`${part.text}: 消え終わり ${ends} 秒 / 行は ${span} 秒`];
      });
    });

    expect(overrun).toStrictEqual([]);
  });

  it('カメラが次の語句へ移りきれる', () => {
    // M13-4。カメラは語句の少し手前から動き出して、出た後に着く。**間隔がこれより
    // 詰まると、前の語句がまだ画面の真ん中に居るうちに次へ動き出す**。
    // `camera.test.ts` は定数どうしを比べているだけでシートを読んでいない
    // （レビュー指摘 🟡）ので、噛み合わせはここで見る
    const gaps = sheet.lines.flatMap((line) =>
      partsOf(line).flatMap((part, order, all) =>
        all[order + 1] === undefined ? [] : [all[order + 1].at - part.at],
      ),
    );

    expect(CAMERA_MOVE).toBeLessThanOrEqual(Math.min(...gaps));
  });

  it('退場の長さが語句の間隔より短い', () => {
    // **これが逆転すると、次の語句が出ている間じゅう前の語句が引き続ける** ＝
    // 「対応するセリフだけ映す」（Issue #73）と正面から擦れる。
    // `EXIT_DURATION` を伸ばした日にここが落ちる（再レビューの指摘 🟡 — 3.0 秒に
    // 書き換えても本編の検査は全部緑だった）
    const gaps = sheet.lines.flatMap((line) =>
      partsOf(line).flatMap((part, order, all) =>
        all[order + 1] === undefined ? [] : [all[order + 1].at - part.at],
      ),
    );

    expect(EXIT_DURATION).toBeLessThan(Math.min(...gaps));
  });

  it('どの演出も次の行が来る前に出揃う', () => {
    // 演出の所要時間は文字数で決まり、猶予は行間隔で決まる。どちらも実データ側で
    // 変わりうる（M6 のタイミング入力ツールで time を詰めたときなど）ので、
    // 定数を書かずにシートから測る。
    //
    // こちらは「最長の行 × 最短の猶予」という実在しない組み合わせで全演出を測る
    // 安全網。まだ割り当てていない演出も含めて、どこに振っても破綻しないことを見る。
    // 実際の組み合わせは上の「各行の演出がその行の猶予に収まる」が測っているので、
    // 伸ばしの行専用のゆっくりした演出を足したくなったら、この検査の方を緩める。
    const worst = worstCase(sheet.lines);

    for (const name of Object.keys(effects)) {
      // レジストリには関数と { layout, build } の 2 通りが書けるので resolveEffect で揃える
      const timeline = resolveEffect(name).build(dummyTarget(worst.longestText));
      expect(timeline.duration(), `${name} が ${worst.shortestGap} 秒に収まらない`).toBeLessThan(
        worst.shortestGap,
      );
      timeline.kill();
    }
  });
});

/**
 * 作品として見せる区間（WORK_WINDOW）と本編シートの噛み合わせ。
 *
 * M6-3 で 51 行の time を実測に差し替えると歌が動くので、区間だけ据え置くと
 * **全テスト緑のまま作品が空になる**。ここで噛み合わせそのものを見張る。
 */
describe('WORK_WINDOW × 本編シート', () => {
  const sheet = parseLyricSheet(JSON.parse(SHEET_SOURCES[DEFAULT_SHEET_NAME]));
  const sliced = sliceSheet(sheet, WORK_WINDOW);

  it('区間が音源の中に収まっている', () => {
    expect(WORK_WINDOW.start).toBeGreaterThanOrEqual(0);
    expect(WORK_WINDOW.end).toBeLessThan(AUDIO_DURATION_SECONDS);
  });

  it('切り出すとラスサビの 10 行が残る', () => {
    // 作品の姿。M8-0 ではラスサビ 1 ブロック（7 行）だった。
    // M8-5 の間だけ 3 行に縮めていたのを Issue #37 で戻し、
    // **M12-1（Issue #69）で作者の「あと 10 秒」に応えて 3 行足した**（7 → 10）。
    // **短く縮めた状態に戻ることを止めているのはここ**（work.test.ts の尺の下限は
    // 5 行でも 6 行でも通るので、行数まではこちらでしか守れない）
    expect(sliced.lines).toHaveLength(10);
  });

  it('区間の頭に助走がある（いきなり歌から始まらない）', () => {
    // 1 小節ぶん（79.85 BPM で 3.0055 秒）を目安に、無音から入る
    expect(sliced.lines[0].time).toBeGreaterThan(1);
  });

  it('序が歌い出しに食い込まない', () => {
    // 序（M14-2）は歌詞シートに書かず、切り出した後の頭に挿す（work.ts の PRELUDE）。
    // **食い込むと `withPrelude` が投げる** — 起動時に落ちるので画面には
    // 「歌詞ファイルを読み込めませんでした」しか出ない。値は定数なので、ここで止める
    expect(() => withPrelude(sliced, PRELUDE)).not.toThrow();
  });

  it('序が助走の後に出て、歌い出しに繋がる', () => {
    // 序が消えるのと 1 行目が出るのが同じ時刻。**間を空けると画が一度空になる**
    // （無音の間奏に空の画面が数秒残る）ので、ぴったり繋げてある
    const withIt = withPrelude(sliced, PRELUDE);
    const sung = sliced.lines[0];

    expect(withIt.lines[0]).toBe(PRELUDE);
    expect(PRELUDE.time + (PRELUDE.duration ?? 0)).toBeCloseTo(sung.time, 2);
  });

  it('序の帳が実際に出る', () => {
    // **序の尺（6.01 秒）に入る字数は限られる**（`MIN_VEIL_SLOT` の下限より、
    // `single` なら 3 字まで）。一文を書き換えて漢字が増えると、綴りも組み合わせも
    // 正しいのに**帳だけが黙って出なくなる**（画には縦の一文だけが残り、
    // それはそれで成立してしまう）
    expect(silentVeilsOf(PRELUDE, PRELUDE.duration ?? 0)).toStrictEqual([]);
  });

  it('最後の行が区間の終わりまでに収まる', () => {
    const last = sliced.lines[sliced.lines.length - 1];
    // **区間の長さも 1ms の格子で見る。** 切り出した時刻は domain の中で丸められて
    // いるので、生の引き算（215.84 - 176.77 = 39.06999999999999）と比べると
    // 1e-14 の埃で落ちる。丸めずに比べると、**最終行を区間の終わりぴったりで
    // 閉じた**（M13-1）ことが「はみ出している」と読まれる
    const length = onMillisecondGrid(WORK_WINDOW.end - WORK_WINDOW.start);
    expect(last.time + (last.duration ?? 0)).toBeLessThanOrEqual(length);
  });

  it('最後の行が語句ごと区間の終わりまでに収まる', () => {
    // M8-5 で生まれた新しい壊れ方 — 最終行には次の行が無いので、刻みすぎても
    // 「行の猶予に収まる」の検査に掛からず、**語句が出揃う前に区間が終わる**。
    // 区間の終わりを猶予として、本番と同じ組み立てで測る
    const last = sliced.lines[sliced.lines.length - 1];
    const settled = settledTimeOf(last, WORK_WINDOW.end - WORK_WINDOW.start - last.time);

    expect(last.time + settled).toBeLessThanOrEqual(WORK_WINDOW.end - WORK_WINDOW.start);
  });

  it('頭のフェードは歌い出しより前に明ける', () => {
    // M12-2。助走の 1 小節を使い切って無音から立ち上がる形なので、明ける前に
    // 歌が始まると**1 行目だけが薄い画で出る**。区間の頭を動かした日に効く
    expect(WORK_FADE.in).toBeLessThanOrEqual(sliced.lines[0].time);
  });

  it('終わりのフェードは最後の語句が出揃ってから始まる', () => {
    // M12-2。ここが破れると、最後の語句が**出た直後から薄れ始める**（Issue #69 で
    // 区間の終わりを 52 拍に決めた時の、まさにその余白）。本番と同じ組み立てで測る
    const last = sliced.lines[sliced.lines.length - 1];
    const length = WORK_WINDOW.end - WORK_WINDOW.start;
    const settled = settledTimeOf(last, length - last.time);

    expect(last.time + settled).toBeLessThanOrEqual(length - WORK_FADE.out);
  });

  it('切り出した後も極性の切り替えが速すぎない（明滅の安全）', () => {
    // **`parseLyricSheet` の検証だけでは届かない**（M9-3a）。区間の頭を跨いで
    // 始まっている行は時刻 0 に詰められるので、**元は 1 秒離れていた切り替えが
    // 切り出した後には 0.1 秒差になりうる**。生のシートは通るのに、画面に出る側だけが
    // 危ない形になる。全画面の反転は明滅なので、ここは目で確かめて済ませられない。
    //
    // **今は本編に `polarity` を書いた行が 1 つも無いので自明に緑**（Issue #61 で
    // 割り当てを取り消した）。それでも残すのは、これが明滅の安全のための番人で、
    // 極性が戻ってきた日に効くため。**「どこかで切り替わる」を主張する検査の方は
    // 落とした** — あれは割り当てが在ることを前提にしていて、今は主張自体が誤り
    expect(findRapidPolarityFlip(createPolarityTrack(sliced))).toBeNull();
  });

  it('切り出しても全行に effect が残っている', () => {
    expect(
      sliced.lines.every((line) => line.effect !== undefined && isEffectName(line.effect)),
    ).toBe(true);
  });

  /**
   * 作品に出る語句の並び。**構図の検査はすべてこの並びで見る。**
   *
   * M8-5 で画に出る単位が行から語句になったので、行の place だけを見ると
   * 刻んだ行の構図が丸ごと検査を素通りする（行の place は語句が省いた時の
   * 戻り先でしかない）。partsOf は刻んでいない行も 1 語句として返すので、
   * どちらの書き方でも同じ検査が当たる。
   */
  const parts = sliced.lines.flatMap((line) => partsOf(line));

  it('作品に出る全ての語句に構図が明示されている', () => {
    // M4-3 で effect に課したのと同じ理由 — 省略しても既定の構図（中央）で動くので、
    // 「意図して中央に置いた語句」と「割り当てを忘れた語句」が画面を見ても区別できない。
    //
    // **全 51 行ではなく、切り出した後だけを見る。** 文字PV は 1 語句ずつ手で
    // 構図を作るので、作品に出ない行まで用意するのは現実的でない（M8-0 の決定）。
    // 区間を広げたらここが落ちて、構図の要る行が増えたことに気付ける
    const missing = parts.filter((part) => part.place === undefined).map((part) => part.text);

    expect(missing).toStrictEqual([]);
  });

  it('知らないアンカー名や大きさの段階が書かれていない', () => {
    // 未知の名前でも既定に落ちて動いてしまうので、綴りの間違いは画面を見ても
    // 気付けない（effect の「知らない演出名」と同じ）。ここで名指しして落とす
    const unknown = parts.flatMap((part) =>
      part.place === undefined
        ? []
        : [
            ...(isAnchorName(part.place.at) ? [] : [`${part.text}: at=${part.place.at}`]),
            ...(isSizeName(part.place.size) ? [] : [`${part.text}: size=${part.place.size}`]),
          ],
    );

    expect(unknown).toStrictEqual([]);
  });

  it('隣り合う語句が同じアンカーに置かれていない', () => {
    // M8-1 の狙いは「1 つずつ違う画になる」こと。同じ場所に続けて出すと、
    // 文字だけが差し替わって見えて構図が効かない。離れた所での再登場は
    // 「戻ってきた」として効くので、隣り合う組だけを見る。
    //
    // 行を跨いだ組も見る（前の行の最後の語句 → 次の行の最初の語句）。積み上げた画が
    // 消えた直後に同じ場所へ置くと、行が変わったことが画から読み取れない
    const repeated = parts
      .slice(1)
      .map((part, index) => ({ part, previous: parts[index] }))
      .filter(({ part, previous }) => part.place?.at === previous.place?.at)
      .map(({ part, previous }) => `${previous.text} → ${part.text}: ${part.place?.at}`);

    expect(repeated).toStrictEqual([]);
  });

  it('作品のどこかに図形が置かれている', () => {
    // シートから decor を消しても**全テストが緑のまま**、画から面と線だけが消える
    // （M8-3a そのものが静かに無効になる）。1 つも無い状態を落とす
    expect(parts.some((part) => part.decor.length > 0)).toBe(true);
  });

  it('作品のどこかに英字が添えられている', () => {
    // 図形と同じ穴（M8-3c）。シートから sub を消しても**全テストが緑のまま**、
    // 画から英字だけが消える。1 つも無い状態を落とす
    expect(parts.some((part) => part.sub !== undefined)).toBe(true);
  });

  it('一過性の装飾がどれも作品のどこかで使われている', () => {
    // 図形・英字と同じ穴（M10-2）に加えて、**使われていない案が残ることも落とす**。
    //
    // レジストリに 6 案あっても、シートが 4 案しか使っていなければ**残り 2 案は
    // 画で確かめられないコード**になる。M11 のレビューで踏んだのがまさにこれで、
    // 閾値が骨格の次数に届かず「輪を描く分岐が 1 度も通らない」状態が
    // 全テスト緑のまま残っていた。**足した案は必ず画に出す**か、出さないなら消す
    const used = new Set(parts.map((part) => part.spark).filter((name) => name !== undefined));
    const unused = Object.keys(sparks).filter((name) => !used.has(name));

    expect(unused).toStrictEqual([]);
  });

  it('一過性の装飾が付いていない語句の方が多い', () => {
    // **「一瞬だけ」は、付いていない語句があって初めて成り立つ。** 全語句に付けると
    // 常態になり、装飾ではなく地になる（作者の言葉は「適度な言葉に付与する」）。
    //
    // 半分という線に理屈は無い — 守りたいのは「選んで付けている」ことなので、
    // **付けすぎた時に気付ける位置**に置く。今は 19 語句中 8 個
    const sparked = parts.filter((part) => part.spark !== undefined);

    expect(sparked.length).toBeLessThan(parts.length / 2);
  });

  it('語句が出る時刻が拍の格子に載っている', () => {
    // **`at` は 8 分（0.5 拍）の格子の上に置く**（Issue #37 で刻みの根拠にした）。
    // シートに書いてあるのは `0.751` のような裸の秒数で、`work.ts` の `BEAT_GRID`
    // とは何も繋がっていない。曲を差し替えて BPM を測り直した日に、**`at` だけが
    // 古い格子に残る** — M8-4 の衝撃は新しい格子で叩かれるので、語句の登場と
    // 拍がすれ違ったまま画だけは動く（この repo が一番嫌う壊れ方）。
    //
    // 許容（20ms）は秒数を 10ms に丸めて書いていることぶん。耳で詰めた結果として
    // 格子から意図的に外したくなったら、その時にこの検査を緩める判断をすること
    const half = secondsPerBeat(BEAT_GRID) / 2;
    const offGrid = sliced.lines
      .flatMap((line) => partsOf(line).map((part) => ({ line, part, steps: part.at / half })))
      .filter(({ steps }) => Math.abs(steps - Math.round(steps)) * half > 0.02)
      .map(({ line, part, steps }) => `${line.text} の「${part.text}」: at=${part.at}（${steps.toFixed(2)} 個目の 8 分）`);

    expect(offGrid).toStrictEqual([]);
  });

  it('作品の行が語句に刻まれている', () => {
    // M8-5 の狙いそのもの。1 行を丸ごと出す行が作品に残っていたら、そこだけ
    // 動きが単調になる。区間を広げた時に、刻み忘れの行をここで名指しして落とす
    const whole = sliced.lines.filter((line) => line.parts === undefined).map((line) => line.text);

    expect(whole).toStrictEqual([]);
  });
});

/**
 * その演出が語句を画面の平面から離すか（奥行き方向へ動かすか）。
 *
 * 実際に組み立てて、トゥイーンが触るプロパティを見る。z だけでなく面の回転も
 * 見るのは、回った面は端が z=0 の平面を突き抜けるため。
 */
function movesInDepth(effect: string | undefined): boolean {
  const timeline = resolveEffect(effect).build(dummyTarget(2));
  // Z 軸まわりの回転（rotation / rotateZ）は画面の中で回るだけなので見ない
  const touchesDepth = touching(['z', 'translateZ', 'rotationX', 'rotationY']);
  const moves = tweensOf(timeline).some((child) => touchesDepth(child.vars));
  timeline.kill();

  return moves;
}

/**
 * トゥイーンだけを深く辿る（入れ子のタイムラインそのものは返さない）。
 *
 * **`getChildren(true)` の既定はタイムラインも混ぜて返す**が、`gsap.core.Timeline` には
 * `targets()` が無い（gsap 側に "potential future feature" としてコメントアウトで残っている）。
 * 今のレジストリは全演出が単層なので当たらないが、**入れ子を返す演出を足した日に
 * TypeError で落ちる**（レビュー指摘 🟡）。
 */
function tweensOf(timeline: gsap.core.Timeline): gsap.core.Tween[] {
  return timeline.getChildren(true, true, false) as gsap.core.Tween[];
}

/**
 * 「そのプロパティのどれかを触っているか」を返す述語を作る。
 *
 * **書き方の違いで漏れないよう、3 通りの置き場所を辿る。** gsap は同じ動きを何通りにも
 * 書けるので、片方だけを見ると「後から足した演出だけが検査をすり抜ける」——
 * この手の検査が守りたい当のケースになる。
 *
 * - `fromTo` の始点は `vars` ではなく `vars.startAt` に入る
 * - `keyframes` で書くと `vars` は keyframes だけを持つ
 * - **`translateX` / `rotateY` のような別名はそのままキーになる**ので、正式名と並べて書く
 *   （別名の一覧は gsap の CSSPlugin が持っている）
 */
function touching(properties: readonly string[]): (vars: unknown) => boolean {
  const touches = (vars: unknown): boolean => {
    if (typeof vars !== 'object' || vars === null) return false;
    if (Array.isArray(vars)) return vars.some(touches);

    const record = vars as Record<string, unknown>;

    return (
      properties.some((property) => Object.hasOwn(record, property)) ||
      touches(record.startAt) ||
      touches(record.keyframes)
    );
  };

  return touches;
}

/**
 * 見えの位置・大きさ・向きを変えるプロパティ（gsap の別名も含む）。
 *
 * 不透明度は入れない — 薄くなっても重なりは崩れないので、複製は影として読める。
 */
const TRANSFORM_PROPERTIES = [
  'x', 'y', 'z', 'xPercent', 'yPercent',
  'translateX', 'translateY', 'translateZ',
  'scale', 'scaleX', 'scaleY',
  'rotation', 'rotationX', 'rotationY', 'rotationZ',
  'rotate', 'rotateX', 'rotateY', 'rotateZ',
  'skewX', 'skewY',
];

/**
 * 語句か文字を**動かす**演出かどうか（不透明度だけの演出は含めない）。
 *
 * `movesInDepth` と同じ手（実際に組み立てて、トゥイーンが触るプロパティを見る）だが、
 * こちらは**語句（`root`）と文字（`chars`）の両方**を見る。
 *
 * **語句の複製（`SparkEntry.echoesText`）は、字が定位置にある間しか意味を持たない。**
 * 複製は語句の兄弟として置かれるので演出には付いてこない。M10-1 では `root` を変形する
 * 演出（`swing` / `zoomLine`）だけを落としていたが、**M10-2 で実際に画を見たら
 * `glitch` でも濁っていた** — あちらは文字ごとに `xPercent` を ±60 ずらすので、
 * 複製がどの字にも重ならない。しかも `glitch` は自前で色ずれの残像を持っているので、
 * 朱の複製が加わると帯・字・複製・残像の 4 層になって語句が読めなくなる。
 *
 * 通るのは `typewriter`（0.01 秒で字が置かれる）と `calm`（不透明度だけ）。
 * **厳しく見えるが、それが `ghost` の適用範囲そのもの。**
 *
 * 図形（帯・罫）でも似たことは起きるが、あちらは「語句の周りの重み」なので少しずれても
 * 図として成立する。ぴったり重なることが要るのは複製だけ。
 */
function movesText(effect: string | undefined): boolean {
  const target = dummyTarget(2);
  const timeline = resolveEffect(effect).build(target);
  const touches = touching(TRANSFORM_PROPERTIES);

  // 語句そのもの・分割された文字・**切った板**（M13-5）のどれを動かしても引っ掛ける。
  // 板を数えないと、`slice` が「字を定位置に置くだけの演出」に化けて
  // **`ghost`（語句の複製）を当ててよい**ことになる — 字が動く演出に複製を添えると、
  // 複製だけが取り残されて別の語に見える
  const moved = [
    target.root as unknown as object,
    ...(target.chars as unknown as object[]),
    ...(target.slices as unknown as object[]),
  ];
  const moves = tweensOf(timeline).some(
    (child) => child.targets().some((one) => moved.includes(one as object)) && touches(child.vars),
  );
  timeline.kill();

  return moves;
}

/** その行が画面に出ていられる秒数。次の行が来るか duration が切れるかの早い方 */
function gapAfter(lines: readonly LyricLine[], index: number): number {
  const untilNext = index + 1 < lines.length ? lines[index + 1].time - lines[index].time : Infinity;
  // duration が指定されていれば、次の行を待たずにその行は消える
  return Math.min(untilNext, lines[index].duration ?? Infinity);
}

/** 演出にとって最も条件が厳しい組み合わせ（最長の行と最短の猶予）を測る */
function worstCase(lines: readonly LyricLine[]) {
  const gaps = lines.map((_line, index) => gapAfter(lines, index));

  return {
    shortestGap: Math.min(...gaps),
    longestText: Math.max(...lines.map((line) => line.text.length)),
  };
}

/**
 * 演出の長さを測るだけなので、DOM の代わりにダミーを渡せば足りる。
 *
 * gsap は要素でなくただのオブジェクトもトゥイーンできるので、
 * ブラウザ無しで時間の組み立てだけを借りられる（stage/effects.test.ts と同じ手）。
 */
function dummyTarget(count: number, kanji = 0) {
  const slices: Element[] = [];
  const veilGlyphs: HTMLElement[] = [];

  return {
    frame: {} as HTMLElement,
    // 漂いが書く項目を 0 で先に持たせる。空のオブジェクトに z を書かせると
    // gsap が「プラグイン不足では」と警告する（stage/drift.test.ts と同じ手）
    drift: { z: 0, rotationY: 0, rotationX: 0, yPercent: 0, opacity: 1 } as unknown as HTMLElement,
    root: {} as HTMLElement,
    chars: Array.from({ length: count }, () => ({}) as unknown as Element),
    // カメラが向く先（M13-4）。DOM が無いので測れない。組み立てが借りられれば足りる
    focus: { x: 0.5, y: 0.5, width: 0.3, height: 0.2, aspect: 16 / 9 },
    // 図形（M8-3a）も英字（M8-3c）も一過性の装飾（M10-1）も本番と同じ経路で組まれるので、
    // 当て先だけ返す。これらが行の尺に入ることも、これで「行の猶予に収まる」の検査が見てくれる
    // 板（M13-5）。本番と同じ枚数を立てる — 減らすと、板ごとに違う値を書く演出の
    // 尺が実際より短く測れる（一過性の装飾の破片と同じ理由）。
    // **立てた板は控える** — `movesText` が「字が動いたか」を見るのに要る
    slices,
    sliceChars: (n: number) =>
      Array.from({ length: count }, () =>
        Array.from({ length: n }, () => {
          const piece = {} as Element;
          slices.push(piece);
          return piece;
        }),
      ),
    createDecor: () => ({}) as HTMLElement,
    createSub: () => ({}) as HTMLElement,
    // 帳（M14-1）。**字の数は本番どおりに揃える**（破片と同じ理由）— 減らすと、
    // 字の数で持ち時間が決まる帳の尺が実際より短く測れる。
    // 数の出どころは `kanjiOf`（呼ぶ側が語句の歌詞から数える）。
    // **立てた字は控える** — 「帳が実際に出たか」を組み立てから読むのに要る
    veilGlyphs,
    createVeil: () => {
      veilGlyphs.push(...Array.from({ length: kanji }, () => ({}) as HTMLElement));
      return veilGlyphs;
    },
    createSpark: (spark: SparkShape) => ({
      box: {} as HTMLElement,
      // 破片の数は本番どおりに揃える。減らすと、破片ごとに時間差を付ける案
      // （blocks の stagger）の尺が実際より短く測れる
      pieces: Array.from({ length: spark.pieces }, () => ({}) as HTMLElement),
    }),
  };
}

/**
 * その語句にまつわるものが出揃うまでの秒数。**登場だけではない。**
 *
 * 図形（M8-3a）・英字（M8-3c）・一過性の装飾（M10-1）も語句と同じ時刻から始まり、
 * 登場より長いことがある（`burst` の 1.0 秒 > `swing` の 0.6 秒）。退場は箱ごと引くので、
 * **`stage/exit.ts` が見ているのと同じ「出揃う」で測らないと意味が無い**
 * （再レビューの指摘 🟡 — 登場だけを測っていたので、`spark` を足しても緑のままだった）。
 *
 * **語句 1 つだけの行として本番の組み立てに通す。** 揃え方を書き並べると、
 * 添え物を足した日に検査の側だけが古くなる
 */
function settledOf(part: ResolvedPart): number {
  const timeline = buildLineTimeline(
    {
      time: 0,
      text: part.text,
      ...(part.effect !== undefined ? { effect: part.effect } : {}),
      ...(part.decor.length > 0 ? { decor: [...part.decor] } : {}),
      ...(part.sub !== undefined ? { sub: part.sub } : {}),
      ...(part.spark !== undefined ? { spark: part.spark } : {}),
    },
    () => dummyTarget(part.text.length, kanjiOf(part.text).length),
    // 退場も漂いも入らない長さにする（測りたいのは出揃う時刻だけ）
    { span: Infinity, camera: {} },
  );
  const settled = timeline.labels[LINE_SETTLED];
  timeline.kill();

  expect(settled).toBeTypeOf('number');

  return settled;
}

/** domain と同じ 1ms の格子に載せる（`domain/lyrics.ts` の `trim`） */
function onMillisecondGrid(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * 行の語句がすべて出揃う時刻（行の頭から何秒か）。
 *
 * **尺（`duration()`）ではない**（M13-2）。漂いが入って以降、行のタイムラインは
 * 行が出ている長さいっぱいまで伸びるので、尺を測ると「刻みすぎていないか」ではなく
 * 「行の長さ」を測ることになる。
 */
function settledTimeOf(line: LyricLine, span: number): number {
  const timeline = buildLineTimeline(
    line,
    (part) => dummyTarget(part.text.length, kanjiOf(part.text).length),
    { span, camera: {} },
  );
  const settled = timeline.labels[LINE_SETTLED];
  timeline.kill();

  return settled;
}

/**
 * その行で「帳を書いたのに出ない」語句を挙げる（M14-1）。
 *
 * **本番と同じ組み立て（`buildLineTimeline`）で測る。** 滞在を手で計算すると、
 * 本番が渡す「退場が始まるまで」（`exitStartFor` のぶん 0.4 秒短い）と食い違い、
 * 境界の割り当てが検査を通ったまま画から消える。
 *
 * 見るのは**字が動いているか**であって、当て先が作られたかではない。出せない時は
 * 当て先ごと作らない作りだが、そこに頼ると「作りはしたが動かない」を見逃す。
 */
function silentVeilsOf(line: LyricLine, span: number): string[] {
  const targets: ReturnType<typeof dummyTarget>[] = [];
  const timeline = buildLineTimeline(
    line,
    (part) => {
      const target = dummyTarget(part.text.length, kanjiOf(part.text).length);
      targets.push(target);
      return target;
    },
    { span, camera: {} },
  );
  const moving = new Set(tweensOf(timeline).flatMap((tween) => tween.targets()));
  timeline.kill();

  return partsOf(line).flatMap((part, order) =>
    part.veil !== undefined &&
    isVeilName(part.veil) &&
    !targets[order].veilGlyphs.some((glyph) => moving.has(glyph))
      ? [`${part.text}: ${part.veil}（漢字 ${kanjiOf(part.text).length} 字）`]
      : [],
  );
}

/** 空白を落とす。画の都合で入れた空白で歌詞の一致を落としたくない */
function strip(text: string): string {
  return text.replace(/\s+/gu, '');
}

/**
 * 噛み合わせを見る道具そのものを試す。
 *
 * M10-1 の時点では本編シートが `spark` を使っておらず、上の検査は空振りしていた。
 * **M10-2 で `ghost` を 1 つ当てたので今は空振りしないが、道具の側の検査は残す** —
 * 見分ける範囲（どの演出を落とすか）は、割り当てとは別に古びるため。
 */
describe('movesText', () => {
  it('字を定位置に置くだけの演出は typewriter と calm の 2 つだけ', () => {
    // **演出名を並べた表にしない**（レビュー指摘 🟡）。`movesText` 本体は
    // 「表にすると演出を足した時に更新を忘れる」という理由でレジストリを実際に
    // 組み立てる作りなのに、それを試す側が表を持っていては同じ穴が空く。
    //
    // レジストリ全体を回して、**`ghost` を当ててよい演出がこの 2 つに限る**ことを見る
    // （PLAN.md にそう書いた以上、演出を足した日にここが落ちるべき）。
    // typewriter は 0.01 秒で字が置かれ、calm は語句を触るが不透明度だけ
    const still = Object.keys(effects).filter((name) => !movesText(name));

    expect(still.sort()).toStrictEqual(['calm', 'typewriter']);
  });

  it('未知の演出名でも既定に落ちて判定できる', () => {
    // resolveEffect が既定（fade）へ落とすので、綴りを間違えた語句に ghost を
    // 当てても検査は素通りしない
    expect(movesText('fdae')).toBe(true);
  });
});
