import { useState, type CSSProperties } from 'react';
import { useActiveRecords, useTagMap, useTypeMap } from '../../db/hooks';
import { pauseRecord, resumeRecord, stopRecord } from '../../db/actions';
import { useNow } from '../../ui/hooks';
import { IconButton } from '../../ui/Icon';
import { formatClock, recordSpans, totalMs } from '../../lib/time';
import { RecordDialog } from './RecordDialog';

/**
 * 进行中的记录。section：计时页上的一组卡片；strip：其他页面顶部的紧凑横条。
 * 没有进行中的记录时整块不显示。点卡片任意位置编辑，暂停/停止按钮除外。
 */
export function RunningPanel({ variant }: { variant: 'section' | 'strip' }) {
  const actives = useActiveRecords();
  const typeMap = useTypeMap();
  const tagMap = useTagMap();
  const now = useNow(1000, !!actives?.length);
  const [editing, setEditing] = useState<string | null>(null);

  if (!actives || !typeMap || !tagMap || actives.length === 0) return null;

  return (
    <section className={`running running-${variant}`} aria-label="进行中">
      <ul className="run-list">
        {actives.map((r) => {
          const type = typeMap.get(r.typeId);
          const tags = r.tagIds.map((id) => tagMap.get(id)).filter((t) => t && !t.deleted);
          const name = type?.name ?? '未知类型';
          return (
            <li key={r.id} className={`run is-${r.state}`} style={{ '--c': type?.color ?? '#888' } as CSSProperties}>
              {/* 这个按钮通过 ::after 铺满整张卡片，所以点卡片任何位置都会打开编辑 */}
              <button type="button" className="run-main" onClick={() => setEditing(r.id)} aria-label={`编辑 ${name}`}>
                <span className="run-emoji" aria-hidden="true">{type?.emoji ?? '❔'}</span>
                <span className="run-text">
                  <span className="run-name">
                    {name}
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
