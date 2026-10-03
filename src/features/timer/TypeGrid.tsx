import type { CSSProperties } from 'react';
import type { CatalogItem } from '../../schema';
import type { DbRecord } from '../../db/db';
import { toggleType } from '../../db/actions';
import { useLongPress, useNow } from '../../ui/hooks';
import { formatClock, recordSpans, totalMs } from '../../lib/time';

export function TypeGrid({
  types,
  actives,
  onOptions,
}: {
  types: CatalogItem[];
  actives: DbRecord[];
  onOptions: (typeId: string) => void;
}) {
  const now = useNow(1000, actives.length > 0);
  const latestByType = new Map<string, DbRecord>();
  for (const r of actives) if (!latestByType.has(r.typeId)) latestByType.set(r.typeId, r);

  return (
    <ul className="type-grid">
      {types.map((t) => (
        <Tile key={t.id} type={t} active={latestByType.get(t.id)} now={now} onOptions={() => onOptions(t.id)} />
      ))}
    </ul>
  );
}

function Tile({
  type,
  active,
  now,
  onOptions,
}: {
  type: CatalogItem;
  active?: DbRecord;
  now: number;
  onOptions: () => void;
}) {
  const press = useLongPress(onOptions, () => void toggleType(type.id));
  const stateLabel = active ? (active.state === 'running' ? '计时中，点击停止' : '已暂停，点击继续') : '点击开始';
  return (
    <li>
      <button
        type="button"
        className={`tile${active ? ` is-${active.state}` : ''}`}
        style={{ '--c': type.color } as CSSProperties}
        aria-label={`${type.name}，${stateLabel}`}
        title={`${stateLabel}；长按或右键：带备注和标签开始`}
        {...press}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            onOptions();
          }
        }}
      >
        <span className="tile-emoji" aria-hidden="true">{type.emoji}</span>
        <span className="tile-name">{type.name}</span>
        {active && <span className="tile-time">{formatClock(totalMs(recordSpans(active, now)))}</span>}
      </button>
    </li>
  );
}
