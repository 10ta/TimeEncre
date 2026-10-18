import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _setZoneForTest } from '../src/lib/zone';
import { rangeOf } from '../src/lib/range';
import {
  change, countedDays, dailyUnion, goalForKey, goalMarks, hourHeat, periodValue, pomoStats, previousValue, previousWindow,
  sessionStats, sleepStats, streaks, trendRanges, trendSeries, totalsBy, untrackedIn, weekdayAverages, bedMinuteOfDay,
} from '../src/lib/insights';
import { daysIn } from '../src/lib/range';

const H = 3_600_000;
const M = 60_000;
// 上海时区：2026-10-12 是周一
const at = (d: number, h: number, mi = 0) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00+08:00`);
const iso = (ms: number) => new Date(ms).toISOString();
const rec = (typeId: string, ...ivs: Array<[number, number | null]>) => ({
  typeId,
  tagIds: [] as string[],
  comment: '',
  intervals: ivs.map(([s, e]) => ({ start: iso(s), end: e === null ? null : iso(e) })),
});

beforeEach(() => _setZoneForTest('Asia/Shanghai'));
afterEach(() => _setZoneForTest(null));

describe('平均与比较', () => {
  it('本周还没过完：按到今天为止的天数算日均；开始用之前的日子不算', () => {
    const week = rangeOf('week', at(15, 10), 1); // 10/12–10/18
    expect(countedDays(week, at(15, 10), at(1, 0))).toBe(4); // 周一到周四
    expect(countedDays(week, at(15, 10), at(14, 9))).toBe(2); // 周三才开始用
    expect(countedDays(week, at(20, 10), at(1, 0))).toBe(7); // 已过完的一周
    expect(countedDays(week, at(15, 10), null)).toBe(0);
    expect(periodValue(8 * H, 'week', 4)).toBe(2 * H);
    expect(periodValue(8 * H, 'month', 28)).toBe(2 * H); // 周均
    expect(periodValue(5 * H, 'day', 1)).toBe(5 * H);
    expect(periodValue(5 * H, 'week', 0)).toBeNull();
  });

  it('比较窗口：周 / 月是上一期，日是前 7 天的日均', () => {
    const day = rangeOf('day', at(15, 10), 1);
    expect(previousWindow('day', day, 1)).toEqual({ from: at(8, 0), to: at(15, 0) });
    expect(previousWindow('week', rangeOf('week', at(15, 10), 1), 1).from).toBe(at(5, 0));
    expect(previousValue(14 * H, 'day', 7)).toBe(2 * H);
    expect(change(3 * H, 2 * H)).toEqual({ delta: H, pct: 0.5 });
    expect(change(3 * H, 0)).toEqual({ delta: 3 * H, pct: null });
    expect(change(null, 2 * H)).toBeNull();
  });

  it('趋势：最早的在前，最后一期是当前期；开始用之前为 null', () => {
    const ranges = trendRanges('week', at(15, 10), 1, 3);
    expect(ranges.map((r) => r.from)).toEqual([Date.parse('2026-09-28T00:00:00+08:00'), at(5, 0), at(12, 0)]);
    const s = trendSeries(ranges, 'week', at(15, 10), at(6, 0), (f) => (f === at(12, 0) ? 8 * H : 14 * H));
    expect(s).toEqual([null, 14 * H / 6, 2 * H]); // 10/6 才开始用：上周只算 10/6–10/11 这 6 天
  });

  it('未记录：只算开始用之后、截止到现在', () => {
    const rs = [rec('a', [at(15, 8), at(15, 10)])];
    expect(untrackedIn(rs, at(15, 0), at(16, 0), at(15, 12), at(15, 6))).toBe(4 * H);
    expect(totalsBy(rs, at(15, 0), at(16, 0), at(15, 12), (r) => [r.typeId]).get('a')).toBe(2 * H);
  });
});

describe('目标完成情况', () => {
  const g = { typeIds: ['a'], tagIds: [], period: 'day' as const, direction: 'atLeast' as const, targetMinutes: 60 };
  it('周视图里的每日目标：7 天各一个；将来的标 future，开始用之前标 none', () => {
    const rs = [rec('a', [at(13, 8), at(13, 10)]), rec('a', [at(14, 8), at(14, 8, 30)])];
    const marks = goalMarks(g, rs, rangeOf('week', at(15, 10), 1), at(15, 10), at(13, 0), 1);
    expect(marks.map((m) => m.status)).toEqual(['none', 'met', 'missed', 'ongoing', 'future', 'future', 'future']);
  });
  it('周视图里的每周目标只有一个；月视图里按周', () => {
    const wg = { ...g, period: 'week' as const, targetMinutes: 120 };
    const rs = [rec('a', [at(13, 8), at(13, 11)])];
    expect(goalMarks(wg, rs, rangeOf('week', at(15, 10), 1), at(15, 10), at(1, 0), 1).map((m) => m.status)).toEqual(['met']);
    expect(goalMarks(wg, rs, rangeOf('month', at(15, 10), 1), at(15, 10), at(1, 0), 1).length).toBe(5); // 10 月跨 5 周
  });
  it('只匹配单一活动 / 单一标签的目标', () => {
    const goals = [{ ...g, typeIds: ['a', 'b'] }, { ...g, id: 'x' }];
    expect(goalForKey(goals, 'a', 'type')).toBe(goals[1]);
    expect(goalForKey(goals, 'b', 'type')).toBeUndefined();
  });
});

describe('连续天数、分段', () => {
  it('今天还没做不算断；最长取窗口内', () => {
    const days = daysIn(at(10, 0), at(16, 0)); // 10–15
    const rs = [10, 11, 13, 14].map((d) => rec('a', [at(d, 8), at(d, 9)]));
    const daily = dailyUnion(rs, at(10, 0), at(16, 0), at(15, 7));
    expect(streaks(daily, days)).toEqual({ current: 2, longest: 2 });
    const rs2 = [...rs, rec('a', [at(12, 8), at(12, 9)])];
    expect(streaks(dailyUnion(rs2, at(10, 0), at(16, 0), at(15, 7)), days)).toEqual({ current: 5, longest: 5 });
  });
  it('暂停分成的每一段都算一段', () => {
    const rs = [rec('a', [at(15, 8), at(15, 9)], [at(15, 10), at(15, 10, 30)]), rec('a', [at(15, 14), at(15, 17)])];
    expect(sessionStats(rs, at(15, 0), at(16, 0), at(15, 20))).toEqual({ count: 3, totalMs: 4.5 * H, avgMs: 1.5 * H, longestMs: 3 * H });
  });
});

describe('作息', () => {
  it('入睡跨午夜也能正确平均；不到 3 小时算小睡；按起床那天归属', () => {
    const rs = [
      rec('s', [at(12, 23), at(13, 7)]),
      rec('s', [at(14, 1), at(14, 8)]),
      rec('s', [at(14, 14), at(14, 15)]), // 小睡
      rec('s', [at(11, 23), at(12, 6)]), // 起床在 10/12 0 点之后：算本期
    ];
    const st = sleepStats(rs, at(12, 0), at(19, 0), at(15, 10));
    expect(st.nights).toBe(3);
    expect(st.naps).toBe(1);
    expect(bedMinuteOfDay(st.bed!.mean)).toBe(Math.round((23 * 60 + 25 * 60 + 23 * 60) / 3) % 1440); // 23:00、01:00、23:00 → 23:40
    expect(bedMinuteOfDay(st.bed!.mean)).toBe(23 * 60 + 40);
    expect(Math.round(st.wake!.mean)).toBe(7 * 60);
    expect(st.avgMs).toBeCloseTo((8 + 7 + 7) / 3 * H);
  });
});

describe('规律', () => {
  it('星期几平均、时段热力', () => {
    const days = daysIn(at(12, 0), at(15, 0)); // 周一到周三
    const rs = [rec('a', [at(12, 9), at(12, 10)]), rec('a', [at(13, 9), at(13, 9, 30)])];
    const daily = dailyUnion(rs, at(12, 0), at(15, 0), at(15, 10));
    const wd = weekdayAverages(daily, days);
    expect(wd[1]).toBe(H); // 周一
    expect(wd[2]).toBe(0.5 * H); // 周二
    expect(wd[0]).toBe(0);
    const heat = hourHeat(rs, days, at(15, 10), 'records', at(1, 0));
    expect(heat[1][9]).toBe(60);
    expect(heat[2][9]).toBe(30);
    const gaps = hourHeat(rs, days, at(15, 10), 'untracked', at(1, 0));
    expect(gaps[2][9]).toBe(30);
    expect(gaps[1][3]).toBe(60);
  });
});

describe('Pomo', () => {
  it('专注达到设定 90% 才算一个番茄；休息单独累计', () => {
    const f = (s: number, e: number) => ({ ...rec('w', [s, e]), comment: '🍅 Pomo' });
    const b = (s: number, e: number) => ({ ...rec('r', [s, e]), comment: '☕ Pomo' });
    const rs = [f(at(15, 8), at(15, 8, 25)), f(at(15, 9), at(15, 9, 10)), b(at(15, 8, 25), at(15, 8, 30))];
    const st = pomoStats(rs, at(15, 0), at(16, 0), at(15, 12), 25, (r) => r.comment === '🍅 Pomo', (r) => r.comment === '☕ Pomo');
    expect(st).toEqual({ done: 1, focusMs: 35 * M, breakMs: 5 * M });
  });
});
