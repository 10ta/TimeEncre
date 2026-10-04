// 记录表单。LiveRecordForm：原地编辑已有记录，改动即时保存，可撤销本次修改；
// CreateRecordForm：补录新记录，需要点“添加”。
import { useEffect, useMemo, useRef, useState } from 'react';
import { TagPicker } from '../../ui/fields';
import { IconButton } from '../../ui/Icon';
import { useAutosave } from '../../ui/useAutosave';
import { useTypeMap, useTypes } from '../../db/hooks';
import {
  createManualRecord,
  deleteRecord,
  findOverlaps,
  patchRecord,
  restoreRecord,
  stopRecord,
  validateIntervals,
  type IntervalMs,
} from '../../db/actions';
import type { TimeRecord } from '../../schema';
import { formatHm, fromIso, fromLocalInput, toLocalInput } from '../../lib/time';

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
        时间段<span className="field-aside">共 {formatHm(total)}</span>
      </span>
      <ol className="iv-list">
        {rows.map((r, i) => (
          <li key={r.key}>
            <input type="datetime-local" aria-label={`第 ${i + 1} 段开始`} value={r.start} onChange={(e) => set(r.key, { start: e.target.value })} />
            <span className="iv-sep" aria-hidden="true">–</span>
            {r.end === null ? (
              <span className="iv-open">进行中</span>
            ) : (
              <input type="datetime-local" aria-label={`第 ${i + 1} 段结束`} value={r.end} onChange={(e) => set(r.key, { end: e.target.value })} />
            )}
            {rows.length > 1 && r.end !== null && (
              <IconButton icon="close" label={`删除第 ${i + 1} 段`} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
            )}
          </li>
        ))}
      </ol>
      {canAdd && (
        <button type="button" className="btn is-small is-quiet iv-add" onClick={add}>
          ＋ 添加一段
        </button>
      )}
    </div>
  );
}

function TypeSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const types = useTypes(true);
  return (
    <label className="field">
      <span className="field-label">类型</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {types
          ?.filter((t) => !t.archived || t.id === value)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.emoji} {t.name}
              {t.archived ? '（已归档）' : ''}
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
    const names = [...new Set(hits.map((r) => typeMap?.get(r.typeId)?.name ?? '未知类型'))];
    setNote(`和「${names.slice(0, 3).join('、')}」${names.length > 3 ? '等' : ''}的时间有重叠。允许同时计时时这是正常的；如果是录错了，请调整时间。`);
    return true;
  };
  return { note, check, clear: () => setNote(null) };
}

// ---------- 原地编辑：即时保存 ----------

export function LiveRecordForm({ rec, onClose }: { rec: TimeRecord; onClose: () => void }) {
  const [snapshot] = useState(rec);
  const [rows, setRows] = useState(() => rowsFromRecord(rec));
  const [rowsTouched, setRowsTouched] = useState(false);
  const [comment, setComment] = useState(rec.comment);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const overlap = useOverlapNote();

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
  useAutosave(rowsTouched ? intervals : savedIntervals, savedIntervals, (ivs) => {
    const err = validateIntervals(ivs);
    if (err) return setError(err);
    void save({ intervals: ivs });
  });
  useAutosave(comment.trim(), rec.comment, (c) => void save({ comment: c }), 600);

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
    <div className="inline-form">
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
        <span className="field-label">备注</span>
        <textarea
          rows={2}
          value={comment}
          placeholder="可选"
          onChange={(e) => {
            commentTouched.current = true;
            setComment(e.target.value);
          }}
        />
      </label>
      <TagPicker value={rec.tagIds} onChange={(tagIds) => void save({ tagIds })} />
      {overlap.note && <p className="notice is-warn">{overlap.note}</p>}
      {error && <p className="form-error" role="alert">{error}（这一处还没有保存）</p>}
      <div className="inline-foot">
        <button type="button" className="btn is-small" disabled={!changed} onClick={() => void undo()} title="恢复到这次展开编辑之前的样子">
          撤销修改
        </button>
        <span className="save-state" aria-live="polite">{saved && !error ? '已自动保存' : ''}</span>
        <span className="spacer" />
        {rec.state !== 'stopped' && (
          <button type="button" className="btn is-small" onClick={() => void stopRecord(rec.id)}>停止</button>
        )}
        {confirmDelete ? (
          <button type="button" className="btn is-small is-danger" onClick={() => deleteRecord(rec.id).then(onClose)}>确认删除</button>
        ) : (
          <button type="button" className="btn is-small is-ghost-danger" onClick={() => setConfirmDelete(true)}>删除</button>
        )}
        <button type="button" className="btn is-small" onClick={onClose}>收起</button>
      </div>
    </div>
  );
}

// ---------- 补录：点“添加”才创建 ----------

export function CreateRecordForm({
  initial,
  onDone,
}: {
  initial?: { start: number; end: number; typeId?: string };
  onDone: () => void;
}) {
  const types = useTypes();
  const [typeId, setTypeId] = useState(initial?.typeId ?? '');
  const [comment, setComment] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>(() => {
    const end = initial?.end ?? Math.floor(Date.now() / 60_000) * 60_000;
    const start = initial?.start ?? end - 30 * 60_000;
    return [rowFrom(start, end)];
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmOverlap, setConfirmOverlap] = useState(false);
  const overlap = useOverlapNote();
  const effectiveType = typeId || types?.[0]?.id || '';

  const submit = async () => {
    if (!effectiveType) return setError('请先选择类型');
    const ivs = rowsToIntervals(rows);
    const err = validateIntervals(ivs);
    if (err) return setError(err);
    if (!confirmOverlap && (await overlap.check(ivs))) return setConfirmOverlap(true);
    try {
      await createManualRecord({ typeId: effectiveType, comment: comment.trim(), tagIds, intervals: ivs });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="inline-form">
      <TypeSelect value={effectiveType} onChange={setTypeId} />
      <IntervalsEditor
        rows={rows}
        onChange={(r) => {
          setRows(r);
          setConfirmOverlap(false);
          overlap.clear();
          setError(null);
        }}
        canAdd
      />
      <label className="field">
        <span className="field-label">备注</span>
        <textarea rows={2} value={comment} placeholder="可选" onChange={(e) => setComment(e.target.value)} />
      </label>
      <TagPicker value={tagIds} onChange={setTagIds} />
      {overlap.note && <p className="notice is-warn">{overlap.note}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="inline-foot">
        <span className="spacer" />
        <button type="button" className="btn is-small" onClick={onDone}>取消</button>
        <button type="button" className="btn is-small is-primary" onClick={() => void submit()}>
          {confirmOverlap ? '仍然添加' : '添加'}
        </button>
      </div>
    </div>
  );
}
