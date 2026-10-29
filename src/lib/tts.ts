// Text-to-speech that works on Android (native engine) and in browsers (Web Speech).
// Text is spoken in chunks of whole sentences so playback survives short screen-offs and
// we can still highlight the sentence being read.
import { isNative } from './native';

export interface Voice {
  id: string; // stable key
  name: string;
  lang: string;
  index?: number; // native voice index
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
      voicesCache = voices.map((v, i) => ({ id: v.voiceURI || `${v.name}-${i}`, name: v.name, lang: v.lang, index: i }));
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
  voicesCache = vs.map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang }));
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
