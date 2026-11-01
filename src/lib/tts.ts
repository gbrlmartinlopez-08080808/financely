// Text-to-speech that works on Android (native engine) and in browsers (Web Speech).
// Text is spoken in chunks of whole sentences so playback survives short screen-offs and
// we can still highlight the sentence being read.
import { isNative } from './native';

export interface Voice {
  id: string; // stable key
  name: string;
  lang: string;
  index?: number; // native voice index
  score: number; // how natural it is likely to sound (higher is better)
  natural: boolean;
}

/** Android and browsers don't say which voices are the good (neural) ones, so read the clues in their names. */
export function scoreVoice(name: string, id: string, local?: boolean): number {
  const s = `${name} ${id}`.toLowerCase();
  let sc = 0;
  if (/neural|natural|premium|enhanced|studio|wavenet|journey|polyglot|siri|high.?quality|\bhq\b/.test(s)) sc += 60;
  if (/network|online/.test(s)) sc += 50; // Google's network voices are neural
  if (/-x-[a-z]{3}-local/.test(s)) sc += 20; // Google's downloadable high-quality offline voices
  if (local === false) sc += 15;
  if (/compact|lite|\blow\b|espeak|flite|pico|-language$/.test(s)) sc -= 40;
  return sc;
}

/** The most natural-sounding voice for a language (e.g. "en-US"), or undefined if none is clearly better. */
export function bestVoice(voices: Voice[], lang: string): Voice | undefined {
  const fam = lang.slice(0, 2).toLowerCase();
  const pool = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(fam));
  const exact = pool.filter((v) => v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase());
  return [...(exact.length ? exact : pool)].sort((a, b) => b.score - a.score)[0];
}

/** Opens Android's "install voice data" screen (where Google's natural voices live). */
export async function openVoiceInstall() {
  if (!isNative) return;
  try {
    const { TextToSpeech } = await loadNative();
    await TextToSpeech.openInstall();
  } catch {
    /* no such screen on this phone */
  }
}

