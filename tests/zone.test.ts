import { afterEach, describe, expect, it } from 'vitest';
import { _setZoneForTest, dayKey, fromParts, offsetLabel, zparts } from '../src/lib/zone';
import { addDays, fromLocalInput, startOfDay, toIso, toLocalInput } from '../src/lib/time';
import { rangeOf, shiftAnchor } from '../src/lib/range';
import { splitByDay } from '../src/lib/segments';

const H = 3_600_000;
const utc = (s: string) => Date.parse(s);

afterEach(() => _setZoneForTest(null));

describe('指定时区（与设备时区无关）', () => {
  it('上海：当天 0 点、ISO 偏移、输入框换算', () => {
    _setZoneForTest('Asia/Shanghai');
    const t = utc('2026-10-08T15:30:00Z'); // 上海 23:30
    expect(toIso(t)).toBe('2026-10-08T23:30:00+08:00');
    expect(startOfDay(t)).toBe(utc('2026-10-07T16:00:00Z'));
    expect(toLocalInput(t)).toBe('2026-10-08T23:30');
    expect(fromLocalInput('2026-10-08T23:30')).toBe(t);
    expect(dayKey(t)).toBe('2026-10-08');
  });

  it('同一时刻换到纽约就是前一天', () => {
    _setZoneForTest('America/New_York');
    const t = utc('2026-10-08T02:30:00Z'); // 纽约 10/07 22:30（EDT）
    expect(toIso(t)).toBe('2026-10-07T22:30:00-04:00');
    expect(dayKey(t)).toBe('2026-10-07');
    expect(zparts(t).wd).toBe(3); // 周三
  });
});

describe('夏令时（纽约 2026：3/8 拨快，11/1 拨慢）', () => {
  it('拨快那天 23 小时，拨慢那天 25 小时', () => {
    _setZoneForTest('America/New_York');
    const mar8 = fromParts(2026, 3, 8);
    expect(addDays(mar8, 1) - mar8).toBe(23 * H);
    const nov1 = fromParts(2026, 11, 1);
    expect(addDays(nov1, 1) - nov1).toBe(25 * H);
    expect(startOfDay(nov1 + 24.5 * H)).toBe(nov1); // 当天 23:30 仍属 11/1
  });

  it('不存在的 02:30 顺延，出现两次的 01:30 取第一次', () => {
    _setZoneForTest('America/New_York');
    expect(toIso(fromParts(2026, 3, 8, 2, 30))).toBe('2026-03-08T03:30:00-04:00');
    expect(toIso(fromParts(2026, 11, 1, 1, 30))).toBe('2026-11-01T01:30:00-04:00');
  });

  it('跨夏令时的一周 / 一天按日历切分', () => {
    _setZoneForTest('America/New_York');
    const r = rangeOf('week', fromParts(2026, 11, 1, 12), 1); // 11/1 是周日，这一周跨过拨慢
    expect(toIso(r.from)).toBe('2026-10-26T00:00:00-04:00');
    expect(toIso(r.to)).toBe('2026-11-02T00:00:00-05:00');
    const rec = { intervals: [{ start: '2026-10-31T23:00:00-04:00', end: '2026-11-01T03:00:00-05:00' }] };
    const m = splitByDay([rec], fromParts(2026, 10, 31), fromParts(2026, 11, 2), fromParts(2026, 11, 3));
    expect(m.get(fromParts(2026, 10, 31))![0].ms).toBe(1 * H);
    expect(m.get(fromParts(2026, 11, 1))![0].ms).toBe(4 * H); // 0 点到 3 点经过了 4 小时
  });
});

describe('月份', () => {
  it('月初、翻页、跨年', () => {
    _setZoneForTest('Europe/Paris');
    const r = rangeOf('month', fromParts(2026, 12, 31, 23), 1);
    expect(toIso(r.from)).toBe('2026-12-01T00:00:00+01:00');
    expect(toIso(r.to)).toBe('2027-01-01T00:00:00+01:00');
    expect(toIso(shiftAnchor('month', fromParts(2026, 1, 31), 1))).toBe('2026-02-01T00:00:00+01:00');
  });

  it('时区偏移标签', () => {
    expect(offsetLabel('Asia/Shanghai')).toBe('UTC+08:00');
    expect(offsetLabel('UTC')).toBe('UTC+00:00');
  });
});

describe('同步的月份分组与时区无关', () => {
  it('同一条记录在不同时区的设备上归到同一个月份文件', async () => {
    const { toDb } = await import('../src/db/db');
    const rec = {
      id: 'r', typeId: 't', tagIds: [], comment: '', state: 'stopped' as const, deleted: false,
      updatedAt: '2026-10-01T01:00:00+08:00',
      intervals: [{ start: '2026-10-01T00:30:00+08:00', end: '2026-10-01T01:00:00+08:00' }],
    };
    _setZoneForTest('America/New_York'); // 在纽约这是 9 月 30 日
    const a = toDb(rec).month;
    _setZoneForTest('Asia/Shanghai');
    const b = toDb(rec).month;
    expect(a).toBe('2026-10');
    expect(b).toBe('2026-10');
  });
});
