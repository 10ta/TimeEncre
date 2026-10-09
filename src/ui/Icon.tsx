const PATHS = {
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  play: 'M8 5.5v13l10.5-6.5z',
  stop: 'M6.5 6.5h11v11h-11z',
  up: 'M12 7l6 7H6z',
  left: 'M7 12l7-6v12z',
  right: 'M17 12l-7 6V6z',
  down: 'M12 17l-6-7h12z',
  reset: 'M12 5V2L7.5 6.5 12 11V7.5a5.5 5.5 0 1 1-5.5 5.5H4a8 8 0 1 0 8-8z',
  close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z',
  more: 'M12 7.75a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5zm0 6a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5zm0 6a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5z',
  grip: 'M9 7a1.6 1.6 0 1 1 0-3.2A1.6 1.6 0 0 1 9 7zm6 0a1.6 1.6 0 1 1 0-3.2A1.6 1.6 0 0 1 15 7zm-6 6.6a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2zm6 0a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2zm-6 6.6a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2zm6 0a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2z',
  pin: 'M14.5 3 21 9.5l-1.6 1.1-1.3-.4-3.4 3.4.6 3.6-1.7 1.7-3.4-3.4L5 20.7 3.3 19l5.2-5.2-3.4-3.4 1.7-1.7 3.6.6 3.4-3.4-.4-1.3z',
  clock: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1 3h2v4.6l3.6 2.1-1 1.7L11 12.8z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d={PATHS[name]} fillRule="evenodd" />
    </svg>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  tone?: 'danger';
}) {
  return (
    <button type="button" className={`icon-btn${tone ? ` is-${tone}` : ''}`} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}
