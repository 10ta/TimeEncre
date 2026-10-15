import { useState } from 'react';
import { EMOJI_PRESETS, PALETTE } from '../db/defaults';
import { quickCreateTag } from '../db/actions';
import { lastGrapheme, looksLikeEmoji } from '../lib/grapheme';
import { useTags } from '../db/hooks';
import { tr } from '../i18n';

export function EmojiField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // 输入法组字期间先暂存，组字结束后再取字形，避免把拼音字母当成图标
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const commit = (raw: string) => {
    const g = lastGrapheme(raw);
    setDraft('');
    if (!g) return;
    onChange(g);
    setNote(looksLikeEmoji(g) ? null : tr("“{0}”不是 emoji，也可以用，只是在不同设备上外观可能不统一。", g));
  };
  return (
    <div className="field">
      <span className="field-label">{tr("图标")}</span>
      <div className="emoji-field">
        <span className="emoji-current" aria-label={tr("当前图标 {0}", value)}>{value}</span>
        <div className="emoji-side">
          <input
            className="emoji-type"
            value={draft}
            placeholder={tr("输入或粘贴一个 emoji")}
            aria-label={tr("输入或粘贴一个 emoji 作为图标")}
            onChange={(e) => {
              if ((e.nativeEvent as InputEvent).isComposing) setDraft(e.target.value);
              else commit(e.target.value);
            }}
            onCompositionEnd={(e) => commit(e.currentTarget.value)}
          />
          <p className="emoji-hint">
            {tr("Windows：")}<kbd>Win</kbd> + <kbd>.</kbd>
            {' · '}
            {tr("Mac：")}<kbd>Ctrl</kbd> + <kbd>Cmd</kbd> + <kbd>{tr("空格")}</kbd>
            {' · '}
            {tr("手机：切换到 emoji 键盘")}
          </p>
          {note && <p className="emoji-hint is-note">{note}</p>}
        </div>
      </div>
      <div className="emoji-presets" role="listbox" aria-label={tr("常用 emoji")}>
        {EMOJI_PRESETS.map((e) => (
          <button
            key={e}
            type="button"
            role="option"
            aria-selected={e === value}
            className={e === value ? 'is-on' : undefined}
            onClick={() => {
              onChange(e);
              setNote(null);
            }}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <span className="field-label">{tr("颜色")}</span>
      <div className="swatches">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch${c.toLowerCase() === value.toLowerCase() ? ' is-on' : ''}`}
            style={{ background: c }}
            aria-label={c}
            onClick={() => onChange(c)}
          />
        ))}
        <label className="swatch swatch-custom" title={tr("自定义颜色")}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={tr("自定义颜色")} />
        </label>
      </div>
    </div>
  );
}

export function TagPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const tags = useTags();
  const [draft, setDraft] = useState('');
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const create = async () => {
    const name = draft.trim();
    if (!name) return;
    const existing = tags?.find((t) => t.name === name);
    const id = existing ? existing.id : await quickCreateTag(name);
    if (!value.includes(id)) onChange([...value, id]);
    setDraft('');
  };
  return (
    <div className="field">
      <span className="field-label">{tr("标签")}</span>
      <div className="chips">
        {tags?.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chip${value.includes(t.id) ? ' is-on' : ''}`}
            style={{ '--c': t.color } as React.CSSProperties}
            aria-pressed={value.includes(t.id)}
            onClick={() => toggle(t.id)}
          >
            {t.emoji} {t.name}
          </button>
        ))}
        <input
          className="chip-input"
          placeholder={tr("新标签，回车添加")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void create();
            }
          }}
        />
      </div>
    </div>
  );
}
