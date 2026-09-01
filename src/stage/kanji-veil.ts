import gsap from 'gsap';
import type { EffectTimeline } from './effects';

/**
 * 一文の上に漢字を重ねる帳（M14-1 / [Issue #84](https://github.com/bubbleShaker/lyric-stage/issues/84)）。
 * 参考は M8 / M13 と同じ [文字PV - ロウワー](https://youtu.be/3ioQDnOknuY)。
 *
 * `effects.ts`（動き）・`composition.ts`（構図）・`decor.ts`（貼り付く図形）・
 * `sub-text.ts`（添える英字）・`spark.ts`（一過性の装飾）と直交する**第 5 の軸**。
 *
 * ## 何が今までと違うのか
 *
 * M13 で作品は「カメラが語句を 1 つずつ映す」形になった。画面に居るのは**出たばかりの
 * 語句と引きかけの語句だけ**で、一文がまるごと画に留まることは無い。
 *
 * 帳はその**反対の作り** — 一文を据え置き、その上を別の層が明滅する。相反するので
 * 混ぜず、**行の単位で切り替える**（帳を当てる行は語句に刻まない）。
 *
 * ## `spark`（第 4 の軸）と分けた理由
 *
 * どちらも「語句に何かを一瞬添える」ように見えるが、**時間の尺度が違う**。
 * `spark` は語句が出る瞬間に 0.4〜1.0 秒で弾けて消えるので、**語句の登場の一部**として
 * `part.at` に置ける。帳は**語句が居るあいだずっと続く**ので、`drift`（M13-2）と同じく
 * 滞在の長さ（`span`）を知らないと組み立てられない。
 *
 * この違いは口の形にそのまま出る — `SparkBuild` は当て先だけを取るが、
 * `buildKanjiVeil` は `span` を取る。**滞在を知るのは `line-timeline.ts` だけ**なので、
 * 帳を組むのもそこ（`spark` と同じ場所だが、`drift` と同じ順番）になる。
 *
 * ## 演出（`effect`）にしなかった理由
 *
 * 「一文を縦に出す」は既にある（`effects.ts` の `vertical`）。帳を演出として書くと、
 * **縦に出す部分を書き写す**ことになり、しかも `effects` の暗黙の約束
 * （どの演出も 1 秒以内に出揃う。`MAX_STAGGER_SPAN` と `src/lyric-sheets.test.ts` の
 * 「各行の演出がその行の猶予に収まる」がそれを守っている）を帳だけが破る。
 * 軸を分ければ、組み方（`effect: "vertical"`）と帳（`veil`）を掛け合わせて書ける。
 *
 * ## 明滅の安全
 *
 * 帳は画面の広い面積を占めるので、`spark`（語句の周り数十 px）とは扱いが違い、
 * 全画面の反転（`MIN_POLARITY_INTERVAL`）や拍のフラッシュ（`MIN_FLASH_INTERVAL`）と
 * 同じ側に立つ。1 字あたりの持ち時間に下限（`MIN_VEIL_SLOT` = 1 秒）を置いて、
 * WCAG 2.3.1 の閾値（1 秒に 3 回）に対して 3 倍の余裕を取る。
 *
 * **収まらないなら出さない**（`buildDrift` が短すぎる滞在を弾くのと同じ）。字を間引いて
 * 詰め込むと、シートに書いた文の漢字が黙って欠けた画になる。
 */

/**
 * 帳の層・箱・字に当たるクラス。**中身は `src/style.css` が持つ。**
 *
 * 層（`VEIL_LAYER_CLASS`）はカメラの外に 1 枚だけ立ち、行をまたいで使い回される
 * （理由は `LyricStage.veilLayer`）。箱は語句 1 つにつき 1 枚。
 *
 * 定数にしてあるのは `SPARK_BASE_CLASS` と同じ理由 — 当てるのは `LyricStage` で、
 * 形（大きさ・輪郭の太さ）を決めるのは CSS、という分担を綴りで繋がないため。
 */
export const VEIL_LAYER_CLASS = 'stage__veils';
export const VEIL_CLASS = 'stage__veil';
export const VEIL_GLYPH_CLASS = 'stage__veil-glyph';

