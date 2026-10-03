import type { CatalogItem, Settings } from '../schema';
import { toIso } from '../lib/time';
import { newId } from '../lib/id';

export const PALETTE = [
  '#7A5C8E', '#C7684B', '#9A9A3A', '#E07B1F', '#2E7D6B',
  '#3F6FB5', '#B5487A', '#5B8C3A', '#8C6A4A', '#4A5A8C',
];

const DEFAULT_TYPES: Array<[string, string]> = [
  ['睡眠', '😴'], ['洗漱', '🛁'], ['通勤', '🚌'], ['工作', '💼'],
  ['吃饭', '🍜'], ['运动', '🏃'], ['阅读', '📖'], ['购物', '🛍️'],
  ['娱乐', '🎮'], ['家务', '🧹'], ['电影', '🎬'], ['散步', '🚶'],
  ['学习', '🎓'], ['上网', '💻'],
];

export function defaultTypes(): CatalogItem[] {
  const stamp = toIso(Date.now());
  return DEFAULT_TYPES.map(([name, emoji], i) => ({
    id: newId(),
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
