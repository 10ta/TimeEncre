// App 内提醒的规则（纯函数）：给定此刻的数据，算出“现在应该提醒什么”。
// 只在页面打开时由 Nudges 组件每半分钟调用一次；同一件事只提醒一次（key 去重由调用方负责）。
import { rangeOf } from './range';
import { fromIso } from './time';
import { evalGoal, isCap, type GoalSpec } from './goals';
import { matchesGoal } from './stats';
import { currentBlocks, type RoutineLike } from './routines';

const M = 60_000;

interface RecLike {
  id: string;
  typeId: string;
  tagIds: string[];
  state: 'running' | 'paused' | 'stopped';
  intervals: { start: string; end: string | null }[];
}

export interface NudgeConfig {
  enabled?: boolean;
  idleMin?: number | null;
  routineStart?: boolean;
  long?: Record<string, number>;
}

export type Nudge =
  /** “至多”目标：正在计时的活动让本期到了 80% / 100% */
  | { key: string; also: string[]; kind: 'cap'; goal: GoalSpec & { id: string; name: string }; level: 80 | 100; ms: number; target: number }
  /** 某个活动连续计时满了 N 分钟（每满一次提醒一次） */
  | { key: string; also: string[]; kind: 'long'; typeId: string; minutes: number }
  /** 没有任何计时已经这么久 */
  | { key: string; also: string[]; kind: 'idle'; minutes: number }
  /** 例程开始了，但没在做那件事 */
  | { key: string; also: string[]; kind: 'routine'; typeId: string; start: number; end: number };

export interface NudgeInput {
  now: number;
  /** 至少覆盖各“至多”目标的当前周期，外加所有进行中的记录 */
  records: RecLike[];
  goals: Array<GoalSpec & { id: string; name: string }>;
  routines: RoutineLike[];
  config: NudgeConfig | undefined;
  weekStart: number;
}

/** 空闲提醒最多连着几次 */
export const IDLE_MAX_REPEAT = 3;

/** 例程开始后多久之内还提醒（过了就不再打扰） */
export const ROUTINE_GRACE_MS = 15 * M;

export function dueNudges({ now, records, goals, routines, config, weekStart }: NudgeInput): Nudge[] {
  if (config?.enabled === false) return [];
  const out: Nudge[] = [];
  const running = records.filter((r) => r.state === 'running');

  // 1. “至多”目标快到 / 已到上限：只在有匹配的记录正在计时时提醒
  for (const g of goals) {
    if (!isCap(g) || !running.some((r) => matchesGoal(g, r))) continue;
    const period = rangeOf(g.period, now, weekStart);
    const ev = evalGoal(g, records, period, now, false);
    const ratio = (ev.value ?? 0) / ev.target;
    const base = `cap:${g.id}:${period.from}`;
    if (ratio >= 1) out.push({ key: `${base}:100`, also: [`${base}:80`], kind: 'cap', goal: g, level: 100, ms: ev.value ?? 0, target: ev.target });
    else if (ratio >= 0.8) out.push({ key: `${base}:80`, also: [], kind: 'cap', goal: g, level: 80, ms: ev.value ?? 0, target: ev.target });
  }

  // 2. 连续计时太久：按最后一段（正在进行的那段）算
  for (const r of running) {
    const n = config?.long?.[r.typeId];
    if (!n) continue;
    const last = r.intervals[r.intervals.length - 1];
    if (!last || last.end !== null) continue;
    const since = fromIso(last.start);
    const k = Math.floor((now - since) / (n * M));
    if (k >= 1) out.push({ key: `long:${r.id}:${since}:${k}`, also: [], kind: 'long', typeId: r.typeId, minutes: k * n });
  }

  // 3. 空闲：没有任何进行中的计时，离最后一次结束已经满了 idleMin 的整数倍
  const idle = config?.idleMin;
  if (idle && running.length === 0) {
    let lastEnd = -Infinity;
    for (const r of records) for (const iv of r.intervals) if (iv.end) lastEnd = Math.max(lastEnd, fromIso(iv.end));
    if (Number.isFinite(lastEnd) && lastEnd <= now) {
      const k = Math.floor((now - lastEnd) / (idle * M));
      // 最多连着提醒三次，页面整夜开着也不会一直响
      if (k >= 1 && k <= IDLE_MAX_REPEAT) out.push({ key: `idle:${lastEnd}:${k}`, also: [], kind: 'idle', minutes: k * idle });
    }
  }

  // 4. 例程开始：开始后一刻钟内，那件事没在计时
  if (config?.routineStart !== false) {
    const doing = new Set(running.map((r) => r.typeId));
    for (const b of currentBlocks(routines, now)) {
      if (doing.has(b.routine.typeId) || now - b.start > ROUTINE_GRACE_MS) continue;
      out.push({ key: `routine:${b.routine.id}:${b.start}`, also: [], kind: 'routine', typeId: b.routine.typeId, start: b.start, end: b.end });
    }
  }
  return out;
}
