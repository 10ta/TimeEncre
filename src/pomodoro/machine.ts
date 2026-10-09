// 番茄钟状态机（纯函数）。一切按时间戳计算：页面在后台、被关掉再打开，状态都能正确推算出来。
import { dayKey } from '../lib/zone';
import type { Settings } from '../schema';

export type Phase = 'work' | 'short' | 'long';
export type PomoConfig = Settings['pomodoro'];

export interface PomoState {
  phase: Phase;
  status: 'idle' | 'running' | 'paused';
  /** 本段已累计的时长（不含当前这次运行） */
  accMs: number;
  /** 当前这次运行的开始时间 */
  runSince: number | null;
  /** 距上次长休已完成的工作段数 */
  done: number;
  /** 当前工作段关联的时间记录 */
  recordId: string | null;
  /** 今天完成的番茄数与专注时长（day 为 YYYY-MM-DD） */
  today: { day: string; count: number; focusMs: number };
}

export { dayKey };

export const initialState = (now: number): PomoState => ({
  phase: 'work',
  status: 'idle',
  accMs: 0,
  runSince: null,
  done: 0,
  recordId: null,
  today: { day: dayKey(now), count: 0, focusMs: 0 },
});

/** 两个自动开关；旧设置只有 autoStartNext 时两者都沿用它 */
export const autoBreak = (cfg: PomoConfig) => cfg.autoStartBreak ?? cfg.autoStartNext ?? false;
export const autoFocus = (cfg: PomoConfig) => cfg.autoStartFocus ?? cfg.autoStartNext ?? false;
export const linkedTags = (cfg: PomoConfig) => cfg.linkedTagIds ?? [];

export function durationMs(phase: Phase, cfg: PomoConfig): number {
  const min = phase === 'work' ? cfg.workMin : phase === 'short' ? cfg.shortBreakMin : cfg.longBreakMin;
  return min * 60_000;
}

export function elapsedMs(s: PomoState, now: number): number {
  return s.accMs + (s.status === 'running' && s.runSince !== null ? Math.max(0, now - s.runSince) : 0);
}

export const remainingMs = (s: PomoState, cfg: PomoConfig, now: number) =>
  Math.max(0, durationMs(s.phase, cfg) - elapsedMs(s, now));

/** 当前运行段会在何时结束；不在运行时为 null */
export function endsAt(s: PomoState, cfg: PomoConfig): number | null {
  if (s.status !== 'running' || s.runSince === null) return null;
  return s.runSince + durationMs(s.phase, cfg) - s.accMs;
}

const nextPhase = (s: PomoState, cfg: PomoConfig, doneAfter: number): Phase =>
  s.phase !== 'work' ? 'work' : doneAfter % cfg.cyclesBeforeLong === 0 ? 'long' : 'short';

export interface Finished {
  phase: Phase;
  endAt: number;
  recordId: string | null;
}

/**
 * 推进到 now：处理所有已经到点的阶段。
 * 下一段是否自动开始由对应开关决定（专注→休息看 autoBreak，休息→专注看 autoFocus），
 * 不自动开始时停在 idle；都自动时可能连续推进多段（比如页面关了很久）。
 * 返回新状态、结束了哪些阶段，以及如果此刻有一个新的工作段在运行，它是何时开始的（调用方据此建记录）。
 */
export function settle(
  s: PomoState,
  cfg: PomoConfig,
  now: number,
): { state: PomoState; finished: Finished[]; workStartedAt: number | null } {
  let state = rollDay(s, now);
  const finished: Finished[] = [];
  let workStartedAt: number | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const end = endsAt(state, cfg);
    if (end === null || end > now) break;
    finished.push({ phase: state.phase, endAt: end, recordId: state.recordId });
    const wasWork = state.phase === 'work';
    const done = wasWork ? state.done + 1 : state.phase === 'long' ? 0 : state.done;
    const today = rollDay(state, end).today;
    const nextToday = wasWork
      ? { ...today, count: today.count + 1, focusMs: today.focusMs + durationMs('work', cfg) }
      : today;
    const phase = nextPhase(state, cfg, wasWork ? state.done + 1 : state.done);
    const auto = wasWork ? autoBreak(cfg) : autoFocus(cfg);
    state = {
      ...state,
      phase,
      done,
      accMs: 0,
      recordId: null,
      today: nextToday,
      status: auto ? 'running' : 'idle',
      runSince: auto ? end : null,
    };
    workStartedAt = auto && phase === 'work' ? end : null;
  }
  return { state: rollDay(state, now), finished, workStartedAt };
}

/** 跨天后清零“今天”的统计 */
function rollDay(s: PomoState, now: number): PomoState {
  const day = dayKey(now);
  return s.today.day === day ? s : { ...s, today: { day, count: 0, focusMs: 0 } };
}

export const start = (s: PomoState, now: number): PomoState => ({ ...s, status: 'running', runSince: now });

export const pause = (s: PomoState, now: number): PomoState =>
  s.status !== 'running' ? s : { ...s, status: 'paused', accMs: elapsedMs(s, now), runSince: null };

/** 提前结束本段：工作段不计入完成数，直接进入短休；休息段直接回到工作 */
export function skip(s: PomoState, cfg: PomoConfig): PomoState {
  const phase: Phase = s.phase === 'work' ? (s.done + 1) % cfg.cyclesBeforeLong === 0 ? 'long' : 'short' : 'work';
  return { ...s, phase, status: 'idle', accMs: 0, runSince: null, recordId: null, done: s.phase === 'long' ? 0 : s.done };
}

export const switchPhase = (s: PomoState, phase: Phase): PomoState =>
  s.status !== 'idle' ? s : { ...s, phase, accMs: 0, runSince: null };

export const reset = (s: PomoState, now: number): PomoState => ({ ...initialState(now), today: rollDay(s, now).today });
