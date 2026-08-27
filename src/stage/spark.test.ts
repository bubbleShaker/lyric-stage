import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isSparkName,
  resolveSpark,
  sparks,
  SPARK_BASE_CLASS,
  SPARK_ECHO_CLASS,
  SPARK_PIECE_CLASS,
  type SparkEntry,
  type SparkName,
  type SparkTarget,
} from './spark';
// Vite の ?raw で CSS を文字列として読む（decor.test.ts と同じ手）
import styleCss from '../style.css?raw';
import { classRule, rulesMatching } from '../test-support/css-rules';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 知らない名前は警告して落とす作りなので、黙らせないと出力が汚れる */
function silenceWarnings() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

/**
 * 当て先のダミー。gsap は要素でなくただのオブジェクトも動かせるので、
 * ブラウザ無しで「何がどこまで書かれるか」を読める（decor.test.ts と同じ手）。
 *
 * **破片は本番と同じ数だけ立てる。** 減らすと、破片ごとに違う値を書く案
 * （burst の放射・focus の向き）が「たまたま通る」ようになる。
 */
function dummyTarget(entry: SparkEntry): SparkTarget {
  return {
    box: {} as HTMLElement,
    pieces: Array.from({ length: entry.pieces }, () => ({}) as HTMLElement),
  };
}

/** 組み立てて time 秒まで進め、当て先に書かれた値を読めるようにする */
function playTo(entry: SparkEntry, time: number): { target: SparkTarget; stop: () => void } {
  const target = dummyTarget(entry);
  const timeline = entry.build(target).pause();
  // **一度だけ余計に動かしてから目的の時刻へ。** gsap は playhead が動いていない
  // タイムラインを描き直さない（本番では buildLineTimeline が親の側で同じことをする）
  timeline.time(time + 0.0001).time(time);

  return { target, stop: () => timeline.kill() };
}

/** ダミーに書かれた値を読む（gsap は素のオブジェクトにはプロパティとして書く） */
function valueOf(element: HTMLElement, name: string): number {
  return Number((element as unknown as Record<string, unknown>)[name]);
}

/** 組み立てて長さだけを測る（測ったら捨てる。gsap のティッカーに残さない） */
function durationOf(entry: SparkEntry): number {
  const timeline = entry.build(dummyTarget(entry));
  const duration = timeline.duration();
  timeline.kill();

  return duration;
}

/**
 * 装飾ごとの「消え方」— 終わった時にこれが 0 なら、画から消えている。
 *
 * **`Record<SparkName, ...>` にしてあるのが要。** 案を足すとここが型検査で落ちるので、
 * 「出て、消える」（この軸の定義そのもの）をどう果たすかを必ず書くことになる。
 * 消え忘れた装飾は行が終わるまで朱のまま残り、静的な図形と見分けが付かなくなる。
 */
const remainderOf: Record<SparkName, (target: SparkTarget) => number> = {
  // 破片そのものが薄れて消える 5 案
  burst: maxPieceOpacity,
  ripple: maxPieceOpacity,
  focus: maxPieceOpacity,
  blocks: maxPieceOpacity,
  ghost: maxPieceOpacity,
  // 下線だけは不透明度を動かさない。**尻尾が抜けきると描かれる幅が 0 になる**
  // （消え方も CSS の clip-path 側にあり、JS が書くのは進み具合だけ）
  underline: ({ box }) => 1 - valueOf(box, '--spark-tail'),
};

function maxPieceOpacity({ pieces }: SparkTarget): number {
  return Math.max(...pieces.map((piece) => valueOf(piece, 'opacity')));
}

