// 计时页顶部：此刻有例程、而且没在做那件事时，提示一行，点一下开始。
import { type CSSProperties } from 'react';
import { useActiveRecords, useRoutines, useTypeMap } from '../../db/hooks';
import { toggleType } from '../../db/actions';
import { currentBlocks } from '../../lib/routines';
import { useNow } from '../../ui/hooks';
import { clockRange } from '../../i18n/dates';
import { tr } from '../../i18n';

export function RoutineNow() {
  const routines = useRoutines();
  const actives = useActiveRecords();
  const typeMap = useTypeMap();
  const now = useNow(30_000);
  if (!routines || !actives || !typeMap) return null;
  const running = new Set(actives.filter((r) => r.state === 'running').map((r) => r.typeId));
  const due = currentBlocks(routines, now).filter((b) => !running.has(b.routine.typeId) && typeMap.has(b.routine.typeId));
  if (!due.length) return null;
  return (
    <ul className="routine-now" aria-label={tr("现在的例程")}>
      {due.map((b) => {
        const t = typeMap.get(b.routine.typeId)!;
        return (
          <li key={`${b.routine.id}@${b.start}`} style={{ '--c': t.color } as CSSProperties}>
            <span>
              {tr("按计划现在是 {0}", `${t.emoji} ${t.name}`)}
              <small>{clockRange(b.start, b.end)}</small>
            </span>
            <button type="button" className="btn is-small is-primary" onClick={() => void toggleType(t.id)}>
              {tr("开始")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
