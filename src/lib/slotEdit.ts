// Keep 预约时间段的联动：输入框里的值是所选时区的墙上时间 “YYYY-MM-DDTHH:MM”。
// - 改开始：整段跟着平移，保持原来的时长（原来不合法就按一小时），不会出现“结束早于开始”。
// - 改结束的时刻：按开始那天理解；落在开始之前、但挪到次日后不超过 12 小时的（如 23:00 → 01:00），算次日。
//   只有原来的结束就在开始前后一天以内才这样处理；跨好几天的预约、或用户自己改了结束日期，都原样保留。
import { fromLocalInput, toLocalInput } from './time';

const H = 3_600_000;
const DAY = 24 * H;
/** 原来的时段不合法时，改开始后给的时长 */
export const SLOT_DEFAULT_MS = H;
/** 结束早于开始时，挪到次日后最多多长才当作“跨午夜” */
const OVERNIGHT_MAX_MS = 12 * H;

export interface SlotText {
  start: string;
  end: string;
}

const datePart = (v: string) => v.slice(0, 10);
const timePart = (v: string) => v.slice(10);

/** 日历上的下一天（与时区、夏令时无关的纯日期运算） */
function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function moveSlotStart(cur: SlotText, nextStart: string): SlotText {
  const s = fromLocalInput(cur.start);
  const e = fromLocalInput(cur.end);
  const ns = fromLocalInput(nextStart);
  if (Number.isNaN(ns)) return { start: nextStart, end: cur.end };
  const dur = !Number.isNaN(s) && !Number.isNaN(e) && e > s ? e - s : SLOT_DEFAULT_MS;
  return { start: nextStart, end: toLocalInput(ns + dur) };
}

export function setSlotEnd(cur: SlotText, nextEnd: string): SlotText {
  const s = fromLocalInput(cur.start);
  const e = fromLocalInput(cur.end);
  const ne = fromLocalInput(nextEnd);
  if (Number.isNaN(s) || Number.isNaN(e) || Number.isNaN(ne)) return { start: cur.start, end: nextEnd };
  // 只改了时刻（日期没动），且原来的结束就在开始前后一天以内：按开始那天重新理解
  const onlyTime = datePart(nextEnd) === datePart(cur.end);
  if (!onlyTime || Math.abs(e - s) > DAY) return { start: cur.start, end: nextEnd };
  const sameDay = `${datePart(cur.start)}${timePart(nextEnd)}`;
  const c = fromLocalInput(sameDay);
  if (c > s) return { start: cur.start, end: sameDay };
  const overnight = `${nextDate(datePart(cur.start))}${timePart(nextEnd)}`;
  const o = fromLocalInput(overnight);
  // 跨午夜的短时段算次日；否则保留在当天，由界面提示“结束要晚于开始”
  return { start: cur.start, end: o - s <= OVERNIGHT_MAX_MS ? overnight : sameDay };
}
