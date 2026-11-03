// 计时页上的“今天感觉怎么样”：1–5 分一键打分，每档一句话说明是什么感觉。再点一次同一个就清除。
// 上午还没给昨天打分的话，多显示一行“昨天”。评分随同步保存，周复盘拿它找关联。
import { useState } from 'react';
import { useRatings } from '../../db/hooks';
import { setRating } from '../../db/daily';
import { useNow } from '../../ui/hooks';
import { addDays, startOfDay } from '../../lib/time';
import { dayKey, zparts } from '../../lib/zone';
import { tr } from '../../i18n';

export const SCORES = [
  { score: 1, emoji: '😫', label: tr("很糟"), feel: tr("累、烦，什么都不顺") },
  { score: 2, emoji: '😕', label: tr("偏差"), feel: tr("有点低落或没劲") },
  { score: 3, emoji: '😐', label: tr("一般"), feel: tr("平平常常") },
  { score: 4, emoji: '🙂', label: tr("不错"), feel: tr("顺利，有收获") },
  { score: 5, emoji: '😄', label: tr("很好"), feel: tr("状态极佳，很满足") },
] as const;

export function DayRating() {
  const ratings = useRatings();
  const now = useNow(60_000);
  if (!ratings) return null;
  const today = dayKey(now);
  const yesterday = dayKey(addDays(startOfDay(now), -1));
  const askYesterday = !ratings.has(yesterday) && zparts(now).h < 12;
  return (
    <section className="day-rating" aria-label={tr("每日感受")}>
      {askYesterday && <RatingRow day={yesterday} label={tr("昨天感觉怎么样？")} value={undefined} />}
      <RatingRow day={today} label={tr("今天感觉怎么样？")} value={ratings.get(today)} />
    </section>
  );
}

function RatingRow({ day, label, value }: { day: string; label: string; value: number | undefined }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = SCORES.find((s) => s.score === (hover ?? value));
  return (
    <div className="rating-row">
      <span className="rating-label">{label}</span>
      <span className="rating-faces" role="radiogroup" aria-label={label}>
        {SCORES.map((s) => (
          <button
            key={s.score}
            type="button"
            role="radio"
            aria-checked={value === s.score}
            className={`face${value === s.score ? ' is-on' : ''}`}
            title={tr("{0}：{1}", s.label, s.feel)}
            onPointerEnter={() => setHover(s.score)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(s.score)}
            onBlur={() => setHover(null)}
            onClick={() => void setRating(day, value === s.score ? null : s.score)}
          >
            <span aria-hidden="true">{s.emoji}</span>
            <span className="sr-only">{s.label}</span>
          </button>
        ))}
      </span>
      <span className="rating-feel" aria-live="polite">
        {shown ? (
          <>
            <b>{shown.label}</b> {shown.feel}
          </>
        ) : (
          <span className="hint">{tr("点一个表情就行，周复盘会用它找关联")}</span>
        )}
      </span>
    </div>
  );
}
