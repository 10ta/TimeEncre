// 日期 + 时刻输入，值是所选时区里的墙上时间 “YYYY-MM-DDTHH:MM”（和以前的 datetime-local 一样）。
// 时刻用自己的文本框，好按设置显示 12 / 24 小时制：浏览器自带的时间框只跟随系统区域设置。
// 边输边生效（输完整时），失焦或回车时再按输入整理一次；输错了失焦后恢复原值。
// ↑ / ↓ 调一分钟，按住 Shift 调十分钟。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getHour12 } from '../lib/zone';
import { parseTime } from '../lib/timeinput';
import { fromLocalInput, toLocalInput } from '../lib/time';
import { tr } from '../i18n';

const pad2 = (n: number) => String(n).padStart(2, '0');

function split(value: string) {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  return m ? { date: m[1], h: +m[2], mi: +m[3] } : null;
}

/** 文本框里显示的时刻：24 小时制 “21:30”，12 小时制 “9:30”（半天由旁边的按钮显示） */
function display(h: number, mi: number, h12: boolean) {
  return h12 ? `${h % 12 === 0 ? 12 : h % 12}:${pad2(mi)}` : `${pad2(h)}:${pad2(mi)}`;
}

export function DateTimeField({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 时刻框的无障碍名称；日期框是“{label}（日期）” */
  label: string;
  className?: string;
}) {
  const h12 = getHour12();
  const cur = split(value);
  const shown = cur ? display(cur.h, cur.mi, h12) : '';
  const [draft, setDraft] = useState(shown);
  const [bad, setBad] = useState(false);
  const focused = useRef(false);

  // 外部改了值（快捷按钮、拖动等）且没在输入时，跟着更新
  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);

  const emit = (date: string, h: number, mi: number) => {
    const next = `${date}T${pad2(h)}:${pad2(mi)}`;
    if (next !== value) onChange(next);
  };

  const pm = cur ? cur.h >= 12 : false;

  const typeTime = (raw: string) => {
    setDraft(raw);
    setBad(false);
    const p = parseTime(raw, h12 ? pm : null);
    if (p?.complete && cur) emit(cur.date, p.h, p.mi);
  };

  const settle = () => {
    focused.current = false;
    const p = parseTime(draft, h12 ? pm : null);
    if (!p || !cur) {
      setBad(draft.trim() !== '');
      setDraft(shown);
      return;
    }
    emit(cur.date, p.h, p.mi);
    setDraft(display(p.h, p.mi, h12));
  };

  const step = (minutes: number) => {
    const ms = fromLocalInput(value);
    if (Number.isNaN(ms)) return;
    const next = toLocalInput(ms + minutes * 60_000);
    onChange(next);
    const s = split(next);
    if (s) setDraft(display(s.h, s.mi, h12));
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      settle();
      focused.current = true;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      step((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
    }
  };

  return (
    <span className={`dtf${className ? ` ${className}` : ''}`}>
      <input
        type="date"
        className="dtf-date"
        aria-label={tr("{0}（日期）", label)}
        value={cur?.date ?? ''}
        onChange={(e) => {
          // 清空日期不算数：保留原来的日期
          if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && cur) emit(e.target.value, cur.h, cur.mi);
        }}
      />
      <input
        type="text"
        className={`dtf-time${bad ? ' is-bad' : ''}`}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder={h12 ? 'h:mm' : 'HH:MM'}
        aria-label={label}
        aria-invalid={bad || undefined}
        title={tr("例如 9:30、930、21h30；↑↓ 调一分钟")}
        value={draft}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => typeTime(e.target.value)}
        onBlur={settle}
        onKeyDown={onKey}
      />
      {h12 && (
        <button
          type="button"
          className="dtf-ampm"
          aria-label={tr("切换上午 / 下午，当前{0}", pm ? tr("下午") : tr("上午"))}
          onClick={() => cur && emit(cur.date, (cur.h + 12) % 24, cur.mi)}
        >
          {pm ? tr("下午") : tr("上午")}
        </button>
      )}
    </span>
  );
}
