import { useEffect, useState, type CSSProperties } from 'react';
import { useActiveRecords, useTagMap, useTypeMap } from '../../db/hooks';
import { pauseRecord, resumeRecord, stopRecord } from '../../db/actions';
import { useNow } from '../../ui/hooks';
import { IconButton } from '../../ui/Icon';
import { formatClock, recordSpans, totalMs } from '../../lib/time';
import { Drawer } from '../../ui/Drawer';
import { LiveRecordForm } from '../records/RecordForms';
import { fromDb } from '../../db/db';

/**
 * 进行中的记录。section：计时页上的一组卡片；strip：其他页面顶部的紧凑横条。
 * 没有进行中的记录时整块不显示。点卡片任意位置在卡片内展开编辑，暂停/停止按钮除外；
 * 横条上点击则跳回计时页，并展开那条记录（#/timer?edit=<id>）。
 */
export function RunningPanel({ variant }: { variant: 'section' | 'strip' }) {
  const actives = useActiveRecords();
  const typeMap = useTypeMap();
  const tagMap = useTagMap();
  const now = useNow(1000, !!actives?.length);
  const [editing, setEditing] = useState<string | null>(null);

  // 从其他页面的横条跳过来时，展开指定的记录，然后把地址恢复成 #/timer
  useEffect(() => {
    if (variant !== 'section') return;
    const apply = () => {
      const m = location.hash.match(/[?&]edit=([^&]+)/);
      if (!m) return;
      setEditing(decodeURIComponent(m[1]));
      history.replaceState(null, '', '#/timer');
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [variant]);

  if (!actives || !typeMap || !tagMap || actives.length === 0) return null;

  return (
    <section className={`running running-${variant}`} aria-label="进行中">
      <ul className="run-list">
        {actives.map((r) => {
          const type = typeMap.get(r.typeId);
          const tags = r.tagIds.map((id) => tagMap.get(id)).filter((t) => t && !t.deleted);
          const name = type?.name ?? '未知类型';
          const inline = variant === 'section';
          const open = inline && editing === r.id;
          return (
            <li key={r.id} className={`run is-${r.state}${open ? ' is-open' : ''}`} style={{ '--c': type?.color ?? '#888' } as CSSProperties}>
              {/* 这个按钮通过 ::after 铺满整张卡片，所以点卡片任何位置都会打开编辑 */}
              <button
                type="button"
                className="run-main"
                onClick={() =>
                  inline ? setEditing(editing === r.id ? null : r.id) : (location.hash = `#/timer?edit=${encodeURIComponent(r.id)}`)
                }
                aria-label={inline ? `编辑 ${name}` : `到计时页编辑 ${name}`}
                aria-expanded={inline ? open : undefined}
              >
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
              {inline && (
                <Drawer open={open} onClose={() => setEditing(null)}>
                  <LiveRecordForm rec={fromDb(r)} onClose={() => setEditing(null)} />
                </Drawer>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
