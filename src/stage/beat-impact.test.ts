import { describe, expect, it } from 'vitest';
import { createBeatPulse, createFlashPulse, type BeatGrid } from '../domain/beat';
import {
  BEAT_FLASH_CLASS,
  FLASH_VAR,
  impactValues,
  SHAKE_DIRECTIONS,
  SHAKE_X_VAR,
  SHAKE_Y_VAR,
  shakeDirectionAt,
  type BeatImpactPulses,
} from './beat-impact';
// Vite の ?raw で CSS を文字列として読む（decor.test.ts / palette.test.ts と同じ手）
import styleCss from '../style.css?raw';

const GRID: BeatGrid = { bpm: 79.85, origin: 0 };
const pulse = createBeatPulse(GRID, { division: 2, decay: 0.6 });

/** 本編と同じ組み合わせ（光るのは拍ごと、揺れは 8 分ごと） */
const PULSES: BeatImpactPulses = {
  flash: createFlashPulse(GRID, { division: 1, decay: 0.5 }),
  shake: createBeatPulse(GRID, { division: 2, decay: 0.45 }),
};

/** 盛り上がりが振り切っている場面での値 */
const loud = (time: number) => impactValues(PULSES, time, { reduced: false, intensity: 1 });

describe('揺れる向き', () => {
  it('打拍ごとに表を順に引く', () => {
    const directions = SHAKE_DIRECTIONS.map((_, n) => shakeDirectionAt(pulse, pulse.interval * n));

    expect(directions).toStrictEqual([...SHAKE_DIRECTIONS]);
  });

  it('表を一巡したら先頭へ戻る', () => {
    expect(shakeDirectionAt(pulse, pulse.interval * SHAKE_DIRECTIONS.length)).toBe(
      SHAKE_DIRECTIONS[0],
    );
  });

  it('区間の手前（負の時刻）でも表の中を指す', () => {
    // WindowedPlayback は助走の 1 小節ぶん負の時刻を返す。素の剰余だと
    // 表の外（undefined）を引いて、分割代入がその場で例外になる
    for (const n of [1, 2, 5, 7, 13]) {
      expect(shakeDirectionAt(pulse, -pulse.interval * n)).toBeDefined();
    }
  });

  it('隣り合う打拍で向きが変わる', () => {
    // 同じ向きが続くと「同じ方向へ 2 度跳ねる」だけの動きに見える
    const pairs = SHAKE_DIRECTIONS.map((direction, index) => [
      direction,
      SHAKE_DIRECTIONS[(index + 1) % SHAKE_DIRECTIONS.length],
    ]);

    for (const [current, next] of pairs) {
      expect(current).not.toStrictEqual(next);
    }
  });

  it('縦の振れが横より大きい（キックに叩かれる画にする）', () => {
    for (const [x, y] of SHAKE_DIRECTIONS) {
      expect(Math.abs(y)).toBeGreaterThan(Math.abs(x));
    }
  });
});

