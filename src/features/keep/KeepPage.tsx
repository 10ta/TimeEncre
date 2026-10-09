// Keep 页：清单卡片按顺序从左到右、从上到下排成几列（瀑布流），列数随宽度变化。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createList, moveItem, moveList } from '../../db/keep';
import { useNow } from '../../ui/hooks';
import { tr } from '../../i18n';
import { useKeepItems, useKeepLists } from './model';
import { KeepCard } from './KeepCard';
import { useKeepDrag, type DropTarget } from './dnd';

const COL_MIN_PX = 290;

/** 从日历点“将来的预约”跳过来：#/keep?item=<id> */
function readHighlight(): string | null {
  return new URLSearchParams(location.hash.split('?')[1] ?? '').get('item');
}

export function KeepPage() {
  const lists = useKeepLists();
  const items = useKeepItems();
  const now = useNow(30_000);
  const [focus, setFocus] = useState<string | null>(null);
  const onFocused = useCallback(() => setFocus(null), []);
  const [highlight, setHighlight] = useState<string | null>(readHighlight);
  useEffect(() => {
    if (!highlight) return;
    history.replaceState(null, '', '#/keep');
    const t = window.setTimeout(() => setHighlight(null), 2500);
    return () => window.clearTimeout(t);
  }, [highlight]);

  // 列数
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCols(Math.max(1, Math.floor(el.clientWidth / COL_MIN_PX))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [lists === undefined, (lists?.length ?? 0) === 0]);

  const onDrop = (kind: 'item' | 'list', id: string, t: DropTarget) => {
    if (kind === 'item' && t.kind === 'item') void moveItem(id, t.listId, t.beforeId);
    if (kind === 'list' && t.kind === 'list') void moveList(id, t.beforeId);
  };
  const { drag, start } = useKeepDrag(onDrop);

  const byList = useMemo(() => {
    const m = new Map<string, NonNullable<typeof items>>();
    for (const it of items ?? []) {
      const arr = m.get(it.listId) ?? [];
      arr.push(it);
      m.set(it.listId, arr);
    }
    return m;
  }, [items]);

  if (!lists || !items) return null;

  const newList = async () => {
    const id = await createList('');
    setFocus(`list:${id}`);
  };

  const columns: (typeof lists)[] = Array.from({ length: Math.min(cols, Math.max(1, lists.length)) }, () => []);
  lists.forEach((l, i) => columns[i % columns.length].push(l));

  return (
    <div className={`page keep-page${drag ? ' is-dragging' : ''}`}>
      <header className="page-head">
        <h1>Keep</h1>
        <button type="button" className="btn is-primary" onClick={() => void newList()}>
          {tr("＋ 新清单")}
        </button>
      </header>
      {lists.length === 0 ? (
        <div className="keep-empty" ref={wrapRef}>
          <p>{tr("还没有清单。清单里的条目可以勾选完成，也可以预约一个时间段；置顶的清单会显示在计时页。")}</p>
          <button type="button" className="btn" onClick={() => void newList()}>
            {tr("新建第一个清单")}
          </button>
        </div>
      ) : (
        <div className="keep-cols" ref={wrapRef}>
          {columns.map((col, ci) => (
            <div key={ci} className="keep-col">
              {col.map((l) => {
                const idx = lists.indexOf(l);
                return (
                  <KeepCard
                    key={l.id}
                    list={l}
                    items={byList.get(l.id) ?? []}
                    nextListId={lists[idx + 1]?.id ?? null}
                    now={now}
                    focus={focus}
                    onFocused={onFocused}
                    onFocus={setFocus}
                    highlight={highlight}
                    dragTarget={drag?.target ?? null}
                    draggingId={drag?.id ?? null}
                    onDragStart={start}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
      {drag && (
        <div className="keep-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }} aria-hidden="true">
          {drag.label}
        </div>
      )}
    </div>
  );
}
