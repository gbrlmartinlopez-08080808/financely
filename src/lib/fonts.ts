// Reading typefaces bundled with the app (all open-licensed, all work offline).
export interface FontDef {
  id: string;
  name: string;
  family: string; // CSS font-family stack
  kind: 'serif' | 'sans' | 'mono' | 'access';
  scale: number; // optical size correction so every face reads at a similar size
  note: string;
}

export const FONTS: FontDef[] = [
  { id: 'garamond', name: 'Garamond', family: "'EB Garamond', Georgia, serif", kind: 'serif', scale: 1.06, note: 'classic book face' },
  { id: 'literata', name: 'Literata', family: "'Literata', Georgia, serif", kind: 'serif', scale: 0.98, note: 'made for long reading' },
  { id: 'source', name: 'Source Serif', family: "'Source Serif 4', Georgia, serif", kind: 'serif', scale: 1, note: 'crisp, balanced' },
  { id: 'lora', name: 'Lora', family: "'Lora', Georgia, serif", kind: 'serif', scale: 1, note: 'warm, calligraphic' },
  { id: 'crimson', name: 'Crimson', family: "'Crimson Pro', Georgia, serif", kind: 'serif', scale: 1.1, note: 'compact, elegant' },
  { id: 'merriweather', name: 'Merriweather', family: "'Merriweather', Georgia, serif", kind: 'serif', scale: 0.92, note: 'sturdy on small screens' },
  { id: 'inter', name: 'Inter', family: "'Inter', system-ui, sans-serif", kind: 'sans', scale: 0.95, note: 'clean sans' },
  { id: 'atkinson', name: 'Atkinson', family: "'Atkinson Hyperlegible', system-ui, sans-serif", kind: 'access', scale: 0.98, note: 'high legibility' },
  { id: 'dyslexic', name: 'OpenDyslexic', family: "'OpenDyslexic', system-ui, sans-serif", kind: 'access', scale: 0.8, note: 'dyslexia friendly' },
  { id: 'mono', name: 'JetBrains Mono', family: "'JetBrains Mono', ui-monospace, monospace", kind: 'mono', scale: 0.8, note: 'typewriter feel' },
  { id: 'plex', name: 'Plex Mono', family: "'IBM Plex Mono', ui-monospace, monospace", kind: 'mono', scale: 0.82, note: 'friendly mono' },
  { id: 'device', name: 'Device', family: "'Noto Serif', Georgia, serif", kind: 'serif', scale: 0.96, note: 'your phone’s serif' },
];

export const DEFAULT_FAVES = ['garamond', 'literata', 'inter', 'mono'];

export const fontById = (id: string): FontDef => FONTS.find((f) => f.id === id) ?? FONTS[0];

/** Old saved values from v1. */
export const migrateFontId = (id: string) => ({ serif: 'garamond', sans: 'inter', mono: 'mono' } as Record<string, string>)[id] ?? id;
