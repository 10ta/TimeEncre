// App 内提醒的规则
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _setZoneForTest } from '../src/lib/zone';
import { dueNudges, type NudgeInput } from '../src/lib/nudges';

const M = 60_000;
// 上海时区：2026-10-12 是周一
const at = (d: number, h: number, mi = 0) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00+08:00`);
const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
const rec = (typeId: string, s: number, e: number | null) => ({
  id: `r${++seq}`,
  typeId,
  tagIds: [] as string[],
  state: (e === null ? 'running' : 'stopped') as 'running' | 'stopped',
  intervals: [{ start: iso(s), end: e === null ? null : iso(e) }],
});
const cap = { id: 'g1', name: '', typeIds: ['web'], tagIds: [], period: 'day' as const, direction: 'atMost' as const, targetMinutes: 60 };
const input = (p: Partial<NudgeInput>): NudgeInput => ({ now: at(13, 12), records: [], goals: [], routines: [], config: {}, weekStart: 1, ...p });

beforeEach(() => _setZoneForTest('Asia/Shanghai'));
afterEach(() => _setZoneForTest(null));

describe('上限提醒', () => {
  it('正在计时、到 80% 提醒一次；到 100% 换成另一条，并把 80% 也记为已提醒', () => {
    const rs = [rec('web', at(13, 10), at(13, 10, 40)), rec('web', at(13, 11, 50), null)];
    expect(dueNudges(input({ records: rs, goals: [cap], now: at(13, 11, 59) }))).toMatchObject([{ kind: 'cap', level: 80, key: expect.stringContaining(':80') }]);
    const n = dueNudges(input({ records: rs, goals: [cap], now: at(13, 12, 15) }));
    expect(n).toMatchObject([{ kind: 'cap', level: 100 }]);
    expect(n[0].also[0]).toContain(':80');
  });
  it('没有在计时就不提醒（超了也不打扰）', () => {
    const rs = [rec('web', at(13, 8), at(13, 10))];
    expect(dueNudges(input({ records: rs, goals: [cap] }))).toEqual([]);
  });
  it('至少型目标不提醒；总开关关掉什么都不提醒', () => {
    const rs = [rec('web', at(13, 10), null)];
    expect(dueNudges(input({ records: rs, goals: [{ ...cap, direction: 'atLeast' }] }))).toEqual([]);
    expect(dueNudges(input({ records: rs, goals: [cap], config: { enabled: false } }))).toEqual([]);
  });
});

describe('连续计时', () => {
  it('每满 N 分钟一条，key 带次数', () => {
    const r = rec('web', at(13, 11), null);
    const cfg = { long: { web: 45 } };
    expect(dueNudges(input({ records: [r], config: cfg, now: at(13, 11, 40) }))).toEqual([]);
    expect(dueNudges(input({ records: [r], config: cfg, now: at(13, 11, 50) }))).toMatchObject([{ kind: 'long', minutes: 45 }]);
    expect(dueNudges(input({ records: [r], config: cfg, now: at(13, 12, 40) }))).toMatchObject([{ kind: 'long', minutes: 90 }]);
  });
});

describe('忘记计时', () => {
  it('没有计时满 N 分钟提醒，最多三次', () => {
    const rs = [rec('x', at(13, 9), at(13, 10))];
    const cfg = { idleMin: 30 };
    expect(dueNudges(input({ records: rs, config: cfg, now: at(13, 10, 20) }))).toEqual([]);
    expect(dueNudges(input({ records: rs, config: cfg, now: at(13, 10, 35) }))).toMatchObject([{ kind: 'idle', minutes: 30 }]);
    expect(dueNudges(input({ records: rs, config: cfg, now: at(13, 11, 35) }))).toMatchObject([{ kind: 'idle', minutes: 90 }]);
    expect(dueNudges(input({ records: rs, config: cfg, now: at(13, 12, 5) }))).toEqual([]);
  });
  it('有计时在进行就不算空闲', () => {
    expect(dueNudges(input({ records: [rec('x', at(13, 9), null)], config: { idleMin: 30 } }))).toEqual([]);
  });
});

describe('例程开始', () => {
  const r = { id: 'rt', typeId: 'study', weekdays: [2], start: 12 * 60, end: 14 * 60 };
  it('开始后一刻钟内、没在做那件事时提醒', () => {
    expect(dueNudges(input({ routines: [r], now: at(13, 12, 5) }))).toMatchObject([{ kind: 'routine', typeId: 'study' }]);
    expect(dueNudges(input({ routines: [r], now: at(13, 12, 20) }))).toEqual([]);
    expect(dueNudges(input({ routines: [r], now: at(13, 12, 5), records: [rec('study', at(13, 11, 55), null)] }))).toEqual([]);
    expect(dueNudges(input({ routines: [r], now: at(13, 12, 5), config: { routineStart: false } }))).toEqual([]);
  });
});
