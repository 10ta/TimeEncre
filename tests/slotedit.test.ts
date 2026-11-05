import { describe, expect, it } from 'vitest';
import { moveSlotStart, setSlotEnd } from '../src/lib/slotEdit';

describe('Keep 预约时间段联动', () => {
  it('改开始：结束跟着平移，保持时长', () => {
    expect(moveSlotStart({ start: '2026-11-05T13:00', end: '2026-11-05T14:30' }, '2026-11-05T14:00')).toEqual({
      start: '2026-11-05T14:00',
      end: '2026-11-05T15:30',
    });
  });

  it('改开始：原来不合法时按一小时', () => {
    expect(moveSlotStart({ start: '2026-11-05T14:00', end: '2026-11-05T13:00' }, '2026-11-05T16:00')).toEqual({
      start: '2026-11-05T16:00',
      end: '2026-11-05T17:00',
    });
  });

  it('改开始的日期：结束日期一起挪', () => {
    expect(moveSlotStart({ start: '2026-11-05T09:00', end: '2026-11-05T10:00' }, '2026-11-07T09:00').end).toBe('2026-11-07T10:00');
  });

  it('改结束时刻：跨午夜的短时段算次日', () => {
    expect(setSlotEnd({ start: '2026-11-05T23:00', end: '2026-11-06T00:00' }, '2026-11-06T01:30').end).toBe('2026-11-06T01:30');
    expect(setSlotEnd({ start: '2026-11-05T23:00', end: '2026-11-05T23:30' }, '2026-11-05T01:00').end).toBe('2026-11-06T01:00');
  });

  it('改结束时刻：早于开始且不像跨午夜，保留当天（由界面提示）', () => {
    expect(setSlotEnd({ start: '2026-11-05T14:00', end: '2026-11-05T15:00' }, '2026-11-05T13:00').end).toBe('2026-11-05T13:00');
  });

  it('次日的结束改回当天之后的时刻：回到开始那天', () => {
    expect(setSlotEnd({ start: '2026-11-05T14:00', end: '2026-11-06T01:00' }, '2026-11-06T15:00').end).toBe('2026-11-05T15:00');
  });

  it('跨好几天的预约、或改了结束日期：原样保留', () => {
    expect(setSlotEnd({ start: '2026-11-05T14:00', end: '2026-11-08T10:00' }, '2026-11-08T09:00').end).toBe('2026-11-08T09:00');
    expect(setSlotEnd({ start: '2026-11-05T14:00', end: '2026-11-05T15:00' }, '2026-11-09T15:00').end).toBe('2026-11-09T15:00');
  });
});
