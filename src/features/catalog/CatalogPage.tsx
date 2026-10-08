import { useRef, useState, type CSSProperties } from 'react';
import { useDuplicateGroups, useTags, useTypes } from '../../db/hooks';
import {
  mergeDuplicates,
  moveCatalogItem,
  patchCatalogItem,
  restoreCatalogItem,
  saveCatalogItem,
  setArchived,
  softDeleteCatalogItem,
  type CatalogKind,
} from '../../db/actions';
import { PALETTE } from '../../db/defaults';
import type { CatalogItem } from '../../schema';
import { ColorField, EmojiField } from '../../ui/fields';
import { IconButton } from '../../ui/Icon';
import { Drawer } from '../../ui/Drawer';
import { useAutosave } from '../../ui/useAutosave';
import { commitAndClose } from '../../ui/commitAndClose';
import { tr } from '../../i18n';

const LABEL: Record<CatalogKind, string> = { types: tr("活动"), tags: tr("标签") };

export function CatalogPage() {
  return (
    <div className="page catalog">
      <header className="page-head">
        <h1>{tr("类型")}</h1>
      </header>
      {(['types', 'tags'] as const).map((kind) => (
        <section key={kind} className="catalog-section" aria-labelledby={`cat-${kind}`}>
          <h2 id={`cat-${kind}`}>{LABEL[kind]}</h2>
          <DuplicateNotice kind={kind} />
          <CatalogList kind={kind} />
        </section>
      ))}
    </div>
  );
}

