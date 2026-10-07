// 时间工具：存储一律用带时区偏移的 ISO 8601（秒精度），计算一律转毫秒时间戳。

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** 毫秒时间戳 → "2026-10-02T16:49:27+08:00" */
export function toIso(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function fromIso(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`无效的时间：${iso}`);
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

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** "2026-10"，用于按月分文件 */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
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

/** 毫秒 → <input type="datetime-local"> 的值 */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> 的值 → 毫秒（按本地时区解释） */
export function fromLocalInput(value: string): number {
  return new Date(value).getTime();
}

export function fileStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
