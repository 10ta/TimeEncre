// 手写 SVG 图表：环形图、每日堆叠柱、单日时间轴。颜色全部来自类型颜色。
import type { ReactNode } from 'react';
import { addDays, formatHm } from '../../lib/time';
import type { Span } from '../../lib/time';

export interface Slice {
  key: string;
  label: string;
  color: string;
  ms: number;
}

const H = 3600_000;
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

/** 角度 a（弧度，0 在正上方，顺时针）对应的坐标 */
const polar = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;

/** 扇环路径：用填充的几何形状而不是描边虚线，在所有浏览器里形状都稳定 */
function ringSector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

/** 完整圆环（只有一个扇区时） */
function fullRing(cx: number, cy: number, r0: number, r1: number): string {
  return `M${cx} ${cy - r1}A${r1} ${r1} 0 1 1 ${cx} ${cy + r1}A${r1} ${r1} 0 1 1 ${cx} ${cy - r1}Z` +
    `M${cx} ${cy - r0}A${r0} ${r0} 0 1 0 ${cx} ${cy + r0}A${r0} ${r0} 0 1 0 ${cx} ${cy - r0}Z`;
}

const MIN_ANGLE = 0.004; // 约 0.23°，更小的扇区画不出来，只在图例里列出

export function Donut({ slices, center, label }: { slices: Slice[]; center: ReactNode; label: string }) {
  const cx = 110;
  const cy = 110;
  const r0 = 63;
  const r1 = 97;
  const total = slices.reduce((a, s) => a + s.ms, 0);
  const visible = slices.filter((s) => total > 0 && (s.ms / total) * 2 * Math.PI >= MIN_ANGLE);
  let a = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 220 220" role="img" aria-label={label}>
        <path d={fullRing(cx, cy, r0, r1)} fill="var(--line)" fillRule="evenodd" />
        {visible.length === 1 ? (
          <path d={fullRing(cx, cy, r0, r1)} fill={visible[0].color} fillRule="evenodd">
            <title>{`${visible[0].label} ${formatHm(visible[0].ms)}`}</title>
          </path>
        ) : (
          visible.map((s) => {
            const a0 = a;
            const a1 = a + (s.ms / total) * 2 * Math.PI;
            a = a1;
            return (
              <path key={s.key} d={ringSector(cx, cy, r0, r1, a0, a1)} fill={s.color} className="donut-slice">
                <title>{`${s.label} ${formatHm(s.ms)}`}</title>
              </path>
            );
          })
        )}
      </svg>
      <div className="donut-center">{center}</div>
    </div>
  );
}

/** 每天一根柱子，按类型堆叠 */
export function DailyBars({
  days,
  data,
  order,
  colorOf,
  labelOf,
}: {
  days: number[];
  data: Map<number, Map<string, number>>;
  order: string[];
  colorOf: (key: string) => string;
  labelOf: (key: string) => string;
}) {
  const W = 720;
  const Hh = 220;
  const pad = { l: 46, r: 8, t: 12, b: 30 };
  const innerW = W - pad.l - pad.r;
  const innerH = Hh - pad.t - pad.b;
  const totals = days.map((d) => [...(data.get(d)?.values() ?? [])].reduce((a, b) => a + b, 0));
  const peak = Math.max(H, ...totals);
  const step = peak <= 8 * H ? 2 * H : peak <= 16 * H ? 4 * H : 6 * H;
  const max = Math.ceil(peak / step) * step;
  const slot = innerW / days.length;
  const bw = Math.min(28, slot * 0.7);
  const y = (ms: number) => pad.t + innerH - (ms / max) * innerH;
  const dense = days.length > 14;

  return (
    <svg className="bars" viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="每日时长按活动堆叠">
      {Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step).map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={pad.l - 6} y={y(v) + 4} className="axis" textAnchor="end">
            {v / H}h
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const x = pad.l + slot * i + (slot - bw) / 2;
        let acc = 0;
        const date = new Date(d);
        const showLabel = !dense || date.getDate() === 1 || date.getDate() % 5 === 0;
        return (
          <g key={d}>
            {order.map((k) => {
              const ms = data.get(d)?.get(k) ?? 0;
              if (ms <= 0) return null;
              const y1 = y(acc + ms);
              const h = y(acc) - y1;
              acc += ms;
              return (
                <rect key={k} x={x} y={y1} width={bw} height={Math.max(h, 0.5)} fill={colorOf(k)}>
                  <title>
                    {date.getMonth() + 1}/{date.getDate()} {labelOf(k)} {formatHm(ms)}
                  </title>
                </rect>
              );
            })}
            {showLabel && (
              <text x={x + bw / 2} y={Hh - 8} className="axis" textAnchor="middle">
                {dense ? date.getDate() : `${WEEKDAY[date.getDay()]} ${date.getDate()}`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** 单日 0–24 点时间轴；同时进行的记录分到不同的行 */
export function DayTimeline({
  day,
  items,
}: {
  day: number;
  items: Array<{ key: string; spans: Span[]; color: string; label: string }>;
}) {
  const W = 720;
  const pad = { l: 8, r: 8 };
  const dayEnd = addDays(day, 1);
  const x = (ms: number) => pad.l + ((ms - day) / (dayEnd - day)) * (W - pad.l - pad.r);
  // 贪心分行：按每一段排，暂停留出的空档可以被别的记录用
  const lanes: number[] = [];
  const placed = items
    .flatMap((it) => it.spans.map((s, i) => ({ key: `${it.key}-${i}`, color: it.color, label: it.label, ...s })))
    .sort((a, b) => a.start - b.start)
    .map((it) => {
      let lane = lanes.findIndex((end) => end <= it.start);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push(0);
      }
      lanes[lane] = it.end;
      return { ...it, lane };
    });
  const laneH = 22;
  const top = 6;
  const Hh = top + Math.max(1, lanes.length) * laneH + 24;
  return (
    <svg className="timeline" viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="当天时间轴">
      {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => {
        const xx = x(day + h * H);
        return (
          <g key={h}>
            <line x1={xx} x2={xx} y1={top} y2={Hh - 20} className="grid" />
            <text x={xx} y={Hh - 6} className="axis" textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
              {h}:00
            </text>
          </g>
        );
      })}
      {placed.map((it) => (
        <rect
          key={it.key}
          x={x(it.start)}
          y={top + it.lane * laneH + 2}
          width={Math.max(x(it.end) - x(it.start), 1)}
          height={laneH - 4}
          rx="3"
          fill={it.color}
        >
          <title>
            {it.label} {formatHm(it.end - it.start)}
          </title>
        </rect>
      ))}
    </svg>
  );
}
