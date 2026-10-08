// 24 小时竖向时间轴（日 = 1 列，周 = 7 列），像日历一样：活动是色块，空档是斜纹块。
// 同时进行的活动在重叠的那一簇里并排；点色块编辑，点空档处理。
// 拖动（方案 D）：拖色块上下边缘改开始 / 结束，拖色块中间整段平移，在空档里拖选一段再补录。
// 鼠标移动超过几像素才算拖动，否则仍是点击。
// 触屏：第一次轻点只选中（出现手柄，可以拖），再点一下才打开编辑面板——面板在手机上会盖住时间轴。
// 只有选中的色块 / 空档接管手势，没选中的照常滚动页面：浏览器在手指按下时就决定交给滚动还是页面，
// 长按后再拦截并不可靠（iOS 尤甚）。
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import type { DbRecord } from '../../db/db';
import { fromDb } from '../../db/db';
import type { CatalogItem } from '../../schema';
import type { DaySeg } from '../../lib/segments';
import { addDays, formatHm, fromIso, startOfDay, type Span } from '../../lib/time';
import { dragIntervals, gapSelection, MIN_SPAN_MS, snapTime, type DragMode } from '../../lib/drag';
import { patchRecord, restoreRecord, validateIntervals, type IntervalMs } from '../../db/actions';
import { showUndo } from '../../ui/undo';
import { dateText, monthShort, weekdayNarrow } from '../../i18n/dates';
import { tr } from '../../i18n';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MOVE_THRESHOLD_PX = 4;
const SNAP_PX = 6;
const AUTOSCROLL_ZONE_PX = 40;

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
  /** 这一块对应记录里的第几段 */
  ivIndex: number;
  canStart: boolean;
  canEnd: boolean;
  canMove: boolean;
}

type Item = Omit<Block, 'lane' | 'lanes'>;

