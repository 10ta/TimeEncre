// 记录表单。LiveRecordForm：原地编辑已有记录，改动即时保存，可撤销本次修改；
// CreateRecordForm：补录新记录，需要点“添加”。
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { TagPicker } from '../../ui/fields';
import { IconButton } from '../../ui/Icon';
import { useAutosave } from '../../ui/useAutosave';
import { commitAndClose } from '../../ui/commitAndClose';
import { useRecord, useTypeMap, useTypes } from '../../db/hooks';
import {
  createManualRecord,
  deleteRecord,
  findOverlaps,
  patchRecord,
  suggestBackfillRange,
  restoreRecord,
  stopRecord,
  validateIntervals,
  type IntervalMs,
} from '../../db/actions';
import type { TimeRecord } from '../../schema';
import { fromDb } from '../../db/db';
import { formatHm, fromIso, fromLocalInput, toLocalInput } from '../../lib/time';
import { tr } from '../../i18n';

// ---------- 时间段 ----------

export interface Row {
  key: number;
  start: string;
  /** null = 进行中（不可编辑） */
  end: string | null;
  /** 原值：输入框没动过就用原始时间，避免只精确到分钟的输入框吃掉秒 */
  orig?: { startInput: string; endInput: string | null; start: number; end: number | null };
}

let rowKey = 0;
const rowFrom = (start: number, end: number | null): Row => {
  const startInput = toLocalInput(start);
  const endInput = end === null ? null : toLocalInput(end);
  return { key: ++rowKey, start: startInput, end: endInput, orig: { startInput, endInput, start, end } };
};
export const rowsFromRecord = (r: TimeRecord): Row[] =>
  r.intervals.map((iv) => rowFrom(fromIso(iv.start), iv.end ? fromIso(iv.end) : null));

export function rowsToIntervals(rows: Row[]): IntervalMs[] {
  return rows.map((r) => ({
    start: r.orig && r.start === r.orig.startInput ? r.orig.start : fromLocalInput(r.start),
    end:
      r.end === null
        ? null
        : r.orig && r.end === r.orig.endInput && r.orig.end !== null
          ? r.orig.end
          : fromLocalInput(r.end),
  }));
}

const recIntervals = (r: TimeRecord): IntervalMs[] =>
  r.intervals.map((iv) => ({ start: fromIso(iv.start), end: iv.end ? fromIso(iv.end) : null }));

function IntervalsEditor({
  rows,
  onChange,
  canAdd,
}: {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  canAdd: boolean;
}) {
  const intervals = rowsToIntervals(rows);
  const total = intervals.reduce((a, iv) => a + Math.max(0, (iv.end ?? Date.now()) - iv.start), 0);
  const set = (key: number, patch: Partial<Row>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => {
    const last = intervals[intervals.length - 1];
    const start = last?.end ?? Date.now();
    const end = Math.max(Math.min(start + 15 * 60_000, Date.now()), start + 60_000);
    onChange([...rows, { key: ++rowKey, start: toLocalInput(start), end: toLocalInput(end) }]);
  };
  return (
    <div className="field">
      <span className="field-label">
        {tr("时间段")}<span className="field-aside">{tr("共 {0}", formatHm(total))}</span>
      </span>
      <ol className="iv-list">
        {rows.map((r, i) => (
          <li key={r.key}>
            <input type="datetime-local" aria-label={tr("第 {0} 段开始", i + 1)} value={r.start} onChange={(e) => set(r.key, { start: e.target.value })} />
            <span className="iv-sep" aria-hidden="true">–</span>
            {r.end === null ? (
              <span className="iv-open">{tr("进行中")}</span>
            ) : (
              <input type="datetime-local" aria-label={tr("第 {0} 段结束", i + 1)} value={r.end} onChange={(e) => set(r.key, { end: e.target.value })} />
            )}
            {rows.length > 1 && r.end !== null && (
              <IconButton icon="close" label={tr("删除第 {0} 段", i + 1)} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
            )}
          </li>
        ))}
      </ol>
      {canAdd && (
        <button type="button" className="btn is-small is-quiet iv-add" onClick={add}>
          {tr("＋ 添加一段")}
        </button>
      )}
    </div>
  );
}

function TypeSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const types = useTypes(true);
  return (
    <label className="field">
      <span className="field-label">{tr("活动|字段")}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {types
          ?.filter((t) => !t.archived || t.id === value)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.emoji} {t.name}
              {t.archived ? tr("（已归档）") : ''}
            </option>
          ))}
      </select>
    </label>
  );
}

