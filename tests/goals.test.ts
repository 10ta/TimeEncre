// 四种目标的计算：累计时长、几天达标、按时作息、某个时段
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _setZoneForTest } from '../src/lib/zone';
import { evalGoal, goalMs, isCap, windowSpans, type GoalSpec } from '../src/lib/goals';
import { goalMarks } from '../src/lib/insights';
import { rangeOf } from '../src/lib/range';

const H = 3_600_000;
const M = 60_000;
// 上海时区：2026-10-12 是周一
const at = (d: number, h: number, mi = 0) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00+08:00`);
const iso = (ms: number) => new Date(ms).toISOString();
const rec = (typeId: string, ...ivs: Array<[number, number | null]>) => ({
  typeId,
  tagIds: [] as string[],
  intervals: ivs.map(([s, e]) => ({ start: iso(s), end: e === null ? null : iso(e) })),
});
const base = { typeIds: ['a'], tagIds: [], period: 'day' as const, direction: 'atLeast' as const, targetMinutes: 30 };
const day = (d: number) => ({ from: at(d, 0), to: at(d + 1, 0) });

beforeEach(() => _setZoneForTest('Asia/Shanghai'));
afterEach(() => _setZoneForTest(null));

describe('几天达标', () => {
  const g: GoalSpec = { ...base, kind: 'days', period: 'week', minDays: 3 };
  const week = rangeOf('week', at(14, 12), 1);
  it('数达到门槛的天数；不够门槛的那天不算', () => {
    const rs = [rec('a', [at(12, 8), at(12, 9)]), rec('a', [at(13, 8), at(13, 8, 10)]), rec('a', [at(14, 8), at(14, 8, 40)])];
    const ev = evalGoal(g, rs, week, at(14, 12), false);
    expect(ev.value).toBe(2);
    expect(ev.target).toBe(3);
    expect(ev.status).toBe('ongoing');
    expect(evalGoal(g, rs, week, at(20, 12), true).status).toBe('missed');
  });
  it('达到天数即达成', () => {
    const rs = [12, 13, 15].map((d) => rec('a', [at(d, 8), at(d, 9)]));
    expect(evalGoal(g, rs, week, at(15, 12), false).status).toBe('met');
  });
});

describe('按时作息', () => {
  const bed: GoalSpec = { ...base, kind: 'clock', clockEdge: 'start', clockMin: 23 * 60 + 30 };
  const wake: GoalSpec = { ...base, kind: 'clock', clockEdge: 'end', clockMin: 8 * 60 };
  it('入睡：23:10 达成；00:30 才睡算前一晚、未达成', () => {
    expect(evalGoal(bed, [rec('a', [at(12, 23, 10), at(13, 7)])], day(12), at(14, 0), true)).toMatchObject({ status: 'met', value: 23 * 60 + 10 });
    const late = evalGoal(bed, [rec('a', [at(13, 0, 30), at(13, 8)])], day(12), at(14, 0), true);
    expect(late.status).toBe('missed');
    expect(late.value).toBe(24 * 60 + 30);
  });
  it('入睡：只看最长的一段，下午的小睡不算', () => {
    const rs = [rec('a', [at(12, 14), at(12, 14, 30)]), rec('a', [at(13, 0, 15), at(13, 7)])];
    expect(evalGoal(bed, rs, day(12), at(14, 0), true).status).toBe('missed');
  });
  it('入睡：截止前还没睡是进行中，过了截止还没睡是 over', () => {
    expect(evalGoal(bed, [], day(12), at(12, 22), false).status).toBe('ongoing');
    expect(evalGoal(bed, [], day(12), at(12, 23, 45), false).status).toBe('over');
  });
  it('入睡：正在睡（记录未结束）也已经能判断', () => {
    expect(evalGoal(bed, [rec('a', [at(12, 23), null])], day(12), at(13, 1), false).status).toBe('met');
  });
  it('起床：按结束时刻，还在睡且过了截止是 over', () => {
    expect(evalGoal(wake, [rec('a', [at(12, 23), at(13, 7, 40)])], day(13), at(13, 12), false)).toMatchObject({ status: 'met', value: 7 * 60 + 40 });
    expect(evalGoal(wake, [rec('a', [at(12, 23), null])], day(13), at(13, 8, 30), false).status).toBe('over');
    expect(evalGoal(wake, [rec('a', [at(12, 23), at(13, 9)])], day(13), at(13, 12), false).status).toBe('missed');
  });
  it('周视图的每日标记：每天一格', () => {
    const rs = [rec('a', [at(12, 23), at(13, 7)]), rec('a', [at(14, 0, 40), at(14, 8)])];
    const marks = goalMarks(bed, rs, rangeOf('week', at(14, 12), 1), at(14, 12), at(1, 0), 1);
    expect(marks.slice(0, 3).map((m) => m.status)).toEqual(['met', 'missed', 'ongoing']);
  });
});

describe('某个时段', () => {
  const cap: GoalSpec = { ...base, kind: 'window', direction: 'atMost', targetMinutes: 15, windowFrom: 22 * 60, windowTo: 2 * 60 };
  it('跨午夜的时段：只算 22:00–02:00 里的部分，前一天开始的那段也算进头两小时', () => {
    const spans = windowSpans(22 * 60, 2 * 60, at(13, 0), at(14, 0));
    expect(spans).toEqual([
      { start: at(13, 0), end: at(13, 2) },
      { start: at(13, 22), end: at(14, 0) },
    ]);
    const rs = [rec('a', [at(13, 21), at(13, 22, 30)]), rec('a', [at(13, 1), at(13, 3)])];
    expect(goalMs(cap, rs, at(13, 0), at(14, 0), at(14, 0))).toBe(30 * M + 1 * H);
  });
  it('至多型超了就是 over / missed', () => {
    const rs = [rec('a', [at(13, 22), at(13, 22, 40)])];
    expect(evalGoal(cap, rs, day(13), at(13, 23), false).status).toBe('over');
    expect(evalGoal(cap, rs, day(13), at(14, 1), true).status).toBe('missed');
    expect(isCap(cap)).toBe(true);
    expect(isCap({ ...cap, kind: 'clock' })).toBe(false);
  });
});

describe('累计时长（默认）不变', () => {
  it('和原来一样', () => {
    const rs = [rec('a', [at(13, 8), at(13, 9)])];
    expect(evalGoal(base, rs, day(13), at(13, 12), false)).toMatchObject({ status: 'met', value: H, target: 30 * M, pct: 100 });
    expect(evalGoal({ ...base, targetMinutes: 120 }, rs, day(13), at(13, 12), false)).toMatchObject({ status: 'ongoing', pct: 50 });
  });
});
