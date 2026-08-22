import { describe, expect, it } from 'vitest';
import { shouldHideTransport, type TransportActivity } from './transport-idle';

/** 隠れる条件が揃った状態。各検査は 1 つだけ崩して確かめる */
const IDLE: TransportActivity = { playing: true, waited: true, focused: false, hovered: false };

describe('shouldHideTransport', () => {
  it('再生中に操作が途切れたら隠す', () => {
    expect(shouldHideTransport(IDLE)).toBe(true);
  });

  it('止まっている間は隠さない', () => {
    // 止めた人は大抵コントロールを操作したい。ここで隠すと、
    // 再生ボタンを探して画面を触り直させることになる
    expect(shouldHideTransport({ ...IDLE, playing: false })).toBe(false);
  });

  it('待ち時間が過ぎるまでは隠さない', () => {
    expect(shouldHideTransport({ ...IDLE, waited: false })).toBe(false);
  });

  it('キーボードのフォーカスがある間は隠さない', () => {
    // 隠すと、キーボードだけで操作している人から「今どこにフォーカスがあるか」が
    // 見えなくなる。シークバーを矢印キーで動かしている最中がまさにこれ
    expect(shouldHideTransport({ ...IDLE, focused: true })).toBe(false);
  });

  it('ポインタが乗っている間は隠さない', () => {
    // 触ろうとして近づけた瞬間に逃げると操作できない
    expect(shouldHideTransport({ ...IDLE, hovered: true })).toBe(false);
  });
});
