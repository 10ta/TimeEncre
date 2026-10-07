import type { CatalogItem, Settings } from '../schema';
import { toIso } from '../lib/time';

export const PALETTE = [
  '#7A5C8E', '#C7684B', '#9A9A3A', '#E07B1F', '#2E7D6B',
  '#3F6FB5', '#B5487A', '#5B8C3A', '#8C6A4A', '#4A5A8C',
];

/** [固定 id 后缀, 名称, emoji] */
const DEFAULT_TYPES: Array<[string, string, string]> = [
  ['sleep', '睡眠', '😴'], ['bath', '洗漱', '🛁'], ['commute', '通勤', '🚌'], ['work', '工作', '💼'],
  ['eat', '吃饭', '🍜'], ['sport', '运动', '🏃'], ['read', '阅读', '📖'], ['shop', '购物', '🛍️'],
  ['fun', '娱乐', '🎮'], ['housework', '家务', '🧹'], ['movie', '电影', '🎬'], ['walk', '散步', '🚶'],
  ['study', '学习', '🎓'], ['internet', '上网', '💻'],
];

export const DEFAULT_ID_PREFIX = 'default-';

/**
 * 默认类型用固定 id、修改时间设为 1970：
 * 多台设备各自选了默认类型，同步时会按 id 合并成同一份，而不是各一份；
 * 任何设备上对它们的改名、归档、删除都比这个时间新，永远不会被新设备的默认值覆盖。
 */
export function defaultTypes(): CatalogItem[] {
  const stamp = toIso(0);
  return DEFAULT_TYPES.map(([key, name, emoji], i) => ({
    id: DEFAULT_ID_PREFIX + key,
    name,
    emoji,
    color: PALETTE[i % PALETTE.length],
    order: i,
    archived: false,
    updatedAt: stamp,
    deleted: false,
  }));
}

/** 未修改过的默认设置用 1970 作为修改时间：同步时远端的任何设置都会胜出，且序列化结果稳定 */
export function defaultSettings(): Settings {
  return {
    updatedAt: toIso(0),
    weekStart: 1,
    allowConcurrent: true,
    discardShort: true,
    discardShortSec: 30,
    pomodoro: {
      workMin: 25,
      shortBreakMin: 5,
      longBreakMin: 15,
      cyclesBeforeLong: 4,
      linkedTypeId: null,
      autoStartNext: false,
      autoStartBreak: false,
      autoStartFocus: false,
      linkedTagIds: [],
      sound: true,
    },
  };
}

/** 常用 emoji 快选 */
export const EMOJI_PRESETS = [
  '😴', '🛁', '🚌', '🚇', '🚗', '💼', '💻', '⌨️', '📐', '🛠️',
  '🍜', '🍕', '☕', '🍳', '🏃', '🏋️', '🧘', '🚴', '🏊', '🚶',
  '📖', '📝', '🎓', '🇫🇷', '🗣️', '🎧', '📷', '🎞️', '🎨', '🎸',
  '🎮', '🎬', '📺', '📱', '🌐', '🛍️', '🧹', '🧺', '🛒', '👨‍👩‍👦',
  '💬', '❤️', '🩺', '💤', '🌳', '✈️', '🧳', '🏷️', '⭐', '⏱️',
];
