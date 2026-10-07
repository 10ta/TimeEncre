// 24 小时竖向时间轴（日 = 1 列，周 = 7 列），像日历一样：活动是色块，空档是虚线块。
// 同时进行的活动在重叠的那一簇里并排；点色块编辑，点空档处理。
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { DbRecord } from '../../db/db';
import type { CatalogItem } from '../../schema';
import type { DaySeg } from '../../lib/segments';
import { addDays, formatHm, startOfDay, type Span } from '../../lib/time';

const HOUR = 3_600_000;
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
const hm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

interface Block {
  key: string;
  rec: DbRecord;
  start: number;
  end: number;
  lane: number;
  lanes: number;
}

/** 按重叠分簇，簇内贪心分配并排的列 */
function layout(items: Array<{ key: string; rec: DbRecord; start: number; end: number }>): Block[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Block[] = [];
  let cluster: Block[] = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];
  const flush = () => {
    const n = laneEnds.length;
    for (const b of cluster) b.lanes = n;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const it of sorted) {
    if (it.start >= clusterEnd && cluster.length) flush();
    let lane = laneEnds.findIndex((e) => e <= it.start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(it.end);
    } else laneEnds[lane] = it.end;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}

export function CalendarView({
  days,
  segsByDay,
  gapsByDay,
  typeMap,
  now,
  selectedKey,
  onOpenRecord,
  onOpenGap,
}: {
  days: number[];
  segsByDay: Map<number, DaySeg<DbRecord>[]>;
  gapsByDay: Map<number, Span[]>;
  typeMap: Map<string, CatalogItem>;
  now: number;
  selectedKey: string | null;
  onOpenRecord: (rec: DbRecord) => void;
  onOpenGap: (gap: Span) => void;
}) {
  const hourPx = days.length === 1 ? 56 : 44;
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = startOfDay(now);

  // 打开时滚动到合适的位置：包含今天就停在“现在”前 3 小时，否则停在当天第一条记录前 1 小时
  const firstHour = useMemo(() => {
    if (days.includes(today)) return Math.max(0, (now - today) / HOUR - 3);
    let first = 24;
    for (const d of days) for (const s of segsByDay.get(d) ?? []) first = Math.min(first, (s.start - d) / HOUR);
    return first === 24 ? 7 : Math.max(0, first - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(',')]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: firstHour * hourPx });
  }, [firstHour, hourPx]);

  return (
    <div className={`cal${days.length === 1 ? ' is-day' : ' is-week'}`} style={{ '--hour': `${hourPx}px` } as CSSProperties}>
      {days.length > 1 && (
        <div className="cal-head">
          <span className="cal-gutter" />
          {days.map((d) => {
            const date = new Date(d);
            return (
              <span key={d} className={`cal-day-label${d === today ? ' is-today' : ''}`}>
                {WEEKDAY[date.getDay()]} <strong>{date.getDate()}</strong>
              </span>
            );
          })}
        </div>
      )}
      <div className="cal-scroll" ref={scrollRef}>
        <div className="cal-grid">
          <div className="cal-hours" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * hourPx }}>
                {h === 0 ? '' : `${h}:00`}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const segs = segsByDay.get(day) ?? [];
            const blocks = layout(
              segs.flatMap((s) => s.spans.map((sp, i) => ({ key: `${s.rec.id}:${i}`, rec: s.rec, start: sp.start, end: sp.end }))),
            );
            const y = (t: number) => ((t - day) / HOUR) * hourPx;
            return (
              <div key={day} className="cal-col" aria-label={new Date(day).toLocaleDateString()}>
                {(gapsByDay.get(day) ?? []).map((g) => {
                  const h = y(g.end) - y(g.start);
                  const key = `gap:${g.start}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`cal-gap${selectedKey === key ? ' is-selected' : ''}`}
                      aria-expanded={selectedKey === key}
                      style={{ top: y(g.start), height: Math.max(h, 3) }}
                      onClick={() => onOpenGap(g)}
                      title={`未记录 ${hm(g.start)}–${hm(g.end)}（${formatHm(g.end - g.start)}）`}
                    >
                      {h >= 16 && <span>未记录 · {formatHm(g.end - g.start)}</span>}
                    </button>
                  );
                })}
                {blocks.map((b) => {
                  const t = typeMap.get(b.rec.typeId);
                  const h = y(b.end) - y(b.start);
                  const live = b.rec.state === 'running' && b.end >= now - 1000;
                  const selected = selectedKey === `rec:${b.rec.id}`;
                  return (
                    <button
                      key={b.key}
                      type="button"
                      className={`cal-block${live ? ' is-live' : ''}${selected ? ' is-selected' : ''}`}
                      aria-expanded={selected}
                      style={
                        {
                          '--c': t?.color ?? '#888',
                          top: y(b.start),
                          height: Math.max(h, 3),
                          left: `calc(${(b.lane / b.lanes) * 100}% + 2px)`,
                          width: `calc(${100 / b.lanes}% - 4px)`,
                        } as CSSProperties
                      }
                      onClick={() => onOpenRecord(b.rec)}
                      title={`${t?.name ?? '未知活动'} ${hm(b.start)}–${live ? '现在' : hm(b.end)}（${formatHm(b.end - b.start)}）${b.rec.comment ? `\n${b.rec.comment}` : ''}`}
                    >
                      {h >= 18 && (
                        <span className="cal-block-name">
                          <span className="cal-block-emoji">{t?.emoji}</span>
                          <span className="cal-block-label"> {t?.name ?? '未知活动'}</span>
                        </span>
                      )}
                      {h >= 36 && (
                        <span className="cal-block-time">
                          {hm(b.start)}–{live ? '现在' : hm(b.end)}
                        </span>
                      )}
                    </button>
                  );
                })}
                {day === today && <span className="cal-now" style={{ top: y(now) }} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 每天的空档（过去的部分；今天截止到现在） */
export function dayGaps(
  segsByDay: Map<number, DaySeg<DbRecord>[]>,
  days: number[],
  now: number,
  gapsOf: (spans: Span[], from: number, to: number) => Span[],
): Map<number, Span[]> {
  const out = new Map<number, Span[]>();
  for (const d of days) {
    const to = Math.min(addDays(d, 1), now);
    if (to <= d) continue;
    out.set(d, gapsOf((segsByDay.get(d) ?? []).flatMap((s) => s.spans), d, to));
  }
  return out;
}
