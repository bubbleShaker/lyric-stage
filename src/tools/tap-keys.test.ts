import { describe, expect, it } from 'vitest';
import { commandForKey } from './tap-keys';

describe('commandForKey', () => {
  it('開始・終了・取り消しを単キーに割り当てる', () => {
    expect(commandForKey(' ')).toBe('in');
    expect(commandForKey('Enter')).toBe('out');
    expect(commandForKey('Backspace')).toBe('undo');
  });

  it('割り当ての無いキーは何も起こさない', () => {
    expect(commandForKey('a')).toBeUndefined();
    expect(commandForKey('Escape')).toBeUndefined();
  });
});
