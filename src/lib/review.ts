// 周复盘（纯函数）：从这一周的数据自动得出“发生了什么”和“可以怎么改”。
// 只用简单、看得懂的比较（分组平均、占比），样本不够就不下结论；界面负责把结果翻译成句子。
import { addDays, recordSpans, startOfDay } from './time';
import { daysIn } from './range';
import { dayKey, fromParts, zparts } from './zone';
import { unionMs } from './stats';
import { countedDays, dailyUnion, goalMarks, sleepStats, untrackedIn } from './insights';
import { goalKind, isCap, type GoalSpec } from './goals';
import { adherence, type RoutineLike } from './routines';

const H = 3_600_000;
const M = 60_000;

interface RecLike {
  typeId: string;
  tagIds: string[];
  intervals: { start: string; end: string | null }[];
}

export interface ReviewGoal extends GoalSpec {
  id: string;
  name: string;
}

export interface ReviewInput {
  /** 至少覆盖 [lookbackFrom, week.to) */
  records: RecLike[];
  goals: ReviewGoal[];
  routines: RoutineLike[];
  /** 日期 YYYY-MM-DD → 1–5 */
  ratings: Map<string, number>;
  week: { from: number; to: number };
  prev: { from: number; to: number };
  now: number;
  firstMs: number | null;
  weekStart: number;
  sleepTypeId: string | null;
  /** 参与比较的活动（一般是所有没归档的活动） */
  typeIds: string[];
}

export interface GoalResult {
  goal: ReviewGoal;
  met: number;
  judged: number;
  /** 本周当前这一期（每周 / 每月目标）还没结束时的状态 */
  ongoing: boolean;
}

export interface Change {
  typeId: string;
  /** 日均，毫秒 */
  cur: number;
  prev: number;
}

export interface RoutineResult {
  routine: RoutineLike;
  plannedMs: number;
  doneMs: number;
  /** 这件事实际最常做的时段（开始的小时），没有数据时为 null */
  peakHour: number | null;
}

export interface Link {
  typeId: string;
  /** 两组的日均之差（毫秒）：正数 = “好”的那组更多 */
  diffMs: number;
  nA: number;
  nB: number;
}

export type Suggestion =
  /** “至多”目标超了好几天：超出的时间集中在某个时段 → 建议给那个时段设上限 */
  | { kind: 'capWindow'; goal: ReviewGoal; missed: number; judged: number; fromHour: number; toHour: number; share: number }
  /** “至少”目标没做到：建议用例程把时间固定下来，放在最常做这件事的时段 */
  | { kind: 'fixTime'; goal: ReviewGoal; met: number; judged: number; typeId: string | null; hour: number | null }
  /** 入睡时间波动大、又没有按时作息目标 → 建议设一个 */
  | { kind: 'bedtime'; sdMin: number; bedMin: number; suggestMin: number }
  /** 例程完成得少：建议挪到实际常做的时段，或缩短 */
  | { kind: 'routine'; result: RoutineResult }
  /** 未记录太多 */
  | { kind: 'untracked'; ms: number };

export interface Review {
  days: number;
  goals: GoalResult[];
  changes: Change[];
  untrackedMs: number;
  sleep: { nights: number; bedMean: number | null; bedSd: number | null; avgMs: number };
  routines: RoutineResult[];
  rating: { avg: number | null; n: number; prevAvg: number | null; prevN: number };
  /** 评分 4–5 的日子 vs 其他日子：各活动日均差得最多的（近 8 周） */
  ratingLinks: Link[];
  ratedDays: number;
  /** 睡得较长的第二天 vs 睡得较短的第二天（近 8 周，按中位数分组） */
  sleepLinks: Link[];
  sleepSplitMs: number | null;
  suggestions: Suggestion[];
}

/** 往回看多少天找规律 */
export const LOOKBACK_DAYS = 56;
/** 每组至少几天才比较 */
const MIN_GROUP = 4;
/** 差多少才值得说 */
const MIN_DIFF = 20 * M;

/** 一组记录每个小时（0–23）一共做了多少 */
export function hourTotals(records: RecLike[], from: number, to: number, now: number): number[] {
  const out = new Array<number>(24).fill(0);
  for (const r of records)
    for (const s of recordSpans(r, now)) {
      let a = Math.max(s.start, from);
      const e = Math.min(s.end, to);
      while (a < e) {
        const p = zparts(a);
        const next = Math.min(e, fromParts(p.y, p.m, p.d, p.h + 1));
        out[p.h] += next - a;
        a = next;
      }
    }
  return out;
}

