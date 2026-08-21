import { describe, expect, it } from 'vitest';
import { commandForKey, isTextEntryTarget } from './tap-keys';

describe('commandForKey', () => {
  it('開始・終了・取り消し・再生を単キーに割り当てる', () => {
    expect(commandForKey(' ')).toBe('in');
    expect(commandForKey('Enter')).toBe('out');
    expect(commandForKey('Backspace')).toBe('undo');
    expect(commandForKey('p')).toBe('toggle');
    expect(commandForKey('P')).toBe('toggle');
  });

  it('割り当ての無いキーは何も起こさない', () => {
    expect(commandForKey('a')).toBeUndefined();
    expect(commandForKey('Escape')).toBeUndefined();
  });
});

describe('isTextEntryTarget', () => {
  it('文字を打ち込む場所では横取りしない', () => {
    expect(isTextEntryTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('シークバーは横取りしてよい（シーク直後も収録できる）', () => {
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'range' })).toBe(false);
  });

  it('ボタンや一覧の上でも横取りする', () => {
    expect(isTextEntryTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntryTarget({ tagName: 'LI' })).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