/**
 * 帳の当て先 — **立った字だけ。**
 *
 * `SparkTarget` は `{ box, pieces }` の形だが、こちらは箱を渡さない。あちらは箱に
 * 進み具合（`--spark-head`）を書く案があるので箱を読む者が居るが、帳は字だけを
 * 動かす。**読まない口を、形を揃えるためだけに残さない**（レビュー指摘 🟢）。
 * 箱そのものは `LyricStage` が立てて字を入れる（大きさと輪郭を CSS が配るため）。
 */
export type VeilTarget = readonly HTMLElement[];

/**
 * 字ごとの置き場所。**画面に対する位置の割合**（`x` は幅の、`y` は高さの何 %）。
 *
 * 中央からのずれではなく**位置そのもの**。50 が中央で、案A（`single`）が 42 を
 * 中心に置いているのは、**右上に据えた一文を避けて左へ寄せている**から。
 *
 * **字自身の大きさを単位にしてはいけない**（M14-3 / [Issue #87](https://github.com/bubbleShaker/lyric-stage/issues/87)）。
 * 一度 `glitch` / `shatter` と同じ「字の大きさに対する割合」で書いていたが、
 * あちらは**語句に貼り付く残像**なので字を単位にするのが正しく、帳は**画面を覆う層**
 * なので画面を単位にする（`--veil-size` を画面の高さで書いているのと同じ理由）。
 * 取り違えると、**作者が案を選んだ時に見た散らし方と別物になる** — 実際、横の
 * 広がりが半分になり、かたまりが画面のど真ん中へ寄って一文の上に重なっていた。
 */
export interface VeilSpot {
  /** 画面の左端からの位置（幅の何 %）。50 が中央 */
  readonly x: number;
  /** 画面の上端からの位置（高さの何 %）。50 が中央 */
  readonly y: number;
  /** 大きさの倍率。CSS が配る基準（`--veil-size`）に掛かる */
  readonly scale: number;
}

export interface VeilEntry {
  /**
   * 箱に当てる CSS クラス。**大きさと線の太さはすべてここに預けている**
   * （`DecorEntry.className` / `SparkEntry.className` と同じ分担）。
   */
  readonly className: string;
  /**
   * 一文が降り切ってから、さらに置く間（秒）。**待ちの本体ではなく上乗せ。**
   *
   * 帳を語句と同時に始めると、**文が読まれる前に上から字が被さる**。据えた一文が
   * 読めることが帳の前提なので、登場が終わるのを待ってから重ね始める。
   *
   * **待ちを定数だけで持ってはいけない**（レビュー指摘 🟡）。`vertical` の着地は
   * `0.5 + 文字送り` で、14 字を超える一文では 1.3 秒に達する — 定数の待ちだと
   * **長い一文ほど、まだ降りている字の上に帳が浮かぶ**。実際に降り切る時刻は
   * 組み立てる側（`line-timeline.ts`）が登場のタイムラインから測って `after` で渡し、
   * ここはその後ろに置く間だけを持つ。
   */
  readonly lead: number;
  /**
   * 1 字あたりの持ち時間（秒）。**望みの値**で、滞在が短ければここから縮む。
   *
   * 逆に滞在が余っても伸ばさない — 伸ばすと最後の字が延々と居座る。余った時間は
   * 帳が畳まれた後の「一文だけが残る間」になる（序ではそのまま歌い出しへ繋がる）。
   */
  readonly slot: number;
  /**
   * 1 字の寿命が持ち時間の何倍か。**1 なら重ならず、1 を超えると次の字と重なる。**
   *
   * 「重なってはフェードアウトする」という依頼の核がこの値。案ごとの違いの本体でもある。
   */
  readonly life: number;
  /** 寿命のうち、出入りに使う割合（残りが居座る時間） */
  readonly fade: { readonly in: number; readonly out: number };
  /**
   * 字ごとの置き場所。**順番だけで決める**（乱数を使わない）。
   *
   * 星の配置（M5-1）と同じ判断で、**画も作品の一部として固定する**。再生のたびに
   * 帳の位置が変わると、詰めた画をもう一度見られない。
   */
  readonly spot: (index: number) => VeilSpot;
}

