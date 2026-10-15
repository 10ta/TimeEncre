import { afterEach, describe, expect, it } from 'vitest';
import { parseTime } from '../src/lib/timeinput';
import { _setZoneForTest } from '../src/lib/zone';
import { clockRange, clockText, dateTimeText, dayLabel, dayOfMonth, hourLabel, weekdayShort } from '../src/i18n/dates';
import { startOfDay } from '../src/lib/time';

afterEach(() => _setZoneForTest(null));

describe('时刻输入解析', () => {
  it('24 小时制', () => {
    expect(parseTime('9:30', null)).toEqual({ h: 9, mi: 30, complete: true });
    expect(parseTime('21h30', null)).toEqual({ h: 21, mi: 30, complete: true });
    expect(parseTime('21.3', null)).toEqual({ h: 21, mi: 3, complete: false });
    expect(parseTime('２１：０５'.normalize('NFKC'), null)).toEqual({ h: 21, mi: 5, complete: true });
    expect(parseTime('21：05', null)).toEqual({ h: 21, mi: 5, complete: true });
    expect(parseTime('930', null)).toEqual({ h: 9, mi: 30, complete: false });
    expect(parseTime('2130', null)).toEqual({ h: 21, mi: 30, complete: true });
    expect(parseTime('7', null)).toEqual({ h: 7, mi: 0, complete: false });
    expect(parseTime('0:00', null)).toEqual({ h: 0, mi: 0, complete: true });
    expect(parseTime('24:00', null)).toBeNull();
    expect(parseTime('9:75', null)).toBeNull();
    expect(parseTime('abc', null)).toBeNull();
    expect(parseTime('', null)).toBeNull();
  });
  it('写了上午 / 下午', () => {
    expect(parseTime('9:30pm', null)?.h).toBe(21);
    expect(parseTime('9:30 P.M.', null)?.h).toBe(21);
    expect(parseTime('12:15am', null)?.h).toBe(0);
    expect(parseTime('12pm', false)?.h).toBe(12);
    expect(parseTime('下午3:05', null)).toEqual({ h: 15, mi: 5, complete: true });
    expect(parseTime('上午12:30', true)?.h).toBe(0);
    expect(parseTime('13pm', null)).toBeNull();
  });
  it('12 小时制没写半天时沿用当前半天，13–23 按 24 小时', () => {
    expect(parseTime('9:30', true)?.h).toBe(21);
    expect(parseTime('9:30', false)?.h).toBe(9);
    expect(parseTime('12:10', false)?.h).toBe(0);
    expect(parseTime('12:10', true)?.h).toBe(12);
    expect(parseTime('18:00', false)?.h).toBe(18);
    expect(parseTime('0:20', true)?.h).toBe(0);
  });
});

describe('时刻显示', () => {
  const t = Date.parse('2026-10-02T13:05:00Z'); // 上海 21:05，纽约 09:05
  it('24 小时制按所选时区', () => {
    _setZoneForTest('Asia/Shanghai');
    expect(clockText(t)).toBe('21:05');
    _setZoneForTest('America/New_York');
    expect(clockText(t)).toBe('09:05');
    expect(hourLabel(15)).toBe('15:00');
    expect(clockRange(t, t + 3600_000)).toBe('09:05–10:05');
  });
  it('12 小时制', () => {
    _setZoneForTest('America/New_York', true);
    expect(clockText(t)).toBe('上午9:05');
    expect(clockRange(t, t + 3600_000)).toBe('上午9:05–10:05');
    expect(clockRange(t, t + 4 * 3600_000)).toBe('上午9:05–下午1:05');
    expect(hourLabel(15)).toBe('下午3时');
    expect(dateTimeText(t)).toBe('2026/10/2 上午9:05');
  });
  it('日期跟随时区', () => {
    const late = Date.parse('2026-10-02T23:30:00Z'); // 纽约 10/2 周五 19:30，上海 10/3 周六 07:30
    _setZoneForTest('America/New_York');
    expect(dayOfMonth(late)).toBe(2);
    expect(weekdayShort(late)).toBe('周五');
    expect(dayLabel(startOfDay(late), late)).toBe('今天 10月2日 周五');
    _setZoneForTest('Asia/Shanghai');
    expect(dayOfMonth(late)).toBe(3);
    expect(dayLabel(startOfDay(late), late)).toBe('今天 10月3日 周六');
  });
});