describe('書き込む値', () => {
  it('拍の頭で瞬き、余韻が終われば静まる', () => {
    expect(loud(0).flash).toBeGreaterThan(0);
    // 拍ごとの刻み（0.7514 秒）の半分で余韻が尽きる
    expect(loud(PULSES.flash.interval * 0.5).flash).toBe(0);
  });

  it('8 分ごとに揺れる（拍の間にも揺れが来る）', () => {
    const between = PULSES.shake.interval;

    expect(Math.abs(loud(between).y)).toBeGreaterThan(0);
    // 揺れの刻みは光る刻みの半分。ここは瞬いていない
    expect(loud(between).flash).toBe(0);
  });

  it('動きを減らす設定では瞬きも揺れも 0 になる', () => {
    // **落とすとアクセシビリティの約束が静かに消える**（画は出るので目でも気付けない）。
    // 打拍の頭＝一番大きく出る時刻で見る
    const reduced = impactValues(PULSES, 0, { reduced: true, intensity: 1 });

    expect(reduced).toStrictEqual({ flash: 0, x: 0, y: 0 });
  });

  it('静かな場面でも振れ幅が残る', () => {
    // 実音を素直に掛けるだけだと、window.loud が既定 0 の effect-preview.html で
    // 衝撃が一切出ない（拍は鳴っているのに画が動かない道具になる）
    const quiet = impactValues(PULSES, 0, { reduced: false, intensity: 0 });

    expect(quiet.flash).toBeGreaterThan(0);
    expect(quiet.flash).toBeLessThan(loud(0).flash);
  });

  it('盛り上がりが大きいほど強く叩く', () => {
    const levels = [0, 0.5, 1].map(
      (intensity) => impactValues(PULSES, 0, { reduced: false, intensity }).flash,
    );

    expect(levels[0]).toBeLessThan(levels[1]);
    expect(levels[1]).toBeLessThan(levels[2]);
  });

  it('外れた盛り上がりを渡されても書き込む値は 0〜1 に収まる', () => {
    // IntensityQuery の型（() => number）は 0〜1 を縛らない。effect-preview.html が
    // 渡すのは無加工の () => window.loud なので、20 と打たれると
    // **画面全体が ink 一色に覆われる**（明るさの上限は CSS の係数に預けてある）
    for (const intensity of [20, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const values = impactValues(PULSES, 0, { reduced: false, intensity });

      expect(values.flash).toBeGreaterThanOrEqual(0);
      expect(values.flash).toBeLessThanOrEqual(1);
      expect(Math.abs(values.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(values.y)).toBeLessThanOrEqual(1);
    }
  });

  it('値は段に刻まれる（連続値をそのまま書かない）', () => {
    // **M8-2 の 🔴 の一般化。**刻まないと「前と同じなら書かない」が一度も効かず、
    // 拍の合間の静かなフレームでもスタイルを書き換え続ける（毎回レイアウトの再計算）。
    // 目に見えない差の 2 つの盛り上がりが、同じ値に落ちることで確かめる
    const a = impactValues(PULSES, 0, { reduced: false, intensity: 0.5 });
    const b = impactValues(PULSES, 0, { reduced: false, intensity: 0.5001 });

    expect(a).toStrictEqual(b);
    // 刻んだ結果は段の倍数（段の幅を広げすぎると目に見えるので、細かさも見る）
    expect(a.flash * 64).toBeCloseTo(Math.round(a.flash * 64), 10);
    expect(loud(0).flash - impactValues(PULSES, 0, { reduced: false, intensity: 0.9 }).flash)
      .toBeGreaterThan(0);
  });
});

describe('CSS との対応', () => {
  // **コメントを落としてから走査する**（decor.test.ts と同じ手）。このリポジトリは
  // コメントでクラス名やカスタムプロパティ名を書くので、素で見ると
  // 「説明を 1 行足しただけで緑になる」
  const css = styleCss.replace(/\/\*[\s\S]*?\*\//g, '');

  function rulesFor(className: string): string[] {
    const pattern = new RegExp(`([^{}]*\\.${className}(?![\\w-])[^{}]*)\\{([^}]*)\\}`, 'g');

    return [...css.matchAll(pattern)].map(([, , body]) => body);
  }

  it('光の膜のクラスが style.css にある', () => {
    // 打ち間違えても型検査も他の検査も通り、起きるのは「position: absolute が
    // 落ちて、通常フローの箱が図形のレイヤーに現れる」という気付きにくい壊れ方
    expect(rulesFor(BEAT_FLASH_CLASS).length).toBeGreaterThan(0);
  });

  // JS が書くのは強さと向きだけで、その意味（明度差・揺れ幅）は CSS が持つ。
  // **読み忘れると、拍は刻まれているのに画は静止したまま**になる（M8-3a と同じ穴）
  it('光の膜が強さを読んでいる', () => {
    expect(rulesFor(BEAT_FLASH_CLASS).some((body) => body.includes(FLASH_VAR))).toBe(true);
  });

  it('揺れる箱が向きを読んでいる', () => {
    const rules = rulesFor('stage__lines');

    for (const variable of [SHAKE_X_VAR, SHAKE_Y_VAR]) {
      expect(rules.some((body) => body.includes(variable))).toBe(true);
    }
  });

  it('揺らすのは .stage__lines であって構図の枠ではない', () => {
    // .stage__frame の transform は GSAP のもの（M8-1 で実測した residue が戻る）。
    // 揺れの変数をあちらの規則に書くと取り合いが再発するので、そこは触らせない
    const frameRules = rulesFor('stage__frame');

    for (const variable of [SHAKE_X_VAR, SHAKE_Y_VAR]) {
      expect(frameRules.some((body) => body.includes(variable))).toBe(false);
    }
  });

  it('明滅の明度差を掛ける係数が小さい', () => {
    // 速さの安全（3Hz）は domain/beat.ts が構造で守る。こちらは**係数の桁**だけを見る
    // （レビュー指摘 🟡。明るくする経路は係数だけではない — 塗りを差し色に変える、
    // filter や mix-blend-mode を足す、はここを素通りする）。0.035 を 0.35 と
    // 打ち間違えたときに落ちれば十分で、それ以上は画を見て決めること。
    //
    // **上限は M9-1（Issue #53）で 0.08 から 0.04 へ下げた。** 明るい地では
    // 同じ係数でも相対輝度の変化が大きくなり、0.06 で WCAG 2.3.1 の閾値に届く
    // （計算は style.css の .screen-decor__flash に書いた）。**地の明暗を
    // また変えるなら、この上限も測り直すこと** — 検査の数字そのものが
    // 「今の地の明るさ」に依存している。
    //
    // 0.04 は**打ち間違いの網であると同時に、実際の天井でもある**（レビュー指摘 🟢）
    // — この係数での合成後の輝度は 0.8008 で、閾値の 0.80 とのマージンは実質ゼロ。
    // 網としては緩いままにしたいが、緩めた先が安全でないので上限をここに置く。
    //
    // **数の並び順に依存しない。** calc の中は掛ける順を入れ替えても等価なので、
    // 宣言から数値をすべて拾って一番大きいものを見る
    const opacities = rulesFor(BEAT_FLASH_CLASS).flatMap((body) => [
      ...body.matchAll(/opacity:([^;}]*)/g),
    ]);

    expect(opacities.length).toBe(1);

    const factors = [...opacities[0][1].matchAll(/[\d.]+/g)].map(([value]) => Number(value));

    expect(factors.length).toBeGreaterThan(0);
    expect(Math.max(...factors)).toBeLessThanOrEqual(0.04);
  });
});
