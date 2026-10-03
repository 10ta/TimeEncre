import type { CSSProperties } from 'react';
import { useRecordsAround, useTypeMap } from '../../db/hooks';
import { useNow } from '../../ui/hooks';
import { addDays, clippedMs, formatHm, recordSpans, startOfDay } from '../../lib/time';

export function TodayStrip() {
  useNow(15_000); // 定时刷新；记录变化时 live query 也会触发重渲染
  const now = Date.now();
  const dayStart = startOfDay(now);
  const records = useRecordsAround(dayStart);
  const typeMap = useTypeMap();
  if (!records || !typeMap) return null;

  const dayEnd = Math.min(addDays(dayStart, 1), now);
  const byType = new Map<string, number>();
  for (const r of records) {
    const ms = clippedMs(recordSpans(r, now), dayStart, dayEnd);
    if (ms > 0) byType.set(r.typeId, (byType.get(r.typeId) ?? 0) + ms);
  }
  const rows = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, ms]) => s + ms, 0);
  const max = rows[0]?.[1] ?? 1;

  return (
    <section className="today" aria-labelledby="today-title">
      <header className="today-head">
        <h2 id="today-title">今天</h2>
        <span className="today-total">{total > 0 ? `已记录 ${formatHm(total)}` : '还没有记录'}</span>
      </header>
      {rows.length > 0 && (
        <ul className="today-list">
          {rows.map(([typeId, ms]) => {
            const t = typeMap.get(typeId);
            return (
              <li key={typeId} style={{ '--c': t?.color ?? '#888', '--w': `${(ms / max) * 100}%` } as CSSProperties}>
                <span className="today-name">
                  {t?.emoji} {t?.name ?? '未知类型'}
                </span>
                <span className="today-bar" aria-hidden="true">
                  <span />
                </span>
                <span className="today-ms">{formatHm(ms)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