/** 连续 width 小时（可跨午夜）里做得最多的那段的开始小时，以及它占全部的比例 */
export function peakWindow(hours: number[], width: number): { hour: number; share: number } | null {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let best = 0;
  let bestSum = -1;
  for (let h = 0; h < 24; h++) {
    let sum = 0;
    for (let k = 0; k < width; k++) sum += hours[(h + k) % 24];
    // 一样多时取从有数据的那个小时开始的（“22–01 点”比“21–24 点”更贴切）
    if (sum > bestSum || (sum === bestSum && hours[best] === 0 && hours[h] > 0)) {
      bestSum = sum;
      best = h;
    }
  }
  return { hour: best, share: bestSum / total };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 按天分两组，比较各活动的日均：groupOf(day) 返回 'a' / 'b' / null（不参与） */
function compareGroups(byType: Map<string, Map<number, number>>, days: number[], groupOf: (day: number) => 'a' | 'b' | null): Link[] {
  const a = days.filter((d) => groupOf(d) === 'a');
  const b = days.filter((d) => groupOf(d) === 'b');
  if (a.length < MIN_GROUP || b.length < MIN_GROUP) return [];
  const out: Link[] = [];
  for (const [typeId, daily] of byType) {
    const diff = mean(a.map((d) => daily.get(d) ?? 0)) - mean(b.map((d) => daily.get(d) ?? 0));
    if (Math.abs(diff) >= MIN_DIFF) out.push({ typeId, diffMs: diff, nA: a.length, nB: b.length });
  }
  return out.sort((x, y) => Math.abs(y.diffMs) - Math.abs(x.diffMs)).slice(0, 3);
}

/** 每晚主睡眠（≥ 3 小时）的时长，按起床那天归属 */
function nightsByWakeDay(records: RecLike[], now: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of records) {
    if (r.intervals.some((iv) => iv.end === null)) continue;
    const spans = recordSpans(r, now);
    if (!spans.length) continue;
    const dur = spans.reduce((a, s) => a + s.end - s.start, 0);
    if (dur < 3 * H) continue;
    const p = zparts(spans[spans.length - 1].end);
    const day = fromParts(p.y, p.m, p.d);
    out.set(day, Math.max(out.get(day) ?? 0, dur));
  }
  return out;
}

const roundDownTo = (m: number, step: number) => Math.floor(m / step) * step;

