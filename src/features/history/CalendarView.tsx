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
import { freeSpanAround, patchRecord, restoreRecord, validateIntervals, type IntervalMs } from '../../db/actions';
import { showUndo } from '../../ui/undo';
import { clockRange, clockText, dateText, dayOfMonth, hourLabel, monthShort, spanText, weekdayNarrow } from '../../i18n/dates';
import { tr } from '../../i18n';
import { getHour12 } from '../../lib/zone';

const HOUR = 3_600_000;
const MOVE_THRESHOLD_PX = 4;
const SNAP_PX = 6;
const AUTOSCROLL_ZONE_PX = 40;

const hm = clockText;

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
      // 跨天的段在每一天都能整段平移（作用于整段，不只是这一天的部分）
      canMove: closed,
    };
  });
}

type Drag =
  | {
      kind: 'rec';
      rec: DbRecord;
      ivIndex: number;
      mode: DragMode;
      /** 整段（不按天裁剪）的原始起止 */
      orig: { start: number; end: number };
      /** 平移时按下点相对开始时间的偏移 */
      offset: number;
      preview: { start: number; end: number };
      ivs: IntervalMs[];
      /** 按下的那一块的并排位置，预览沿用 */
      lane: number;
      lanes: number;
    }
  | { kind: 'gap'; gap: Span; anchor: number; preview: Span };

type Pending = { drag: Drag; x0: number; y0: number };

/** Keep 里带预约时间段的条目：在日历里画成虚线框，和记录并排 */
export interface Plan {
  id: string;
  text: string;
  color: string;
  start: number;
  end: number;
  done: boolean;
}

/** 有预约的那天，右侧留给预约框的宽度 */
const PLAN_W = { day: '26%', week: '34%' };

/** 一天里的预约框分并排的列 */
function planLanes(plans: Plan[]): Array<Plan & { lane: number; lanes: number }> {
  const sorted = [...plans].sort((a, b) => a.start - b.start || b.end - a.end);
  const ends: number[] = [];
  const placed = sorted.map((p) => {
    let lane = ends.findIndex((e) => e <= p.start);
    if (lane < 0) lane = ends.push(p.end) - 1;
    else ends[lane] = p.end;
    return { ...p, lane };
  });
  return placed.map((p) => ({ ...p, lanes: Math.max(1, ends.length) }));
}

/** 停在边缘多久翻页 */
const FLIP_HOLD_MS = 600;
const FLIP_ZONE_PX = 28;

const isDraggedPiece = (d: Drag | null, b: Block) => d?.kind === 'rec' && d.rec.id === b.rec.id && d.ivIndex === b.ivIndex;

