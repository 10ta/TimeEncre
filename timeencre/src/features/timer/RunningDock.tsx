// 进行中的计时：所有页面底部的同一条悬浮栏，不占页面布局，出现 / 消失不会让页面内容移动。
// 点某一项，在它上方弹出编辑面板（任何页面都一样）；暂停 / 停止按钮直接操作。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useActiveRecords, useTagMap, useTypeMap } from '../../db/hooks';
import { pauseRecord, resumeRecord, stopRecord } from '../../db/actions';
import { fromDb } from '../../db/db';
import { useNow } from '../../ui/hooks';
import { IconButton } from '../../ui/Icon';
import { useOutsideClose } from '../../ui/useOutsideClose';
import { commitAndClose } from '../../ui/commitAndClose';
import { formatClock, recordSpans, totalMs } from '../../lib/time';
import { LiveRecordForm } from '../records/RecordForms';

export function RunningDock() {
  const actives = useActiveRecords();
  const typeMap = useTypeMap();
  const tagMap = useTagMap();
  const now = useNow(1000, !!actives?.length);
  const [openId, setOpenId] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const count = actives?.length ?? 0;

  // 有悬浮栏时给页面底部留出滚动余量（只加长可滚动区域，不移动可见内容）
  useEffect(() => {
    document.body.classList.toggle('has-dock', count > 0);
    return () => document.body.classList.remove('has-dock');
  }, [count]);

  const open = actives?.find((r) => r.id === openId);
  useEffect(() => {
    if (openId && actives && !open) setOpenId(null); // 记录已停止
  }, [openId, actives, open]);
  useOutsideClose(!!open, sheetRef, () => setOpenId(null));

  if (!actives || !typeMap || !tagMap || count === 0) return null;
  const openType = open ? typeMap.get(open.typeId) : undefined;

  return (
    <div className="dock" role="region" aria-label="进行中">
      {open && (
        <div
          ref={sheetRef}
          className="dock-sheet"
          style={{ '--c': openType?.color ?? '#888' } as CSSProperties}
          onKeyDown={(e) => e.key === 'Escape' && commitAndClose(sheetRef.current, () => setOpenId(null))}
        >
          <header className="dock-sheet-head">
            <span className="run-emoji" aria-hidden="true">{openType?.emoji ?? '❔'}</span>
            <strong>{openType?.name ?? '未知活动'}</strong>
            <span className="dock-sheet-clock">{formatClock(totalMs(recordSpans(open, now)))}</span>
          </header>
          <LiveRecordForm key={open.id} rec={fromDb(open)} onClose={() => setOpenId(null)} />
        </div>
      )}
      <ul className="dock-items">
        {actives.map((r) => {
          const type = typeMap.get(r.typeId);
          const name = type?.name ?? '未知活动';
          const tags = r.tagIds.map((id) => tagMap.get(id)).filter((t) => t && !t.deleted);
          return (
            <li
              key={r.id}
              className={`dock-item is-${r.state}${openId === r.id ? ' is-open' : ''}`}
              style={{ '--c': type?.color ?? '#888' } as CSSProperties}
            >
              <button
                type="button"
                className="dock-main"
                aria-expanded={openId === r.id}
                aria-label={`编辑 ${name}`}
                onClick={() =>
                  openId ? commitAndClose(sheetRef.current, () => setOpenId(openId === r.id ? null : r.id)) : setOpenId(r.id)
                }
              >
                <span className="run-emoji" aria-hidden="true">{type?.emoji ?? '❔'}</span>
                <span className="dock-text">
                  <span className="dock-name">
                    {name}
                    {r.state === 'paused' && <span className="badge">已暂停</span>}
                  </span>
                  {(tags.length > 0 || r.comment) && (
                    <span className="dock-meta">
                      {tags.map((t) => `${t!.emoji}${t!.name}`).join(' ')}
                      {tags.length > 0 && r.comment ? ' · ' : ''}
                      {r.comment}
                    </span>
                  )}
                </span>
                <span className="dock-clock">{formatClock(totalMs(recordSpans(r, now)))}</span>
              </button>
              <span className="dock-actions">
                {r.state === 'running' ? (
                  <IconButton icon="pause" label="暂停" onClick={() => void pauseRecord(r.id)} />
                ) : (
                  <IconButton icon="play" label="继续" onClick={() => void resumeRecord(r.id)} />
                )}
                <IconButton icon="stop" label="停止" tone="danger" onClick={() => void stopRecord(r.id)} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
