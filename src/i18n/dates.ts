// 与语言相关的日期文字。中文保持原有格式；法语用 Intl。
// 全部按设置里的时区显示；时刻按 12/24 小时制设置显示。
import { getLang, locale } from './index';
import { addDays, startOfDay } from '../lib/time';
import { getHour12, getZone, zparts } from '../lib/zone';

const ZH_WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const ZH_WEEKDAY_NARROW = ['日', '一', '二', '三', '四', '五', '六'];

const fmtCache = new Map<string, Intl.DateTimeFormat>();
const fmt = (opts: Intl.DateTimeFormatOptions) => {
  const key = `${locale()}|${getZone()}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale(), { timeZone: getZone(), ...opts });
    fmtCache.set(key, f);
  }
  return f;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pad2 = (n: number) => String(n).padStart(2, '0');

/** “周五” / “ven.” */
export function weekdayShort(ms: number): string {
  return getLang() === 'zh' ? ZH_WEEKDAY[zparts(ms).wd] : fmt({ weekday: 'short' }).format(ms);
}

/** 图表 / 日历列头用的极短星期：“五” / “ven.” */
export function weekdayNarrow(ms: number): string {
  return getLang() === 'zh' ? ZH_WEEKDAY_NARROW[zparts(ms).wd] : fmt({ weekday: 'short' }).format(ms);
}

/** 该时间点在所选时区里是几号 */
export const dayOfMonth = (ms: number) => zparts(ms).d;

/** 日历左上角的月份缩写：“10月” / “oct.”；跨月时 “9–10月” / “sept.–oct.” */
export function monthShort(from: number, lastDay: number): string {
  const a = zparts(from).m;
  const b = zparts(lastDay).m;
  if (getLang() === 'zh') return a === b ? `${a}月` : `${a}–${b}月`;
  const m = fmt({ month: 'short' });
  return cap(a === b ? m.format(from) : `${m.format(from)}–${m.format(lastDay)}`);
}

const zhMd = (ms: number) => {
  const p = zparts(ms);
  return `${p.m}月${p.d}日`;
};

/** 图表提示里的短日期：“10/2” / “2/10” */
export function shortDate(ms: number): string {
  const p = zparts(ms);
  return getLang() === 'zh' ? `${p.m}/${p.d}` : `${p.d}/${p.m}`;
}

/** “今天 10月2日 周五” / “Aujourd’hui · ven. 2 oct.” */
export function dayLabel(dayStart: number, now: number): string {
  const today = startOfDay(now);
  const y = zparts(dayStart).y;
  const sameYear = y === zparts(now).y;
  const rel = dayStart === today ? 'today' : dayStart === addDays(today, -1) ? 'yesterday' : null;
  if (getLang() === 'zh') {
    const base = `${zhMd(dayStart)} ${ZH_WEEKDAY[zparts(dayStart).wd]}`;
    const withYear = sameYear ? base : `${y}年${base}`;
    return rel === 'today' ? `今天 ${withYear}` : rel === 'yesterday' ? `昨天 ${withYear}` : withYear;
  }
  const d = cap(fmt({ weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(dayStart));
  return rel === 'today' ? `Aujourd’hui · ${d}` : rel === 'yesterday' ? `Hier · ${d}` : d;
}

/** 区间标题：日 / 周 / 月 */
export function rangeLabelText(mode: 'day' | 'week' | 'month', from: number, to: number, now: number): string {
  if (mode === 'day') return dayLabel(from, now);
  const yNow = zparts(now).y;
  const last = addDays(to, -1);
  const y1 = zparts(from).y;
  const y2 = zparts(last).y;
  if (getLang() === 'zh') {
    if (mode === 'month') return `${y1}年${zparts(from).m}月`;
    if (y1 !== y2) return `${y1}年${zhMd(from)} – ${y2}年${zhMd(last)}`;
    return `${y1 === yNow ? '' : `${y1}年`}${zhMd(from)} – ${zhMd(last)}`;
  }
  if (mode === 'month') return cap(fmt({ month: 'long', year: 'numeric' }).format(from));
  const withYear = y1 !== y2 || y1 !== yNow;
  const f = fmt({ day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  return `${f.format(from)} – ${f.format(last)}`;
}

// ---------- 时刻（12/24 小时制） ----------

/** 时刻：24 小时制 “09:05”；12 小时制 “上午9:05” / “9:05 AM” */
export function clockText(ms: number): string {
  if (!getHour12()) {
    const p = zparts(ms);
    return `${pad2(p.h)}:${pad2(p.mi)}`;
  }
  return fmt({ hourCycle: 'h12', hour: 'numeric', minute: '2-digit' }).format(ms);
}

/** 时段 “09:05–10:30”；12 小时制下同为上午 / 下午时只写一次：“9:05–10:30 AM” / “上午9:05–10:30” */
export function clockRange(start: number, end: number | string, sep = '–'): string {
  if (typeof end === 'string') return `${clockText(start)}${sep}${end}`;
  if (getHour12() && zparts(start).h < 12 === zparts(end).h < 12 && end - start < 12 * 3600_000) {
    const a = clockText(start);
    const b = clockText(end);
    if (getLang() === 'zh') return `${a}${sep}${b.replace(/^[^\d]+/, '')}`;
    return `${a.replace(/\s*[^\d:]+$/, '')}${sep}${b}`;
  }
  return `${clockText(start)}${sep}${clockText(end)}`;
}

/** 可能跨天的时段：同一天时同 clockRange；跨天时带上日期 “10/2 23:00 – 10/3 07:10” */
export function spanText(start: number, end: number | string): string {
  if (typeof end === 'string' || zparts(start).d === zparts(end).d && end - start < 86_400_000) return clockRange(start, end);
  return `${shortDate(start)} ${clockText(start)} – ${shortDate(end)} ${clockText(end)}`;
}

/** 预约之类的时段：不是今天的带上日期 */
export function slotText(start: number, end: number, now: number): string {
  const text = spanText(start, end);
  if (text.includes('/') || dayOfMonthKey(start) === dayOfMonthKey(now)) return text;
  return `${shortDate(start)} ${text}`;
}
const dayOfMonthKey = (ms: number) => {
  const p = zparts(ms);
  return p.y * 10000 + p.m * 100 + p.d;
};

/** 时间轴刻度：一天中的第 h 点（0–24）。24 小时制 “9:00”；12 小时制 “上午9时” / “9 AM” */
export function hourLabel(h: number): string {
  if (!getHour12()) return `${h}:00`;
  return new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', hourCycle: 'h12', hour: 'numeric' }).format(Date.UTC(2000, 0, 1, h % 24));
}

/** 本地化的日期（所选时区） */
export function dateText(ms: number): string {
  const p = zparts(ms);
  return getLang() === 'zh' ? `${p.y}/${p.m}/${p.d}` : `${pad2(p.d)}/${pad2(p.m)}/${p.y}`;
}
/** 日期 + 时刻（设置页“上次同步”等） */
export const dateTimeText = (ms: number) => `${dateText(ms)} ${clockText(ms)}`;
export const timeText = clockText;