/** Tidies text for the ear: no citation numbers, URLs, or abbreviations read letter by letter. */
export function speechText(raw: string): string {
  return raw
    .replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, '')
    .replace(/\(\s*(?:[A-Z][\p{L}'’.\- ]+(?:,| and | & )[^()]{0,60}?\d{4}[a-z]?;?\s*)+\)/gu, '')
    .replace(/https?:\/\/\S+|www\.\S+/g, 'link')
    .replace(/\be\.g\./gi, 'for example')
    .replace(/\bi\.e\./gi, 'that is')
    .replace(/\bet al\./g, 'et al')
    .replace(/\bvs\./gi, 'versus')
    .replace(/\bFig\./g, 'Figure')
    .replace(/\bEq\./g, 'Equation')
    .replace(/\bcf\./gi, 'compare')
    .replace(/\u00ad/g, '')
    .replace(/^\s*\d+(?:\.\d+)*\.?\s+(?=\p{Lu}\p{Ll})/u, '') // "2.3 Method" is read as "Method"
    .replace(/\s*\((?:see\s+)?(?:Fig(?:ure)?|Table|Eq(?:uation)?|Section|Sec)\.?\s*[\dA-Z][\d.a-z]*\)/g, '') // "(Figure 3)"
    .replace(/[\u00b9\u00b2\u00b3\u2070-\u2079]+/g, '') // superscript footnote marks
    .replace(/\s[—–]\s/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SpeakOpts {
  rate: number;
  pitch: number;
  voice?: string;
  lang?: string;
}

type Native = typeof import('@capacitor-community/text-to-speech');
let native: Native | null = null;
const loadNative = async () => (native ??= await import('@capacitor-community/text-to-speech'));

let voicesCache: Voice[] | null = null;

export async function listVoices(): Promise<Voice[]> {
  if (voicesCache) return voicesCache;
  if (isNative) {
    try {
      const { TextToSpeech } = await loadNative();
      const { voices } = await TextToSpeech.getSupportedVoices();
      voicesCache = voices.map((v, i) => {
        const id = v.voiceURI || `${v.name}-${i}`;
        const score = scoreVoice(v.name, id, (v as { localService?: boolean }).localService);
        return { id, name: v.name, lang: v.lang, index: i, score, natural: score >= 50 };
      });
    } catch {
      voicesCache = [];
    }
    return voicesCache;
  }
  const synth = window.speechSynthesis;
  if (!synth) return [];
  let vs = synth.getVoices();
  if (!vs.length)
    vs = await new Promise((r) => {
      const t = setTimeout(() => r(synth.getVoices()), 1200);
      synth.onvoiceschanged = () => {
        clearTimeout(t);
        r(synth.getVoices());
      };
    });
  voicesCache = vs.map((v) => {
    const score = scoreVoice(v.name, v.voiceURI, v.localService);
    return { id: v.voiceURI, name: v.name, lang: v.lang, score, natural: score >= 50 };
  });
  return voicesCache;
}

export function ttsAvailable() {
  return isNative || 'speechSynthesis' in window;
}

/**
 * Speak `text`; resolves when finished or stopped. `onBoundary` reports the character offset of
 * the word currently being spoken (when the engine supports it).
 */
export async function speak(text: string, opts: SpeakOpts, onBoundary?: (charIndex: number) => void): Promise<'done' | 'stopped'> {
  const voices = await listVoices();
  const v = voices.find((x) => x.id === opts.voice);
  if (isNative) {
    const { TextToSpeech } = await loadNative();
    let handle: { remove: () => void } | undefined;
    if (onBoundary) {
      try {
        handle = await TextToSpeech.addListener('onRangeStart', (e: { start: number }) => onBoundary(e.start));
      } catch {
        /* older engines */
      }
    }
    try {
      stoppedFlag = false;
      await TextToSpeech.speak({
        text,
        lang: v?.lang ?? opts.lang ?? 'en-US',
        rate: opts.rate,
        pitch: opts.pitch,
        volume: 1,
        voice: v?.index,
        category: 'playback',
        queueStrategy: 0,
      });
      return stoppedFlag ? 'stopped' : 'done';
    } catch {
      return 'stopped';
    } finally {
      handle?.remove();
    }
  }
  const synth = window.speechSynthesis;
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate;
    u.pitch = opts.pitch;
    const wv = synth.getVoices().find((x) => x.voiceURI === opts.voice);
    if (wv) u.voice = wv;
    else if (opts.lang) u.lang = opts.lang;
    u.onboundary = (e) => onBoundary?.(e.charIndex);
    u.onend = () => resolve(stoppedFlag ? 'stopped' : 'done');
    u.onerror = () => resolve('stopped');
    stoppedFlag = false;
    synth.speak(u);
    // Chrome bug: long utterances stall; keep the engine awake.
    const keep = setInterval(() => {
      if (!synth.speaking) clearInterval(keep);
      else if (!synth.paused) {
        synth.pause();
        synth.resume();
      }
    }, 10000);
  });
}

let stoppedFlag = false;
export async function stopSpeaking() {
  stoppedFlag = true;
  if (isNative) {
    const { TextToSpeech } = await loadNative();
    await TextToSpeech.stop().catch(() => {});
  } else window.speechSynthesis?.cancel();
}

/** Split text into sentences (Intl.Segmenter where available). */
export function sentences(text: string, lang = 'en'): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    const seg = new Seg(lang, { granularity: 'sentence' });
    for (const s of seg.segment(text)) if (s.segment.trim()) out.push({ text: s.segment, start: s.index });
    return out;
  }
  const re = /[^.!?]+[.!?]+["'”’)\]]*\s*|[^.!?]+$/g;
  let m;
  while ((m = re.exec(text))) if (m[0].trim()) out.push({ text: m[0], start: m.index });
  return out;
}

/** Guess the document language from a text sample (for TTS voice choice). */
export function guessLang(sample: string): string {
  const s = sample.slice(0, 2000).toLowerCase();
  const score = (words: string[]) => words.reduce((a, w) => a + (s.match(new RegExp(`\\b${w}\\b`, 'g'))?.length ?? 0), 0);
  const langs: [string, string[]][] = [
    ['en-US', ['the', 'and', 'of', 'to', 'is', 'that']],
    ['es-ES', ['el', 'la', 'de', 'que', 'y', 'los', 'en']],
    ['fr-FR', ['le', 'la', 'les', 'et', 'des', 'est', 'une']],
    ['de-DE', ['der', 'die', 'und', 'das', 'ist', 'nicht']],
    ['it-IT', ['il', 'che', 'di', 'e', 'la', 'per', 'non']],
    ['pt-PT', ['o', 'que', 'de', 'e', 'do', 'da', 'não']],
  ];
  let best = 'en-US';
  let bs = 0;
  for (const [l, w] of langs) {
    const sc = score(w);
    if (sc > bs) {
      bs = sc;
      best = l;
    }
  }
  return best;
}