/** 按重叠分簇，簇内贪心分配并排的列 */
function layout(items: Item[]): Block[] {
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

const toMs = (rec: DbRecord): IntervalMs[] =>
  rec.intervals.map((iv) => ({ start: fromIso(iv.start), end: iv.end ? fromIso(iv.end) : null }));

/** 当天的一个裁剪段对应到记录的哪一段，以及哪些边能拖 */
function blockItems(seg: DaySeg<DbRecord>, now: number): Item[] {
  const ivs = toMs(seg.rec);
  return seg.spans.map((sp, n) => {
    let ivIndex = ivs.findIndex((iv) => iv.start <= sp.start && (iv.end ?? now) >= sp.end);
    if (ivIndex < 0) ivIndex = 0;
    const iv = ivs[ivIndex];
    const clippedTop = iv.start < sp.start;
    const clippedBottom = iv.end !== null && iv.end > sp.end;
    const closed = iv.end !== null;
    return {
      key: `${seg.rec.id}:${n}`,
      rec: seg.rec,
      start: sp.start,
      end: sp.end,
      ivIndex,
      canStart: !clippedTop,
      canEnd: closed && !clippedBottom,
      canMove: closed && !clippedTop && !clippedBottom,
    };
  });
}

type Drag =
  | {
      kind: 'rec';
      key: string;
      rec: DbRecord;
      ivIndex: number;
      mode: DragMode;
      day: number;
      orig: { start: number; end: number };
      /** 平移时按下点相对开始时间的偏移 */
      offset: number;
      preview: { start: number; end: number };
      ivs: IntervalMs[];
    }
  | { kind: 'gap'; day: number; gap: Span; anchor: number; preview: Span };

type Pending = {
  drag: Drag;
  col: HTMLElement;
  x0: number;
  y0: number;
};

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
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const suppressClick = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  /** 触屏上第一次轻点选中的色块 / 空档（'rec:<id>' 或 'gap:<开始时间>'） */
  const [touchPick, setTouchPick] = useState<string | null>(null);
  const lastPointerType = useRef<string>('mouse');
  const isPicked = (key: string) => selectedKey === key || touchPick === key;
  const coarse = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches, []);

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

  const blocksByDay = useMemo(() => {
    const m = new Map<number, Block[]>();
    for (const d of days) m.set(d, layout((segsByDay.get(d) ?? []).flatMap((s) => blockItems(s, now))));
    return m;
  }, [days, segsByDay, now]);

  // ---------- 拖动 ----------

  const setDragState = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  /** 当天可吸附的边：其他色块的起止、空档边界、现在、当天起止 */
  const edgesFor = (day: number, excludeKey?: string) => {
    const edges = [day, day + DAY];
    if (day === today) edges.push(now);
    for (const b of blocksByDay.get(day) ?? []) {
      if (b.key === excludeKey) continue;
      edges.push(b.start, b.end);
    }
    return edges;
  };

  const timeAt = (col: HTMLElement, day: number, clientY: number) =>
    day + ((clientY - col.getBoundingClientRect().top) / hourPx) * HOUR;

  const update = (clientY: number) => {
    const p = pendingRef.current;
    const d = dragRef.current;
    if (!p || !d) return;
    const t = timeAt(p.col, d.day, clientY);
    const th = (SNAP_PX / hourPx) * HOUR;
    if (d.kind === 'gap') {
      setDragState({ ...d, preview: gapSelection(d.anchor, snapTime(t, [d.gap.start, d.gap.end], th), d.gap) });
      return;
    }
    const edges = edgesFor(d.day, d.key);
    const realNow = Date.now();
    let proposed: { start: number; end: number };
    if (d.mode === 'start') proposed = { start: snapTime(t, edges, th), end: d.orig.end };
    else if (d.mode === 'end') proposed = { start: d.orig.start, end: snapTime(t, edges, th) };
    else {
      const dur = d.orig.end - d.orig.start;
      const raw = t - d.offset;
      // 开始或结束哪一端贴上了边就用哪一端；都没贴上就按开始取整
      const hitStart = edges.find((e) => Math.abs(e - raw) <= th);
      const hitEnd = edges.find((e) => Math.abs(e - (raw + dur)) <= th);
      const s = hitStart ?? (hitEnd !== undefined ? hitEnd - dur : snapTime(raw, [], th));
      proposed = { start: s, end: s + dur };
    }
    const ivs = dragIntervals(toMs(d.rec), d.ivIndex, d.mode, proposed, realNow, { lo: d.day, hi: d.day + DAY });
    const iv = ivs[d.ivIndex];
    setDragState({ ...d, ivs, preview: { start: iv.start, end: iv.end ?? realNow } });
  };

  const commit = async (d: Drag) => {
    if (d.kind === 'gap') {
      const sel = d.preview.end - d.preview.start >= MIN_SPAN_MS ? d.preview : d.gap;
      onOpenGap(sel);
      return;
    }
    if (d.preview.start === d.orig.start && d.preview.end === d.orig.end) return;
    // dragIntervals 已经做了限制；这里再校验一次，不合法就当作没拖
    if (validateIntervals(d.ivs)) return;
    const snapshot = fromDb(d.rec);
    await patchRecord(d.rec.id, { intervals: d.ivs });
    const t = typeMap.get(d.rec.typeId);
    showUndo(
      tr("已调整「{0}」{1}–{2}", t?.name ?? tr("未知活动"), hm(d.preview.start), d.rec.state === 'running' && d.mode === 'start' ? tr("现在") : hm(d.preview.end)),
      () => restoreRecord(snapshot),
    );
  };

  const activate = () => {
    const p = pendingRef.current;
    if (!p) return;
    setDragState(p.drag);
    if (lastPointer.current) update(lastPointer.current.y);
  };

  const endAll = () => {
    pendingRef.current = null;
    lastPointer.current = null;
    setDragState(null);
  };

  // 拖动期间的全局监听：指针移动 / 松开 / 取消、Esc、阻止触屏滚动、靠近边缘自动滚动
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = pendingRef.current;
      if (!p) return;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      const dist = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
      if (!dragRef.current) {
        if (dist > MOVE_THRESHOLD_PX) activate();
        return;
      }
      update(e.clientY);
    };
    const onUp = () => {
      const p = pendingRef.current;
      const d = dragRef.current;
      if (p && d) {
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 400);
        void commit(d);
      }
      endAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) {
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 400);
        endAll();
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    let raf = 0;
    const tick = () => {
      const sc = scrollRef.current;
      const lp = lastPointer.current;
      if (dragRef.current && sc && lp) {
        const r = sc.getBoundingClientRect();
        // 朝边缘拖进区域才滚，越靠边越快；按下的位置本身就靠边时，区域缩小到“比起点更靠边”
        const y0 = pendingRef.current?.y0 ?? lp.y;
        const topZone = Math.min(AUTOSCROLL_ZONE_PX, y0 - r.top - 12);
        const bottomZone = Math.min(AUTOSCROLL_ZONE_PX, r.bottom - y0 - 12);
        const dTop = lp.y - r.top;
        const dBottom = r.bottom - lp.y;
        const speed = (depth: number, zone: number) => Math.ceil(Math.min(1, depth / zone) * 10);
        const dy =
          topZone > 0 && dTop < topZone ? -speed(topZone - dTop, topZone) : bottomZone > 0 && dBottom < bottomZone ? speed(bottomZone - dBottom, bottomZone) : 0;
        if (dy) {
          sc.scrollTop += dy;
          update(lp.y);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', endAll);
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', endAll);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchmove', onTouchMove);
    };
    // 回调里通过 ref 取最新状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourPx, blocksByDay, now]);

  const begin = (e: RPointerEvent, drag: Drag, selected: boolean) => {
    lastPointerType.current = e.pointerType;
    if (e.button !== 0) return;
    // 触屏：没选中的不接管，让页面正常滚动
    if (e.pointerType === 'touch' && !selected) return;
    const col = (e.currentTarget as HTMLElement).closest('.cal-col') as HTMLElement | null;
    if (!col) return;
    if (e.pointerType !== 'touch') e.preventDefault(); // 避免拖动时选中文字
    lastPointer.current = { x: e.clientX, y: e.clientY };
    pendingRef.current = { drag, col, x0: e.clientX, y0: e.clientY };
  };

  const onBlockDown = (e: RPointerEvent, b: Block, day: number) => {
    const handle = (e.target as HTMLElement).closest('[data-handle]')?.getAttribute('data-handle') as 'start' | 'end' | null;
    const mode: DragMode | null = handle ?? (b.canMove ? 'move' : null);
    if (!mode) return;
    const t = timeAt((e.currentTarget as HTMLElement).closest('.cal-col') as HTMLElement, day, e.clientY);
    begin(
      e,
      {
        kind: 'rec',
        key: b.key,
        rec: b.rec,
        ivIndex: b.ivIndex,
        mode,
        day,
        orig: { start: b.start, end: b.end },
        offset: t - b.start,
        preview: { start: b.start, end: b.end },
        ivs: toMs(b.rec),
      },
      isPicked(`rec:${b.rec.id}`),
    );
  };

  const onGapDown = (e: RPointerEvent, g: Span, day: number) => {
    const col = (e.currentTarget as HTMLElement).closest('.cal-col') as HTMLElement;
    const th = (SNAP_PX / hourPx) * HOUR;
    const anchor = Math.min(Math.max(snapTime(timeAt(col, day, e.clientY), [g.start, g.end], th), g.start), g.end);
    begin(e, { kind: 'gap', day, gap: g, anchor, preview: { start: anchor, end: anchor } }, isPicked(`gap:${g.start}`));
  };

  /** 拖动后的那次 click 不算；触屏上第一次轻点只选中 */
  const guardClick = (key: string, fn: () => void) => () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (lastPointerType.current === 'touch' && !isPicked(key)) {
      setTouchPick(key);
      return;
    }
    setTouchPick(null);
    fn();
  };

  return (
    <div
      className={`cal${days.length === 1 ? ' is-day' : ' is-week'}${drag ? ' is-dragging' : ''}`}
      style={{ '--hour': `${hourPx}px` } as CSSProperties}
    >
      {days.length > 1 && (
        <div className="cal-head">
          <span className="cal-gutter cal-month">{monthShort(days[0], days[days.length - 1])}</span>
          {days.map((d) => {
            const date = new Date(d);
            return (
              <span key={d} className={`cal-day-label${d === today ? ' is-today' : ''}`}>
                {weekdayNarrow(d)} <strong>{date.getDate()}</strong>
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
            const blocks = blocksByDay.get(day) ?? [];
            const y = (t: number) => ((t - day) / HOUR) * hourPx;
            const gapDrag = drag?.kind === 'gap' && drag.day === day ? drag : null;
            return (
              <div key={day} className="cal-col" aria-label={dateText(day)}>
                {(gapsByDay.get(day) ?? []).map((g) => {
                  const h = y(g.end) - y(g.start);
                  const key = `gap:${g.start}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`cal-gap${isPicked(key) ? ' is-selected' : ''}`}
                      aria-expanded={selectedKey === key}
                      style={{ top: y(g.start), height: Math.max(h, 3) }}
                      onPointerDown={(e) => onGapDown(e, g, day)}
                      onClick={guardClick(key, () => onOpenGap(g))}
                      title={tr("未记录 {0}–{1}（{2}）", hm(g.start), hm(g.end), formatHm(g.end - g.start))}
                    >
                      {h >= 16 && (
                        <span>
                          {tr("未记录 ·")} {formatHm(g.end - g.start)}
                        </span>
                      )}
                    </button>
                  );
                })}
                {gapDrag && gapDrag.preview.end > gapDrag.preview.start && (
                  <span
                    className="cal-select"
                    style={{ top: y(gapDrag.preview.start), height: y(gapDrag.preview.end) - y(gapDrag.preview.start) }}
                    aria-hidden="true"
                  >
                    <span className="cal-drag-label">
                      {hm(gapDrag.preview.start)}–{hm(gapDrag.preview.end)} · {formatHm(gapDrag.preview.end - gapDrag.preview.start)}
                    </span>
                  </span>
                )}
                {blocks.map((b) => {
                  const t = typeMap.get(b.rec.typeId);
                  const dragging = drag?.kind === 'rec' && drag.key === b.key ? drag : null;
                  const start = dragging ? dragging.preview.start : b.start;
                  const end = dragging ? dragging.preview.end : b.end;
                  const h = y(end) - y(start);
                  const live = b.rec.state === 'running' && b.end >= now - 1000;
                  const selected = isPicked(`rec:${b.rec.id}`);
                  // 触屏上手柄会挡住滚动：只在选中的色块上显示
                  const showHandles = h >= 20 && (!coarse || selected || !!dragging);
                  return (
                    <button
                      key={b.key}
                      type="button"
                      className={`cal-block${live ? ' is-live' : ''}${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${b.canMove ? ' is-movable' : ''}`}
                      aria-expanded={selected}
                      style={
                        {
                          '--c': t?.color ?? '#888',
                          top: y(start),
                          height: Math.max(h, 3),
                          left: `calc(${(b.lane / b.lanes) * 100}% + 2px)`,
                          width: `calc(${100 / b.lanes}% - 4px)`,
                        } as CSSProperties
                      }
                      onPointerDown={(e) => onBlockDown(e, b, day)}
                      onClick={guardClick(`rec:${b.rec.id}`, () => onOpenRecord(b.rec))}
                      title={tr("{0} {1}–{2}（{3}）{4}", t?.name ?? tr("未知活动"), hm(b.start), live ? tr("现在") : hm(b.end), formatHm(b.end - b.start), b.rec.comment ? `\n${b.rec.comment}` : '')}
                    >
                      {showHandles && b.canStart && <span className="cal-handle is-top" data-handle="start" aria-hidden="true" />}
                      {h >= 18 && (
                        <span className="cal-block-name">
                          <span className="cal-block-emoji">{t?.emoji}</span>
                          <span className="cal-block-label"> {t?.name ?? tr("未知活动")}</span>
                        </span>
                      )}
                      {h >= 36 && !dragging && (
                        <span className="cal-block-time">
                          {hm(b.start)}–{live ? tr("现在") : hm(b.end)}
                        </span>
                      )}
                      {showHandles && b.canEnd && <span className="cal-handle is-bottom" data-handle="end" aria-hidden="true" />}
                      {dragging && (
                        <span className="cal-drag-label">
                          {hm(start)}–{live && dragging.mode === 'start' ? tr("现在") : hm(end)} · {formatHm(end - start)}
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
