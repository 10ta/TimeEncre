// 周复盘：要点、规律和建议
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _setZoneForTest } from '../src/lib/zone';
import { hourTotals, peakWindow, weeklyReview, type ReviewInput } from '../src/lib/review';
import { rangeOf } from '../src/lib/range';
import { addDays } from '../src/lib/time';

const H = 3_600_000;
// 上海时区：2026-10-12 是周一
const at = (d: number, h: number, mi = 0) => {
  const base = Date.parse('2026-10-01T00:00:00+08:00');
  return base + (d - 1) * 24 * H + h * H + mi * 60_000;
};
const iso = (ms: number) => new Date(ms).toISOString();
const rec = (typeId: string, s: number, e: number) => ({ typeId, tagIds: [] as string[], intervals: [{ start: iso(s), end: iso(e) }] });
const dk = (d: number) => `2026-${d > 31 ? '11' : '10'}-${String(d > 31 ? d - 31 : d).padStart(2, '0')}`;

beforeEach(() => _setZoneForTest('Asia/Shanghai'));
afterEach(() => _setZoneForTest(null));

function input(p: Partial<ReviewInput>): ReviewInput {
  const week = rangeOf('week', at(19, 12), 1); // 10/19–10/25
  return {
    records: [], goals: [], routines: [], ratings: new Map(), week,
    prev: { from: addDays(week.from, -7), to: week.from },
    now: at(26, 12), firstMs: at(1, 0), weekStart: 1, sleepTypeId: 'z', typeIds: ['web', 'study', 'z'], ...p,
  };
}

describe('工具函数', () => {
  it('按小时累计（跨小时切开），最集中的三小时', () => {
    const h = hourTotals([rec('web', at(19, 22, 30), at(20, 0, 30))], at(19, 0), at(21, 0), at(26, 0));
    expect(h[22]).toBe(0.5 * H);
    expect(h[23]).toBe(H);
    expect(h[0]).toBe(0.5 * H);
    expect(peakWindow(h, 3)).toEqual({ hour: 22, share: 1 });
  });
});

describe('周复盘', () => {
  it('上限目标超了好几天、集中在晚上 → 建议给那个时段设上限', () => {
    const records = [19, 20, 21, 22, 23].map((d) => rec('web', at(d, 22), at(d, 23, 59)));
    const goals = [{ id: 'g', name: '', typeIds: ['web'], tagIds: [], period: 'day' as const, direction: 'atMost' as const, targetMinutes: 60 }];
    const r = weeklyReview(input({ records, goals }));
    expect(r.goals[0]).toMatchObject({ met: 2, judged: 7 });
    expect(r.suggestions[0]).toMatchObject({ kind: 'capWindow', missed: 5, fromHour: 22, toHour: 1 });
  });

  it('至少型目标没做到、没有例程 → 建议固定时间，用平时最常做的时段', () => {
    const records = [rec('study', at(19, 20), at(19, 21)), rec('study', at(12, 20), at(12, 21))];
    const goals = [{ id: 'g', name: '', typeIds: ['study'], tagIds: [], period: 'day' as const, direction: 'atLeast' as const, targetMinutes: 60 }];
    const r = weeklyReview(input({ records, goals }));
    expect(r.suggestions[0]).toMatchObject({ kind: 'fixTime', met: 1, judged: 7, typeId: 'study', hour: 20 });
    const covered = weeklyReview(input({ records, goals, routines: [{ id: 'x', typeId: 'study', weekdays: [1], start: 1200, end: 1260 }] }));
    expect(covered.suggestions.find((s) => s.kind === 'fixTime')).toBeUndefined();
  });

  it('入睡波动大、没有就寝目标 → 建议就寝目标', () => {
    const beds = [22, 25, 23, 26, 22.5, 25.5];
    const records = beds.map((b, i) => rec('z', at(19 + i, 0) + b * H, at(19 + i, 0) + (b + 7.5) * H));
    const r = weeklyReview(input({ records }));
    const s = r.suggestions.find((x) => x.kind === 'bedtime');
    expect(s).toBeTruthy();
    expect(r.sleep.nights).toBeGreaterThanOrEqual(4);
  });

  it('评分规律：高分的日子学习更多', () => {
    const ratings = new Map<string, number>();
    const records = [];
    for (let d = 1; d <= 25; d++) {
      const good = d % 2 === 0;
      ratings.set(dk(d), good ? 5 : 2);
      if (good) records.push(rec('study', at(d, 9), at(d, 11)));
    }
    const r = weeklyReview(input({ records, ratings }));
    expect(r.ratingLinks[0]).toMatchObject({ typeId: 'study', diffMs: 2 * H });
    expect(r.rating.n).toBe(7);
  });

  it('变化只列超出往常范围的：和前 4 周同几天比，周中不会因为“才过了几天”全是下降', () => {
    // 9/21 起每天学习 2h、上网 1h；本周（10/19–）上网涨到每天 3h；“现在”是 10/22 周四上午
    const records = [];
    for (let day = at(1, 0) - 10 * 24 * H; day < at(22, 0); day += 24 * H) {
      records.push(rec('study', day + 9 * H, day + 11 * H));
      const web = day >= at(19, 0) ? 3 : 1;
      records.push(rec('web', day + 20 * H, day + (20 + web) * H));
    }
    const r = weeklyReview(input({ records, now: at(22, 10), firstMs: at(1, 0) - 10 * 24 * H }));
    expect(r.changes.map((c) => c.typeId)).toEqual(['web']);
    expect(r.changes[0]).toMatchObject({ cur: 3 * H, median: H, partial: false });
  });

  it('样本不够不下结论', () => {
    const ratings = new Map([[dk(20), 5], [dk(21), 1]]);
    const r = weeklyReview(input({ ratings }));
    expect(r.ratingLinks).toEqual([]);
    expect(r.ratedDays).toBe(2);
  });

  it('例程完成得少 → 建议调整；未记录多 → 建议补', () => {
    const routines = [{ id: 'rt', typeId: 'study', weekdays: [1, 2, 3, 4, 5], start: 9 * 60, end: 11 * 60 }];
    const r = weeklyReview(input({ routines, records: [rec('study', at(19, 20), at(19, 22))] }));
    expect(r.routines[0]).toMatchObject({ plannedMs: 10 * H, doneMs: 0, peakHour: 20 });
    expect(r.suggestions.map((s) => s.kind)).toEqual(['routine', 'untracked']);
  });
});
