import { useState, type CSSProperties } from 'react';
import { useActiveRecords, useTagMap, useTypeMap } from '../../db/hooks';
import { pauseRecord, resumeRecord, stopRecord } from '../../db/actions';
import { useNow } from '../../ui/hooks';
import { IconButton } from '../../ui/Icon';
import { formatClock, recordSpans, totalMs } from '../../lib/time';
import { RecordDialog } from './RecordDialog';

/** side：大屏右侧常驻面板；strip：窄屏顶部横条（没有进行中的计时就不显示） */
export function RunningPanel({ variant }: { variant: 'side' | 'strip' }) {
  const actives = useActiveRecords();
  const typeMap = useTypeMap();
  const tagMap = useTagMap();
  const now = useNow(1000, !!actives?.length);
  const [editing, setEditing] = useState<string | null>(null);

  if (!actives || !typeMap || !tagMap) return null;
  if (variant === 'strip' && actives.length === 0) return null;

  return (
    <section className={`running running-${variant}`} aria-label="进行中">
      {variant === 'side' && (
        <h2 className="running-title">
          进行中{actives.length > 0 && <span className="count">{actives.length}</span>}
        </h2>
      )}
      {variant === 'side' && actives.length === 0 && (
        <p className="empty">点任意一个类型开始计时。长按或右键可以先填备注和标签。</p>
      )}
      <ul className="run-list">
        {actives.map((r) => {
          const type = typeMap.get(r.typeId);
          const tags = r.tagIds.map((id) => tagMap.get(id)).filter((t) => t && !t.deleted);
          return (
            <li key={r.id} className={`run is-${r.state}`} style={{ '--c': type?.color ?? '#888' } as CSSProperties}>
              <button type="button" className="run-main" onClick={() => setEditing(r.id)} title="编辑备注、标签、开始时间">
                <span className="run-emoji" aria-hidden="true">{type?.emoji ?? '❔'}</span>
                <span className="run-text">
                  <span className="run-name">
                    {type?.name ?? '未知类型'}
                    {r.state === 'paused' && <span className="badge">已暂停</span>}
                  </span>
                  {tags.length > 0 && (
                    <span className="run-tags">
                      {tags.map((t) => (
                        <span key={t!.id}>
                          {t!.emoji}
                          {t!.name}
                        </span>
                      ))}
                    </span>
                  )}
                  {r.comment && <span className="run-meta">{r.comment}</span>}
                </span>
              </button>
              <span className="run-clock">{formatClock(totalMs(recordSpans(r, now)))}</span>
              <span className="run-actions">
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
      {editing && <RecordDialog mode="edit" recordId={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
