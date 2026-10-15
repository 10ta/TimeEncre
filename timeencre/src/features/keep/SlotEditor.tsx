// 条目的预约时间段。和记录的“时间段”用同一套：同样的日期时刻框、同样的一行“开始 – 结束 ×”，
// 改了就自动保存；点空白处 / 按 Esc 收起（收起前先提交正在输入的值）；× 取消预约。
import { useRef, useState } from 'react';
import { DateTimeField } from '../../ui/DateTimeField';
import { IconButton } from '../../ui/Icon';
import { updateItem } from '../../db/keep';
import { fromLocalInput, toIso, toLocalInput } from '../../lib/time';
import { fromParts, zparts } from '../../lib/zone';
import { useAutosave } from '../../ui/useAutosave';
import { useOutsideClose } from '../../ui/useOutsideClose';
import { commitAndClose } from '../../ui/commitAndClose';
import type { KeepItem } from '../../schema';
import { slotMs } from './model';
import { tr } from '../../i18n';

const H = 3_600_000;

/** 新预约的默认时间：下一个整点开始，一小时 */
export function defaultSlot(now = Date.now()) {
  const p = zparts(now);
  const start = fromParts(p.y, p.m, p.d, p.h + 1);
  return { start, end: start + H };
}

export function SlotEditor({ item, onClose }: { item: KeepItem; onClose: () => void }) {
  const cur = slotMs(item) ?? defaultSlot();
  const [start, setStart] = useState(() => toLocalInput(cur.start));
  const [end, setEnd] = useState(() => toLocalInput(cur.end));
  const s = fromLocalInput(start);
  const e = fromLocalInput(end);
  const valid = !Number.isNaN(s) && !Number.isNaN(e) && e > s;
  const saved = slotMs(item);
  const savedKey = saved ? [toLocalInput(saved.start), toLocalInput(saved.end)] : null;
  // 打开即表示要预约：默认时间也会保存；结束不晚于开始时不保存
  const removed = useRef(false);
  useAutosave(valid ? [start, end] : savedKey, savedKey, (v) => {
    if (v && !removed.current) void updateItem(item.id, { slot: { start: toIso(fromLocalInput(v[0])), end: toIso(fromLocalInput(v[1])) } });
  });

  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(true, ref, onClose);

  return (
    <div className="field slot-editor" ref={ref} onKeyDown={(ev) => ev.key === 'Escape' && commitAndClose(ref.current, onClose)}>
      <ol className="iv-list">
        <li>
          <DateTimeField label={tr("预约开始")} value={start} onChange={setStart} />
          <span className="iv-sep" aria-hidden="true">–</span>
          <DateTimeField label={tr("预约结束")} value={end} onChange={setEnd} />
          <IconButton
            icon="close"
            label={tr("取消预约")}
            onClick={() => {
              if (removed.current) return;
              removed.current = true;
              // 标记后卸载时就不会再把时间存回去
              void updateItem(item.id, { slot: null });
              onClose();
            }}
          />
        </li>
      </ol>
      {!valid && <p className="form-error" role="alert">{tr("结束要晚于开始")}</p>}
    </div>
  );
}
