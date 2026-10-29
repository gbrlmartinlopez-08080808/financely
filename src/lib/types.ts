export type DocKind =
  | 'pdf'
  | 'epub'
  | 'docx'
  | 'markdown'
  | 'html'
  | 'text'
  | 'code'
  | 'sheet'
  | 'slides'
  | 'odt'
  | 'rtf'
  | 'image'
  | 'audio'
  | 'video'
  | 'scan'
  | 'unknown';

export interface DocMeta {
  id: string;
  name: string; // display title
  fileName: string;
  kind: DocKind;
  mime: string;
  size: number;
  addedAt: number;
  openedAt: number;
  progress: number; // 0..1
  position?: { mode: ReadMode; value: number }; // scroll anchor
  pages?: number;
  author?: string;
  coverId?: string; // key in blobs store
  readMs: number;
  finished?: boolean;
  /** For scans: ids of page images. */
  scanPages?: string[];
}

export type ReadMode = 'page' | 'liquid';

export interface Highlight {
  id: string;
  docId: string;
  text: string;
  prefix: string;
  note?: string;
  at: number;
}

export interface Bookmark {
  id: string;
  docId: string;
  progress: number;
  label: string;
  at: number;
}

export type ReaderTheme = 'paper' | 'white' | 'dusk' | 'night';
export type ReaderFont = 'serif' | 'sans' | 'mono';

export interface Settings {
  name: string;
  appTheme: 'light' | 'system' | 'dark';
  readerTheme: ReaderTheme;
  font: ReaderFont;
  fontSize: number; // px
  lineHeight: number;
  margin: number; // px side padding
  justify: boolean;
  haptics: boolean;
  dailyGoal: number; // minutes
  ttsRate: number;
  ttsVoice?: string;
  ttsPitch: number;
  focusListen: boolean; // dim non-active sentences while listening
  defaultPdfMode: ReadMode;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  name: 'reader',
  appTheme: 'system',
  readerTheme: 'paper',
  font: 'serif',
  fontSize: 19,
  lineHeight: 1.6,
  margin: 22,
  justify: true,
  haptics: true,
  dailyGoal: 15,
  ttsRate: 1,
  ttsPitch: 1,
  focusListen: true,
  defaultPdfMode: 'page',
  onboarded: false,
};

/** Liquid content produced by any format loader. Rendered as HTML into the reading column. */
export interface LiquidDoc {
  html: string;
  toc: TocEntry[];
  /** Object URLs created for this document (images, math crops) so we can revoke them. */
  urls: string[];
}

export interface TocEntry {
  title: string;
  anchor: string; // element id inside liquid html
  level: number;
  page?: number;
}
