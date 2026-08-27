import gsap from 'gsap';
import type { EffectTimeline } from './effects';

/**
 * 語句に一瞬だけ添える装飾（M10-1 / Issue #65）— **出て、消える。**
 *
 * `effects.ts`（動き）・`composition.ts`（構図）・`decor.ts`（貼り付く図形）・
 * `sub-text.ts`（添える英字）と直交する**第 4 の軸**。
 *
 * ## `decor` と混ぜない
 *
 * 帯・罫・枠は「語句をそこに留めるための静的な重み」で、出たら**行が終わるまで残る**。
 * こちらは 0.4〜1.0 秒で消える。同じ語彙に混ぜると「消える decor と消えない decor」が
 * 並んで読めなくなる（`place` を `effect` に畳まなかった M8-1、`decor` を第 3 の軸に
 * した M8-3a と同じ判断）。
 *
 * ## 語句に 1 つだけ（`decor` と違い配列にしない）
 *
 * `decor` は `["band", "rule"]` と重ねられるが、こちらは重ねない。一瞬の装飾を
 * 2 つ重ねると、1 秒足らずの間に別々の動きが同時に走って**何が起きたのか読めない**。
 * 「適度な言葉に付与する」（作者）ための軸なので、語句あたり 1 つで足りる。
 *
 * ## 破片の数はレジストリが宣言し、DOM を作るのは `LyricStage`
 *
 * 粒 12 個・線 14 本のような**同じ形の複製**が要るので、`decor` の
 * 「クラス名を渡して当て先を 1 つ受け取る」形では足りない。かといって組み立てる関数が
 * `document.createElement` を呼ぶと、**作る人（演出）と消す人（stage）が非対称**になる
 * — `LyricStage.clear()` が枠ごと捨てるだけで後始末が済むのは、DOM の持ち主が
 * 1 人だから（M4-2 で「演出は DOM を触らない。レイアウトは宣言する」と決めたのと同じ線）。
 *
 * そこで**数だけを宣言**し、当て先は `{ box, pieces }` の形で受け取る
 * （`EffectTarget` の `{ root, chars }` と同じ形）。
 *
 * ## 差し色の朱を使う — **M8-2 の線を破る**
 *
 * 「差し色は触れる所（再生ボタン・seek）に限り、作品側は無彩色だけで組む」と #41 で
 * 決めてあった。6 案はどれも朱で立つことが前提なので、ここで破る（PLAN.md に決定として
 * 書いた）。**色そのものは `style.css` が持つ** — このファイルは 1 つも色を書かない。
 *
 * コントラストの扱いは M11 のレビュー（#63）で引いた線に従う。一過性の粒・線は
 * **字の「地」として振る舞わない**（画面を横切る帯ではなく、1 秒未満で消える小さな形）
 * ので、`palette.ts` の `sub` の段を測り直す相手には含めない。
 *
 * ## 明滅の安全
 *
 * 全画面の反転（`MIN_POLARITY_INTERVAL`）や拍のフラッシュ（`MIN_FLASH_INTERVAL`）とは
 * 別の話になる。ここが占めるのは語句の周り数十 px で、WCAG 2.3.1 の general flash
 * threshold が対象にする「画面の 25% を超える面積」に届かない。**語句ごとに 1 回だけ**
 * という作りも合わせて、下限の仕組みは持たない。
 */

/** 一過性の装飾の当て先。`EffectTarget`（`{ root, chars }`）と同じ形 */
export interface SparkTarget {
  /**
   * 破片を入れる箱。語句の枠に貼り付いている。
   *
   * 進み具合を書く先でもある（`underline` の `--spark-head` / `--spark-tail`）。
   * カスタムプロパティは継承するので、箱に書けば中の破片に届く（`sub-text.ts` と同じ）。
   */
  readonly box: HTMLElement;
  /** 箱の中に立った破片。数は `SparkEntry.pieces` が決める */
  readonly pieces: HTMLElement[];
}

export type SparkBuild = (target: SparkTarget) => EffectTimeline;

