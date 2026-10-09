// Keep 的拖动排序：按住条目左侧的把手拖到别的位置（可以拖到别的清单），按住卡片标题旁的把手给清单排序。
// 用指针事件自己实现（HTML5 拖放在触屏上不可用）：把手设了 touch-action: none，手指按下即可拖，不用长按。
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';

export type DropTarget =
  | { kind: 'item'; listId: string; beforeId: string | null }
  | { kind: 'list'; beforeId: string | null };

export interface DragState {
  kind: 'item' | 'list';
  id: string;
  label: string;
  x: number;
  y: number;
  target: DropTarget | null;
}

const THRESHOLD = 4;

/** 指针下面的放置位置：条目按上下半边决定插在它前面还是后面；落在卡片空白处就放到最后 */
function targetAt(kind: 'item' | 'list', x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (kind === 'item') {
    const row = el.closest<HTMLElement>('[data-item-id]');
    if (row?.dataset.listId) {
      const r = row.getBoundingClientRect();
      const before = y < r.top + r.height / 2 ? row.dataset.itemId! : row.dataset.nextId || null;
      return { kind: 'item', listId: row.dataset.listId, beforeId: before };
    }
    const card = el.closest<HTMLElement>('[data-list-id]');
    return card ? { kind: 'item', listId: card.dataset.listId!, beforeId: null } : null;
  }
  const card = el.closest<HTMLElement>('[data-list-id]');
  if (!card) return null;
  const r = card.getBoundingClientRect();
  return { kind: 'list', beforeId: y < r.top + r.height / 2 ? card.dataset.listId! : card.dataset.nextList || null };
}

export function useKeepDrag(onDrop: (kind: 'item' | 'list', id: string, target: DropTarget) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const pending = useRef<{ kind: 'item' | 'list'; id: string; label: string; x0: number; y0: number; active: boolean } | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const stateRef = useRef<DragState | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p) return;
      if (!p.active) {
        if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < THRESHOLD) return;
        p.active = true;
      }
      const next: DragState = { kind: p.kind, id: p.id, label: p.label, x: e.clientX, y: e.clientY, target: targetAt(p.kind, e.clientX, e.clientY) };
      // 拖到自己身上等于没动
      if (next.target && next.target.beforeId === p.id) next.target = null;
      stateRef.current = next;
      setDrag(next);
      // 靠近窗口上下边缘时滚动页面
      const edge = 48;
      if (e.clientY < edge) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
    };
    const end = (commit: boolean) => {
      const s = stateRef.current;
      pending.current = null;
      stateRef.current = null;
      setDrag(null);
      if (commit && s?.target) dropRef.current(s.kind, s.id, s.target);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && pending.current && end(false);
    const touch = (e: TouchEvent) => pending.current?.active && e.preventDefault();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    window.addEventListener('touchmove', touch, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('touchmove', touch);
    };
  }, []);

  const start = (e: RPointerEvent, kind: 'item' | 'list', id: string, label: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pending.current = { kind, id, label, x0: e.clientX, y0: e.clientY, active: false };
  };

  return { drag, start };
}