/**
 * 1 字あたりの持ち時間の下限（秒）。**明滅の安全のための壁。**
 *
 * これを下回るなら帳そのものを出さない（間引かない。上記）。
 */
export const MIN_VEIL_SLOT = 1;

/** 入ってくる時の大きさ（`spot.scale` に対する倍率）。わずかに大きい所から締まって来る */
const ENTER_SCALE = 1.06;

/** 抜ける時の大きさ。入りとは逆に、わずかに縮みながら消える */
const EXIT_SCALE = 0.97;

/**
 * 帳の案。**3 案とも「一文の上に漢字が重なる」形は同じで、密度と速さだけが違う。**
 *
 * `decor` / `spark` と同じく、シートには名前だけを書き、実在するかは
 * `src/lyric-sheets.test.ts` が落とす。
 */
export const veils = {
  /**
   * ひと文字ずつ。前の字が消えかける頃に次が入る。
   *
   * 一度に見えるのはほぼ 1 字なので、**帳そのものが読める**。字の多い文でも画が濁らない。
   *
   * **これが作者の選んだ案**（M14-1 で 3 案を実物で動かして選ばれた「案A ひと文字ずつ」）。
   * 序（M14-2）も要所の行（M14-3）もこれを使う。`pair` / `breath` は選ばれなかったが、
   * **消さずに残す** — 一文の長さや字数が変われば向き不向きが変わるし、案を並べて
   * 見比べられること自体が次の判断の材料になる。
   */
  single: {
    className: 'stage__veil--single',
    lead: 1.1,
    slot: 1.35,
    life: 1.25,
    fade: { in: 0.36, out: 0.44 },
    // **かたまりの中心は 42%（中央よりわずかに左）。** 3 つの位置を巡るので、
    // 字が増えても散らかりすぎない。
    //
    // **一文を避けているわけではない**（レビュー指摘 🔴 → 実測で確かめた）。
    // 見本では一文が右上に置きっぱなしだったので「左へ寄せて避けている」ように
    // 見えたが、本番のカメラ（M13-4）は**その語句を画面の中央へ寄せる**
    // （`restCamera` → `framingFor`）ので、シートの `place` は**カメラの向き先**で
    // あって画面上の居場所ではない。実測（1280×720）でも一文は cx 49〜50% に立つ。
    // つまり帳は一文の**上に重なる** — 重なっても読めるのは輪郭だけで塗らないからで、
    // 重ねること自体が依頼の中身。42% はその上での散らし方の起点でしかない
    spot: (index) => ({ x: 42 + ((index % 3) - 1) * 7, y: 50 + ((index % 2) - 0.5) * 10, scale: 1 }),
  },

  /**
   * 大小を重ねる。大きい字と小さい字が交互に、常に 2 字ぶん重なる。
   *
   * 画は賑やかになる。**字の少ない文向き**（多いと重なりが 3 字を超えて読めなくなる）。
   */
  pair: {
    className: 'stage__veil--pair',
    lead: 1.0,
    slot: 1.05,
    life: 1.9,
    fade: { in: 0.24, out: 0.46 },
    // 大きい字は左上、小さい字は右下。大小の差は倍率が付ける（大きさの基準は 1 つ）
    spot: (index) =>
      index % 2 === 0 ? { x: 36, y: 46, scale: 1 } : { x: 62, y: 62, scale: 0.55 },
  },

  /**
   * 大きく、ゆっくり。画面いっぱいの一字が息をするように出入りする。
   *
   * **字の少ない文向き**（1 字あたり 2 秒以上使うので、6 字あると 13 秒要る）。
   */
  breath: {
    className: 'stage__veil--breath',
    lead: 1.3,
    slot: 2.2,
    life: 1.15,
    fade: { in: 0.42, out: 0.46 },
    // ほぼ中央に据わる。大きい一字なので、振ると画面から溢れる
    spot: (index) => ({ x: 46 + ((index % 2) - 0.5) * 6, y: 50, scale: 1 }),
  },
} satisfies Record<string, VeilEntry>;

