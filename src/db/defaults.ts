import type { CatalogItem, Settings } from '../schema';
import { toIso } from '../lib/time';
import { getLang } from '../i18n';

export const PALETTE = [
  '#7A5C8E', '#C7684B', '#9A9A3A', '#E07B1F', '#2E7D6B',
  '#3F6FB5', '#B5487A', '#5B8C3A', '#8C6A4A', '#4A5A8C',
];

/** [固定 id 后缀, 中文名, 法语名, emoji] */
const DEFAULT_TYPES: Array<[string, string, string, string]> = [
  ['sleep', '睡眠', 'Sommeil', '😴'], ['bath', '洗漱', 'Toilette', '🛁'], ['commute', '通勤', 'Trajet', '🚌'],
  ['work', '工作', 'Travail', '💼'], ['eat', '吃饭', 'Repas', '🍜'], ['sport', '运动', 'Sport', '🏃'],
  ['read', '阅读', 'Lecture', '📖'], ['shop', '购物', 'Courses', '🛍️'], ['fun', '娱乐', 'Loisirs', '🎮'],
  ['housework', '家务', 'Ménage', '🧹'], ['movie', '电影', 'Cinéma', '🎬'], ['walk', '散步', 'Promenade', '🚶'],
  ['study', '学习', 'Études', '🎓'], ['internet', '上网', 'Internet', '💻'],
];

/** 默认活动的所有语言名称 → 固定 id（合并同名时识别默认活动用） */
export const DEFAULT_NAME_TO_ID = new Map(
  DEFAULT_TYPES.flatMap(([key, zh, fr]) => [[zh, `default-${key}`], [fr, `default-${key}`]] as Array<[string, string]>),
);

export const DEFAULT_ID_PREFIX = 'default-';

/**
 * 默认类型用固定 id、修改时间设为 1970：
 * 多台设备各自选了默认类型，同步时会按 id 合并成同一份，而不是各一份；
 * 任何设备上对它们的改名、归档、删除都比这个时间新，永远不会被新设备的默认值覆盖。
 */
export function defaultTypes(): CatalogItem[] {
  const stamp = toIso(0);
  const lang = getLang();
  return DEFAULT_TYPES.map(([key, zh, fr, emoji], i) => ({
    id: DEFAULT_ID_PREFIX + key,
    name: lang === 'fr' ? fr : zh,
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
