import { tr } from '../i18n';
import { fromParts, offsetMs, zparts } from './zone';
// 时间工具：存储一律用带时区偏移的 ISO 8601（秒精度），计算一律转毫秒时间戳。
// “某天几点”一类的计算都按设置里选的时区（见 zone.ts），不依赖设备时区。

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** 毫秒时间戳 → "2026-10-02T16:49:27+08:00" */
export function toIso(ms: number): string {
  const p = zparts(ms);
  const off = Math.round(offsetMs(ms) / 60_000);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${p.y}-${pad(p.m)}-${pad(p.d)}` +
    `T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function fromIso(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(tr("无效的时间：{0}", iso));
  return t;
}

export interface Span {
  start: number;
  end: number;
}

/** 记录的所有区间，未结束的区间以 now 作为终点 */
export function recordSpans(
  rec: { intervals: { start: string; end: string | null }[] },
  now: number,
): Span[] {
  return rec.intervals.map((iv) => ({
    start: fromIso(iv.start),
    end: iv.end ? fromIso(iv.end) : now,
  }));
}

export function totalMs(spans: Span[]): number {
  return spans.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
}

/** 区间落在 [from, to) 内的部分 */
export function clippedMs(spans: Span[], from: number, to: number): number {
  return spans.reduce(
    (sum, s) => sum + Math.max(0, Math.min(s.end, to) - Math.max(s.start, from)),
    0,
  );
}

/** 所选时区里当天 0 点 */
export function startOfDay(ms: number): number {
  const p = zparts(ms);
  return fromParts(p.y, p.m, p.d);
}

/** 按日历日加减（遇到夏令时，一天可能是 23 或 25 小时） */
export function addDays(ms: number, n: number): number {
  const p = zparts(ms);
  return fromParts(p.y, p.m, p.d + n, p.h, p.mi, p.s) + (((ms % 1000) + 1000) % 1000);
}

/** 所选时区里的 "2026-10" */
export function monthKey(ms: number): string {
  const p = zparts(ms);
  return `${p.y}-${pad(p.m)}`;
}

/** 01:01:01（小时可超过 99） */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 3h 05m / 45m */
export function formatHm(ms: number): string {
  if (ms > 0 && ms < 60_000) return '<1m';
  const m = Math.round(Math.max(0, ms) / 60000);
  const h = Math.floor(m / 60);
  return h === 0 ? `${m}m` : `${h}h ${pad(m % 60)}m`;
}

/** 毫秒 → 所选时区里的 "2026-10-08T21:30"（时间输入框用） */
export function toLocalInput(ms: number): string {
  const p = zparts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** "2026-10-08T21:30" → 毫秒（按所选时区解释）；格式不对返回 NaN */
export function fromLocalInput(value: string): number {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return fromParts(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

export function fileStamp(ms: number): string {
  const p = zparts(ms);
  return `${p.y}${pad(p.m)}${pad(p.d)}-${pad(p.h)}${pad(p.mi)}`;
}