/** 登録済みの帳の名前。`veils` に足せば自動で増える */
export type VeilName = keyof typeof veils;

/** 外から来た文字列が登録済みの帳の名前かどうか（`isEffectName` と同じ理由で `hasOwn`） */
export function isVeilName(name: string): name is VeilName {
  return Object.hasOwn(veils, name);
}

/**
 * 帳に出す字を文から拾う。**漢字だけ。**
 *
 * かなやラテン文字まで拾うと帳が文そのものの写しになり、**重ねる意味が消える**
 * （下に据えた一文と同じものが大きく出るだけになる）。漢字は 1 字で像を持つので、
 * 抜き出して大きく重ねると文の意味が別の層として立つ — それが依頼の核。
 *
 * 判定は Unicode の用字（`Script=Han`）。字の範囲を自分で書かないので、
 * 拡張漢字も踊り字（々）も取りこぼさない。
 *
 * **重複はそのまま残す。** 同じ字が 2 度出る文（`降り募る…降り注ぐ`）では、
 * 帳にも 2 度出るのが文に対して正直な写し方になる。
 */
export function kanjiOf(text: string): string[] {
  return [...text].filter((char) => KANJI.test(char));
}

/** 漢字かどうか。`filter` の中に書くと呼び出しのたびに作り直される（レビュー指摘 🟢） */
const KANJI = /\p{Script=Han}/u;

/** `resolveVeil` の任意指定（`ResolveOptions` と同じ形） */
export interface ResolveVeilOptions {
  /** OS の「視差効果を減らす」設定が有効か */
  readonly reducedMotion?: boolean;
}

/**
 * 名前から帳の案を引く。**出さないときは null。**
 *
 * `resolveSpark` と同じ形。null を返すと呼ぶ側は当て先を作らないので、
 * **動きを減らす設定では帳の DOM がそもそも立たない**（字を透明で置いておく
 * ような中途半端な状態が残らない）。
 *
 * 帳は画面の広い面積を占めてゆっくり明滅し続けるので、`drift` と同じく
 * 「減らす設定では丸ごと止める」側に置く。据えた一文は `vertical` の組み方が
 * 残るので、**文は静かに読めるまま**になる（M4-4 で `layout` を落とさないと
 * 決めたのと同じ線）。
 */
export function resolveVeil(
  name: string | undefined,
  { reducedMotion = false }: ResolveVeilOptions = {},
): VeilEntry | null {
  if (name === undefined) return null;
  if (reducedMotion) return null;

  if (!isVeilName(name)) {
    console.warn(`未知の帳の名前です: ${name}（帳は出しません）`);
    return null;
  }

  return veils[name];
}

export interface VeilOptions {
  /**
   * 帳が居られる長さ（秒）。**語句が出てから次へ渡す（または行が終わる）まで。**
   *
   * `buildDrift` と同じ値を受け取る。省略できないのも同じ理由で、既定値を置くと
   * 渡し忘れた所で帳だけが静かに出なくなる。
   */
  readonly span: number;
  /**
   * 一文が降り切る時刻（語句が出てから何秒か）。**登場の実測。**
   *
   * 省略できる（0 として扱う）のは `VeilEntry.lead` の説明のとおり — 待ちの本体は
   * こちらで、`lead` はその後ろに置く間。渡し忘れても帳は出るので `span` のように
   * 必須にはしないが、**渡す側（`line-timeline.ts`）が登場から測ること**は
   * 「長い一文では帳が重なり始めるのが後ろへ動く」（`line-timeline.test.ts`）が見張る。
   */
  readonly after?: number;
}

/**
 * その字数・その滞在で帳が出るかどうか。**組み立てる前に呼べる。**
 *
 * `buildKanjiVeil` は出せないとき空のタイムラインを返すが、それだと**当て先（DOM）を
 * 作った後で「出さない」が決まる**ことになり、動きを減らす設定では当て先ごと立てない
 * という作り（`resolveVeil`）と非対称になる（レビュー指摘 🟡）。
 *
 * 判定そのものは `buildKanjiVeil` の中にも残す。**呼ぶ側の順番に頼らない**ため
 * （こちらを呼び忘れても、明滅が速くなるのではなく帳が出ないだけで済む）。
 */
