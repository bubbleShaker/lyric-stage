import { afterEach, describe, expect, it, vi } from 'vitest';
import styleCss from '../style.css?raw';
import {
  buildKanjiVeil,
  fitsVeil,
  isVeilName,
  kanjiOf,
  MIN_VEIL_SLOT,
  resolveVeil,
  veils,
  VEIL_CLASS,
  VEIL_GLYPH_CLASS,
  VEIL_LAYER_CLASS,
  type VeilEntry,
  type VeilTarget,
} from './kanji-veil';

/**
 * 帳（M14-1 / Issue #84）— 一文の上に漢字を重ねる第 5 の軸。
 *
 * 検査できるのは**時間の組み立てと、字の選び方**だけ。「重なって見えるか」は
 * 目で見るしかないので、`effect-preview.html` と見本のページで確かめる。
 */

/**
 * 当て先のダミー。gsap は要素でなくただのオブジェクトにも書けるので、
 * これで尺と値の動きを読める（`drift.test.ts` / `spark.test.ts` と同じ手）。
 */
function dummyTarget(count: number): VeilTarget {
  return Array.from(
    { length: count },
    // `left` / `top` も先に持たせる（M14-3 で散らし方が画面の割合になった）。
    // 空のままだと gsap が単位の分からない値として読む
    () =>
      ({ opacity: 0, left: '0%', top: '0%', xPercent: 0, yPercent: 0, scale: 1 }) as unknown as HTMLElement,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('kanjiOf', () => {
  it('漢字だけを拾う', () => {
    expect(kanjiOf('夢に眠る幻が掌に降り注ぐ')).toStrictEqual([
      '夢',
      '眠',
      '幻',
      '掌',
      '降',
      '注',
    ]);
  });

  it('かな・カタカナ・ラテン文字・数字は拾わない', () => {
    expect(kanjiOf('シャイニングスターを 3 つ')).toStrictEqual([]);
    expect(kanjiOf("I'll believe of my sensation")).toStrictEqual([]);
  });

  it('同じ字が 2 度出れば 2 度拾う', () => {
    // 帳は文の写しなので、重複を畳むと文と数が合わなくなる
    expect(kanjiOf('降り募る想い、降り注ぐ')).toStrictEqual(['降', '募', '想', '降', '注']);
  });

  it('踊り字も漢字として拾う', () => {
    // 用字（Script=Han）で見ているので、字の範囲を書き並べずに済んでいる
    expect(kanjiOf('人々')).toStrictEqual(['人', '々']);
  });
});

describe('resolveVeil', () => {
  it('名前が無ければ出さない', () => {
    expect(resolveVeil(undefined)).toBeNull();
  });

  it('登録済みの名前なら案が返る', () => {
    expect(resolveVeil('single')).toBe(veils.single);
  });

  it('知らない名前は警告して出さない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(resolveVeil('sngle')).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('Object.prototype 由来の名前を拾わない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(resolveVeil('toString')).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(isVeilName('toString')).toBe(false);
  });

  it('動きを減らす設定では出さない', () => {
    // 当て先を作るかどうかの分岐がここに閉じているので、DOM ごと立たない
    expect(resolveVeil('single', { reducedMotion: true })).toBeNull();
  });
});

describe('buildKanjiVeil', () => {
  const entry = veils.single;

  it('字が 1 つも無ければ何もしない', () => {
    expect(buildKanjiVeil(dummyTarget(0), entry, { span: 12 }).duration()).toBe(0);
  });

  it('滞在に収まる', () => {
    const span = 9;
    const timeline = buildKanjiVeil(dummyTarget(4), entry, { span });

    expect(timeline.duration()).toBeGreaterThan(0);
    expect(timeline.duration()).toBeLessThanOrEqual(span);
  });

  it('一文が降り切るのを待ってから始まる', () => {
    const timeline = buildKanjiVeil(dummyTarget(3), entry, { span: 12 });
    const glyph = timeline.getChildren()[0].targets()[0] as { opacity: number };

    timeline.time(entry.lead * 0.5);
    expect(glyph.opacity).toBe(0);

    timeline.time(entry.lead + entry.slot * entry.life * 0.5);
    expect(glyph.opacity).toBeGreaterThan(0);
  });

  it('登場が長い一文では、待ちがそのぶん後ろへ動く', () => {
    // **待ちは定数だけでは足りない**（レビュー指摘 🟡）。`vertical` の着地は文字数で
    // 伸びる（最長 1.3 秒）ので、定数の待ちだとまだ降りている字の上に帳が浮かぶ。
    // 実測した着地（`after`）を受け取り、`lead` はその後ろに置く間として働く
    const after = 1.3;
    const timeline = buildKanjiVeil(dummyTarget(3), entry, { span: 14, after });
    const glyph = timeline.getChildren()[0].targets()[0] as { opacity: number };

    timeline.time(after * 0.9 + entry.lead);
    expect(glyph.opacity).toBe(0);

    timeline.time(after + entry.lead + entry.slot * entry.life * 0.5);
    expect(glyph.opacity).toBeGreaterThan(0);
  });

  it('待ちが伸びたぶんも滞在に収める', () => {
    // 待ちを後ろへ動かしたぶん、1 字あたりの持ち時間が縮む（＝はみ出さない）
    const span = 12;
    const timeline = buildKanjiVeil(dummyTarget(4), entry, { span, after: 1.3 });

    expect(timeline.duration()).toBeGreaterThan(0);
    expect(timeline.duration()).toBeLessThanOrEqual(span);
  });

  it('字が増えても滞在からはみ出さない', () => {
    // 持ち時間を望みの値から縮めて詰める。**間引きはしない**ので、
    // 6 字でも 6 字ぶんが同じ滞在に収まる
    const span = 14;
    const timeline = buildKanjiVeil(dummyTarget(6), entry, { span });

    expect(timeline.duration()).toBeLessThanOrEqual(span);
    expect(new Set(timeline.getChildren().flatMap((child) => child.targets())).size).toBe(6);
  });

  it('滞在が余っても伸ばさない（一文だけが残る間ができる）', () => {
    const timeline = buildKanjiVeil(dummyTarget(3), entry, { span: 40 });

    // 望みの持ち時間で組んだ長さ ＝ 待ち + 2 字ぶんの送り + 最後の 1 字の寿命
    const wanted = entry.lead + entry.slot * (2 + entry.life);
    expect(timeline.duration()).toBeCloseTo(wanted);
  });

  it('明滅が速くなるくらいなら丸ごと出さない', () => {
    // 6 字を 4 秒に詰めると 1 字あたり 1 秒を切る。間引いて詰め込むと文の漢字が
    // 黙って欠けるので、帳そのものを出さない
    expect(buildKanjiVeil(dummyTarget(6), entry, { span: 4 }).duration()).toBe(0);
  });

  it('どの案でも、出るからには 1 字あたり 1 秒を下回らない', () => {
    // 光過敏性発作の閾値（1 秒に 3 回）に対する余裕。案を足したときの安全網でもある
    for (const [name, plan] of Object.entries(veils) as [string, VeilEntry][]) {
      const count = 5;
      const timeline = buildKanjiVeil(dummyTarget(count), plan, { span: 30 });

      // 待ちを除いた尺を、字の数と寿命で割り戻すと 1 字あたりの持ち時間になる
      const slot = (timeline.duration() - plan.lead) / (count - 1 + plan.life);
      expect(slot, name).toBeGreaterThanOrEqual(MIN_VEIL_SLOT);
    }
  });

  it('出るかどうかは組み立てる前に決められる', () => {
    // 当て先（DOM）を作る前に呼べる形にしてある。呼ばずに組み立てても
    // 明滅が速くなることは無い（判定は buildKanjiVeil の中にも残っている）
    expect(fitsVeil(4, entry, { span: 9 })).toBe(true);
    expect(fitsVeil(6, entry, { span: 4 })).toBe(false);
    expect(fitsVeil(0, entry, { span: 30 })).toBe(false);
    expect(fitsVeil(3, entry, { span: Infinity })).toBe(false);
  });

  it('滞在が無限なら出さない', () => {
    // 最終行の猶予は Infinity になりうる（domain の lineSpanAt）。
    // 通すと 1 字が永久に出入りするトゥイーンになる
    expect(buildKanjiVeil(dummyTarget(3), entry, { span: Infinity }).duration()).toBe(0);
  });

  it('字は透明から現れて、透明へ戻る', () => {
    const target = dummyTarget(2);
    const timeline = buildKanjiVeil(target, entry, { span: 12 });
    const [first] = target as unknown as { opacity: number }[];

    timeline.time(0);
    expect(first.opacity).toBe(0);

    // 1 字目の寿命の半ば（居座っている間）
    timeline.time(entry.lead + entry.slot * entry.life * 0.5);
    expect(first.opacity).toBeCloseTo(1);

    timeline.time(timeline.duration());
    expect(first.opacity).toBe(0);
  });

  it('案ごとの散らし方がそのまま字に置かれる', () => {
    // **見るのは `left` / `top`**（M14-3 / Issue #87）。散らし方は**画面に対する構図**
    // なので画面の割合で置く。`xPercent` / `yPercent` は字の中心をそこへ合わせる
    // -50% でしかなく、**案ごとに変わらない** — そちらを見ていると、案の値を
    // どう書き換えても検査が通る
    const target = dummyTarget(2);
    const timeline = buildKanjiVeil(target, veils.pair, { span: 12 });
    const glyphs = target as unknown as { left: string; top: string; xPercent: number }[];

    timeline.time(veils.pair.lead + 0.01);
    expect(glyphs[0].left).toBe(`${veils.pair.spot(0).x}%`);
    expect(glyphs[0].top).toBe(`${veils.pair.spot(0).y}%`);
    expect(glyphs[0].xPercent).toBeCloseTo(-50);

    // 2 字目は自分の出番が来るまで置かれない（`set` が出番の時刻に立っている）
    timeline.time(timeline.duration());
    expect(glyphs[1].left).toBe(`${veils.pair.spot(1).x}%`);
  });

  it('散らし方が画面の中に収まっている', () => {
    // **画面に対する位置なので、0〜100 の外へ出ると字が画面から溢れる**
    // （字の大きさに対する割合だった頃は、外へ出しても字の隣に居るだけだった）。
    // 中心が縁に近すぎても、大きい字は半分が切れる — 案の値を触った日に効く
    for (const [name, plan] of Object.entries(veils) as [string, VeilEntry][]) {
      for (let index = 0; index < 8; index += 1) {
        const spot = plan.spot(index);

        expect(spot.x, `${name}[${index}].x`).toBeGreaterThanOrEqual(20);
        expect(spot.x, `${name}[${index}].x`).toBeLessThanOrEqual(80);
        expect(spot.y, `${name}[${index}].y`).toBeGreaterThanOrEqual(20);
        expect(spot.y, `${name}[${index}].y`).toBeLessThanOrEqual(80);
      }
    }
  });
});

describe('veils（案のレジストリ）', () => {
  it('どの案も出入りが寿命に収まる', () => {
    // 出入りの合計が寿命を超えると、居座る段の長さが負になる（gsap は落ちないので
    // 画では「重なり方が案の狙いと違う」としか出ない）
    for (const [name, plan] of Object.entries(veils) as [string, VeilEntry][]) {
      expect(plan.fade.in + plan.fade.out, name).toBeLessThanOrEqual(1);
    }
  });

  it('どの案も待ちが 0 以上で、寿命が持ち時間以上ある', () => {
    for (const [name, plan] of Object.entries(veils) as [string, VeilEntry][]) {
      expect(plan.lead, name).toBeGreaterThanOrEqual(0);
      // 1 を下回ると字と字の間に「何も出ていない間」ができる。帳は続くものなので、
      // 途切れさせたいなら持ち時間（slot）の側を伸ばす
      expect(plan.life, name).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('CSS との対応', () => {
  // **コメントを落としてから走査する**（`spark.test.ts` と同じ）。このリポジトリは
  // コメントにクラス名を書くので、素で見ると「説明を 1 行足しただけで緑になる」
  const css = styleCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleOf = (className: string) =>
    new RegExp(`\\.${className}(?![\\w-])[^{]*\\{([^}]*)\\}`, 'g');
  const declared = (className: string) => ruleOf(className).test(css);

  const cases: [string, string][] = [
    ['帳の層', VEIL_LAYER_CLASS],
    ['帳の箱', VEIL_CLASS],
    ['帳の字', VEIL_GLYPH_CLASS],
    ...Object.entries(veils).map(([name, entry]): [string, string] => [
      `案 ${name}`,
      entry.className,
    ]),
  ];

  it.each(cases)('%s のクラス .%s が style.css にある', (_label, className) => {
    // レジストリは「名前 → クラス」の唯一の関門だが、その先の対応は無防備。
    // 綴りを間違えても型検査も検査も通り、起きるのは「帳だけが出ない」という
    // 例外も警告も出ない壊れ方（`decor.test.ts` / `spark.test.ts` と同じ穴）
    expect(declared(className)).toBe(true);
  });

  it.each(Object.entries(veils))('%s は自分の大きさを配る', (_name, entry) => {
    // 大きさは案ごとに違う（画面の高さの 46〜82%）。書き忘れると**どの案も同じ
    // 大きさで出る**（フォールバックが効くので、例外にも赤にもならない）
    const rules = [...css.matchAll(ruleOf(entry.className))].map(([, body]) => body);

    expect(rules.some((body) => body.includes('--veil-size'))).toBe(true);
  });

  it('字は塗らず、輪郭だけで描かれる', () => {
    // **依頼の核がここ**（作者が選んだのは「輪郭だけ」）。塗りを足すと下に据えた
    // 一文が透けなくなり、重ねる意味が変わる
    const [, body] = ruleOf(VEIL_GLYPH_CLASS).exec(css) ?? [];

    expect(body).toContain('color: transparent');
    expect(body).toContain('-webkit-text-stroke');
  });
});
