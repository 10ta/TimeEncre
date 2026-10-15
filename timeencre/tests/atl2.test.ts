import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { atl2ColorToHex, convertAtl2 } from '../src/io/atl2';
import { RecordSchema, CatalogItemSchema } from '../src/schema';
import { fromIso, recordSpans, totalMs } from '../src/lib/time';

const sample = JSON.parse(readFileSync(new URL('./fixtures/atl2-sample.ttbkp', import.meta.url), 'utf8'));

describe('ATL2 导入', () => {
  it('转换真实备份样本', () => {
    const c = convertAtl2(sample, 0);
    expect(c.types).toHaveLength(13);
    expect(c.records).toHaveLength(2);
    const sleep = c.types.find((t) => t.name === 'Sleep')!;
    expect(sleep.emoji).toBe('😴');
    expect(sleep.color).toMatch(/^#[0-9a-f]{6}$/);
    for (const t of c.types) CatalogItemSchema.parse(t);
    for (const r of c.records) RecordSchema.parse(r);
    const r0 = c.records[0];
    expect(r0.id).toBe('01a0fbfa-9ff4-7428-be89-d859827e9b8f');
    expect(r0.state).toBe('stopped');
    expect(fromIso(r0.intervals[0].start)).toBe(1790000000 * 1000);
    expect(totalMs(recordSpans(r0, 0))).toBe(3000);
  });

  it('颜色：有符号 ARGB → #rrggbb', () => {
    expect(atl2ColorToHex(-1)).toBe('#ffffff');
    expect(atl2ColorToHex(-16777216)).toBe('#000000');
    expect(atl2ColorToHex(-7837317)).toBe('#88697b');
  });

  it('未结束的区间视为进行中，标签按名字生成', () => {
    const c = convertAtl2({
      types: [], activities: [{
        guid: 'a', typeGuid: 't', state: 1, tags: ['ios', 'ios', { name: 'x' }],
        intervals: [{ from: 100, to: 200 }, { from: 300, to: 0 }],
      }],
    });
    expect(c.records[0].state).toBe('running');
    expect(c.records[0].intervals[1].end).toBeNull();
    expect(c.tags.map((t) => t.name)).toEqual(['ios', 'x']);
    expect(c.records[0].tagIds).toHaveLength(2);
  });

  it('非 ATL2 文件报错', () => {
    expect(() => convertAtl2({ foo: 1 })).toThrow();
  });
});
