// 一个清单卡片：标题、置顶、菜单（颜色 / 清除已完成 / 删除）、未完成条目、添加条目、折叠的已完成条目。
// 改动即时保存。条目里回车新建下一条（Shift + 回车换行），在空条目里按退格删除它。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { clearDone, createItem, deleteItem, deleteList, moveItem, restoreKeep, setItemDone, updateItem, updateList } from '../../db/keep';
import { PALETTE } from '../../db/defaults';
import type { KeepItem, KeepList } from '../../schema';
import { Icon } from '../../ui/Icon';
import { useAutosave } from '../../ui/useAutosave';
import { useOutsideClose } from '../../ui/useOutsideClose';
import { showUndo } from '../../ui/undo';
import { slotText } from '../../i18n/dates';
import { tr } from '../../i18n';
import { slotMs, slotState, type SlotState } from './model';
import { SlotEditor } from './SlotEditor';
import type { DropTarget } from './dnd';

export const SLOT_WORD: Record<SlotState, string> = {
  upcoming: '',
  started: tr("已开始"),
  overdue: tr("已过期"),
  done: tr("已完成"),
};

const OPEN_DONE_KEY = 'timeencre.keep.openDone';
function readOpenDone(): string[] {
  try {
    return JSON.parse(localStorage.getItem(OPEN_DONE_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function writeOpenDone(ids: string[]) {
  try {
    localStorage.setItem(OPEN_DONE_KEY, JSON.stringify(ids));
  } catch {
    /* 只在本次生效 */
  }
}

/** 文本框随内容长高 */
function useAutoHeight(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

export function SlotChip({ item, now, onClick }: { item: KeepItem; now: number; onClick?: () => void }) {
  const s = slotMs(item);
  const st = slotState(item, now);
  if (!s || !st) return null;
  const body = (
    <>
      <Icon name="clock" />
      <span>{slotText(s.start, s.end, now)}</span>
      {SLOT_WORD[st] && <span className="slot-word">{SLOT_WORD[st]}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={`slot-chip is-${st}`} onClick={onClick} title={tr("修改预约时间")}>
      {body}
    </button>
  ) : (
    <span className={`slot-chip is-${st}`}>{body}</span>
  );
}

export function KeepCard({
  list,
  items,
  nextListId,
  now,
  focus,
  onFocused,
  onFocus,
  highlight,
  dragTarget,
  draggingId,
  onDragStart,
}: {
  list: KeepList;
  items: KeepItem[];
  nextListId: string | null;
  now: number;
  /** 需要获得焦点的：'list:<id>'（标题）或条目 id */
  focus: string | null;
  onFocused: () => void;
  onFocus: (key: string) => void;
  highlight: string | null;
  dragTarget: DropTarget | null;
  draggingId: string | null;
  onDragStart: (e: RPointerEvent, kind: 'item' | 'list', id: string, label: string) => void;
}) {
  const open = items.filter((x) => !x.done);
  const done = items.filter((x) => x.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  const [showDone, setShowDone] = useState(() => readOpenDone().includes(list.id));
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideClose(menu, menuRef, () => setMenu(false));

  // 标题
  const [name, setName] = useState(list.name);
  const editingName = useRef(false);
  useEffect(() => {
    if (!editingName.current) setName(list.name);
  }, [list.name]);
  const flushName = useAutosave(name, list.name, (v) => void updateList(list.id, { name: v }), 400);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus === `list:${list.id}`) {
      titleRef.current?.focus();
      onFocused();
    }
  }, [focus, list.id, onFocused]);

  // 添加条目
  const [draft, setDraft] = useState('');
  const addRef = useRef<HTMLInputElement>(null);
  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await createItem(list.id, text);
  };

  const toggleDone = () => {
    const next = !showDone;
    setShowDone(next);
    const ids = readOpenDone().filter((x) => x !== list.id);
    writeOpenDone(next ? [...ids, list.id] : ids);
  };

  const remove = async () => {
    setMenu(false);
    const snap = await deleteList(list.id);
    if (snap) showUndo(tr("已删除清单「{0}」", list.name || tr("无标题")), () => restoreKeep([snap.list], snap.items));
  };

  const clear = async () => {
    setMenu(false);
    const gone = await clearDone(list.id);
    if (gone.length) showUndo(tr("已清除 {0} 项已完成", gone.length), () => restoreKeep([], gone));
  };

  const listDrop = dragTarget?.kind === 'list';
  const dropBefore = listDrop && dragTarget.beforeId === list.id;
  const dropAfter = listDrop && dragTarget.beforeId === null && nextListId === null;
  const itemDropHere = dragTarget?.kind === 'item' && dragTarget.listId === list.id ? dragTarget : null;

  return (
    <section
      className={`keep-card${list.pinned ? ' is-pinned' : ''}${dropBefore ? ' is-drop-before' : ''}${dropAfter ? ' is-drop-after' : ''}${draggingId === list.id ? ' is-dragging' : ''}`}
      style={{ '--c': list.color } as CSSProperties}
      data-list-id={list.id}
      data-next-list={nextListId ?? ''}
      aria-label={list.name || tr("无标题")}
    >
      <header className="keep-head">
        <span
          className="keep-grip is-list"
          onPointerDown={(e) => onDragStart(e, 'list', list.id, list.name || tr("无标题"))}
          title={tr("拖动排序")}
          aria-hidden="true"
        >
          <Icon name="grip" />
        </span>
        <input
          ref={titleRef}
          className="keep-title"
          value={name}
          placeholder={tr("标题")}
          aria-label={tr("清单标题")}
          onFocus={() => (editingName.current = true)}
          onBlur={() => {
            editingName.current = false;
            flushName();
          }}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              flushName();
              addRef.current?.focus();
            }
          }}
        />
        <button
          type="button"
          className={`keep-icon${list.pinned ? ' is-on' : ''}`}
          aria-pressed={list.pinned}
          title={list.pinned ? tr("取消置顶（不再显示在首页）") : tr("置顶（显示在首页）")}
          aria-label={tr("置顶")}
          onClick={() => void updateList(list.id, { pinned: !list.pinned })}
        >
          <Icon name="pin" />
        </button>
        <div className="keep-menu-wrap" ref={menuRef}>
          <button type="button" className="keep-icon" aria-expanded={menu} aria-label={tr("更多操作")} title={tr("更多操作")} onClick={() => setMenu((m) => !m)}>
            <Icon name="more" />
          </button>
          {menu && (
            <div className="keep-menu" role="menu">
              <div className="keep-swatches" role="group" aria-label={tr("颜色")}>
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`swatch${c.toLowerCase() === list.color.toLowerCase() ? ' is-on' : ''}`}
                    style={{ background: c }}
                    aria-label={c}
                    onClick={() => void updateList(list.id, { color: c })}
                  />
                ))}
              </div>
              <button type="button" role="menuitem" className="keep-menu-item" disabled={done.length === 0} onClick={() => void clear()}>
                {tr("清除已完成（{0}）", done.length)}
              </button>
              <button type="button" role="menuitem" className="keep-menu-item is-danger" onClick={() => void remove()}>
                {tr("删除清单")}
              </button>
            </div>
          )}
        </div>
      </header>

      <ul className="keep-items">
        {open.map((it, i) => (
          <ItemRow
            key={it.id}
            item={it}
            prevId={open[i - 1]?.id ?? null}
            nextId={open[i + 1]?.id ?? null}
            now={now}
            focus={focus === it.id}
            onFocused={onFocused}
            onFocus={onFocus}
            highlight={highlight === it.id}
            dropBefore={itemDropHere?.beforeId === it.id}
            dragging={draggingId === it.id}
            onDragStart={onDragStart}
          />
        ))}
        {itemDropHere && itemDropHere.beforeId === null && <li className="keep-drop" aria-hidden="true" />}
      </ul>

      <div className="keep-add">
        <Icon name="plus" />
        <input
          ref={addRef}
          value={draft}
          placeholder={tr("添加条目")}
          aria-label={tr("添加条目到「{0}」", list.name || tr("无标题"))}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void add()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void add();
            }
          }}
        />
      </div>

      {done.length > 0 && (
        <div className="keep-done">
          <button type="button" className="keep-done-toggle" aria-expanded={showDone} onClick={toggleDone}>
            <Icon name={showDone ? 'down' : 'right'} />
            {tr("{0} 项已完成", done.length)}
          </button>
          {showDone && (
            <ul className="keep-items is-done">
              {done.map((it) => (
                <ItemRow key={it.id} item={it} prevId={null} nextId={null} now={now} focus={false} onFocused={onFocused} onFocus={onFocus} highlight={highlight === it.id} dropBefore={false} dragging={false} onDragStart={onDragStart} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ItemRow({
  item,
  prevId,
  nextId,
  now,
  focus,
  onFocused,
  onFocus,
  highlight,
  dropBefore,
  dragging,
  onDragStart,
}: {
  item: KeepItem;
  prevId: string | null;
  nextId: string | null;
  now: number;
  focus: boolean;
  onFocused: () => void;
  onFocus: (key: string) => void;
  highlight: boolean;
  dropBefore: boolean;
  dragging: boolean;
  onDragStart: (e: RPointerEvent, kind: 'item' | 'list', id: string, label: string) => void;
}) {
  const [text, setText] = useState(item.text);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(item.text);
  }, [item.text]);
  const flush = useAutosave(text, item.text, (v) => void updateItem(item.id, { text: v }), 400);
  const ref = useRef<HTMLTextAreaElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  useAutoHeight(ref, text);
  const [slotOpen, setSlotOpen] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  useOutsideClose(slotOpen, slotRef, () => setSlotOpen(false));

  useEffect(() => {
    if (!focus) return;
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    onFocused();
  }, [focus, onFocused]);

  useEffect(() => {
    if (highlight) rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight]);

  const onKey = async (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey && !item.done) {
      e.preventDefault();
      flush();
      // 在这一条后面新建一条
      const id = await createItem(item.listId, '');
      await moveItem(id, item.listId, nextId);
      onFocus(id);
    } else if (e.key === 'Backspace' && text === '' && !item.done) {
      e.preventDefault();
      await deleteItem(item.id);
      if (prevId) onFocus(prevId);
    }
  };

  const toggle = async () => {
    flush();
    await setItemDone(item.id, !item.done);
  };

  const remove = async () => {
    const snap = await deleteItem(item.id);
    if (snap && snap.text.trim()) showUndo(tr("已删除「{0}」", snap.text), () => restoreKeep([], [snap]));
  };

  return (
    <li
      ref={rowRef}
      className={`keep-item${item.done ? ' is-done' : ''}${highlight ? ' is-flash' : ''}${dropBefore ? ' is-drop-before' : ''}${dragging ? ' is-dragging' : ''}`}
      data-item-id={item.done ? undefined : item.id}
      data-next-id={nextId ?? ''}
      data-list-id={item.done ? undefined : item.listId}
    >
      {item.done ? (
        <span className="keep-grip is-blank" aria-hidden="true" />
      ) : (
        <span className="keep-grip" onPointerDown={(e) => onDragStart(e, 'item', item.id, text || '…')} title={tr("拖动排序")} aria-hidden="true">
          <Icon name="grip" />
        </span>
      )}
      <input type="checkbox" className="keep-check" checked={item.done} onChange={() => void toggle()} aria-label={item.done ? tr("标为未完成") : tr("标为完成")} />
      <div className="keep-body">
        <textarea
          ref={ref}
          rows={1}
          className="keep-text"
          value={text}
          aria-label={tr("条目内容")}
          onFocus={() => (editing.current = true)}
          onBlur={() => {
            editing.current = false;
            flush();
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => void onKey(e)}
        />
        {item.slot && !slotOpen && <SlotChip item={item} now={now} onClick={() => setSlotOpen(true)} />}
        {slotOpen && (
          <div ref={slotRef}>
            <SlotEditor item={item} onDone={() => setSlotOpen(false)} />
          </div>
        )}
      </div>
      <span className="keep-tools">
        {!item.slot && !item.done && (
          <button type="button" className="keep-icon" aria-expanded={slotOpen} title={tr("预约时间段")} aria-label={tr("预约时间段")} onClick={() => setSlotOpen((o) => !o)}>
            <Icon name="clock" />
          </button>
        )}
        <button type="button" className="keep-icon" title={tr("删除")} aria-label={tr("删除")} onClick={() => void remove()}>
          <Icon name="close" />
        </button>
      </span>
    </li>
  );
}
