import { describe, expect, it, vi } from 'vitest';
import { createFadeCurve } from '../domain/fade';
import { mountWorkFade, WORK_FADE_VAR } from './work-fade';
// ?raw で CSS と HTML を文字列として読む（beat-impact.test.ts / font-subset.test.ts と同じ手）
import indexHtml from '../../index.html?raw';
import { classRule as rulesFor } from '../test-support/css-rules';

/** 膜の当て先。CSS と index.html の両方がこの名前を知っている */
const FADE_CLASS = 'work-fade';

/**
 * 書き込み先の偽物。DOM は要らない（このリポジトリのテストはブラウザを持たない）。
 * `setProperty` に来た値だけを控える。
 */
function fakeVeil() {
  const written: [string, string][] = [];

  return {
    written,
    element: {
      style: {
        setProperty: (name: string, value: string) => {
          written.push([name, value]);
        },
      },
    } as unknown as HTMLElement,
  };
}

const LENGTH = 39.07;
const SPANS = { in: 2.254, out: 1.503 };
const curve = createFadeCurve(LENGTH, SPANS);

describe('mountWorkFade', () => {
  it('組み立てた時点で隠れている（最初のフレームを待たない）', () => {
    // 待つと、再生ボタンを押した瞬間だけ画が素のまま・音も全開で飛び出す
    const veil = fakeVeil();
    const volume = vi.fn();

    mountWorkFade(veil.element, curve, volume);

    expect(veil.written).toStrictEqual([[WORK_FADE_VAR, '0']]);
    expect(volume).toHaveBeenCalledWith(0);
  });

  it('画と音に同じ値を配る', () => {
    const veil = fakeVeil();
    const volume = vi.fn();
    const fade = mountWorkFade(veil.element, curve, volume);

    fade.render(SPANS.in / 2);

    const [, level] = veil.written[veil.written.length - 1];
    expect(volume).toHaveBeenLastCalledWith(Number(level));
    expect(Number(level)).toBeGreaterThan(0);
    expect(Number(level)).toBeLessThan(1);
  });

  it('明けてしまえば書き込みが止まる', () => {
    // 曲線は連続値なので、刻まずに書くと**開け終わった後も毎フレーム**
    // わずかに違う値を書き続ける（そのたびにスタイルの再計算が要る）
    const veil = fakeVeil();
    const volume = vi.fn();
    const fade = mountWorkFade(veil.element, curve, volume);

    fade.render(10);
    const after = veil.written.length;
    for (const time of [10.001, 11, 12, 20, 25]) fade.render(time);

    expect(veil.written.length).toBe(after);
    expect(veil.written[after - 1]).toStrictEqual([WORK_FADE_VAR, '1']);
  });

  it('シークで戻れば、そのぶん画も音も戻る', () => {
    // 時計は音の再生位置なので、フェードだけが置いていかれてはいけない
    const veil = fakeVeil();
    const volume = vi.fn();
    const fade = mountWorkFade(veil.element, curve, volume);

    fade.render(10);
    fade.render(0.2);

    expect(volume).toHaveBeenLastCalledWith(expect.any(Number));
    expect(volume.mock.lastCall?.[0]).toBeLessThan(0.2);
  });

  it('終端では隠れきる', () => {
    const veil = fakeVeil();
    const volume = vi.fn();
    const fade = mountWorkFade(veil.element, curve, volume);

    fade.render(10);
    fade.render(LENGTH);

    expect(veil.written[veil.written.length - 1]).toStrictEqual([WORK_FADE_VAR, '0']);
    expect(volume).toHaveBeenLastCalledWith(0);
  });
});

describe('膜の配線', () => {
  it('style.css が現れ具合を不透明度として読んでいる', () => {
    // 読み忘れると、値は毎フレーム正しく書かれているのに画だけ開かない
    // （M8-3a / M8-4 と同じ壊れ方。例外も型検査の赤も出ない）。
    //
    // **「その文字列が在るか」では粗い**（レビュー指摘 🟡）。別の宣言に紛れていても
    // 緑になってしまうので、`opacity` が実際にこの値から決まっていることまで見る
    const body = rulesFor(FADE_CLASS).join('\n');

    expect(body).toMatch(new RegExp(`opacity:\\s*calc\\([^;]*${WORK_FADE_VAR}`));
  });

  it('膜が画面いっぱいを地の色で覆う', () => {
    // 同じ理由（レビュー指摘 🟡）。値を読んでいても、色を失えば透明な箱、
    // 大きさを失えば 0 幅の箱になり、**どちらも「何も起きない」で緑のまま**。
    // 色はパレット変数から取ること（16 進を直に書くと palette.test.ts が落とす）
    const body = rulesFor(FADE_CLASS).join('\n');

    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/inset:\s*0/);
    expect(body).toMatch(/background:\s*var\(--stage-bg\)/);
    // 覆っている間に操作を奪わない（opacity: 0 でも要素はそこに居る）
    expect(body).toMatch(/pointer-events:\s*none/);
  });

  it('既定値は「見えている」側', () => {
    // JS が落ちても画が地の色で塗り潰されたままにならないこと。
    // var() の第 2 引数が 1（＝ opacity 0）でなければならない
    const body = rulesFor(FADE_CLASS).join('\n');

    expect(body).toMatch(/var\(--work-fade,\s*1\)/);
  });

  it('再生コントロールとクレジットより奥に置かれている', () => {
    // 手前に置くと、フェードインの最中＝まだ止まっている間に再生ボタンが霞む。
    // クレジットは素材の利用条件なので、なおさら覆ってはいけない。
    // **DOM 順ではなく z-index で決める**（並べ替えだけで裏返らないように）
    const depth = (className: string): number => {
      const found = /z-index:\s*(-?\d+)\s*;/.exec(rulesFor(className).join('\n'));
      // 書き忘れを 0 として扱うと「同じ深さ」で素通りするので、必ず落とす
      expect(found, `${className} に z-index が無い`).not.toBeNull();
      return Number(found?.[1]);
    };

    // **歌詞との関係も宣言側で見る**（レビュー指摘 🟡）。ここを見ないと、
    // 「膜が歌詞を覆う」根拠が index.html の並び順しか無いことに気付けない
    expect(depth(FADE_CLASS)).toBeGreaterThan(depth('stage__lines'));
    expect(depth(FADE_CLASS)).toBeLessThan(depth('transport'));
    expect(depth(FADE_CLASS)).toBeLessThan(depth('credit'));
    // 歌詞を読めなかった知らせも同じ理由（頭のフェードが明ける前にこそ出る）
    expect(depth(FADE_CLASS)).toBeLessThan(depth('stage__message'));
  });

  it('膜が index.html に在り、画を裏返す枠の中に居る', () => {
    // 枠（.scene）の外に出すと、極性が裏返ったときに膜だけ元の色で残る。
    // 組み立て側は id で掴むので、id ごと見る
    const scene = /<div class="scene" id="scene">([\s\S]*?)<\/div>\s*<script/.exec(indexHtml)?.[1];

    expect(scene).toBeDefined();
    expect(scene).toMatch(/id="work-fade"/);
  });
});
