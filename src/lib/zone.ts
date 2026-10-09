// 时区与 12/24 小时制。两个设置只保存在本机（localStorage），切换时整页刷新——
// 和语言一样，模块里按时区算好的东西（今天几点开始、日历范围等）在加载时就定下了。
//
// 所有“某天几点”“这个月从哪天开始”的计算都经过这里：给定时区里的墙上时间 ⇄ 绝对时间点（毫秒）。
// 记录本身存的是绝对时间点（带偏移的 ISO），换时区只改变显示与分组，不改数据。

const TZ_KEY = 'timeencre.tz';
const H12_KEY = 'timeencre.hour12';
export const AUTO = 'auto';

export const deviceZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export function isValidZone(z: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function readZonePref(): string {
  const v = read(TZ_KEY);
  return v && v !== AUTO && isValidZone(v) ? v : AUTO;
}

let zonePref = readZonePref();
let zone = zonePref === AUTO ? deviceZone() : zonePref;
let hour12 = read(H12_KEY) === '1';

/** 当前生效的时区（IANA 名称） */
export const getZone = () => zone;
/** 用户的选择：'auto' 或 IANA 名称 */
export const getZonePref = () => zonePref;
export const getHour12 = () => hour12;

function saveAndReload(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 存不下就只对本次生效 */
  }
  location.reload();
}

export const switchZone = (pref: string) => saveAndReload(TZ_KEY, pref === AUTO || !isValidZone(pref) ? AUTO : pref);
export const switchHour12 = (on: boolean) => saveAndReload(H12_KEY, on ? '1' : '0');

/** 仅测试用 */
export function _setZoneForTest(z: string | null, h12 = false) {
  zonePref = z ?? AUTO;
  zone = z ?? deviceZone();
  hour12 = h12;
  cache.clear();
}

// ---------- 墙上时间 ⇄ 时间点 ----------

export interface ZParts {
  y: number;
  /** 1–12 */
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  /** 0 = 周日 */
  wd: number;
}

const fmts = new Map<string, Intl.DateTimeFormat>();
function partsFmt(z: string) {
  let f = fmts.get(z);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: z,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    fmts.set(z, f);
  }
  return f;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const cache = new Map<number, ZParts>();

/** 时间点在当前时区里的年月日时分秒 */
export function zparts(ms: number): ZParts {
  const key = Math.floor(ms / 1000);
  const hit = cache.get(key);
  if (hit) return hit;
  const p: Record<string, string> = {};
  // 传 Date 而不是数字：有的环境（假时钟）把数字 0 当成“没传”，会格式化成当前时间
  for (const { type, value } of partsFmt(zone).formatToParts(new Date(key * 1000))) p[type] = value;
  const out: ZParts = { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: WD[p.weekday] ?? 0 };
  if (cache.size > 4000) cache.clear();
  cache.set(key, out);
  return out;
}

/** 当前时区在该时间点相对 UTC 的偏移（毫秒，东八区为 +8h） */
export function offsetMs(ms: number): number {
  const p = zparts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * 当前时区里的墙上时间 → 时间点。月、日、时可以越界（例如 d + 1、m + 1），会自动进位。
 * 夏令时：不存在的时刻（拨快那一小时）顺延到拨快之后；出现两次的时刻（拨慢）取第一次。
 */
export function fromParts(y: number, m: number, d: number, h = 0, mi = 0, s = 0): number {
  const u = Date.UTC(y, m - 1, d, h, mi, s);
  const n = new Date(u); // 进位后的规范墙上时间
  const want = [n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), n.getUTCHours(), n.getUTCMinutes(), n.getUTCSeconds()];
  const before = offsetMs(u - 86_400_000);
  const after = offsetMs(u + 86_400_000);
  const valid = [...new Set([u - before, u - after])].filter((t) => {
    const p = zparts(t);
    return p.y === want[0] && p.m === want[1] && p.d === want[2] && p.h === want[3] && p.mi === want[4] && p.s === want[5];
  });
  return valid.length ? Math.min(...valid) : u - before;
}

/** "2026-10-08" */
export function dayKey(ms: number): string {
  const p = zparts(ms);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** 可选的时区列表（浏览器支持时取完整列表） */
export function allZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const list = intl.supportedValuesOf?.('timeZone') ?? [];
  const base = list.length
    ? list
    : ['UTC', 'Europe/Paris', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'America/Toronto', 'America/Montreal', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Australia/Sydney'];
  return [...new Set([...base, deviceZone(), zone, 'UTC'])].sort();
}

/** "UTC+08:00" 形式的当前偏移，用于时区列表 */
export function offsetLabel(z: string, at = Date.now()): string {
  try {
    const p: Record<string, string> = {};
    for (const { type, value } of partsFmt(z).formatToParts(new Date(at))) p[type] = value;
    const off = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(at / 1000) * 1000) / 60000);
    const sign = off >= 0 ? '+' : '−';
    const a = Math.abs(off);
    return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  } catch {
    return '';
  }
}
