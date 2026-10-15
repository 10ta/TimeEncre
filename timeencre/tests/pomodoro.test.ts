import { describe, expect, it } from 'vitest';
import { initialState, pause, remainingMs, settle, skip, start } from '../src/pomodoro/machine';

const M = 60_000;
const cfg = { workMin: 25, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4, linkedTypeId: null, autoStartNext: false, sound: true };
const t0 = new Date(2026, 9, 2, 9, 0).getTime();

describe('番茄钟状态机', () => {
  it('工作 → 到点后停在短休（不自动开始），结束时间精确', () => {
    const s = start(initialState(t0), t0);
    expect(remainingMs(s, cfg, t0 + 10 * M)).toBe(15 * M);
    const r = settle(s, cfg, t0 + 40 * M); // 页面在后台，晚了 15 分钟才检查
    expect(r.finished).toEqual([{ phase: 'work', endAt: t0 + 25 * M, recordId: null }]);
    expect(r.state.phase).toBe('short');
    expect(r.state.status).toBe('idle');
    expect(r.state.today.count).toBe(1);
  });

  it('暂停不计时', () => {
    let s = start(initialState(t0), t0);
    s = pause(s, t0 + 10 * M);
    expect(remainingMs(s, cfg, t0 + 60 * M)).toBe(15 * M);
    s = start(s, t0 + 60 * M);
    expect(settle(s, cfg, t0 + 74 * M).finished).toHaveLength(0);
    expect(settle(s, cfg, t0 + 75 * M).finished[0].endAt).toBe(t0 + 75 * M);
  });

  it('第 4 个工作段之后是长休，长休后计数归零', () => {
    const auto = { ...cfg, autoStartNext: true };
    const s = start(initialState(t0), t0);
    // 4×25 + 3×5 = 115 分钟后进入长休
    const r = settle(s, auto, t0 + 116 * M);
    expect(r.state.phase).toBe('long');
    expect(r.state.done).toBe(4);
    expect(r.finished.filter((f) => f.phase === 'work')).toHaveLength(4);
    const r2 = settle(r.state, auto, t0 + 131 * M);
    expect(r2.state.phase).toBe('work');
    expect(r2.state.done).toBe(0);
    expect(r2.workStartedAt).toBe(t0 + 130 * M);
  });

  it('两个自动开关分开：只自动休息时，休息结束停下等待', () => {
    const c = { ...cfg, autoStartBreak: true, autoStartFocus: false };
    const s = start(initialState(t0), t0);
    const r = settle(s, c, t0 + 40 * M);
    expect(r.state.phase).toBe('work'); // 25 专注 + 5 短休已过
    expect(r.state.status).toBe('idle');
    expect(r.workStartedAt).toBeNull();
    expect(r.finished.map((f) => f.phase)).toEqual(['work', 'short']);
  });

  it('只自动专注时，专注结束停在休息前', () => {
    const c = { ...cfg, autoStartBreak: false, autoStartFocus: true };
    const r = settle(start(initialState(t0), t0), c, t0 + 40 * M);
    expect(r.state.phase).toBe('short');
    expect(r.state.status).toBe('idle');
  });

  it('提前结束工作段：不计数，进入短休', () => {
    const s = skip(start(initialState(t0), t0), cfg);
    expect(s.phase).toBe('short');
    expect(s.done).toBe(0);
    expect(s.today.count).toBe(0);
  });

  it('跨天清零今日统计', () => {
    const s = start(initialState(t0), t0);
    const r = settle(s, cfg, t0 + 25 * M);
    const next = settle(r.state, cfg, t0 + 24 * 60 * M);
    expect(next.state.today.count).toBe(0);
  });
});
