import { useState, type CSSProperties } from 'react';
import { useTags, useTypes } from '../../db/hooks';
import {
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

const LABEL: Record<CatalogKind, string> = { types: '活动类型', tags: '标签' };

export function CatalogPage() {
  const [kind, setKind] = useState<CatalogKind>('types');
  return (
    <div className="page">
      <header className="page-head">
        <h1>类型与标签</h1>
      </header>
      <div className="tabs" role="tablist">
        {(['types', 'tags'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'is-on' : undefined} onClick={() => setKind(k)}>
            {LABEL[k]}
          </button>
        ))}
      </div>
      <CatalogList key={kind} kind={kind} />
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
        {kind === 'types' ? '计时页按这里的顺序排列。归档后不再出现在计时页，历史记录不受影响。' : '标签平级，可以给任何记录打多个。'}
        点一行展开编辑，改动即时保存。
      </p>

      <ul className="cat-list">
        {live.map((x) =>
          row(
            x,
            <>
              <IconButton icon="up" label="上移" onClick={() => void moveCatalogItem(kind, x.id, -1)} />
              <IconButton icon="down" label="下移" onClick={() => void moveCatalogItem(kind, x.id, 1)} />
              <button type="button" className="btn is-small" onClick={() => void setArchived(kind, x.id, true)}>
                归档
              </button>
            </>,
          ),
        )}
        <li className={`cat-add${openKey === 'new' ? ' is-open' : ''}`}>
          <div className="cat-row">
            <button type="button" className="cat-name" aria-expanded={openKey === 'new'} onClick={() => toggle('new')}>
              ＋ 新建{LABEL[kind]}
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
            {showArchived ? '收起' : '显示'}已归档（{archived.length}）
          </button>
          {showArchived && (
            <ul className="cat-list is-archived">
              {archived.map((x) =>
                row(
                  x,
                  <button type="button" className="btn is-small" onClick={() => void setArchived(kind, x.id, false)}>
                    恢复
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
  useAutosave(name.trim(), item.name, (n) => void save({ name: n }), 500);
  // 拖动取色器时会连续触发，稍等再存
  useAutosave(color, item.color, (c) => void save({ color: c }), 250);

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
    <div className="inline-form">
      <label className="field">
        <span className="field-label">名称</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <EmojiField value={item.emoji} onChange={(emoji) => void save({ emoji })} />
      <ColorField value={color} onChange={setColor} />
      {confirmDelete && (
        <p className="hint">删除后不再显示，已有记录仍保留并标注为已删除的{LABEL[kind]}。只是不想在计时页看到的话，用“归档”更合适。</p>
      )}
      {error && <p className="form-error" role="alert">{error}（这一处还没有保存）</p>}
      <div className="inline-foot">
        <button type="button" className="btn is-small" disabled={!changed} onClick={() => void undo()}>撤销修改</button>
        <span className="save-state" aria-live="polite">{saved && !error ? '已自动保存' : ''}</span>
        <span className="spacer" />
        {confirmDelete ? (
          <button type="button" className="btn is-small is-danger" onClick={() => softDeleteCatalogItem(kind, item.id).then(onClose)}>确认删除</button>
        ) : (
          <button type="button" className="btn is-small is-ghost-danger" onClick={() => setConfirmDelete(true)}>删除</button>
        )}
        <button type="button" className="btn is-small" onClick={onClose}>收起</button>
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
    if (!name.trim()) return setError('请填写名称');
    await saveCatalogItem(kind, { name: name.trim(), emoji, color });
    onDone();
  };
  return (
    <div className="inline-form">
      <label className="field">
        <span className="field-label">名称</span>
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
        <button type="button" className="btn is-small" onClick={onDone}>取消</button>
        <button type="button" className="btn is-small is-primary" onClick={() => void submit()}>添加</button>
      </div>
    </div>
  );
}
