import type { CSSProperties } from 'react';
import type { CatalogItem } from '../../schema';
import type { DbRecord } from '../../db/db';
import { toggleType } from '../../db/actions';
import { useLongPress, useNow } from '../../ui/hooks';
import { formatClock, recordSpans, totalMs } from '../../lib/time';
import { tr } from '../../i18n';

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
      <li>
        <a className="tile is-manage" href="#/catalog" title={tr("增删、排序、归档活动和标签")}>
          <span className="tile-emoji" aria-hidden="true">⚙️</span>
          <span className="tile-name">{tr("管理")}</span>
        </a>
      </li>
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
  const stateLabel = active ? (active.state === 'running' ? tr("计时中，点击停止") : tr("已暂停，点击继续")) : tr("点击开始");
  return (
    <li>
      <button
        type="button"
        className={`tile${active ? ` is-${active.state}` : ''}`}
        style={{ '--c': type.color } as CSSProperties}
        aria-label={tr("{0}，{1}", type.name, stateLabel)}
        title={tr("{0}；长按或右键：带备注和标签开始", stateLabel)}
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
        {/* 时间这一行始终占位，开始 / 停止计时不会改变格子高度、带动下面的内容移动 */}
        <span className={`tile-time${active ? '' : ' is-empty'}`} aria-hidden={!active}>
          {active ? formatClock(totalMs(recordSpans(active, now))) : '00:00:00'}
        </span>
      </button>
    </li>
  );
}
