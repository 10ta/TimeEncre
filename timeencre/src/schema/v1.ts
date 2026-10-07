// schemaVersion 1 的数据结构。
// 规则：
//  - 用 looseObject：遇到未知字段原样保留，旧版本客户端不会把新版本加的字段删掉。
//  - 时间用 ISO 8601 带时区；id 用 UUIDv7（RFC 9562）；颜色用 #rrggbb。
//  - 时长不存，由 intervals 计算。
//  - deleted 是墓碑标记：删除也是一次"更新"，多设备合并时才不会被旧数据复活。
import { z } from 'zod';

const IsoTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), '无效的 ISO 时间');
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色需为 #rrggbb');

const base = {
  id: z.string().min(1),
  updatedAt: IsoTime,
  deleted: z.boolean().default(false),
};

/** 活动类型和标签共用同一结构：平级、无父子、带 emoji 图标 */
export const CatalogItemV1 = z.looseObject({
  ...base,
  name: z.string(),
  emoji: z.string(),
  color: HexColor,
  order: z.number(),
  archived: z.boolean().default(false),
});

export const IntervalV1 = z.looseObject({
  start: IsoTime,
  end: IsoTime.nullable(),
});

export const RecordV1 = z.looseObject({
  ...base,
  typeId: z.string(),
  tagIds: z.array(z.string()).default([]),
  comment: z.string().default(''),
  /** running：最后一个区间未结束；paused：区间都已结束但记录未停止；stopped：已结束 */
  state: z.enum(['running', 'paused', 'stopped']),
  intervals: z.array(IntervalV1).min(1),
});

export const GoalV1 = z.looseObject({
  ...base,
  name: z.string().default(''),
  typeIds: z.array(z.string()).default([]),
  tagIds: z.array(z.string()).default([]),
  period: z.enum(['day', 'week', 'month']),
  direction: z.enum(['atLeast', 'atMost']),
  targetMinutes: z.number().positive(),
});

export const PomodoroV1 = z.looseObject({
  workMin: z.number().positive().default(25),
  shortBreakMin: z.number().positive().default(5),
  longBreakMin: z.number().positive().default(15),
  cyclesBeforeLong: z.number().int().positive().default(4),
  linkedTypeId: z.string().nullable().default(null),
  // 以下为 v1 内的增量字段：旧文件缺失时取默认值，无需升版本
  /** 已拆分为 autoStartBreak / autoStartFocus；保留用于兼容旧设置 */
  autoStartNext: z.boolean().default(false),
  /** 专注结束后自动开始休息（缺省时沿用 autoStartNext） */
  autoStartBreak: z.boolean().optional(),
  /** 休息结束后自动开始专注（缺省时沿用 autoStartNext） */
  autoStartFocus: z.boolean().optional(),
  /** 专注记录自动带上的标签 */
  linkedTagIds: z.array(z.string()).optional(),
  sound: z.boolean().default(true),
});

export const SettingsV1 = z.looseObject({
  updatedAt: IsoTime,
  /** 0 = 周日，1 = 周一 */
  weekStart: z.number().int().min(0).max(6).default(1),
  allowConcurrent: z.boolean().default(true),
  /** 停止时总时长不足 discardShortSec 秒的计时自动作废（防误触）；缺省视为开启、30 秒 */
  discardShort: z.boolean().optional(),
  discardShortSec: z.number().int().positive().optional(),
  pomodoro: PomodoroV1,
});

/** 仓库中的 TimeEncre/profile.json */
export const ProfileFileV1 = z.looseObject({
  schemaVersion: z.literal(1),
  kind: z.literal('profile'),
  types: z.array(CatalogItemV1),
  tags: z.array(CatalogItemV1),
  goals: z.array(GoalV1),
  settings: SettingsV1,
});

/** 仓库中的 TimeEncre/records/2026-10.json（按记录首个区间的开始月份归档） */
export const RecordsFileV1 = z.looseObject({
  schemaVersion: z.literal(1),
  kind: z.literal('records'),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  records: z.array(RecordV1),
});

/** 手动导出 / 导入用的单文件备份 */
export const BundleFileV1 = z.looseObject({
  schemaVersion: z.literal(1),
  kind: z.literal('bundle'),
  app: z.literal('TimeEncre'),
  exportedAt: IsoTime,
  types: z.array(CatalogItemV1),
  tags: z.array(CatalogItemV1),
  goals: z.array(GoalV1),
  settings: SettingsV1,
  records: z.array(RecordV1),
});
