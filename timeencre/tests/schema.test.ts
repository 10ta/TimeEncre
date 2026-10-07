import { describe, expect, it } from 'vitest';
import { migrateFile, SchemaTooNewError } from '../src/schema';
import { RecordSchema } from '../src/schema';
import { clippedMs, formatClock, formatHm, toIso, fromIso } from '../src/lib/time';

describe('schema 与迁移', () => {
  it('拒绝比程序新的版本', () => {
    expect(() => migrateFile({ schemaVersion: 99, kind: 'profile' })).toThrow(SchemaTooNewError);
  });
  it('保留未知字段（looseObject）', () => {
    const r = RecordSchema.parse({
      id: 'x', updatedAt: '2026-10-02T10:00:00+08:00', typeId: 't', state: 'stopped',
      intervals: [{ start: '2026-10-02T09:00:00+08:00', end: '2026-10-02T10:00:00+08:00' }],
      futureField: 42,
    });
    expect((r as Record<string, unknown>).futureField).toBe(42);
    expect(r.deleted).toBe(false);
  });
});

describe('时间工具', () => {
  it('ISO 往返', () => {
    const ms = 1790933901000;
    expect(fromIso(toIso(ms))).toBe(ms);
  });
  it('格式化与裁剪', () => {
    expect(formatClock(3661000)).toBe('01:01:01');
    expect(formatHm(65 * 60000)).toBe('1h 05m');
    expect(clippedMs([{ start: 0, end: 100 }], 50, 200)).toBe(50);
  });
});
