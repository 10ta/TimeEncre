// 通用的“已完成 · 撤销”提示：任何地方调用 showUndo，界面右上角显示几秒。
type Item = { id: number; message: string; undo: () => void | Promise<void> };
type Listener = (item: Item | null) => void;

let seq = 0;
const listeners = new Set<Listener>();

export function showUndo(message: string, undo: () => void | Promise<void>) {
  const item = { id: ++seq, message, undo };
  listeners.forEach((l) => l(item));
}

export function onUndo(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
