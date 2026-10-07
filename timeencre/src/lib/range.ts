// 日 / 周 / 月区间。全部按本地时区的自然日计算（startOfDay / addDays 能正确处理夏令时）。
import { addDays, startOfDay } from './time';

export type RangeMode = 'day' | 'week' | 'month';

export interface Range {
  mode: RangeMode;
  from: number;
  /** 不含 */
  to: number;
}

export function rangeOf(mode: RangeMode, anchor: number, weekStart: number): Range {
  const d0 = startOfDay(anchor);
  if (mode === 'day') return { mode, from: d0, to: addDays(d0, 1) };
  if (mode === 'week') {
    const back = (new Date(d0).getDay() - weekStart + 7) % 7;
    const from = addDays(d0, -back);
    return { mode, from, to: addDays(from, 7) };
  }
  const d = new Date(d0);
  return {
    mode,
    from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
  };
}

/** 前后翻一页，返回新的锚点 */
export function shiftAnchor(mode: RangeMode, anchor: number, dir: -1 | 1): number {
  if (mode === 'day') return addDays(anchor, dir);
  if (mode === 'week') return addDays(anchor, 7 * dir);
  const d = new Date(anchor);
  return new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime();
}

/** 区间内每一天的 0 点 */
export function daysIn(from: number, to: number): number[] {
  const out: number[] = [];
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const md = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

export function dayLabel(dayStart: number, now: number): string {
  const today = startOfDay(now);
  const base = `${md(dayStart)} ${WEEKDAY[new Date(dayStart).getDay()]}`;
  const sameYear = new Date(dayStart).getFullYear() === new Date(now).getFullYear();
  const withYear = sameYear ? base : `${new Date(dayStart).getFullYear()}年${base}`;
  if (dayStart === today) return `今天 ${withYear}`;
  if (dayStart === addDays(today, -1)) return `昨天 ${withYear}`;
  return withYear;
}

export function rangeLabel(r: Range, now: number): string {
  if (r.mode === 'day') return dayLabel(r.from, now);
  if (r.mode === 'month') {
    const d = new Date(r.from);
    return `${d.getFullYear()}年${d.getMonth() + 1}月`;
  }
  const last = addDays(r.to, -1);
  const y1 = new Date(r.from).getFullYear();
  const y2 = new Date(last).getFullYear();
  const yNow = new Date(now).getFullYear();
  if (y1 !== y2) return `${y1}年${md(r.from)} – ${y2}年${md(last)}`;
  return `${y1 === yNow ? '' : `${y1}年`}${md(r.from)} – ${md(last)}`;
}

export const rangeContains = (r: Range, ms: number) => ms >= r.from && ms < r.to;
