import { describe, expect, it } from 'vitest';
import { buildSubText, SUB_CLASS, SUB_TEXT_CLASS } from './sub-text';
// Vite の ?raw で CSS を文字列として読む（decor.test.ts と同じ手）
import styleCss from '../style.css?raw';

/**
 * 語句に添える英字（M8-3c / Issue #47）。
 *
 * 見ているのは 2 つ — 進み具合が 0 → 1 に動くことと、**CSS 側がそれを読んでいること**。
 * 後者が本題で、読み忘れると「タイムラインは動いているのに画は静止したまま」に
 * なる（`decor.test.ts` が図形について見ているのと同じ穴）。
 */

/** 当て先。gsap は要素でなくただのオブジェクトも動かせる（decor.test.ts と同じ手） */
function dummySub() {
  return {} as unknown as HTMLElement;
}

/** 組み立てたタイムラインを time 秒まで進めて、当て先に書かれた値を読む */
function revealAt(element: HTMLElement, time: number): number {
  const timeline = buildSubText(element).pause();
  // **一度だけ余計に動かしてから目的の時刻へ。** gsap は playhead が動いていない
  // タイムラインを描き直さない（本番では buildLineTimeline が親のタイムラインで同じことをする）
  timeline.time(time + 0.0001).time(time);
  const value = Number((element as unknown as Record<string, unknown>)['--sub-reveal']);
  timeline.kill();

  return value;
}

describe('buildSubText', () => {
  it('進み具合を 0 から 1 へ動かす', () => {
    expect(revealAt(dummySub(), 0)).toBe(0);
    expect(revealAt(dummySub(), 10)).toBe(1);
  });

  it('動きを減らす設定では、英字は残して拭き取る過程だけを飛ばす', () => {
    // 図形（#43）で「動きだけを畳んで図形は残す」と決めたのと同じ判断。
    // 英字は構図の一部で、消すと画が別物になる
    const element = dummySub();
    const timeline = buildSubText(element, { reducedMotion: true }).pause();
    timeline.time(0.0001).time(0);

    // 時刻 0 の時点で出来上がっている（＝拭き取る動きが無い）
    expect(Number((element as unknown as Record<string, unknown>)['--sub-reveal'])).toBe(1);
    timeline.kill();
  });
});

describe('CSS との対応', () => {
  // **コメントを落としてから走査する。** このリポジトリはコメントでクラス名や
  // カスタムプロパティ名を書くので、素で見ると「説明を 1 行足しただけで緑になる」
  const css = styleCss.replace(/\/\*[\s\S]*?\*\//g, '');

  /** そのクラスを含むセレクタの規則の中身を集める */
  function rulesFor(className: string): string[] {
    const pattern = new RegExp(`([^{}]*\\.${className}(?![\\w-])[^{}]*)\\{([^}]*)\\}`, 'g');

    return [...css.matchAll(pattern)].map(([, , body]) => body);
  }

  it.each([
    ['箱', SUB_CLASS],
    ['字', SUB_TEXT_CLASS],
  ])('%s のクラス .%s が style.css にある', (_label, className) => {
    // 打ち間違えると position: absolute も書体も外れ、**英字が通常フローの箱として
    // 語句を押し下げる**（例外も警告も出ない）
    expect(rulesFor(className).length).toBeGreaterThan(0);
  });

  it('CSS が進み具合を読んでいる', () => {
    // JS 側は --sub-reveal を動かすだけで、それが「拭き取り」を意味することは
    // CSS が決める。読み忘れると英字が最初から出来上がった姿で置かれる。
    //
    // 読む先は**字の側**（箱ではない）。箱で切ると語句より長い英字が切れる
    // （stage/sub-text.ts の SUB_TEXT_CLASS を見よ）ので、当て先ごと見張る
    expect(rulesFor(SUB_TEXT_CLASS).some((body) => body.includes('--sub-reveal'))).toBe(true);
  });

  it('拭き取りが箱ではなく字に掛かっている', () => {
    // 🔴 の再発防止。箱（枠＝語句の幅）で clip-path を掛けると、**はみ出した英字が
    // 永久に描かれない**。今のシートはどれも語句より短いので画には出ないが、
    // 長い英字を書いた瞬間に「なぜか尻が出ない」になり、しかも
    // **getBoundingClientRect はクリップ後の見えを返さないので実測でも捕まらない**
    const boxRules = rulesFor(SUB_CLASS).filter(
      // 字のクラスは箱のクラスを名前に含まない（.stage__sub__text は別物）ので、
      // rulesFor の否定先読みで既に分かれている
      (body) => body.includes('clip-path'),
    );

    expect(boxRules).toStrictEqual([]);
  });

  it('英字がフローに入らない（枠の箱を押し広げない）', () => {
    // 枠は width/height: max-content なので、絶対配置を外すと枠の箱が英字ぶん伸び、
    // **枠の箱を基準にしている図形（.stage__decor）の inset が丸ごとずれる**。
    // 帯が語句の上に乗り上げるが、原因は英字の側にあるので追いにくい
    expect(rulesFor(SUB_CLASS).some((body) => /position:\s*absolute/.test(body))).toBe(true);
  });
});