describe('resolveSpark', () => {
  it('名前から登録を引く', () => {
    expect(resolveSpark('burst')).toBe(sparks.burst);
  });

  it('指定が無ければ出さない', () => {
    // 図形（resolveDecor）と同じく**既定の装飾は無い**。どの装飾を意図したかは
    // 名前でしか分からないので、適当なものを出すより出さない方が誤解が無い
    expect(resolveSpark(undefined)).toBeNull();
  });

  it('知らない名前は落として警告する', () => {
    // 投げないのは、シートの綴り間違い 1 つで作品が丸ごと出なくなるのを避けるため。
    // 綴りの間違いそのものは lyric-sheets.test.ts が名指しで落とす
    const warn = silenceWarnings();

    expect(resolveSpark('brust')).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('動きを減らす設定では出さない', () => {
    // **図形（#43）や英字（#47）とは逆の判断。** あちらは「動きだけを畳んで形は残す」
    // だが、弾ける粒を静止させると「意味の分からない粒が語句の周りに散らばったまま」に
    // なり、畳んだ姿が画として成立しない。動きが本体である装飾は、畳む ＝ 出さない
    for (const name of Object.keys(sparks)) {
      expect(resolveSpark(name, { reducedMotion: true })).toBeNull();
    }
  });

  it('動きを減らす設定でも、知らない名前は警告する', () => {
    // 出さないのは同じでも理由が違う。ここで黙ると、**動きを減らす設定の端末でだけ
    // 綴りの間違いが隠れる**
    const warn = silenceWarnings();

    expect(resolveSpark('brust', { reducedMotion: true })).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('名前の判定', () => {
  it('Object.prototype 由来の名前を実在と誤認しない', () => {
    // effects.ts の isEffectName / decor.ts の isDecorName と同じ罠
    expect(isSparkName('toString')).toBe(false);
    expect(isSparkName('constructor')).toBe(false);
    expect(isSparkName('__proto__')).toBe(false);
  });

  it('実在する名前は通る', () => {
    expect(isSparkName('burst')).toBe(true);
  });
});

describe('レジストリ', () => {
  const entries = Object.entries(sparks);

  it('装飾ごとに別のクラスが当たる', () => {
    // 書き写しの間違いで 2 つの装飾が同じクラスを指すと、シートには別の名前を
    // 書いているのに画は同じという、読んでも分からない状態になる
    const classes = entries.map(([, entry]) => entry.className);

    expect(new Set(classes).size).toBe(classes.length);
  });

  it.each(entries)('%s は破片を 1 つ以上立てる', (_name, entry) => {
    // 箱は入れ物でしかない（形を持つのは破片）。0 だと**箱だけが立って何も出ない**
    expect(entry.pieces).toBeGreaterThan(0);
  });

  it.each(entries)('%s は 1.0 秒以内に終わる', (_name, entry) => {
    // 一過性の装飾なので、語句が出た後まで残ってはいけない。本編の語句の間隔は
    // 最短 0.751 秒（1 拍）なので、**次の語句が出るころには薄れ終わっている**必要がある。
    // 1.0 秒は基準の burst の尺そのもの（PLAN.md）で、これを超える案は入れない。
    //
    // 行の猶予に収まるかどうかは src/lyric-sheets.test.ts が本番の組み立てで測る。
    // ここが見るのは「一過性であること」そのもの
    const duration = durationOf(entry);

    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(1);
  });

  it.each(entries)('%s は終わりに消えている', (name, entry) => {
    // **「出て、消える」がこの軸の定義そのもの**（decor との唯一の違い）。
    // 消え方は案によって違う（不透明度／描かれる幅）ので、remainderOf が持つ
    const { target, stop } = playTo(entry, durationOf(entry));
    const remainder = remainderOf[name as SparkName](target);
    stop();

    expect(remainder).toBe(0);
  });

  it('弾ける粒は 1 つずつ違う向きへ飛ぶ', () => {
    // 放射の向きは JS が持つ唯一の「形」に関わる値（CSS は粒を中心に置くだけ）。
    // 全部が同じ向きに飛んでも例外は出ず、**画を見なければ気付けない**
    const { target, stop } = playTo(sparks.burst, 1);
    const reached = target.pieces.map(
      (piece) => `${valueOf(piece, 'xPercent').toFixed(2)},${valueOf(piece, 'yPercent').toFixed(2)}`,
    );
    stop();

    expect(new Set(reached).size).toBe(sparks.burst.pieces);
  });

  it('集中線は 1 本ずつ違う向きを向く', () => {
    const { target, stop } = playTo(sparks.focus, 0);
    const angles = target.pieces.map((piece) => valueOf(piece, 'rotation'));
    stop();

    expect(new Set(angles).size).toBe(sparks.focus.pieces);
  });

  it('下線は頭と尻尾を別々に進める', () => {
    // 同じ値を書いてしまうと、**頭と尻尾が同時に動いて幅 0 の線が滑る**だけになる。
    // 走り抜ける手触りは 2 つのずれそのものなので、ずれていることを見る
    const { target, stop } = playTo(sparks.underline, 0.42);
    const head = valueOf(target.box, '--spark-head');
    const tail = valueOf(target.box, '--spark-tail');
    stop();

    expect(head).toBeGreaterThan(tail);
  });

  it('語句の文字を写すのは ghost だけ', () => {
    // 写す案が増えると `.stage__text` を当てる相手も増える。**増やすなら意図して
    // 増やすこと**（写した破片は語句と同じ書体・太さ・字間で描かれる）
    const echoes = entries.filter(([, entry]) => entry.echoesText).map(([name]) => name);

    expect(echoes).toStrictEqual(['ghost']);
  });
});

describe('CSS との対応', () => {
  // **コメントを落としてから走査する**（css-rules.ts が済ませている）。このリポジトリは
  // コメントでクラス名を書くので、素で見ると「説明を 1 行足しただけで緑になる」
  const css = styleCss.replace(/\/\*[\s\S]*?\*\//g, '');

  // レジストリは「名前 → クラス」の唯一の関門だが、**その先の対応関係は無防備**。
  // 'stage__spark--brust' と打ち間違えても型検査もテストも全部通り、起きるのは
  // 「装飾だけが出ない」という例外も警告も出ない壊れ方（decor.test.ts と同じ穴）
  const declared = (className: string) => new RegExp(`\\.${className}(?![\\w-])`).test(css);

  const cases: [string, string][] = [
    ['箱と破片の基底', SPARK_BASE_CLASS],
    ['破片', SPARK_PIECE_CLASS],
    ...Object.entries(sparks).map(([name, entry]): [string, string] => [
      `装飾 ${name}`,
      entry.className,
    ]),
  ];

  it.each(cases)('%s のクラス .%s が style.css にある', (_label, className) => {
    expect(declared(className)).toBe(true);
  });

  it('語句の文字を写す先のクラスが実在する', () => {
    // `.stage__text` は歌詞そのものの規則。**ghost はここに相乗りして書体を借りている**
    // ので、この名前が変わったら写した複製だけが素の書体で出る
    expect(classRule(SPARK_ECHO_CLASS).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(sparks))('%s は差し色で描かれる', (_name, entry) => {
    // **色は 1 つも JS に書いていない**（spark.ts）。CSS 側が書き忘れると、
    // 形は正しく動くのに**透明なものが飛ぶ**（例外も検査の赤も出ない）。
    // 併せて、差し色以外の色を使い始めたらここで気付ける — 作品側で朱を使うのは
    // M8-2 の線を意図して破った例外なので、なし崩しに増やさない
    const painted = rulesMatching(`\\.${entry.className}(?![\\w-])`).some((body) =>
      body.includes('var(--stage-accent)'),
    );

    expect(painted).toBe(true);
  });

  it('下線は頭と尻尾の両方を読んでいる', () => {
    // JS は進み具合を書くだけで、それが何を意味するかは CSS が決める（--decor-grow と
    // 同じ分担）。CSS 側が読み忘れると、**タイムラインは動いているのに画は静止したまま**
    const body = rulesMatching(`\\.${sparks.underline.className}(?![\\w-])`).join('\n');

    expect(body).toContain('--spark-head');
    expect(body).toContain('--spark-tail');
  });

  it('位置で場所を決める案は、破片の数だけ場所を持っている', () => {
    // blocks は「どこに出るか」を :nth-child で CSS が持つ（JS は数を宣言するだけ）。
    // **数を増やした時に CSS だけ付いてこない**と、7 個目以降が全部左上に重なって出る
    const placed = Array.from({ length: sparks.blocks.pieces }, (_unused, order) =>
      new RegExp(
        `\\.${sparks.blocks.className}[^{}]*:nth-child\\(${order + 1}\\)`,
      ).test(css),
    );

    expect(placed.every(Boolean)).toBe(true);
  });
});