export function weeklyReview(input: ReviewInput): Review {
  const { records, goals, routines, ratings, week, prev, now, firstMs, weekStart, sleepTypeId, typeIds } = input;
  const end = Math.min(week.to, now);
  const days = countedDays(week, now, firstMs);
  const prevDays = countedDays(prev, now, firstMs);
  const ofType = (id: string) => records.filter((r) => r.typeId === id);

  // 目标：本周的各个周期
  const goalResults: GoalResult[] = goals.map((g) => {
    const marks = goalMarks(g, records, week, now, firstMs, weekStart);
    const judged = marks.filter((m) => m.status === 'met' || m.status === 'missed');
    return {
      goal: g,
      met: judged.filter((m) => m.status === 'met').length,
      judged: judged.length,
      ongoing: marks.some((m) => m.status === 'ongoing' || m.status === 'over'),
    };
  });

  // 变化最大的活动（日均）
  const changes: Change[] = [];
  if (days && prevDays)
    for (const id of typeIds) {
      const mine = ofType(id);
      const cur = unionMs(mine.flatMap((r) => recordSpans(r, now)).map((s) => ({ start: Math.max(s.start, week.from), end: Math.min(s.end, end) })).filter((s) => s.end > s.start)) / days;
      const p = unionMs(mine.flatMap((r) => recordSpans(r, now)).map((s) => ({ start: Math.max(s.start, prev.from), end: Math.min(s.end, prev.to) })).filter((s) => s.end > s.start)) / prevDays;
      if (Math.abs(cur - p) >= 15 * M) changes.push({ typeId: id, cur, prev: p });
    }
  changes.sort((a, b) => Math.abs(b.cur - b.prev) - Math.abs(a.cur - a.prev));

  const untrackedMs = untrackedIn(records, week.from, week.to, now, firstMs);

  // 作息
  const sleepRecs = sleepTypeId ? ofType(sleepTypeId) : [];
  const ss = sleepStats(sleepRecs, week.from, week.to, now);
  const sleep = { nights: ss.nights, bedMean: ss.bed?.mean ?? null, bedSd: ss.bed?.sd ?? null, avgMs: ss.avgMs };

  // 近 8 周：每天各活动的时长
  const lookFrom = Math.max(addDays(week.to, -LOOKBACK_DAYS), firstMs == null ? week.from : startOfDay(firstMs));
  const lookDays = daysIn(lookFrom, end).filter((d) => addDays(d, 1) <= now);
  const byType = new Map(typeIds.map((id) => [id, dailyUnion(ofType(id), lookFrom, end, now)]));

  // 例程：计划 vs 实际
  const routineResults: RoutineResult[] = routines
    .filter((r) => !r.deleted)
    .map((r) => {
      const a = adherence(r, records, week.from, week.to, now);
      const peak = peakWindow(hourTotals(ofType(r.typeId), lookFrom, end, now), 1);
      return { routine: r, plannedMs: a.plannedMs, doneMs: a.doneMs, peakHour: peak?.hour ?? null };
    })
    .filter((x) => x.plannedMs > 0);

  // 评分
  const scoresIn = (from: number, to: number) => daysIn(from, Math.min(to, now)).map((d) => ratings.get(dayKey(d))).filter((x): x is number => x != null);
  const cur = scoresIn(week.from, week.to);
  const pr = scoresIn(prev.from, prev.to);
  const rating = { avg: cur.length ? mean(cur) : null, n: cur.length, prevAvg: pr.length ? mean(pr) : null, prevN: pr.length };
  const ratedDays = lookDays.filter((d) => ratings.has(dayKey(d))).length;
  const ratingLinks = compareGroups(byType, lookDays, (d) => {
    const s = ratings.get(dayKey(d));
    return s == null ? null : s >= 4 ? 'a' : 'b';
  });

  // 睡眠长短 vs 第二天
  let sleepLinks: Link[] = [];
  let sleepSplitMs: number | null = null;
  if (sleepTypeId) {
    const nights = nightsByWakeDay(sleepRecs, now);
    const durs = lookDays.map((d) => nights.get(d)).filter((x): x is number => x != null).sort((a, b) => a - b);
    if (durs.length >= MIN_GROUP * 2) {
      sleepSplitMs = durs[Math.floor(durs.length / 2)];
      const others = new Map([...byType].filter(([id]) => id !== sleepTypeId));
      sleepLinks = compareGroups(others, lookDays, (d) => {
        const n = nights.get(d);
        return n == null ? null : n >= sleepSplitMs! ? 'a' : 'b';
      });
    }
  }

  // ---------- 建议（最多 3 条，按顺序取） ----------
  const suggestions: Suggestion[] = [];
  for (const gr of goalResults) {
    const g = gr.goal;
    const missed = gr.judged - gr.met;
    if (isCap(g) && goalKind(g) === 'duration' && missed >= 3) {
      const mine = records.filter((r) => g.typeIds.includes(r.typeId) || r.tagIds.some((t) => g.tagIds.includes(t)));
      const pw = peakWindow(hourTotals(mine, week.from, end, now), 3);
      if (pw && pw.share >= 0.4) suggestions.push({ kind: 'capWindow', goal: g, missed, judged: gr.judged, fromHour: pw.hour, toHour: (pw.hour + 3) % 24, share: pw.share });
    } else if (g.direction === 'atLeast' && goalKind(g) !== 'clock' && gr.judged >= 3 && gr.met * 2 < gr.judged) {
      const typeId = g.typeIds[0] ?? null;
      const covered = typeId != null && routines.some((r) => !r.deleted && r.typeId === typeId);
      if (!covered) {
        const pw = typeId ? peakWindow(hourTotals(ofType(typeId), lookFrom, end, now), 1) : null;
        suggestions.push({ kind: 'fixTime', goal: g, met: gr.met, judged: gr.judged, typeId, hour: pw?.hour ?? null });
      }
    }
  }
  const hasBedGoal = goals.some((g) => goalKind(g) === 'clock' && g.clockEdge !== 'end' && sleepTypeId != null && g.typeIds.includes(sleepTypeId));
  if (sleep.nights >= 4 && sleep.bedSd != null && sleep.bedSd >= 45 && sleep.bedMean != null && !hasBedGoal) {
    const bedMin = (Math.round(sleep.bedMean) + 720) % 1440;
    // 建议的入睡时刻：平均入睡往前取整到半点
    const suggestMin = (roundDownTo(Math.round(sleep.bedMean), 30) + 720) % 1440;
    suggestions.push({ kind: 'bedtime', sdMin: Math.round(sleep.bedSd), bedMin, suggestMin });
  }
  for (const rr of routineResults)
    if (rr.plannedMs >= 2 * H && rr.doneMs < rr.plannedMs * 0.5) suggestions.push({ kind: 'routine', result: rr });
  if (untrackedMs >= 2 * H) suggestions.push({ kind: 'untracked', ms: untrackedMs });

  return {
    days,
    goals: goalResults,
    changes: changes.slice(0, 3),
    untrackedMs,
    sleep,
    routines: routineResults,
    rating,
    ratingLinks,
    ratedDays,
    sleepLinks,
    sleepSplitMs,
    suggestions: suggestions.slice(0, 3),
  };
}
