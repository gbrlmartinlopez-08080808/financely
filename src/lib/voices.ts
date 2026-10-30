// The reading language, and the natural voice that goes with it: chosen from the phone's own language (no extra
// question), downloaded in the background right after the introduction, and made the default. Fast phone voices in
// other accents remain one tap away in the Voice sheet.
import { NEURAL_PREFIX, NEURAL_VOICES, neuralDownload, neuralStored, neuralSupported, sharedEngine, neuralId, isNeural, type NeuralVoice } from './neural';
import { getState, updateSettings } from './store';
import { reportJob } from './scan';
import * as db from './db';

export const LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'other', label: 'Another language' },
];

/** The language the phone is set to, as one of ours. */
export function detectLang(): string {
  const l = (navigator.languages?.[0] ?? navigator.language ?? 'en').slice(0, 2).toLowerCase();
  return LANGS.some((x) => x.code === l) ? l : 'other';
}

/** The natural voice for a language, with the accent of the phone's locale where there is a choice. */
export function naturalVoiceFor(lang: string): NeuralVoice | undefined {
  const loc = (navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase();
  const pick = (id: string) => NEURAL_VOICES.find((v) => v.id === id);
  if (lang === 'en') return /^en-(gb|au|nz|ie|in|za)/.test(loc) ? pick('en_GB-alba-medium') : pick('en_US-hfc_female-medium');
  return NEURAL_VOICES.find((v) => v.lang.slice(0, 2) === lang);
}

let busy = false;
/** a language asked for while another voice was downloading: it is fetched right after (never silently dropped) */
let next: { lang: string; opts: { force?: boolean } } | null = null;
/**
 * Downloads the natural voice for the language (if it isn't on the phone) and makes it the default, unless the reader
 * already chose a voice. Shows up as background work, with its progress. Safe to call again.
 */
export async function ensureNaturalVoice(lang = getState().settings.lang || detectLang(), opts: { force?: boolean } = {}): Promise<void> {
  if (!neuralSupported()) return;
  if (busy) {
    next = { lang, opts };
    return;
  }
  const v = naturalVoiceFor(lang);
  if (!v) return;
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData && !opts.force) return; // the phone is asked to save data: leave it to the reader
  busy = true;
  const jobId = 'voice';
  try {
    const have = (await neuralStored()).includes(v.id);
    await db.put('kv', 'voice:auto', 'pending');
    if (!have) {
      reportJob(jobId, `Your reading voice · ${v.label}`, 'voice', 0, 100);
      await neuralDownload(v.id, (f) => reportJob(jobId, `Your reading voice · ${v.label}`, 'voice', Math.round(f * 100), 100));
    }
    const cur = getState().settings.ttsVoice;
    // make it the default unless the reader picked something else on purpose
    if (!cur || (isNeural(cur) && !NEURAL_VOICES.find((x) => NEURAL_PREFIX + x.id === cur)?.lang.startsWith(lang))) await updateSettings({ ttsVoice: NEURAL_PREFIX + v.id });
    await db.put('kv', 'voice:auto', 'done');
    window.dispatchEvent(new CustomEvent('frogity:voice', { detail: { id: v.id } }));
    void warmVoice();
  } catch (e) {
    console.warn('voice download failed', e);
    await db.put('kv', 'voice:auto', 'failed');
  } finally {
    reportJob(jobId, '', 'voice', 1, 1, true);
    busy = false;
    const n = next;
    next = null;
    if (n && n.lang !== lang) void ensureNaturalVoice(n.lang, n.opts);
  }
}

/** Loads the chosen natural voice and says a word silently, so the first real sentence is not slow. */
let warmed = '';
export async function warmVoice() {
  const sel = getState().settings.ttsVoice;
  if (!isNeural(sel) || !neuralSupported()) return;
  const id = neuralId(sel);
  if (warmed === id) return;
  try {
    if (!(await neuralStored()).includes(id)) return;
    await sharedEngine.init(id);
    await sharedEngine.say('Ready.', 1); // first run compiles the model's kernels; this pays for it now
    warmed = id;
  } catch (e) {
    console.warn('voice warm-up failed', e);
  }
}

/** On start: finish a download that was interrupted, and warm the voice while the app is quiet. */
export async function resumeVoice() {
  const st = await db.get<string>('kv', 'voice:auto');
  if (st === 'pending' || st === 'failed') await ensureNaturalVoice();
  else void warmVoice();
}