export function CalendarView({
  days,
  segsByDay,
  gapsByDay,
  typeMap,
  now,
  selectedKey,
  gapFloor,
  canNext,
  onFlip,
  plans = [],
  onOpenPlan,
  onOpenRecord,
  onOpenGap,
}: {
  days: number[];
  segsByDay: Map<number, DaySeg<DbRecord>[]>;
  gapsByDay: Map<number, Span[]>;
  typeMap: Map<string, CatalogItem>;
  now: number;
  selectedKey: string | null;
  /** 第一条记录的开始：之前的时间不算空档 */
  gapFloor: number;
  /** 能否往后翻（后面不全是将来） */
  canNext: boolean;
  /** 拖动时停在边缘：翻到前 / 后一天（日）或一周（周） */
  onFlip: (dir: -1 | 1) => void;
  plans?: Plan[];
  /** 点预约框 */
  onOpenPlan?: (plan: Plan) => void;
  onOpenRecord: (rec: DbRecord) => void;
  onOpenGap: (gap: Span) => void;
}) {
  const isDay = days.length === 1;
  const hourPx = isDay ? 56 : 44;
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const today = startOfDay(now);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const suppressClick = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  /** 正在边缘停留：方向和开始停留的时刻 */
  const flipRef = useRef<{ dir: -1 | 1; since: number } | null>(null);
  const [flip, setFlip] = useState<-1 | 1 | null>(null);
  /** 触屏上第一次轻点选中的色块 / 空档（'rec:<id>' 或 'gap:<开始时间>'） */
  const [touchPick, setTouchPick] = useState<string | null>(null);
  const lastPointerType = useRef<string>('mouse');
  const isPicked = (key: string) => selectedKey === key || touchPick === key;
  const coarse = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches, []);

  // 回调里要用最新的 props
  const latest = useRef({ days, canNext, onFlip, isDay });
  latest.current = { days, canNext, onFlip, isDay };

  // 打开时滚动到合适的位置：包含今天就停在“现在”前 3 小时，否则停在当天第一条记录前 1 小时
  const firstHour = useMemo(() => {
    if (days.includes(today)) return Math.max(0, (now - today) / HOUR - 3);
    let first = 24;
    for (const d of days) for (const s of segsByDay.get(d) ?? []) first = Math.min(first, (s.start - d) / HOUR);
    return first === 24 ? 7 : Math.max(0, first - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(',')]);
  useEffect(() => {
    // 拖动中翻页时不要跳回去
    if (dragRef.current) return;
    scrollRef.current?.scrollTo({ top: firstHour * hourPx });
  }, [firstHour, hourPx]);

  const blocksByDay = useMemo(() => {
    const m = new Map<number, Block[]>();
    for (const d of days) m.set(d, layout((segsByDay.get(d) ?? []).flatMap((s) => blockItems(s, now))));
    return m;
  }, [days, segsByDay, now]);
  const blocksRef = useRef(blocksByDay);
  blocksRef.current = blocksByDay;
  const plansRef = useRef(plans);
  plansRef.current = plans;

  // ---------- 拖动 ----------

  const setDragState = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  /** 可吸附的边：可见各天的起止、现在、其他色块的起止（不含正在拖的这一段） */
  const edgesFor = (d: Drag | null) => {
    const ds = latest.current.days;
    const edges = [...ds, addDays(ds[ds.length - 1], 1), Date.now()];
    for (const p of plansRef.current) edges.push(p.start, p.end);
    for (const list of blocksRef.current.values())
      for (const b of list) {
        if (isDraggedPiece(d, b)) continue;
        edges.push(b.start, b.end);
      }
    return edges;
  };

  /** 指针位置 → 时间点：横向找所在的那一天（超出两侧按最近的一天），纵向按时刻 */
  const timeAt = (clientX: number, clientY: number) => {
    const cols = gridRef.current ? [...gridRef.current.querySelectorAll<HTMLElement>(':scope > .cal-col')] : [];
    const ds = latest.current.days;
    if (!cols.length) return ds[0];
    let i = cols.findIndex((c) => clientX < c.getBoundingClientRect().right);
    if (i < 0) i = cols.length - 1;
    const day = ds[Math.min(i, ds.length - 1)];
    const t = day + ((clientY - cols[i].getBoundingClientRect().top) / hourPx) * HOUR;
    return Math.min(Math.max(t, day), addDays(day, 1));
  };

  const update = () => {
    const d = dragRef.current;
    const lp = lastPointer.current;
    if (!pendingRef.current || !d || !lp) return;
    const t = timeAt(lp.x, lp.y);
    const th = (SNAP_PX / hourPx) * HOUR;
    if (d.kind === 'gap') {
      setDragState({ ...d, preview: gapSelection(d.anchor, snapTime(t, [d.gap.start, d.gap.end], th), d.gap) });
      return;
    }
    const edges = edgesFor(d);
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
    const ivs = dragIntervals(toMs(d.rec), d.ivIndex, d.mode, proposed, realNow);
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
      tr("已调整「{0}」{1}", t?.name ?? tr("未知活动"), spanText(d.preview.start, d.rec.state === 'running' && d.mode === 'start' ? tr("现在") : d.preview.end)),
      () => restoreRecord(snapshot),
    );
  };

  const activate = () => {
    const p = pendingRef.current;
    if (!p) return;
    setDragState(p.drag);
    update();
  };

  const endAll = () => {
    pendingRef.current = null;
    lastPointer.current = null;
    flipRef.current = null;
    setFlip(null);
    setDragState(null);
  };

  // 拖动期间的全局监听：指针移动 / 松开 / 取消、Esc、阻止触屏滚动、靠近边缘自动滚动、停在边缘翻页
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
      update();
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

    /** 指针停在哪个翻页区：日视图是滚到头之后的上 / 下边缘，周视图是左右两侧 */
    const flipZone = (sc: HTMLElement, lp: { x: number; y: number }): -1 | 1 | null => {
      const { isDay, canNext } = latest.current;
      let dir: -1 | 1 | null = null;
      if (isDay) {
        const r = sc.getBoundingClientRect();
        if (lp.y < r.top + FLIP_ZONE_PX && sc.scrollTop <= 0) dir = -1;
        else if (lp.y > r.bottom - FLIP_ZONE_PX && sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 1) dir = 1;
      } else {
        const cols = gridRef.current?.querySelectorAll<HTMLElement>(':scope > .cal-col');
        if (cols?.length) {
          const first = cols[0].getBoundingClientRect();
          const last = cols[cols.length - 1].getBoundingClientRect();
          if (lp.x < first.left + 10) dir = -1;
          else if (lp.x > last.right - 10) dir = 1;
        }
      }
      return dir === 1 && !canNext ? null : dir;
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
          const before = sc.scrollTop;
          sc.scrollTop += dy;
          if (sc.scrollTop !== before) update();
        }

        const dir = flipZone(sc, lp);
        const t = performance.now();
        if (!dir) {
          if (flipRef.current) {
            flipRef.current = null;
            setFlip(null);
          }
        } else if (!flipRef.current || flipRef.current.dir !== dir) {
          flipRef.current = { dir, since: t };
          setFlip(dir);
        } else if (t - flipRef.current.since >= FLIP_HOLD_MS) {
          latest.current.onFlip(dir);
          // 日视图翻到后一天从 0 点接着拖，翻到前一天从 24 点接着拖
          if (latest.current.isDay) sc.scrollTop = dir === 1 ? 0 : sc.scrollHeight;
          // 继续停着就再翻；重新计时，动画也重新开始
          flipRef.current = null;
          setFlip(null);
          window.setTimeout(update, 30);
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
  }, [hourPx]);

  const begin = (e: RPointerEvent, drag: Drag, selected: boolean) => {
    lastPointerType.current = e.pointerType;
    if (e.button !== 0) return;
    // 触屏：没选中的不接管，让页面正常滚动
    if (e.pointerType === 'touch' && !selected) return;
    if (e.pointerType !== 'touch') e.preventDefault(); // 避免拖动时选中文字
    lastPointer.current = { x: e.clientX, y: e.clientY };
    pendingRef.current = { drag, x0: e.clientX, y0: e.clientY };
  };

  const onBlockDown = (e: RPointerEvent, b: Block) => {
    const handle = (e.target as HTMLElement).closest('[data-handle]')?.getAttribute('data-handle') as 'start' | 'end' | null;
    const mode: DragMode | null = handle ?? (b.canMove ? 'move' : null);
    if (!mode) return;
    const ivs = toMs(b.rec);
    const iv = ivs[b.ivIndex];
    const orig = { start: iv.start, end: iv.end ?? now };
    const t = timeAt(e.clientX, e.clientY);
    begin(
      e,
      { kind: 'rec', rec: b.rec, ivIndex: b.ivIndex, mode, orig, offset: t - orig.start, preview: orig, ivs, lane: b.lane, lanes: b.lanes },
      isPicked(`rec:${b.rec.id}`),
    );
  };

  const onGapDown = (e: RPointerEvent, g: Span) => {
    const th = (SNAP_PX / hourPx) * HOUR;
    // 先用当天这一截，同时去数据库找出包含它的完整空档（可能跨好几天），找到后放宽边界
    const anchor = Math.min(Math.max(snapTime(timeAt(e.clientX, e.clientY), [g.start, g.end], th), g.start), g.end);
    const drag: Drag = { kind: 'gap', gap: g, anchor, preview: { start: anchor, end: anchor } };
    begin(e, drag, isPicked(`gap:${g.start}`));
    if (pendingRef.current?.drag !== drag) return;
    void freeSpanAround(anchor, Date.now(), gapFloor).then((full) => {
      if (!full || full.start > g.start || full.end < g.end) return;
      const p = pendingRef.current;
      if (!p || p.drag.kind !== 'gap' || p.drag.anchor !== anchor) return;
      p.drag = { ...p.drag, gap: full };
      const d = dragRef.current;
      if (d?.kind === 'gap' && d.anchor === anchor) {
        dragRef.current = { ...d, gap: full };
        update();
      }
    });
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

  // 拖动预览的时间标签放在预览开始的那天；开始不在可见范围时放在第一块
  const recPreview = drag?.kind === 'rec' ? drag.preview : null;
  const labelDay = recPreview
    ? (days.find((d) => recPreview.start >= d && recPreview.start < addDays(d, 1)) ??
      days.find((d) => recPreview.end > d && recPreview.start < addDays(d, 1)))
    : undefined;

  const flipLabel = flip === null ? '' : isDay ? (flip < 0 ? tr("前一天") : tr("后一天")) : flip < 0 ? tr("前一周") : tr("后一周");

  return (
    <div
      className={`cal${isDay ? ' is-day' : ' is-week'}${getHour12() ? ' is-h12' : ''}${drag ? ' is-dragging' : ''}`}
      style={{ '--hour': `${hourPx}px` } as CSSProperties}
    >
      {flip !== null && (
        <span className={`cal-flip is-${flip < 0 ? 'prev' : 'next'}`} style={{ '--hold': `${FLIP_HOLD_MS}ms` } as CSSProperties} aria-hidden="true">
          {flip < 0 ? (isDay ? '↑ ' : '← ') : ''}
          {flipLabel}
          {flip > 0 ? (isDay ? ' ↓' : ' →') : ''}
        </span>
      )}
      {!isDay && (
        <div className="cal-head">
          <span className="cal-gutter cal-month">{monthShort(days[0], days[days.length - 1])}</span>
          {days.map((d) => (
            <span key={d} className={`cal-day-label${d === today ? ' is-today' : ''}`}>
              {weekdayNarrow(d)} <strong>{dayOfMonth(d)}</strong>
            </span>
          ))}
        </div>
      )}
      <div className="cal-scroll" ref={scrollRef}>
        <div className="cal-grid" ref={gridRef}>
          <div className="cal-hours" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * hourPx }}>
                {h === 0 ? '' : hourLabel(h)}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const blocks = blocksByDay.get(day) ?? [];
            const dayEnd = addDays(day, 1);
            const y = (t: number) => ((t - day) / HOUR) * hourPx;
            // 正在拖的东西落在这一天的部分
            const clip = (sp: Span | undefined) =>
              sp && sp.end > day && sp.start < dayEnd ? { start: Math.max(sp.start, day), end: Math.min(sp.end, dayEnd) } : null;
            const gapSel = drag?.kind === 'gap' && drag.preview.end > drag.preview.start ? clip(drag.preview) : null;
            const recDrag = drag?.kind === 'rec' ? drag : null;
            const piece = recDrag ? clip(recDrag.preview) : null;
            const labelHere = !!piece && day === labelDay;
            const dayPlans = planLanes(
              plans.filter((p) => p.end > day && p.start < dayEnd).map((p) => ({ ...p, start: Math.max(p.start, day), end: Math.min(p.end, dayEnd), full: p })),
            ) as Array<Plan & { lane: number; lanes: number; full: Plan }>;
            const planW = dayPlans.length ? (isDay ? PLAN_W.day : PLAN_W.week) : '0%';
            return (
              <div key={day} className="cal-col" aria-label={dateText(day)} style={{ '--plan-w': planW } as CSSProperties}>
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
                      onPointerDown={(e) => onGapDown(e, g)}
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
                {gapSel && drag?.kind === 'gap' && (
                  <span className="cal-select" style={{ top: y(gapSel.start), height: y(gapSel.end) - y(gapSel.start) }} aria-hidden="true">
                    {(gapSel.start === drag.preview.start || day === days[0]) && (
                      <span className="cal-drag-label">
                        {spanText(drag.preview.start, drag.preview.end)} · {formatHm(drag.preview.end - drag.preview.start)}
                      </span>
                    )}
                  </span>
                )}
                {blocks.map((b) => {
                  const t = typeMap.get(b.rec.typeId);
                  const origin = isDraggedPiece(drag, b);
                  const h = y(b.end) - y(b.start);
                  const live = b.rec.state === 'running' && b.end >= now - 1000;
                  const selected = isPicked(`rec:${b.rec.id}`);
                  // 触屏上手柄会挡住滚动：只在选中的色块上显示
                  const showHandles = h >= 20 && !origin && (!coarse || selected);
                  return (
                    <button
                      key={b.key}
                      type="button"
                      className={`cal-block${live ? ' is-live' : ''}${selected ? ' is-selected' : ''}${origin ? ' is-origin' : ''}${b.canMove ? ' is-movable' : ''}`}
                      aria-expanded={selected}
                      style={
                        {
                          '--c': t?.color ?? '#888',
                          top: y(b.start),
                          height: Math.max(h, 3),
                          left: `calc((100% - var(--plan-w)) * ${b.lane / b.lanes} + 2px)`,
                          width: `calc((100% - var(--plan-w)) / ${b.lanes} - 4px)`,
                        } as CSSProperties
                      }
                      onPointerDown={(e) => onBlockDown(e, b)}
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
                      {h >= 36 && (
                        <span className="cal-block-time">
                          {clockRange(b.start, live ? tr("现在") : b.end)}
                        </span>
                      )}
                      {showHandles && b.canEnd && <span className="cal-handle is-bottom" data-handle="end" aria-hidden="true" />}
                    </button>
                  );
                })}
                {recDrag && piece && (
                  <span
                    className="cal-block is-dragging"
                    style={
                      {
                        '--c': typeMap.get(recDrag.rec.typeId)?.color ?? '#888',
                        top: y(piece.start),
                        height: Math.max(y(piece.end) - y(piece.start), 3),
                        left: `calc((100% - var(--plan-w)) * ${recDrag.lane / recDrag.lanes} + 2px)`,
                        width: `calc((100% - var(--plan-w)) / ${recDrag.lanes} - 4px)`,
                      } as CSSProperties
                    }
                    aria-hidden="true"
                  >
                    {y(piece.end) - y(piece.start) >= 18 && (
                      <span className="cal-block-name">
                        <span className="cal-block-emoji">{typeMap.get(recDrag.rec.typeId)?.emoji}</span>
                        <span className="cal-block-label"> {typeMap.get(recDrag.rec.typeId)?.name ?? tr("未知活动")}</span>
                      </span>
                    )}
                    {labelHere && (
                      <span className="cal-drag-label">
                        {spanText(recDrag.preview.start, recDrag.rec.state === 'running' && recDrag.mode === 'start' ? tr("现在") : recDrag.preview.end)} ·{' '}
                        {formatHm(recDrag.preview.end - recDrag.preview.start)}
                      </span>
                    )}
                  </span>
                )}
                {dayPlans.map((p) => {
                  const h = y(p.end) - y(p.start);
                  const future = p.full.start > now;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`cal-plan${p.done ? ' is-done' : ''}${future ? ' is-future' : ''}`}
                      style={
                        {
                          '--c': p.color,
                          top: y(p.start),
                          height: Math.max(h, 3),
                          left: `calc(100% - var(--plan-w) + var(--plan-w) * ${p.lane / p.lanes})`,
                          width: `calc(var(--plan-w) / ${p.lanes} - 3px)`,
                        } as CSSProperties
                      }
                      onClick={() => onOpenPlan?.(p.full)}
                      title={tr("预约：{0} {1}{2}", p.text || '…', spanText(p.full.start, p.full.end), future ? '' : tr("（点击按此补录）"))}
                    >
                      {h >= 16 && (
                        <span className="cal-plan-text">
                          {p.done ? '✓ ' : ''}
                          {p.text || '…'}
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
