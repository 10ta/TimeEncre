import { useState, type CSSProperties } from 'react';
import { useTags, useTypes } from '../../db/hooks';
import {
  moveCatalogItem,
  saveCatalogItem,
  setArchived,
  softDeleteCatalogItem,
  type CatalogKind,
} from '../../db/actions';
import { PALETTE } from '../../db/defaults';
import type { CatalogItem } from '../../schema';
import { Modal } from '../../ui/Modal';
import { ColorField, EmojiField } from '../../ui/fields';
import { IconButton } from '../../ui/Icon';

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
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  if (!items) return null;

  const live = items.filter((x) => !x.archived);
  const archived = items.filter((x) => x.archived);

  return (
    <>
      <div className="list-toolbar">
        <p className="hint">
          {kind === 'types' ? '计时页按这里的顺序排列。归档后不再出现在计时页，历史记录不受影响。' : '标签平级，可以给任何记录打多个。'}
        </p>
        <button type="button" className="btn is-primary" onClick={() => setEditing('new')}>
          新建{LABEL[kind]}
        </button>
      </div>
      {live.length === 0 && <p className="empty">还没有{LABEL[kind]}，点“新建{LABEL[kind]}”添加。</p>}
      <ul className="cat-list">
        {live.map((x) => (
          <li key={x.id} style={{ '--c': x.color } as CSSProperties}>
            <span className="cat-emoji" aria-hidden="true">{x.emoji}</span>
            <button type="button" className="cat-name" onClick={() => setEditing(x)}>{x.name}</button>
            <span className="cat-actions">
              <IconButton icon="up" label="上移" onClick={() => void moveCatalogItem(kind, x.id, -1)} />
              <IconButton icon="down" label="下移" onClick={() => void moveCatalogItem(kind, x.id, 1)} />
              <button type="button" className="btn is-small" onClick={() => void setArchived(kind, x.id, true)}>
                归档
              </button>
            </span>
          </li>
        ))}
      </ul>
      {archived.length > 0 && (
        <section className="archived">
          <button type="button" className="btn is-quiet" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? '收起' : '显示'}已归档（{archived.length}）
          </button>
          {showArchived && (
            <ul className="cat-list is-archived">
              {archived.map((x) => (
                <li key={x.id} style={{ '--c': x.color } as CSSProperties}>
                  <span className="cat-emoji" aria-hidden="true">{x.emoji}</span>
                  <button type="button" className="cat-name" onClick={() => setEditing(x)}>{x.name}</button>
                  <span className="cat-actions">
                    <button type="button" className="btn is-small" onClick={() => void setArchived(kind, x.id, false)}>
                      恢复
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {editing && (
        <ItemDialog
          kind={kind}
          item={editing === 'new' ? null : editing}
          defaultColor={PALETTE[items.length % PALETTE.length]}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ItemDialog({
  kind,
  item,
  defaultColor,
  onClose,
}: {
  kind: CatalogKind;
  item: CatalogItem | null;
  defaultColor: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [emoji, setEmoji] = useState(item?.emoji ?? (kind === 'types' ? '⏱️' : '🏷️'));
  const [color, setColor] = useState(item?.color ?? defaultColor);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return setError('请填写名称');
    await saveCatalogItem(kind, { id: item?.id, name: name.trim(), emoji, color });
    onClose();
  };

  return (
    <Modal
      title={item ? `编辑${LABEL[kind]}` : `新建${LABEL[kind]}`}
      onClose={onClose}
      footer={
        <>
          {item &&
            (confirmDelete ? (
              <button type="button" className="btn is-danger" onClick={() => softDeleteCatalogItem(kind, item.id).then(onClose)}>
                确认删除
              </button>
            ) : (
              <button type="button" className="btn is-ghost-danger" onClick={() => setConfirmDelete(true)}>
                删除
              </button>
            ))}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button type="button" className="btn is-primary" onClick={save}>保存</button>
        </>
      }
    >
      <div className="preview" style={{ '--c': color } as CSSProperties}>
        <span className="tile-emoji">{emoji}</span>
        <span>{name || '名称'}</span>
      </div>
      <label className="field">
        <span className="field-label">名称</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <EmojiField value={emoji} onChange={setEmoji} />
      <ColorField value={color} onChange={setColor} />
      {confirmDelete && (
        <p className="hint">删除后不再显示，但已有记录仍保留并标注为已删除的{LABEL[kind]}。只是不想在计时页看到的话，用“归档”更合适。</p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