function CatalogList({ kind }: { kind: CatalogKind }) {
  const typeItems = useTypes(true);
  const tagItems = useTags(true);
  const items = kind === 'types' ? typeItems : tagItems;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  if (!items) return null;
  const toggle = (k: string) => setOpenKey((cur) => (cur === k ? null : k));
  const close = () => setOpenKey(null);

  const live = items.filter((x) => !x.archived);
  const archived = items.filter((x) => x.archived);

  const row = (x: CatalogItem, actions: React.ReactNode) => (
    <li key={x.id} className={openKey === x.id ? 'is-open' : undefined} style={{ '--c': x.color } as CSSProperties}>
      <div className="cat-row">
        <span className="cat-emoji" aria-hidden="true">{x.emoji}</span>
        <button type="button" className="cat-name" aria-expanded={openKey === x.id} onClick={() => toggle(x.id)}>
          {x.name}
        </button>
        <span className="cat-actions">{actions}</span>
      </div>
      <Drawer open={openKey === x.id} onClose={close}>
        <LiveCatalogForm kind={kind} item={x} onClose={close} />
      </Drawer>
    </li>
  );

  return (
    <>
      <p className="hint">
        {kind === 'types'
          ? tr("计时页的格子按这里的顺序排列。归档后不再出现在计时页，历史记录不受影响。点一行展开编辑，改动即时保存。")
          : tr("标签平级，一条记录可以打多个。")}
      </p>

      <ul className="cat-list">
        {live.map((x) =>
          row(
            x,
            <>
              <IconButton icon="up" label={tr("上移")} onClick={() => void moveCatalogItem(kind, x.id, -1)} />
              <IconButton icon="down" label={tr("下移")} onClick={() => void moveCatalogItem(kind, x.id, 1)} />
              <button type="button" className="btn is-small" onClick={() => void setArchived(kind, x.id, true)}>
                {tr("归档")}
              </button>
            </>,
          ),
        )}
        <li className={`cat-add${openKey === 'new' ? ' is-open' : ''}`}>
          <div className="cat-row">
            <button type="button" className="cat-name" aria-expanded={openKey === 'new'} onClick={() => toggle('new')}>
              {kind === 'types' ? tr("＋ 新建活动") : tr("＋ 新建标签")}
            </button>
          </div>
          <Drawer open={openKey === 'new'} onClose={close}>
            <CreateCatalogForm kind={kind} defaultColor={PALETTE[items.length % PALETTE.length]} onDone={close} />
          </Drawer>
        </li>
      </ul>

      {archived.length > 0 && (
        <section className="archived">
          <button type="button" className="btn is-quiet" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? tr("收起已归档（{0}）", archived.length) : tr("显示已归档（{0}）", archived.length)}
          </button>
          {showArchived && (
            <ul className="cat-list is-archived">
              {archived.map((x) =>
                row(
                  x,
                  <button type="button" className="btn is-small" onClick={() => void setArchived(kind, x.id, false)}>
                    {tr("恢复")}
                  </button>,
                ),
              )}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function LiveCatalogForm({ kind, item, onClose }: { kind: CatalogKind; item: CatalogItem; onClose: () => void }) {
  const [snapshot] = useState(item);
  const [name, setName] = useState(item.name);
  const [color, setColor] = useState(item.color);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async (patch: Parameters<typeof patchCatalogItem>[2]) => {
    try {
      await patchCatalogItem(kind, item.id, patch);
      setError(null);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const flushName = useAutosave(name.trim(), item.name, (n) => void save({ name: n }), 500);
  // 拖动取色器时会连续触发，稍等再存
  const flushColor = useAutosave(color, item.color, (c) => void save({ color: c }), 250);
  const formRef = useRef<HTMLDivElement>(null);

  const changed =
    JSON.stringify([item.name, item.emoji, item.color]) !== JSON.stringify([snapshot.name, snapshot.emoji, snapshot.color]);
  const undo = async () => {
    await restoreCatalogItem(kind, snapshot);
    setName(snapshot.name);
    setColor(snapshot.color);
    setError(null);
    setSaved(false);
  };

  return (
    <div
      ref={formRef}
      className="inline-form"
      onBlurCapture={() => {
        flushName();
        flushColor();
      }}
    >
      <label className="field">
        <span className="field-label">{tr("名称")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <EmojiField value={item.emoji} onChange={(emoji) => void save({ emoji })} />
      <ColorField value={color} onChange={setColor} />
      {confirmDelete && (
        <p className="hint">
          {kind === 'types'
            ? tr("删除后不再显示，已有记录仍保留并标注为已删除的活动。只是不想在计时页看到的话，用“归档”更合适。")
            : tr("删除后不再显示，已有记录仍保留并标注为已删除的标签。只是不想在计时页看到的话，用“归档”更合适。")}
        </p>
      )}
      {error && <p className="form-error" role="alert">{error}{tr("（这一处还没有保存）")}</p>}
      <div className="inline-foot">
        <button type="button" className="btn is-small" disabled={!changed} onClick={() => void undo()}>{tr("撤销修改")}</button>
        <span className="save-state" aria-live="polite">{saved && !error ? tr("已自动保存") : ''}</span>
        <span className="spacer" />
        {confirmDelete ? (
          <button type="button" className="btn is-small is-danger" onClick={() => softDeleteCatalogItem(kind, item.id).then(onClose)}>{tr("确认删除")}</button>
        ) : (
          <button type="button" className="btn is-small is-ghost-danger" onClick={() => setConfirmDelete(true)}>{tr("删除")}</button>
        )}
        <button type="button" className="btn is-small" onClick={() => commitAndClose(formRef.current, onClose)}>{tr("收起")}</button>
      </div>
    </div>
  );
}

function CreateCatalogForm({ kind, defaultColor, onDone }: { kind: CatalogKind; defaultColor: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(kind === 'types' ? '⏱️' : '🏷️');
  const [color, setColor] = useState(defaultColor);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim()) return setError(tr("请填写名称"));
    await saveCatalogItem(kind, { name: name.trim(), emoji, color });
    onDone();
  };
  return (
    <div className="inline-form">
      <label className="field">
        <span className="field-label">{tr("名称")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          autoFocus
        />
      </label>
      <EmojiField value={emoji} onChange={setEmoji} />
      <ColorField value={color} onChange={setColor} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="inline-foot">
        <span className="spacer" />
        <button type="button" className="btn is-small" onClick={onDone}>{tr("取消")}</button>
        <button type="button" className="btn is-small is-primary" onClick={() => void submit()}>{tr("添加")}</button>
      </div>
    </div>
  );
}

function DuplicateNotice({ kind }: { kind: CatalogKind }) {
  const groups = useDuplicateGroups(kind);
  const [result, setResult] = useState<string | null>(null);
  if (result) return <p className="notice" role="status">{result}</p>;
  if (!groups || groups.length === 0) return null;
  const list = groups.map((g) => `${g[0].emoji}${g[0].name}×${g.length}`).join(tr("、"));
  return (
    <div className="notice is-warn dup-notice" role="status">
      <p>
        {kind === 'types'
          ? tr("有 {0} 组同名的活动：{1}。常见原因是在两台设备上都选了默认活动。合并后每组只保留一个，相关的记录、目标和 Pomo 设置会改为指向保留的那个。", groups.length, list)
          : tr("有 {0} 组同名的标签：{1}。合并后每组只保留一个，相关的记录、目标和 Pomo 设置会改为指向保留的那个。", groups.length, list)}
      </p>
      <button
        type="button"
        className="btn is-small is-primary"
        onClick={async () => {
          const r = await mergeDuplicates(kind);
          setResult(
            kind === 'types'
              ? tr("已合并 {0} 组，移除 {1} 个重复的活动，更新了 {2} 条记录。下次同步后其他设备也会一致。", r.groups, r.removed, r.recordsUpdated)
              : tr("已合并 {0} 组，移除 {1} 个重复的标签，更新了 {2} 条记录。下次同步后其他设备也会一致。", r.groups, r.removed, r.recordsUpdated),
          );
        }}
      >
        {kind === 'types' ? tr("合并同名活动") : tr("合并同名标签")}
      </button>
    </div>
  );
}
