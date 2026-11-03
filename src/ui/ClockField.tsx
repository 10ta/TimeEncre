// 只有时刻（没有日期）的输入框，值是一天中的分钟数 0–1439。和 DateTimeField 的时刻框同一套解析和 12/24 小时制。
// 边输边生效（输完整时），失焦或回车时再整理一次；输错了失焦后恢复原值。↑ / ↓ 调五分钟。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getHour12 } from '../lib/zone';
import { parseTime } from '../lib/timeinput';
import { tr } from '../i18n';

const pad2 = (n: number) => String(n).padStart(2, '0');

function display(min: number, h12: boolean) {
  const h = Math.floor(min / 60);
  const mi = min % 60;
  return h12 ? `${h % 12 === 0 ? 12 : h % 12}:${pad2(mi)}` : `${pad2(h)}:${pad2(mi)}`;
}

export function ClockField({ value, onChange, label }: { value: number; onChange: (min: number) => void; label: string }) {
  const h12 = getHour12();
  const shown = display(value, h12);
  const [draft, setDraft] = useState(shown);
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  const pm = value >= 720;

  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);

  const emit = (min: number) => {
    const m = ((min % 1440) + 1440) % 1440;
    if (m !== value) onChange(m);
  };

  const settle = () => {
    focused.current = false;
    const p = parseTime(draft, h12 ? pm : null);
    if (!p) {
      setBad(draft.trim() !== '');
      setDraft(shown);
      return;
    }
    emit(p.h * 60 + p.mi);
    setDraft(display(p.h * 60 + p.mi, h12));
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      settle();
      focused.current = true;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (((value + (e.key === 'ArrowUp' ? 5 : -5)) % 1440) + 1440) % 1440;
      onChange(next);
      setDraft(display(next, h12));
    }
  };

  return (
    <span className="dtf is-clock">
      <input
        type="text"
        className={`dtf-time${bad ? ' is-bad' : ''}`}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder={h12 ? 'h:mm' : 'HH:MM'}
        aria-label={label}
        aria-invalid={bad || undefined}
        value={draft}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setBad(false);
          const p = parseTime(e.target.value, h12 ? pm : null);
          if (p?.complete) emit(p.h * 60 + p.mi);
        }}
        onBlur={settle}
        onKeyDown={onKey}
      />
      {h12 && (
        <button
          type="button"
          className="dtf-ampm"
          aria-label={tr("切换上午 / 下午，当前{0}", pm ? tr("下午") : tr("上午"))}
          onClick={() => emit(value + 720)}
        >
          {pm ? tr("下午") : tr("上午")}
        </button>
      )}
    </span>
  );
}
