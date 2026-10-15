// 按“用户看到的一个字符”切分。一个 emoji 可能由多个码点组成：
// 肤色修饰 👍🏽、国旗 🇫🇷（两个区域指示符）、ZWJ 组合 👨‍👩‍👧、键帽 1️⃣。
const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** 输入框里最后一个非空白字形（新输入的内容总在光标处，通常是最后一个） */
export function lastGrapheme(s: string): string {
  let last = '';
  for (const { segment } of seg.segment(s)) if (segment.trim()) last = segment;
  return last;
}

/** 粗略判断是否为 emoji，仅用于提示，不阻止使用其他字符作图标 */
export function looksLikeEmoji(g: string): boolean {
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(g);
}
