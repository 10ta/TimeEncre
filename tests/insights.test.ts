import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _setZoneForTest } from '../src/lib/zone';
import { rangeOf } from '../src/lib/range';
import {
  baselineWindows, change, compareSetup, compareToBaseline, currentWindow, dailyUnion, goalForKey, goalMarks, hourHeat, lastIsPartial,
  pomoStats, previousWindow, sessionStats, sleepStats, streaks, trendRanges, trendSeries, totalsBy, untrackedIn, weekdayAverages, bedMinuteOfDay,
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
  it('本期窗口：进行中的周只算已经过完的日子；周一 / 日视图比到现在为止；开始用之前不算', () => {
    const week = rangeOf('week', at(15, 10), 1); // 10/12–10/18，10/15 是周四
    expect(currentWindow('week', week, at(15, 10), at(1, 0))).toEqual({ from: at(12, 0), to: at(15, 0), days: 3, partial: false });
    expect(currentWindow('week', week, at(15, 10), at(14, 9))).toMatchObject({ from: at(14, 0), days: 1 }); // 周三才开始用
    expect(currentWindow('week', week, at(20, 10), at(1, 0))).toMatchObject({ to: at(19, 0), days: 7, partial: false }); // 已过完
    expect(currentWindow('week', week, at(12, 10), at(1, 0))).toEqual({ from: at(12, 0), to: at(12, 10), days: 1, partial: true }); // 周一上午
    expect(currentWindow('day', rangeOf('day', at(15, 10), 1), at(15, 10), at(1, 0))).toMatchObject({ to: at(15, 10), partial: true });
    expect(currentWindow('week', week, at(15, 10), null)).toBeNull();
  });

  it('往常窗口：前几期的同一段（同几天 / 同一时刻）；开始用之前的期不算', () => {
    const week = rangeOf('week', at(15, 10), 1);
    const cur = currentWindow('week', week, at(15, 10), at(1, 0))!;
    const base = baselineWindows('week', week, cur, at(1, 0), 1);
    // 10/1 开始用：只有 10/5 那周完整；9/28 那周早于开始用
    expect(base).toEqual([{ from: at(5, 0), to: at(8, 0), days: 3, partial: false }]);
    const all = baselineWindows('week', week, cur, Date.parse('2026-09-01T00:00:00+08:00'), 1);
    expect(all).toHaveLength(4);
    // 日视图：前 4 周同一个星期几、同一时刻
    const day = rangeOf('day', at(29, 10), 1);
    const dw = baselineWindows('day', day, currentWindow('day', day, at(29, 10), at(1, 0))!, at(1, 0), 1);
    expect(dw.map((w) => [w.from, w.to])).toEqual([[at(22, 0), at(22, 10)], [at(15, 0), at(15, 10)], [at(8, 0), at(8, 10)], [at(1, 0), at(1, 10)]]);
    expect(previousWindow('week', week, 1).from).toBe(at(5, 0));
  });

  it('和往常比：中位数、范围；超出范围才算异常，往期不足 3 期不下结论', () => {
    const week = rangeOf('week', at(29, 10), 1); // 10/26–11/1，周四上午
    const cur = currentWindow('week', week, at(29, 10), Date.parse('2026-09-01T00:00:00+08:00'))!;
    const base = baselineWindows('week', week, cur, Date.parse('2026-09-01T00:00:00+08:00'), 1);
    // 每一期的值：本周 3 天共 6h（日均 2h）；往期 3 天各 4.5h / 6h / 7.5h / 9h（日均 1.5–3h）
    const totals = new Map([[cur.from, 6 * H], ...base.map((w, i) => [w.from, [4.5, 6, 7.5, 9][i] * H] as [number, number])]);
    const b = compareToBaseline((f) => totals.get(f)!, cur, base);
    expect(b).toMatchObject({ cur: 2 * H, median: 2.25 * H, min: 1.5 * H, max: 3 * H, n: 4, outside: 0 });
    totals.set(cur.from, 12 * H);
    expect(compareToBaseline((f) => totals.get(f)!, cur, base).outside).toBe(1);
    expect(compareToBaseline((f) => totals.get(f)!, cur, base.slice(0, 2)).outside).toBe(0);
    expect(change(3 * H, 2 * H)).toEqual({ delta: H, pct: 0.5 });
  });

  it('只比已经过完的日子：今天上午睡够了、学习还没开始，不会让睡眠偏多、学习偏少', () => {
    const week = rangeOf('week', at(29, 10), 1);
    const fm = Date.parse('2026-09-01T00:00:00+08:00');
    const rs = [] as ReturnType<typeof rec>[];
    // 每天 0–8 睡、19–21 学习，本周和往期一样
    for (let d = Date.parse('2026-09-28T00:00:00+08:00'); d < at(29, 10); d += 24 * H) {
      rs.push(rec('z', [d, d + 8 * H]));
      if (d + 21 * H < at(29, 10)) rs.push(rec('s', [d + 19 * H, d + 21 * H]));
    }
    const { compare } = compareSetup('week', week, at(29, 10), fm, 1);
    const sleep = compare((f, t) => totalsBy(rs, f, t, at(29, 10), (r) => [r.typeId]).get('z') ?? 0)!;
    const study = compare((f, t) => totalsBy(rs, f, t, at(29, 10), (r) => [r.typeId]).get('s') ?? 0)!;
    expect(sleep.cur).toBe(sleep.median);
    expect(study.cur).toBe(study.median);
    expect(study.cur).toBe(2 * H);
  });

  it('趋势：过完的期按整期日均；进行中的按已过完的日子，周一还没有过完的日子时为 null', () => {
    const ranges = trendRanges('week', at(15, 10), 1, 3);
    expect(ranges.map((r) => r.from)).toEqual([Date.parse('2026-09-28T00:00:00+08:00'), at(5, 0), at(12, 0)]);
    const s = trendSeries(ranges, 'week', at(15, 10), at(6, 0), (f, t) => (t - f) / 4);
    expect(s).toEqual([null, 6 * H, 6 * H]); // 10/6 才开始用：上周只算 10/6–10/11
    expect(trendSeries(ranges, 'week', at(12, 10), at(6, 0), () => H).at(-1)).toBeNull();
    expect(lastIsPartial(ranges, at(15, 10))).toBe(true);
  });

  it('未记录：只算开始用之后、截止到现在', () => {
    const rs = [rec('a', [at(15, 8), at(15, 10)])];
    expect(untrackedIn(rs, at(15, 0), at(16, 0), at(15, 12), at(15, 6))).toBe(4 * H);
    expect(totalsBy(rs, at(15, 0), at(16, 0), at(15, 12), (r) => [r.typeId]).get('a')).toBe(2 * H);
  });

  it('未记录：和历史页同一口径，短于 1 分钟的接缝不算', () => {
    const s = 1000;
    // 8:00–10:00、10:00:30–12:00（30 秒接缝）、12:05–13:00（5 分钟空档）
    const rs = [
      rec('a', [at(15, 8), at(15, 10)]),
      rec('a', [at(15, 10) + 30 * s, at(15, 12)]),
      rec('a', [at(15, 12, 5), at(15, 13)]),
    ];
    expect(untrackedIn(rs, at(15, 8), at(15, 13), at(15, 13), at(15, 8))).toBe(5 * 60 * s);
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