export interface SparkEntry {
  /** 箱に当てる CSS クラス。形と色はすべてここに預けている */
  readonly className: string;
  /** 箱の中に立てる破片の数。**1 つも要らない案は無い**（箱は入れ物でしかない） */
  readonly pieces: number;
  /**
   * 破片に語句の文字を写すか。**`ghost` だけが真。**
   *
   * ほかの 5 案の破片は形（粒・線・輪・四角）なので CSS だけで描けるが、`ghost` は
   * 「語句そのものの朱の複製」なので、中身が語句ごとに違う。
   *
   * 写す側（`LyricStage`）は**語句の要素を組み立て直すのではなく、同じクラスを当てる**。
   * 書体・太さ・字間・行間は `.stage__text` が持っているので、写した先に同じ値を
   * 書き並べると**書体を変えた日に 2 か所を直すことになる**（`style.css` の
   * `.stage__text` には「書体を変えるならこの 3 つも測り直すこと」と書いてある）。
   */
  readonly echoesText: boolean;
  readonly build: SparkBuild;
}

/**
 * 箱と破片に必ず当たるクラス（位置の基準）。
 *
 * 打ち間違えても型検査も全テストも通る。落ちるのは `position: absolute` で、
 * 破片が通常フローの箱として語句を押し下げる（`DECOR_BASE_CLASS` と同じ壊れ方）。
 * `spark.test.ts` が `style.css` に実在することを見張る。
 */
export const SPARK_BASE_CLASS = 'stage__spark';
export const SPARK_PIECE_CLASS = 'stage__spark__piece';

/**
 * 語句の文字を写した破片にも当てるクラス（`echoesText` の案が使う）。
 *
 * `.stage__text` そのもの。**書体の宣言を 2 か所に持たないため**（`SparkEntry.echoesText`）。
 */
export const SPARK_ECHO_CLASS = 'stage__text';

/** A 弾ける — 粒が放射状に飛ぶ距離（粒自身の大きさに対する割合） */
const BURST_REACH = 1250;

/** 粒ごとに飛距離を変える割合。**揃えると輪に見えて「弾けた」に見えない** */
const BURST_INNER = 0.62;

/**
 * C 集中線 — 線が縮み込む倍率。破片は大きさ 0 の点なので、拡大率がそのまま距離になる。
 *
 * **語句の中まで縮み切らせない。** 語句は横に長いので、中心まで詰めると左右の線が
 * 字の上を走る。手前で消えるので、届かないことは画に出ない。
 */
const FOCUS_FROM = 2.8;
const FOCUS_TO = 1.5;

