// 日 / 周 / 月区间。全部按所选时区的自然日计算（startOfDay / addDays 能正确处理夏令时）。
import { addDays, startOfDay } from './time';
import { fromParts, zparts } from './zone';
import { rangeLabelText } from '../i18n/dates';

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
    const back = (zparts(d0).wd - weekStart + 7) % 7;
    const from = addDays(d0, -back);
    return { mode, from, to: addDays(from, 7) };
  }
  const p = zparts(d0);
  return { mode, from: fromParts(p.y, p.m, 1), to: fromParts(p.y, p.m + 1, 1) };
}

/** 前后翻一页，返回新的锚点 */
export function shiftAnchor(mode: RangeMode, anchor: number, dir: -1 | 1): number {
  if (mode === 'day') return addDays(anchor, dir);
  if (mode === 'week') return addDays(anchor, 7 * dir);
  const p = zparts(anchor);
  return fromParts(p.y, p.m + dir, 1);
}

/** 区间内每一天的 0 点 */
export function daysIn(from: number, to: number): number[] {
  const out: number[] = [];
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

export { dayLabel } from '../i18n/dates';

export function rangeLabel(r: Range, now: number): string {
  return rangeLabelText(r.mode, r.from, r.to, now);
}

export const rangeContains = (r: Range, ms: number) => ms >= r.from && ms < r.to;
