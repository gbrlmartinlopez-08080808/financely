export type DocKind =
  | 'fr' // a Frogity note: editable here and on the computer
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
  url?: string; // source link for saved web pages
  uri?: string; // Android document URI: the file stays where it is (nothing is copied)
  folder?: string; // linked folder this file came from
  modified?: number;
  coverV?: number; // cover algorithm version (older covers are rebuilt in the background)
  enriched?: boolean; // real cover / title read from the file
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
  page?: number;
  /** placed by the app when you stop reading (one per document, always the latest) */
  auto?: boolean;
}

export type ReaderTheme = 'paper' | 'white' | 'dusk' | 'night';
export type ReaderFont = string;

export interface Settings {
  name: string;
  /** the reading language (en, es, fr, de, it, pt, other): chosen from the phone's, changeable in Settings */
  lang: string;
  appTheme: 'light' | 'system' | 'dark';
  readerTheme: ReaderTheme;
  font: ReaderFont;
  fontFaves: string[]; // up to four favourites shown in the reading sheet
  fontSize: number; // px
  lineHeight: number;
  margin: number; // px side padding
  justify: boolean;
  haptics: boolean;
  dailyGoal: number; // minutes
  reminders: boolean; // a gentle evening notification
  reminderTime: string; // HH:MM
  streakView: 'globe' | 'plant'; // the ASCII picture shown on the streak page (kept until you change it)
  wpm: number; // learned reading speed in liquid/text views (words per minute)
  secPerPage: number; // learned seconds per page in page view
  ttsRate: number;
  ttsVoice?: string;
  ttsPitch: number;
  focusListen: boolean; // dim non-active sentences while listening
  defaultPdfMode: ReadMode;
  onboarded: boolean;
  v: number; // settings schema version
  /** read each book with a voice of its own language (when one is installed) */
  autoVoice?: boolean;
  /** show a Liquid view as flipping pages instead of one long scroll */
  pageFlip?: boolean;
  aiOk: boolean; // user agreed to send questions + short excerpts to the free AI service
}

export const DEFAULT_SETTINGS: Settings = {
  name: 'reader',
  lang: '',
  appTheme: 'system',
  readerTheme: 'paper',
  font: 'garamond',
  fontFaves: ['garamond', 'literata', 'inter', 'mono'],
  fontSize: 20,
  lineHeight: 1.6,
  margin: 22,
  justify: true,
  haptics: true,
  dailyGoal: 15,
  reminders: false,
  reminderTime: '20:30',
  streakView: 'globe',
  wpm: 230,
  secPerPage: 100,
  ttsRate: 1,
  ttsPitch: 1,
  focusListen: true,
  defaultPdfMode: 'page',
  onboarded: false,
  v: 2,
  aiOk: false,
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
