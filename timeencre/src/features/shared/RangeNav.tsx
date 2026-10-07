import type { ReactNode } from 'react';
import { IconButton } from '../../ui/Icon';
import { rangeContains, rangeLabel, type Range, type RangeMode } from '../../lib/range';

const MODES: Array<[RangeMode, string]> = [
  ['day', '日'],
  ['week', '周'],
  ['month', '月'],
];

/** 日/周/月切换 + 前后翻页 + 回到今天。历史页和统计页共用 */
export function RangeNav({
  range,
  now,
  onMode,
  onShift,
  onToday,
  summary,
}: {
  range: Range;
  now: number;
  onMode: (m: RangeMode) => void;
  onShift: (dir: -1 | 1) => void;
  onToday: () => void;
  summary?: ReactNode;
}) {
  const isCurrent = rangeContains(range, now);
  return (
    <div className="range-nav">
      <div className="tabs" role="tablist" aria-label="时间范围">
        {MODES.map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={range.mode === m} className={range.mode === m ? 'is-on' : undefined} onClick={() => onMode(m)}>
            {label}
          </button>
        ))}
      </div>
      <div className="range-step">
        <IconButton icon="left" label="上一页" onClick={() => onShift(-1)} />
        <div className="range-label">
          <span className="range-title">{rangeLabel(range, now)}</span>
          {summary && <span className="range-summary">{summary}</span>}
        </div>
        {isCurrent ? (
          <span className="icon-btn is-placeholder" aria-hidden="true" />
        ) : (
          <IconButton icon="right" label="下一页" onClick={() => onShift(1)} />
        )}
      </div>
      {!isCurrent && (
        <button type="button" className="btn is-small" onClick={onToday}>
          回到今天
        </button>
      )}
    </div>
  );
}
