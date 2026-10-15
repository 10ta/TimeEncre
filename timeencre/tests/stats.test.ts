import { describe, expect, it } from 'vitest';
import { goalProgressMs, goalStatus, recentPeriods, sumByTag, sumByType, unionMs, untrackedMs } from '../src/lib/stats';
import { toIso } from '../src/lib/time';

const H = 3600_000;
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const rec = (typeId: string, s: number, e: number | null, tagIds: string[] = []) => ({
  typeId, tagIds, intervals: [{ start: toIso(s), end: e === null ? null : toIso(e) }],
});

describe('统计', () => {
  const rs = [
    rec('sleep', at(1, 23), at(2, 7)),
    rec('work', at(2, 9), at(2, 12), ['cad']),
    rec('study', at(2, 11), at(2, 13), ['tcf']), // 与工作重叠 1 小时
    rec('commute', at(2, 18), null, ['tcf']), // 进行中
  ];
  const from = at(2, 0), to = at(3, 0), now = at(2, 19);

  it('按类型裁剪到当天', () => {
    const m = sumByType(rs, from, to, now);
    expect(m.get('sleep')).toBe(7 * H);
    expect(m.get('work')).toBe(3 * H);
    expect(m.get('commute')).toBe(1 * H);
  });

  it('按标签：一条记录可计入多个标签，无标签归空键', () => {
    const m = sumByTag(rs, from, to, now);
    expect(m.get('tcf')).toBe(3 * H);
    expect(m.get('')).toBe(7 * H);
  });

  it('未记录时间按并集计算，截止到现在', () => {
    // 已过 19h；覆盖：0-7、9-13、18-19 = 12h
    expect(untrackedMs(rs, from, to, now)).toBe(7 * H);
    expect(unionMs([{ start: 0, end: 10 }, { start: 5, end: 20 }, { start: 30, end: 40 }])).toBe(30);
  });

  it('目标：按类型或标签匹配', () => {
    const g = { typeIds: ['study'], tagIds: ['tcf'], period: 'day' as const, direction: 'atLeast' as const, targetMinutes: 120 };
    expect(goalProgressMs(g, rs, from, to, now)).toBe(3 * H);
    expect(goalStatus(g, 3 * H, false)).toBe('met');
    expect(goalStatus(g, 1 * H, false)).toBe('ongoing');
    expect(goalStatus(g, 1 * H, true)).toBe('missed');
    const cap = { ...g, direction: 'atMost' as const };
    expect(goalStatus(cap, 3 * H, false)).toBe('over');
    expect(goalStatus(cap, 1 * H, true)).toBe('met');
  });

  it('最近若干周期', () => {
    const ps = recentPeriods('week', now, 1, 3);
    expect(ps[0].from).toBe(new Date(2026, 8, 28).getTime());
    expect(ps[2].from).toBe(new Date(2026, 8, 14).getTime());
  });
});