export const sparks = {
  /**
   * A 弾ける — 朱の粒が 12 個、放射状に飛んで急減速しながら薄れる（1.0 秒）。
   *
   * 6 案の基準になる尺。アーティファクトで 3 案（水しぶき／花火／中間）を見比べて
   * 「中間」を採り、**速さつまみ 50% 相当**まで落とした値（PLAN.md）。
   *
   * 飛距離を粒 1 つおきに変えているのは、揃えると 12 個が同心の輪に並んで
   * 「弾けた」ではなく「輪が広がった」（＝ `ripple`）に見えるため。
   */
  burst: {
    className: 'stage__spark--burst',
    pieces: 12,
    echoesText: false,
    build: ({ pieces }) => {
      const count = pieces.length;

      return (
        gsap
          .timeline()
          .fromTo(
            pieces,
            { xPercent: 0, yPercent: 0, scale: 1, opacity: 1 },
            {
              // 粒は円なので幅と高さが等しい ＝ xPercent と yPercent が同じ尺度になり、
              // 放射の対称性が保たれる。px で書かない理由は M4-1（文字サイズが画面幅で変わる）
              xPercent: (index: number) => Math.cos(burstAngle(index, count)) * burstReach(index),
              yPercent: (index: number) => Math.sin(burstAngle(index, count)) * burstReach(index),
              scale: 0.4,
              duration: 1,
              // 出た瞬間が一番速く、あとはほぼ止まって見える。この急ブレーキが
              // 「弾けて散った」の手触りを作る（zoom の expo.out と同じ理屈）
              ease: 'power3.out',
            },
            0,
          )
          // **薄れる側は別のトゥイーンにする**（実測で直した）。飛距離と同じ power3.out に
          // 乗せると、序盤の急加速が不透明度にも掛かって**飛び終わる前に消えてしまう**
          // （0.35 秒でほぼ透明になり、粒が散った画がそもそも見えない）。
          // 一拍おいてから、終盤にすっと引く
          .to(pieces, { opacity: 0, duration: 0.72, ease: 'power2.in' }, 0.28)
      );
    },
  },

  /**
   * B 輪が広がる — 角丸の輪郭が 2 枚、ずれて外へ広がる（0.9 秒）。
   *
   * 2 枚目を少し遅らせるのは、1 枚だと「枠が消えた」だけに見えるため。
   * 追いかける輪があると、広がりが方向として読める。
   */
  ripple: {
    className: 'stage__spark--ripple',
    pieces: 2,
    echoesText: false,
    build: ({ pieces }) =>
      gsap.timeline().fromTo(
        pieces,
        { scale: 0.92, opacity: 0.9 },
        {
          scale: 1.45,
          opacity: 0,
          duration: 0.66,
          ease: 'power2.out',
          // 合計 0.9 秒（0.66 + 0.24）。2 枚目の輪が 1 枚目を追う
          stagger: 0.24,
        },
      ),
  },

  /**
   * C 集中線 — 短い線が 14 本、外から語句へ縮み込む（0.55 秒）。
   *
   * 破片は**大きさ 0 の点**で、線そのものは CSS の擬似要素が点から離れた所に描く
   * （`style.css`）。こうすると `scale` がそのまま「点からの距離」になり、
   * 向き（`rotation`）と距離を別々に書ける — 破片を線そのものにすると、
   * gsap の transform は「平行移動 → 回転」の順なので、**回した後の向きへ動かす**
   * ことができず、放射状に並べられない。
   *
   * 向きは `set` で置くだけで動かさない。集中線は回らず、縮むだけ。
   */
  focus: {
    className: 'stage__spark--focus',
    pieces: 14,
    echoesText: false,
    build: ({ pieces }) => {
      const count = pieces.length;

      return gsap
        .timeline()
        .set(pieces, { rotation: (index: number) => (index / count) * 360 })
        .fromTo(
          pieces,
          { scale: FOCUS_FROM, opacity: 0 },
          {
            scale: FOCUS_TO,
            duration: 0.55,
            // 縮み込む側なので加速。近づくほど速いと「吸い込まれる」に見える
            ease: 'power2.in',
            stagger: { each: 0.012, from: 'random' },
          },
          0,
        )
        // **明るいのは遠い間だけ。** 近づくにつれて薄れる。逆にすると、線が一番濃い
        // ところで語句に重なって、集中線ではなく「語句に刺さった棒」に見える
        .to(pieces, { opacity: 1, duration: 0.1, ease: 'none' }, 0)
        .to(pieces, { opacity: 0, duration: 0.3, ease: 'power1.in' }, 0.25);
    },
  },

  /**
   * D 下線が走る — 太めの下線が左から右へ走り抜ける（0.75 秒）。
   *
   * **頭が走り、遅れて尻尾が追う。** 進み具合を 2 つ（`--spark-head` / `--spark-tail`）
   * 渡すだけで、それを「どこからどこまで描くか」に読み替えるのは CSS
   * （`--decor-grow` / `--sub-reveal` と同じ分担）。伸びる向きを JS にも書くと、
   * 同じ判断が 2 か所になる。
   *
   * 当て先が破片ではなく**箱**なのは、カスタムプロパティが継承で中まで届くため。
   */
  underline: {
    className: 'stage__spark--underline',
    pieces: 1,
    echoesText: false,
    build: ({ box }) =>
      gsap
        .timeline()
        // 未設定のカスタムプロパティは開始値を読めないので、`from` ではなく
        // `fromTo` で両端を書く（`decor.ts` / `sub-text.ts` と同じ）
        .fromTo(box, { '--spark-head': 0 }, { '--spark-head': 1, duration: 0.42, ease: 'power2.out' }, 0)
        .fromTo(box, { '--spark-tail': 0 }, { '--spark-tail': 1, duration: 0.42, ease: 'power2.in' }, 0.33),
  },

  /**
   * E 四角がポンと出る — 小さな四角が 6 個、時間差で出てまとめて消える（1.0 秒）。
   *
   * **どこに出るかは CSS が持つ**（`:nth-child` で 6 か所）。数を宣言してレジストリが
   * 位置まで決めると、形の話が 2 つの層に割れる。
   *
   * 出るのはばらばら（`from: 'random'`）、消えるのは一斉。散らばって現れたものが
   * 同時に引くと、語句に添えた 1 つの飾りとしてまとまる。
   */
  blocks: {
    className: 'stage__spark--blocks',
    pieces: 6,
    echoesText: false,
    build: ({ pieces }) =>
      gsap
        .timeline()
        .fromTo(
          pieces,
          { scale: 0, opacity: 1 },
          {
            scale: 1,
            duration: 0.22,
            // 目標を一度追い越してから戻る。この行き過ぎが「ポン」に見える（bounce と同じ）
            ease: 'back.out(2.4)',
            stagger: { each: 0.07, from: 'random' },
          },
          0,
        )
        .to(pieces, { opacity: 0, scale: 0.62, duration: 0.3, ease: 'power2.in' }, 0.7),
  },

  /**
   * F 影がずれる — 語句の朱の複製が一拍ずれて重なり、すぐ戻る（0.4 秒）。
   *
   * 6 案で唯一、**語句そのものの形を使う**（`echoesText`）。ずれ幅を
   * `xPercent` / `yPercent`（＝複製自身の大きさに対する割合）で書いているので、
   * 短い語句では小さく、長い語句では大きくずれる — 語句の長さに対する比が一定になる。
   */
  ghost: {
    className: 'stage__spark--ghost',
    pieces: 1,
    echoesText: true,
    build: ({ pieces }) =>
      gsap.timeline().fromTo(
        pieces,
        { xPercent: 3.5, yPercent: -6, opacity: 0.85 },
        { xPercent: 0, yPercent: 0, opacity: 0, duration: 0.4, ease: 'power2.out' },
      ),
  },
} satisfies Record<string, SparkEntry>;