function useOverlapNote() {
  const typeMap = useTypeMap();
  const [note, setNote] = useState<string | null>(null);
  const check = async (ivs: IntervalMs[], excludeId?: string) => {
    const hits = await findOverlaps(ivs, excludeId);
    if (!hits.length) return setNote(null), false;
    const names = [...new Set(hits.map((r) => typeMap?.get(r.typeId)?.name ?? tr("未知活动")))];
    const list = names.slice(0, 3).join(tr("、"));
    setNote(
      names.length > 3
        ? tr("和「{0}」等的时间有重叠。允许同时计时时这是正常的；如果是录错了，请调整时间。", list)
        : tr("和「{0}」的时间有重叠。允许同时计时时这是正常的；如果是录错了，请调整时间。", list),
    );
    return true;
  };
  return { note, check, clear: () => setNote(null) };
}

// ---------- 原地编辑：即时保存 ----------

export function LiveRecordForm({
  rec,
  onClose,
  checkOverlapOnMount,
}: {
  rec: TimeRecord;
  onClose: () => void;
  /** 刚补录完：一打开就检查一次重叠并提示 */
  checkOverlapOnMount?: boolean;
}) {
  const [snapshot] = useState(rec);
  const [rows, setRows] = useState(() => rowsFromRecord(rec));
  const [rowsTouched, setRowsTouched] = useState(false);
  const [comment, setComment] = useState(rec.comment);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const overlap = useOverlapNote();
  useEffect(() => {
    if (checkOverlapOnMount) void overlap.check(recIntervals(rec), rec.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 别处改了这条记录（例如在横条上停止），而这里没有未保存的改动：跟上
  const sig = JSON.stringify(rec.intervals);
  const firstSig = useRef(sig);
  useEffect(() => {
    if (sig === firstSig.current) return;
    firstSig.current = sig;
    if (!rowsTouched) setRows(rowsFromRecord(rec));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const commentTouched = useRef(false);
  useEffect(() => {
    if (!commentTouched.current) setComment(rec.comment);
  }, [rec.comment]);

  const save = async (patch: Parameters<typeof patchRecord>[1]) => {
    try {
      await patchRecord(rec.id, patch);
      setError(null);
      setSaved(true);
      if (patch.intervals) setRowsTouched(false);
      if (patch.intervals || patch.typeId) await overlap.check(patch.intervals ?? recIntervals(rec), rec.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const intervals = useMemo(() => rowsToIntervals(rows), [rows]);
  const savedIntervals = useMemo(() => recIntervals(rec), [rec]);
  const flushRows = useAutosave(rowsTouched ? intervals : savedIntervals, savedIntervals, (ivs) => {
    const err = validateIntervals(ivs);
    if (err) return setError(err);
    void save({ intervals: ivs });
  });
  const flushComment = useAutosave(comment.trim(), rec.comment, (c) => void save({ comment: c }), 600);
  const formRef = useRef<HTMLDivElement>(null);
  const close = () => commitAndClose(formRef.current, onClose);

  const changed =
    JSON.stringify([rec.typeId, rec.comment, rec.tagIds, rec.intervals]) !==
    JSON.stringify([snapshot.typeId, snapshot.comment, snapshot.tagIds, snapshot.intervals]);

  const undo = async () => {
    await restoreRecord(snapshot);
    setRows(rowsFromRecord(snapshot));
    setRowsTouched(false);
    commentTouched.current = false;
    setComment(snapshot.comment);
    setError(null);
    overlap.clear();
    setSaved(false);
  };

  return (
    <div
      ref={formRef}
      className="inline-form"
      onBlurCapture={() => {
        // 任何输入框失焦就立即保存，不等延时
        flushRows();
        flushComment();
      }}
    >
      <TypeSelect value={rec.typeId} onChange={(typeId) => void save({ typeId })} />
      <IntervalsEditor
        rows={rows}
        onChange={(r) => {
          setRows(r);
          setRowsTouched(true);
        }}
        canAdd={rec.state !== 'running'}
      />
      <label className="field">
        <span className="field-label">{tr("备注")}</span>
        <textarea
          rows={2}
          value={comment}
          placeholder={tr("可选")}
          onChange={(e) => {
            commentTouched.current = true;
            setComment(e.target.value);
          }}
        />
      </label>
      <TagPicker value={rec.tagIds} onChange={(tagIds) => void save({ tagIds })} />
      {overlap.note && <p className="notice is-warn">{overlap.note}</p>}
      {error && <p className="form-error" role="alert">{error}{tr("（这一处还没有保存）")}</p>}
      <div className="inline-foot">
        <button type="button" className="btn is-small" disabled={!changed} onClick={() => void undo()} title={tr("恢复到这次展开编辑之前的样子")}>
          {tr("撤销修改")}
        </button>
        <span className="save-state" aria-live="polite">{saved && !error ? tr("已自动保存") : ''}</span>
        <span className="spacer" />
        {rec.state !== 'stopped' && (
          <button type="button" className="btn is-small" onClick={() => void stopRecord(rec.id)}>{tr("停止")}</button>
        )}
        {confirmDelete ? (
          <button type="button" className="btn is-small is-danger" onClick={() => deleteRecord(rec.id).then(onClose)}>{tr("确认删除")}</button>
        ) : (
          <button type="button" className="btn is-small is-ghost-danger" onClick={() => setConfirmDelete(true)}>{tr("删除")}</button>
        )}
        <button type="button" className="btn is-small" onClick={close}>{tr("收起")}</button>
      </div>
    </div>
  );
}

// ---------- 补录：点一个活动就建好 ----------

/**
 * 补录分两步，但都不需要“添加”按钮：
 *  1. 时间段已预先填好（空档 / 最近一段记录之后），可以先调整；点一个活动，记录立刻创建；
 *  2. 原地换成与修改已有记录相同的即时编辑表单，继续补备注、标签或调时间。
 * 没点活动就收起，什么也不会留下。
 * onCreated：由父组件接管后续（例如列表里让新条目展开），不传则在原地显示编辑表单。
 */
export function CreateRecordForm({
  initial,
  onDone,
  onCreated,
}: {
  initial?: { start: number; end: number };
  onDone: () => void;
  onCreated?: (id: string, startMs: number) => void;
}) {
  const types = useTypes();
  const [rows, setRows] = useState<Row[]>(() => {
    const end = initial?.end ?? Math.floor(Date.now() / 60_000) * 60_000;
    const start = initial?.start ?? end - 30 * 60_000;
    return [rowFrom(start, end)];
  });
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const created = useRecord(createdId ?? '');

  // 从“补录”按钮打开（没有指定空档）时，默认填最近一段记录结束之后的那段时间；用户动过就不再覆盖
  const rowsTouched = useRef(false);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    void suggestBackfillRange().then((r) => {
      if (alive && !rowsTouched.current) setRows([rowFrom(r.start, r.end)]);
    });
    return () => {
      alive = false;
    };
  }, [initial]);

  const pick = async (typeId: string) => {
    if (busy) return;
    const ivs = rowsToIntervals(rows);
    const err = validateIntervals(ivs);
    if (err) return setError(err);
    setBusy(true);
    try {
      const id = await createManualRecord({ typeId, comment: '', tagIds: [], intervals: ivs });
      if (onCreated) onCreated(id, ivs[0].start);
      else setCreatedId(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (createdId) {
    if (!created || created.deleted) return null;
    return <LiveRecordForm key={created.id} rec={fromDb(created)} onClose={onDone} checkOverlapOnMount />;
  }

  return (
    <div className="inline-form">
      <IntervalsEditor
        rows={rows}
        onChange={(r) => {
          rowsTouched.current = true;
          setRows(r);
          setError(null);
        }}
        canAdd
      />
      <div className="field">
        <span className="field-label">{tr("记录为哪个活动")}</span>
        <div className="pick-grid" role="group" aria-label={tr("记录为哪个活动")}>
          {types?.map((t) => (
            <button
              key={t.id}
              type="button"
              className="pick"
              style={{ '--c': t.color } as CSSProperties}
              disabled={busy}
              onClick={() => void pick(t.id)}
            >
              <span className="pick-emoji" aria-hidden="true">{t.emoji}</span>
              <span className="pick-name">{t.name}</span>
            </button>
          ))}
        </div>
        <p className="hint">{tr("点一个活动就记录好了；之后可以在这里继续补充备注和标签，改动即时保存。")}</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="inline-foot">
        <span className="spacer" />
        <button type="button" className="btn is-small" onClick={onDone}>{tr("收起")}</button>
      </div>
    </div>
  );
}
