import type { CSSProperties } from 'react';

const P: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  down: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  right: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M8 5v14M16 5v14',
  prev: 'M18 6l-8 6 8 6zM6 6v12',
  next: 'M6 6l8 6-8 6zM18 6v12',
  rew: 'M11 6l-7 6 7 6zM20 6l-7 6 7 6z',
  fwd: 'M13 6l7 6-7 6zM4 6l7 6-7 6z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  bookmark: 'M7 4h10v16l-5-4-5 4z',
  share: 'M12 15V3M7 8l5-5 5 5M5 13v6h14v-6',
  check: 'M5 12.5l4.5 4.5L19 7',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  pen: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  ear: 'M3 14v-2a9 9 0 0 1 18 0v2M3 14a2 2 0 0 1 2-2h1v7H5a2 2 0 0 1-2-2zM21 14a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z',
  // Liquid mode: lines of text that wrap to fit the screen
  liquid: 'M4 5.5h16M4 11.5h12a3.5 3.5 0 0 1 0 7h-3.5M14.5 16l-2.5 2.5 2.5 2.5M4 18.5h4.5',
  page: 'M6 3h9l3 3v15H6zM14 3v4h4',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  convert: 'M4 8h13l-3-3M20 16H7l3 3',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16',
  frog: 'M8 4.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8zM16 4.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8zM3.5 13c0 4.6 3.8 7.5 8.5 7.5s8.5-2.9 8.5-7.5M8.8 15.6c2 1.3 4.4 1.3 6.4 0',
  scrollv: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  book: 'M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 1h13',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5M11 8v6M8 11h6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5M8 11h6',
  sidebar: 'M4 4h16v16H4zM9 4v16',
  timer: 'M12 8v5l3 2M9 2h6M12 4a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  voice: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  speed: 'M12 13l4-4M4 17a8 8 0 1 1 16 0',
  wiki: 'M3 6l4 13 5-11 5 11 4-13',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  ask: 'M10 3l2 5.6L17.6 10.6 12 12.6 10 18.2 8 12.6 2.4 10.6 8 8.6zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20, stroke = 1.8, style, className }: { name: IconName | string; size?: number; stroke?: number; style?: CSSProperties; className?: string }) {
  const filled = name === 'play';
  return (
    <svg className={className ?? 'icon'} width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      <path d={P[name] ?? ''} />
    </svg>
  );
}

/** "Tт" glyph used for typography settings (as in the reference design). */
export function TypeGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <path d="M3 5h11M8.5 5v14M13 11h8M17 11v8" />
    </svg>
  );
}