export type SparkName = keyof typeof sparks;

/** 粒が飛ぶ向き。0.5 を足して真横・真上を外し、語句の縁と平行な飛び方を減らす */
function burstAngle(index: number, count: number): number {
  return ((index + 0.5) / count) * Math.PI * 2;
}

function burstReach(index: number): number {
  return index % 2 === 0 ? BURST_REACH : BURST_REACH * BURST_INNER;
}

export function isSparkName(name: string): name is SparkName {
  // Object.hasOwn で自前のキーだけを見る（effects.ts の isEffectName と同じ理由）
  return Object.hasOwn(sparks, name);
}

/** resolveSpark の任意指定。`resolveDecor` の ResolveDecorOptions と揃えてある */
export interface ResolveSparkOptions {
  /** OS の「視差効果を減らす」設定が有効か */
  readonly reducedMotion?: boolean;
}

/**
 * 名前から登録を引く。出さないときは null。
 *
 * **知らない名前は落として警告する**（`resolveDecor` と同じ。既定の装飾は無い）。
 * 綴りの間違いそのものは `src/lyric-sheets.test.ts` が名指しで落とす。
 *
 * **動きを減らす設定では出さない。** 図形（#43）と英字（#47）は「動きだけを畳んで
 * 形は残す」と決めたが、ここは逆にする — 弾ける粒を静止させると
 * 「意味の分からない粒が語句の周りに散らばったまま」になり、**畳んだ姿が画として
 * 成立しない**。動きが本体である装飾は、畳む ＝ 出さない。
 */
export function resolveSpark(
  name: string | undefined,
  { reducedMotion = false }: ResolveSparkOptions = {},
): SparkEntry | null {
  if (name === undefined) return null;

  if (!isSparkName(name)) {
    console.warn(`未知の装飾名です: ${name}（この装飾は出しません）`);
    return null;
  }

  return reducedMotion ? null : sparks[name];
}
