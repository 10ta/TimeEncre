// 让别处（例如计时页的格子）打开底部进行中栏里某条记录的编辑面板
type Listener = (recordId: string) => void;
const listeners = new Set<Listener>();

export function openRecordSheet(recordId: string) {
  listeners.forEach((l) => l(recordId));
}

export function onOpenRecordSheet(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
