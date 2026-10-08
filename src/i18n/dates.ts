// 与语言相关的日期文字。中文保持原有格式；法语用 Intl。
import { getLang, locale } from './index';
import { addDays, startOfDay } from '../lib/time';

const ZH_WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const ZH_WEEKDAY_NARROW = ['日', '一', '二', '三', '四', '五', '六'];

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), opts);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** “周五” / “ven.” */
export function weekdayShort(ms: number): string {
  return getLang() === 'zh' ? ZH_WEEKDAY[new Date(ms).getDay()] : fmt({ weekday: 'short' }).format(ms);
}

/** 图表 / 日历列头用的极短星期：“五” / “ven.” */
export function weekdayNarrow(ms: number): string {
  return getLang() === 'zh' ? ZH_WEEKDAY_NARROW[new Date(ms).getDay()] : fmt({ weekday: 'short' }).format(ms);
}

/** 日历左上角的月份缩写：“10月” / “oct.”；跨月时 “9–10月” / “sept.–oct.” */
export function monthShort(from: number, lastDay: number): string {
  const a = new Date(from);
  const b = new Date(lastDay);
  if (getLang() === 'zh') {
    return a.getMonth() === b.getMonth() ? `${a.getMonth() + 1}月` : `${a.getMonth() + 1}–${b.getMonth() + 1}月`;
  }
  const m = fmt({ month: 'short' });
  return cap(a.getMonth() === b.getMonth() ? m.format(a) : `${m.format(a)}–${m.format(b)}`);
}

const zhMd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/** “今天 10月2日 周五” / “Aujourd’hui · ven. 2 oct.” */
export function dayLabel(dayStart: number, now: number): string {
  const today = startOfDay(now);
  const sameYear = new Date(dayStart).getFullYear() === new Date(now).getFullYear();
  const rel = dayStart === today ? 'today' : dayStart === addDays(today, -1) ? 'yesterday' : null;
  if (getLang() === 'zh') {
    const base = `${zhMd(dayStart)} ${ZH_WEEKDAY[new Date(dayStart).getDay()]}`;
    const withYear = sameYear ? base : `${new Date(dayStart).getFullYear()}年${base}`;
    return rel === 'today' ? `今天 ${withYear}` : rel === 'yesterday' ? `昨天 ${withYear}` : withYear;
  }
  const d = cap(fmt({ weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(dayStart));
  return rel === 'today' ? `Aujourd’hui · ${d}` : rel === 'yesterday' ? `Hier · ${d}` : d;
}

/** 区间标题：日 / 周 / 月 */
export function rangeLabelText(mode: 'day' | 'week' | 'month', from: number, to: number, now: number): string {
  if (mode === 'day') return dayLabel(from, now);
  const yNow = new Date(now).getFullYear();
  if (getLang() === 'zh') {
    if (mode === 'month') {
      const d = new Date(from);
      return `${d.getFullYear()}年${d.getMonth() + 1}月`;
    }
    const last = addDays(to, -1);
    const y1 = new Date(from).getFullYear();
    const y2 = new Date(last).getFullYear();
    if (y1 !== y2) return `${y1}年${zhMd(from)} – ${y2}年${zhMd(last)}`;
    return `${y1 === yNow ? '' : `${y1}年`}${zhMd(from)} – ${zhMd(last)}`;
  }
  if (mode === 'month') return cap(fmt({ month: 'long', year: 'numeric' }).format(from));
  const last = addDays(to, -1);
  const y1 = new Date(from).getFullYear();
  const y2 = new Date(last).getFullYear();
  const withYear = y1 !== y2 || y1 !== yNow;
  const f = fmt({ day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  return `${f.format(from)} – ${f.format(last)}`;
}

/** 本地化的完整日期时间（设置页“上次同步”等） */
export const dateTimeText = (ms: number) => new Date(ms).toLocaleString(locale());
export const timeText = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
export const dateText = (ms: number) => new Date(ms).toLocaleDateString(locale());
