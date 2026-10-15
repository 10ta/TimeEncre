import { describe, expect, it } from 'vitest';
import { lastGrapheme, looksLikeEmoji } from '../src/lib/grapheme';

describe('图标字形', () => {
  it('复合 emoji 作为一个整体', () => {
    expect(lastGrapheme('🎓🇫🇷')).toBe('🇫🇷');
    expect(lastGrapheme('⏱️👨‍👩‍👧')).toBe('👨‍👩‍👧');
    expect(lastGrapheme('👍🏽')).toBe('👍🏽');
    expect(lastGrapheme('1️⃣ ')).toBe('1️⃣');
    expect(lastGrapheme('   ')).toBe('');
  });
  it('emoji 判断', () => {
    for (const e of ['🎓', '🇫🇷', '1️⃣', '👨‍👩‍👧', '☕']) expect(looksLikeEmoji(e)).toBe(true);
    for (const c of ['法', 'A', '1']) expect(looksLikeEmoji(c)).toBe(false);
  });
});
