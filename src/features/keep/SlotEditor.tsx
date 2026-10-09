// 条目的预约时间段：开始 / 结束两个日期时刻框，改了就保存（结束早于开始时不保存并提示）
import { useState } from 'react';
import { DateTimeField } from '../../ui/DateTimeField';
import { updateItem } from '../../db/keep';
import { fromLocalInput, toIso, toLocalInput } from '../../lib/time';
import { fromParts, zparts } from '../../lib/zone';
import { useAutosave } from '../../ui/useAutosave';
import type { KeepItem } from '../../schema';
import { slotMs } from './model';
import { tr } from '../../i18n';

const H = 3_600_000;

/** 新预约的默认时间：下一个整点开始，一小时 */
export function defaultSlot(now = Date.now()) {
  const p = zparts(now);
  const start = fromParts(p.y, p.m, p.d, p.h + 1);
  return { start: toIso(start), end: toIso(start + H) };
}

export function SlotEditor({ item, onDone }: { item: KeepItem; onDone: () => void }) {
  const cur = slotMs(item);
  const [start, setStart] = useState(() => toLocalInput(cur?.start ?? Date.parse(defaultSlot().start)));
  const [end, setEnd] = useState(() => toLocalInput(cur?.end ?? Date.parse(defaultSlot().end)));
  const s = fromLocalInput(start);
  const e = fromLocalInput(end);
  const valid = !Number.isNaN(s) && !Number.isNaN(e) && e > s;
  const savedKey = cur ? [toLocalInput(cur.start), toLocalInput(cur.end)] : null;
  const flush = useAutosave(valid ? [start, end] : savedKey, savedKey, (v) => {
    if (v) void updateItem(item.id, { slot: { start: toIso(fromLocalInput(v[0])), end: toIso(fromLocalInput(v[1])) } });
  }, 300);

  // 改开始时保持时长不变，结束跟着挪
  const moveStart = (v: string) => {
    const ns = fromLocalInput(v);
    if (!Number.isNaN(ns) && valid) setEnd(toLocalInput(ns + (e - s)));
    setStart(v);
  };

  return (
    <div className="slot-editor">
      <div className="slot-row">
        <DateTimeField label={tr("预约开始")} value={start} onChange={moveStart} />
        <span className="iv-sep" aria-hidden="true">–</span>
        <DateTimeField label={tr("预约结束")} value={end} onChange={setEnd} />
      </div>
      {!valid && <p className="form-error" role="alert">{tr("结束要晚于开始")}</p>}
      <div className="row">
        {item.slot && (
          <button
            type="button"
            className="btn is-small is-quiet"
            onClick={() => {
              void updateItem(item.id, { slot: null });
              onDone();
            }}
          >
            {tr("取消预约")}
          </button>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="btn is-small"
          onClick={() => {
            flush();
            onDone();
          }}
        >
          {tr("完成")}
        </button>
      </div>
    </div>
  );
}
