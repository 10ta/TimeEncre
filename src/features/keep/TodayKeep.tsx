// 计时页上的 Keep：上面是今天的预约（含之前过期还没完成的），按时间排；下面是置顶清单里未完成的条目。
// 已经开始、已经过期的预约用不同的颜色和字样标出来。
import { useState, type CSSProperties } from 'react';
import { createItem, restoreKeep, setItemDone } from '../../db/keep';
import { useNow } from '../../ui/hooks';
import { showUndo } from '../../ui/undo';
import { addDays, startOfDay } from '../../lib/time';
import type { KeepItem, KeepList } from '../../schema';
import { tr } from '../../i18n';
import { listMap, slotMs, slotState, useKeepItems, useKeepLists } from './model';
import { SlotChip } from './KeepCard';

/** 每个置顶清单在首页最多显示几条 */
const PER_LIST = 6;

export function TodayKeep() {
  const lists = useKeepLists();
  const items = useKeepItems();
  const now = useNow(30_000);
  if (!lists || !items || lists.length === 0) return null;

  const lm = listMap(lists);
  const dayStart = startOfDay(now);
  const dayEnd = addDays(dayStart, 1);
  // 今天的预约：时间段和今天有交集的；以及之前就过期、还没完成的
  const scheduled = items
    .filter((it) => {
      const s = slotMs(it);
      if (!s || !lm.has(it.listId)) return false;
      if (s.start < dayEnd && s.end > dayStart) return true;
      return !it.done && s.end <= dayStart;
    })
    .sort((a, b) => slotMs(a)!.start - slotMs(b)!.start);
  const shown = new Set(scheduled.map((x) => x.id));
  const pinned = lists.filter((l) => l.pinned);

  return (
    <section className="today-keep" aria-labelledby="today-keep-title">
      <header className="today-head">
        <h2 id="today-keep-title">Keep</h2>
        <a className="section-link" href="#/keep">{tr("查看全部 ›")}</a>
      </header>
      {scheduled.length > 0 && (
        <div className="tk-block">
          <h3 className="tk-sub">{tr("今天的预约")}</h3>
          <ul className="tk-list">
            {scheduled.map((it) => (
              <TkRow key={it.id} item={it} list={lm.get(it.listId)!} now={now} withList />
            ))}
          </ul>
        </div>
      )}
      {pinned.map((l) => (
        <PinnedList key={l.id} list={l} items={items.filter((it) => it.listId === l.id && !it.done && !shown.has(it.id))} now={now} />
      ))}
      {scheduled.length === 0 && pinned.length === 0 && (
        <p className="hint">{tr("今天没有预约。置顶的清单会显示在这里。")}</p>
      )}
    </section>
  );
}

function TkRow({ item, list, now, withList }: { item: KeepItem; list: KeepList; now: number; withList?: boolean }) {
  const st = slotState(item, now);
  const toggle = async () => {
    const was = item.done;
    await setItemDone(item.id, !was);
    if (!was) showUndo(tr("已完成「{0}」", item.text || '…'), () => restoreKeep([], [{ ...item, done: false, doneAt: null }]));
  };
  return (
    <li className={`tk-item${st ? ` is-${st}` : ''}${item.done ? ' is-done' : ''}`} style={{ '--c': list.color } as CSSProperties}>
      <input type="checkbox" className="keep-check" checked={item.done} onChange={() => void toggle()} aria-label={item.done ? tr("标为未完成") : tr("标为完成")} />
      <a className="tk-text" href={`#/keep?item=${item.id}`}>
        {item.text || '…'}
      </a>
      {withList && (
        <span className="tk-list-name">
          <span className="tk-dot" aria-hidden="true" />
          {list.name || tr("无标题")}
        </span>
      )}
      {item.slot && <SlotChip item={item} now={now} />}
    </li>
  );
}

function PinnedList({ list, items, now }: { list: KeepList; items: KeepItem[]; now: number }) {
  const [draft, setDraft] = useState('');
  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await createItem(list.id, text);
  };
  const more = items.length - PER_LIST;
  return (
    <div className="tk-block tk-pinned" style={{ '--c': list.color } as CSSProperties}>
      <h3 className="tk-sub">
        <span className="tk-dot" aria-hidden="true" />
        {list.name || tr("无标题")}
      </h3>
      <ul className="tk-list">
        {items.slice(0, PER_LIST).map((it) => (
          <TkRow key={it.id} item={it} list={list} now={now} />
        ))}
      </ul>
      {more > 0 && (
        <a className="tk-more" href="#/keep">
          {tr("还有 {0} 项 ›", more)}
        </a>
      )}
      <input
        className="tk-add"
        value={draft}
        placeholder={tr("＋ 添加条目")}
        aria-label={tr("添加条目到「{0}」", list.name || tr("无标题"))}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void add();
          }
        }}
      />
    </div>
  );
}
