import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useFirstRecordMs, useRecordsInRange, useSettings, useTagMap, useTypeMap } from '../../db/hooks';
import type { DbRecord } from '../../db/db';
import { fromDb } from '../../db/db';
import type { CatalogItem } from '../../schema';
import { useNow } from '../../ui/hooks';
import { addDays, formatClock, formatHm, startOfDay } from '../../lib/time';
import { dayLabel, daysIn, rangeOf, shiftAnchor, type RangeMode } from '../../lib/range';
import { gaps, splitByDay, type DaySeg } from '../../lib/segments';
import { RangeNav } from '../shared/RangeNav';
import { CreateRecordForm, LiveRecordForm } from '../records/RecordForms';
import { Drawer } from '../../ui/Drawer';
import { FloatingSheet } from '../../ui/FloatingSheet';
import { GAP_MIN_MS } from '../../lib/gaps';
import { CalendarView, dayGaps } from './CalendarView';
import { GapActions } from './GapActions';
import { tr } from '../../i18n';

type View = 'calendar' | 'list';
const VIEW_KEY = 'timeencre.historyView';
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'calendar';
  } catch {
    return 'calendar';
  }
};

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
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => {
    setViewState(v);
    setOpenKey(null);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* 浏览器不允许存储时只在本次生效 */
    }
  };
  // 日历里点中的色块 / 空档：'rec:<id>' 或 'gap:<开始时间>'
  // fresh：刚补录完的记录，打开时检查一次重叠
  const [sheet, setSheet] = useState<{ key: string; recId?: string; fresh?: boolean; gap?: { start: number; end: number } } | null>(null);

  // 从统计页“查看这些空白”跳过来：#/history?mode=week&anchor=<ms>&gaps=1
  useEffect(() => {
    const apply = () => {
      const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
      if (!q.has('mode')) return;
      const m = q.get('mode') as RangeMode;
      if (m === 'day' || m === 'week' || m === 'month') setMode(m);
      const a = Number(q.get('anchor'));
      if (a > 0) setAnchor(a);
      if (q.get('gaps') === '1') setShowGaps(true);
      history.replaceState(null, '', '#/history');
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);
  // 同一时间只展开一个：'new' = 顶部补录；'gap:<开始时间>' = 某个空白下的补录；'<日>:<记录id>' = 编辑某条
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (k: string) => setOpenKey((cur) => (cur === k ? null : k));

  const range = rangeOf(mode, anchor, settings?.weekStart ?? 1);
  const records = useRecordsInRange(range.from, range.to);
  // 第一条记录之前的时间不算“未记录”（还没开始用）
  const firstMs = useFirstRecordMs();
  const gapFloor = firstMs ?? Infinity;

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

  if (!records || !typeMap || !tagMap || !settings || firstMs === undefined) return null;

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
      const from = Math.max(day, gapFloor);
      if (from < dayEnd) for (const g of gaps(segs.flatMap((s) => s.spans), from, dayEnd, GAP_MIN_MS)) items.push({ kind: 'gap', ...g });
    }
    return items.sort((a, b) => (b.kind === 'seg' ? b.seg.start : b.start) - (a.kind === 'seg' ? a.seg.start : a.start));
  };

  // 打开空白显示时，没有任何记录的日子也要列出来
  const allDays = showGaps && !q ? daysDesc(Math.max(range.from, startOfDay(Math.min(gapFloor, now))), visibleTo) : days;

  // 日 / 周可以用日历视图；月只有列表
  const calendarMode = mode !== 'month';
  const showCalendar = calendarMode && view === 'calendar';
  const calDays = daysIn(range.from, range.to);
  const calGaps = q ? new Map<number, { start: number; end: number }[]>() : dayGaps(byDay, calDays, now, (sp, f, t) => (Math.max(f, gapFloor) < t ? gaps(sp, Math.max(f, gapFloor), t, GAP_MIN_MS) : []));

  return (
    <div className="page history">
      <header className="page-head">
        <h1>{tr("历史")}</h1>
      </header>

      <RangeNav
        range={range}
        now={now}
        onMode={(m) => {
          setMode(m);
        }}
        onShift={(dir) => setAnchor((a) => shiftAnchor(mode, a, dir))}
        onToday={() => setAnchor(Date.now())}
        summary={total > 0 ? tr("已记录 {0}", formatHm(total)) : tr("没有记录")}
      />

      <div className="history-tools">
        <input
          type="search"
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("搜索活动、备注或标签")}
          aria-label={tr("搜索活动、备注或标签")}
        />
        {calendarMode && (
          <div className="tabs" role="tablist" aria-label={tr("显示方式")}>
            {(
              [
                ['calendar', tr("日历")],
                ['list', tr("列表")],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'is-on' : undefined} onClick={() => setView(v)}>
                {label}
              </button>
            ))}
          </div>
        )}
        {!showCalendar && (
          <label className="toggle is-compact">
            <input type="checkbox" checked={showGaps} onChange={(e) => setShowGaps(e.target.checked)} />
            <span>{tr("显示未记录的空白")}</span>
          </label>
        )}
        <button type="button" className={`btn${openKey === 'new' ? ' is-active' : ''}`} aria-expanded={openKey === 'new'} onClick={() => toggle('new')}>
          {tr("＋ 补录")}
        </button>
      </div>

      <Drawer open={openKey === 'new'} onClose={() => setOpenKey(null)}>
        <div className="drawer-card">
          <CreateRecordForm onDone={() => setOpenKey(null)} onCreated={(id, start) => setOpenKey(`${startOfDay(start)}:${id}`)} />
        </div>
      </Drawer>

      {showCalendar ? (
        <>
          <CalendarView
            days={calDays}
            segsByDay={byDay}
            gapsByDay={calGaps}
            typeMap={typeMap}
            now={now}
            selectedKey={sheet?.key ?? null}
            onOpenRecord={(rec) => setSheet((cur) => (cur?.key === `rec:${rec.id}` ? null : { key: `rec:${rec.id}`, recId: rec.id }))}
            onOpenGap={(gap) => setSheet((cur) => (cur?.key === `gap:${gap.start}` ? null : { key: `gap:${gap.start}`, gap }))}
          />
          <p className="cal-hint">
            {tr("拖动色块的上下边缘调整时间，拖动中间整段平移；在空档里拖出一段可以只补录这一段。触屏上：点一下选中后拖动，再点一下打开编辑。")}
          </p>
          {sheet?.recId && (
            <RecordSheet key={sheet.recId} recId={sheet.recId} fresh={sheet.fresh} records={records} typeMap={typeMap} onClose={() => setSheet(null)} />
          )}
          {sheet?.gap && (
            <GapSheet
              key={sheet.gap.start}
              gap={sheet.gap}
              records={records}
              typeMap={typeMap}
              onClose={() => setSheet(null)}
              onCreated={(id) => setSheet({ key: `rec:${id}`, recId: id, fresh: true })}
            />
          )}
        </>
      ) : (
        <>
      {allDays.length === 0 && <p className="empty">{q ? tr("这段时间没有匹配“{0}”的记录。", query.trim()) : tr("这段时间没有记录。")}</p>}

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
                        open={openKey === `${day}:${it.seg.rec.id}`}
                        onToggle={() => toggle(`${day}:${it.seg.rec.id}`)}
                        onClose={() => setOpenKey(null)}
                      />
                    ) : (
                      <li key={`gap-${it.start}`}>
                        <div className="gap-row">
                          <button
                            type="button"
                            className={`gap${openKey === `gap:${it.start}` ? ' is-open' : ''}`}
                            aria-expanded={openKey === `gap:${it.start}`}
                            onClick={() => toggle(`gap:${it.start}`)}
                            title={tr("点击记录为某个活动")}
                          >
                            <span className="gap-time">
                              {hm(it.start)} – {hm(it.end)}
                            </span>
                            <span className="gap-label">{tr("未记录")}</span>
                            <span className="gap-ms">{formatHm(it.end - it.start)}</span>
                          </button>
                          <GapActions gap={it} records={records} typeMap={typeMap} />
                        </div>
                        <Drawer open={openKey === `gap:${it.start}`} onClose={() => setOpenKey(null)}>
                          <CreateRecordForm
                            initial={{ start: it.start, end: it.end }}
                            onDone={() => setOpenKey(null)}
                            onCreated={(id, start) => setOpenKey(`${startOfDay(start)}:${id}`)}
                          />
                        </Drawer>
                      </li>
                    ),
                  )}
                </ul>
              </section>
            );
          })}
        </>
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
  open,
  onToggle,
  onClose,
}: {
  seg: DaySeg<DbRecord>;
  type?: CatalogItem;
  tags: CatalogItem[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const r = seg.rec;
  const live = r.state === 'running' && seg.toNextDay === false;
  return (
    <li>
      <button
        type="button"
        className={`entry${open ? ' is-open' : ''}`}
        style={{ '--c': type?.color ?? '#888' } as CSSProperties}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="entry-emoji" aria-hidden="true">{type?.emoji ?? '❔'}</span>
        <span className="entry-body">
          <span className="entry-title">
            {type?.name ?? tr("未知活动")}
            {type?.deleted && <span className="badge">{tr("已删除的活动")}</span>}
            {r.state === 'running' && <span className="badge is-live">{tr("进行中")}</span>}
            {r.state === 'paused' && <span className="badge">{tr("已暂停")}</span>}
          </span>
          <span className="entry-time">
            {hm(seg.start)} – {live ? tr("现在") : hm(seg.end)}
            {seg.spans.length > 1 && <span className="entry-parts">{tr("（{0} 段）", seg.spans.length)}</span>}
            {seg.fromPrevDay && <span className="cont">{tr("接前日")}</span>}
            {seg.toNextDay && <span className="cont">{tr("延续到次日")}</span>}
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
      <Drawer open={open} onClose={onClose}>
        <div className="drawer-edge" style={{ '--c': type?.color ?? '#888' } as CSSProperties}>
          <LiveRecordForm rec={fromDb(r)} onClose={onClose} />
        </div>
      </Drawer>
    </li>
  );
}

const hmRange = (g: { start: number; end: number }) => `${hm(g.start)} – ${hm(g.end)}`;

/** 日历里点色块：在底部浮出编辑面板（与进行中栏同一种） */
function RecordSheet({
  recId,
  fresh,
  records,
  typeMap,
  onClose,
}: {
  recId: string;
  fresh?: boolean;
  records: DbRecord[];
  typeMap: Map<string, CatalogItem>;
  onClose: () => void;
}) {
  // 用最新的数据（编辑后列表会刷新）
  const live = records.find((r) => r.id === recId);
  if (!live || live.deleted) return null;
  const t = typeMap.get(live.typeId);
  return (
    <FloatingSheet
      color={t?.color}
      onClose={onClose}
      head={
        <>
          <span className="run-emoji" aria-hidden="true">{t?.emoji ?? '❔'}</span>
          <strong>{t?.name ?? tr("未知活动")}</strong>
        </>
      }
    >
      <LiveRecordForm key={live.id} rec={fromDb(live)} onClose={onClose} checkOverlapOnMount={fresh} />
    </FloatingSheet>
  );
}

/** 日历里点空档：快捷填充，或记录为某个活动 */
function GapSheet({
  gap,
  records,
  typeMap,
  onClose,
  onCreated,
}: {
  gap: { start: number; end: number };
  records: DbRecord[];
  typeMap: Map<string, CatalogItem>;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  return (
    <FloatingSheet
      onClose={onClose}
      head={
        <>
          <strong>{tr("未记录")}</strong>
          <span className="gap-sheet-range">
            {hmRange(gap)} · {formatHm(gap.end - gap.start)}
          </span>
        </>
      }
    >
      <div className="gap-sheet-actions">
        <GapActions gap={gap} records={records} typeMap={typeMap} onDone={onClose} />
      </div>
      <CreateRecordForm initial={gap} onDone={onClose} onCreated={onCreated} />
    </FloatingSheet>
  );
}
