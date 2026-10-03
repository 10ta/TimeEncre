import { useMemo, useState, type CSSProperties } from 'react';
import { useRecordsInRange, useSettings, useTagMap, useTypeMap } from '../../db/hooks';
import type { DbRecord } from '../../db/db';
import { fromDb } from '../../db/db';
import type { CatalogItem } from '../../schema';
import { useNow } from '../../ui/hooks';
import { addDays, formatClock, formatHm } from '../../lib/time';
import { dayLabel, rangeOf, shiftAnchor, type RangeMode } from '../../lib/range';
import { gaps, splitByDay, type DaySeg } from '../../lib/segments';
import { RangeNav } from '../shared/RangeNav';
import { RecordEditor } from '../records/RecordEditor';

const GAP_MIN_MS = 5 * 60_000;

const hm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type Item = { kind: 'seg'; seg: DaySeg<DbRecord> } | { kind: 'gap'; start: number; end: number };

export function HistoryPage() {
  const settings = useSettings();
  const typeMap = useTypeMap();
  const tagMap = useTagMap();
  useNow(30_000);
  const now = Date.now();

  const [mode, setMode] = useState<RangeMode>('week');
  const [anchor, setAnchor] = useState(now);
  const [query, setQuery] = useState('');
  const [showGaps, setShowGaps] = useState(false);
  const [editing, setEditing] = useState<DbRecord | null>(null);
  const [adding, setAdding] = useState<{ start: number; end: number } | 'blank' | null>(null);

  const range = rangeOf(mode, anchor, settings?.weekStart ?? 1);
  const records = useRecordsInRange(range.from, range.to);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!records || !typeMap || !tagMap) return [];
    if (!q) return records;
    return records.filter((r) => {
      const hay = [
        typeMap.get(r.typeId)?.name ?? '',
        r.comment,
        ...r.tagIds.map((id) => tagMap.get(id)?.name ?? ''),
      ]
        .join('\n')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [records, typeMap, tagMap, q]);

  if (!records || !typeMap || !tagMap || !settings) return null;

  // 不显示未来的日子
  const visibleTo = Math.min(range.to, addDays(new Date(now).setHours(0, 0, 0, 0), 1));
  const byDay = splitByDay(filtered, range.from, visibleTo, now);
  const days = [...byDay.keys()].sort((a, b) => b - a);
  const total = [...byDay.values()].flat().reduce((a, s) => a + s.ms, 0);

  // 空白时段：按日显示，搜索时不显示（筛选后的“空白”没有意义）
  const itemsFor = (day: number, segs: DaySeg<DbRecord>[]): Item[] => {
    const items: Item[] = segs.map((seg) => ({ kind: 'seg', seg }));
    if (showGaps && !q) {
      const dayEnd = Math.min(addDays(day, 1), now);
      for (const g of gaps(segs.flatMap((s) => s.spans), day, dayEnd, GAP_MIN_MS)) items.push({ kind: 'gap', ...g });
    }
    return items.sort((a, b) => (b.kind === 'seg' ? b.seg.start : b.start) - (a.kind === 'seg' ? a.seg.start : a.start));
  };

  // 打开空白显示时，没有任何记录的日子也要列出来
  const allDays = showGaps && !q ? daysDesc(range.from, visibleTo) : days;

  return (
    <div className="page history">
      <header className="page-head">
        <h1>历史</h1>
        <button type="button" className="btn is-primary" onClick={() => setAdding('blank')}>
          补录
        </button>
      </header>

      <RangeNav
        range={range}
        now={now}
        onMode={(m) => {
          setMode(m);
        }}
        onShift={(dir) => setAnchor((a) => shiftAnchor(mode, a, dir))}
        onToday={() => setAnchor(Date.now())}
        summary={total > 0 ? `已记录 ${formatHm(total)}` : '没有记录'}
      />

      <div className="history-tools">
        <input
          type="search"
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索类型、备注或标签"
          aria-label="搜索类型、备注或标签"
        />
        <label className="toggle is-compact">
          <input type="checkbox" checked={showGaps} onChange={(e) => setShowGaps(e.target.checked)} />
          <span>显示未记录的空白</span>
        </label>
      </div>

      {allDays.length === 0 && <p className="empty">{q ? `这段时间没有匹配“${query.trim()}”的记录。` : '这段时间没有记录。'}</p>}

      {allDays.map((day) => {
        const segs = byDay.get(day) ?? [];
        const dayTotal = segs.reduce((a, s) => a + s.ms, 0);
        return (
          <section key={day} className="day" aria-label={dayLabel(day, now)}>
            <header className="day-head">
              <h2>{dayLabel(day, now)}</h2>
              <span className="day-total">{dayTotal > 0 ? formatHm(dayTotal) : ''}</span>
            </header>
            <ul className="entries">
              {itemsFor(day, segs).map((it) =>
                it.kind === 'seg' ? (
                  <Entry
                    key={it.seg.rec.id}
                    seg={it.seg}
                    type={typeMap.get(it.seg.rec.typeId)}
                    tags={it.seg.rec.tagIds.map((id) => tagMap.get(id)).filter((t): t is CatalogItem => !!t && !t.deleted)}
                    onOpen={() => setEditing(it.seg.rec)}
                  />
                ) : (
                  <li key={`gap-${it.start}`}>
                    <button type="button" className="gap" onClick={() => setAdding({ start: it.start, end: it.end })} title="点击补录这段时间">
                      <span className="gap-time">
                        {hm(it.start)} – {hm(it.end)}
                      </span>
                      <span className="gap-label">未记录</span>
                      <span className="gap-ms">{formatHm(it.end - it.start)}</span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          </section>
        );
      })}

      {editing && <RecordEditor key={editing.id} mode="edit" rec={fromDb(editing)} onClose={() => setEditing(null)} />}
      {adding && (
        <RecordEditor
          mode="add"
          initial={adding === 'blank' ? undefined : adding}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

function daysDesc(from: number, to: number): number[] {
  const out: number[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out.reverse();
}

function Entry({
  seg,
  type,
  tags,
  onOpen,
}: {
  seg: DaySeg<DbRecord>;
  type?: CatalogItem;
  tags: CatalogItem[];
  onOpen: () => void;
}) {
  const r = seg.rec;
  const live = r.state === 'running' && seg.toNextDay === false;
  return (
    <li>
      <button type="button" className="entry" style={{ '--c': type?.color ?? '#888' } as CSSProperties} onClick={onOpen}>
        <span className="entry-emoji" aria-hidden="true">{type?.emoji ?? '❔'}</span>
        <span className="entry-body">
          <span className="entry-title">
            {type?.name ?? '未知类型'}
            {type?.deleted && <span className="badge">已删除的类型</span>}
            {r.state === 'running' && <span className="badge is-live">进行中</span>}
            {r.state === 'paused' && <span className="badge">已暂停</span>}
          </span>
          <span className="entry-time">
            {hm(seg.start)} – {live ? '现在' : hm(seg.end)}
            {seg.spans.length > 1 && <span className="entry-parts">（{seg.spans.length} 段）</span>}
            {seg.fromPrevDay && <span className="cont">接前日</span>}
            {seg.toNextDay && <span className="cont">延续到次日</span>}
          </span>
          {(tags.length > 0 || r.comment) && (
            <span className="entry-meta">
              {tags.map((t) => (
                <span key={t.id} className="tag" style={{ '--c': t.color } as CSSProperties}>
                  {t.emoji}
                  {t.name}
                </span>
              ))}
              {r.comment && <span className="entry-comment">{r.comment}</span>}
            </span>
          )}
        </span>
        <span className="entry-ms">{live ? formatClock(seg.ms) : formatHm(seg.ms)}</span>
      </button>
    </li>
  );
}