export function fitsVeil(
  count: number,
  entry: VeilEntry,
  { span, after = 0 }: VeilOptions,
): boolean {
  if (count === 0) return false;
  if (!Number.isFinite(span)) return false;

  return slotFor(count, span, entry, after) >= MIN_VEIL_SLOT;
}

/**
 * 帳を組み立てて返す。**当て先は要素でなくてもよい**（`buildDrift` と同じ。検査はダミーを渡す）。
 *
 * 出せないとき（字が無い・滞在が短すぎる・滞在が無限）も**空のタイムラインを返す**。
 * null を返す形にすると呼ぶ側に分岐が増え、「帳が無い」ことを尺 0 として扱えなくなる。
 */
export function buildKanjiVeil(
  glyphs: VeilTarget,
  entry: VeilEntry,
  options: VeilOptions,
): EffectTimeline {
  const timeline = gsap.timeline();
  const { span, after = 0 } = options;

  // **`Infinity` を弾くのもここ**（`lineSpanAt` は無限を返しうる。`buildDrift` と同じ）。
  // 通すと持ち時間が `Infinity / n` ＝ `Infinity` になり、望みの値との比較が
  // 素通りして 1 字が永久に出入りするトゥイーンになる。
  // 明滅の安全（上記）も同じ判定に含まれる — **間引かずに丸ごと出さない**
  if (!fitsVeil(glyphs.length, entry, options)) return timeline;

  const slot = slotFor(glyphs.length, span, entry, after);

  const life = slot * entry.life;
  const enter = life * entry.fade.in;
  const leave = life * entry.fade.out;

  glyphs.forEach((glyph, index) => {
    const spot = entry.spot(index);
    // **待ちはタイムラインの中に持つ。** 呼ぶ側に `part.at + lead` と書かせると、
    // 帳の尺（`duration()`）が待ちを含まなくなり、行の猶予に収まるかを測れない
    const start = after + entry.lead + index * slot;

    timeline
      // **置き場所は時間を持たない**（トゥイーンではなく set）。散らし方は案が決めるもので、
      // 動かすものではない。gsap に書かせているのは、CSS へ字ごとの値を配ると
      // 「立てる人（LyricStage）が案を知る」ことになるため。
      //
      // **`left` / `top` が画面に対する位置で、`xPercent` / `yPercent` は
      // 字の中心をそこへ合わせるための -50%**（M14-3 で単位を戻した。`VeilSpot` を見よ）。
      // 2 つを混ぜているように見えるが、役が違う — 前者が構図、後者が字の芯出し
      .set(
        glyph,
        {
          left: `${spot.x}%`,
          top: `${spot.y}%`,
          xPercent: -50,
          yPercent: -50,
          scale: spot.scale * ENTER_SCALE,
          opacity: 0,
        },
        start,
      )
      .to(
        glyph,
        {
          keyframes: [
            { opacity: 1, scale: spot.scale, duration: enter, ease: 'power2.out' },
            // 居座る間。`ease: 'none'` を書かないと gsap の既定（power1.out）が
            // 掛かるが、値が変わらないので実害は無い — それでも書くのは、
            // **この段が「何もしない時間」だと読めるようにする**ため
            { duration: life - enter - leave, ease: 'none' },
            { opacity: 0, scale: spot.scale * EXIT_SCALE, duration: leave, ease: 'power2.in' },
          ],
        },
        start,
      );
  });

  return timeline;
}

/**
 * 1 字あたりの持ち時間を決める。
 *
 * 最後の字が抜け終わるのは `after + lead + (n - 1) * slot + slot * life` なので、
 * そこが滞在に収まるように割り戻す。望みの値（`entry.slot`）より長くはしない（上記）。
 */
function slotFor(count: number, span: number, entry: VeilEntry, after: number): number {
  const room = span - after - entry.lead;
  return Math.min(entry.slot, room / (count - 1 + entry.life));
}
