// "Studio" voices: neural text-to-speech that runs on the phone itself (Piper voices through ONNX Runtime Web).
// A voice is downloaded once (about 60 MB, free, no account), then works offline. The synthesiser itself only
// loads the first time you use it, so it costs nothing until then.
import type { VoiceId } from '@diffusionstudio/vits-web';

export interface NeuralVoice {
  id: VoiceId;
  label: string;
  note: string;
  lang: string; // BCP-47
  mb: number;
}

export const NEURAL_VOICES: NeuralVoice[] = [
  { id: 'en_US-hfc_female-medium', label: 'Ava', note: 'warm, clear · US woman', lang: 'en-US', mb: 63 },
  { id: 'en_US-ryan-medium', label: 'Ryan', note: 'steady narrator · US man', lang: 'en-US', mb: 63 },
  { id: 'en_US-lessac-medium', label: 'Lessac', note: 'audiobook style · US', lang: 'en-US', mb: 63 },
  { id: 'en_GB-alba-medium', label: 'Alba', note: 'gentle · Scottish woman', lang: 'en-GB', mb: 63 },
  { id: 'en_GB-alan-medium', label: 'Alan', note: 'calm · British man', lang: 'en-GB', mb: 63 },
  { id: 'es_ES-davefx-medium', label: 'Dave', note: 'español · hombre', lang: 'es-ES', mb: 63 },
  { id: 'fr_FR-siwis-medium', label: 'Siwis', note: 'français · femme', lang: 'fr-FR', mb: 63 },
  { id: 'de_DE-thorsten-medium', label: 'Thorsten', note: 'Deutsch · Mann', lang: 'de-DE', mb: 63 },
  { id: 'it_IT-riccardo-x_low', label: 'Riccardo', note: 'italiano · uomo · compact', lang: 'it-IT', mb: 28 },
  { id: 'pt_BR-faber-medium', label: 'Faber', note: 'português · homem', lang: 'pt-BR', mb: 63 },
];

export const NEURAL_PREFIX = 'neural:';
export const isNeural = (voice?: string): voice is string => !!voice && voice.startsWith(NEURAL_PREFIX);
export const neuralId = (voice: string) => voice.slice(NEURAL_PREFIX.length) as VoiceId;

type Lib = typeof import('@diffusionstudio/vits-web');
let lib: Promise<Lib> | null = null;
const load = () => (lib ??= import('@diffusionstudio/vits-web'));

/** Needs WebAssembly and the browser's private file store (all current Android WebViews have both). */
export const neuralSupported = () => typeof WebAssembly !== 'undefined' && !!navigator.storage?.getDirectory;

export async function neuralStored(): Promise<string[]> {
  try {
    return (await (await load()).stored()) as string[];
  } catch {
    return [];
  }
}

export async function neuralDownload(id: VoiceId, onProgress: (fraction: number) => void): Promise<void> {
  const t = await load();
  const seen = new Map<string, { loaded: number; total: number }>();
  await t.download(id, (p) => {
    seen.set(p.url, { loaded: p.loaded, total: p.total });
    let l = 0;
    let tot = 0;
    for (const v of seen.values()) {
      l += v.loaded;
      tot += v.total;
    }
    onProgress(tot ? l / tot : 0);
  });
}

export async function neuralRemove(id: VoiceId) {
  await (await load()).remove(id);
}

// one synthesis at a time: each runs in its own worker and a phone should not hold two models in memory
let chain: Promise<unknown> = Promise.resolve();
export function neuralSynth(text: string, id: VoiceId): Promise<Blob> {
  const run = chain.then(async () => (await load()).predict({ text, voiceId: id }));
  chain = run.catch(() => {});
  return run;
}

/** Plays a WAV blob. Resolves when it ends or `stop()` is called. */
export class Player {
  private a = new Audio();
  private url = '';
  private ended: (() => void) | null = null;
  constructor() {
    this.a.preservesPitch = true;
  }
  get element() {
    return this.a;
  }
  setRate(r: number) {
    this.a.playbackRate = r;
  }
  play(blob: Blob, rate: number, onTime?: (t: number, d: number) => void): Promise<'done' | 'stopped'> {
    this.release();
    this.url = URL.createObjectURL(blob);
    this.a.src = this.url;
    this.a.playbackRate = rate;
    this.a.preservesPitch = true;
    return new Promise((resolve) => {
      let raf = 0;
      const tick = () => {
        onTime?.(this.a.currentTime, this.a.duration || 0);
        raf = requestAnimationFrame(tick);
      };
      const finish = (r: 'done' | 'stopped') => {
        cancelAnimationFrame(raf);
        this.ended = null;
        resolve(r);
      };
      this.ended = () => finish('stopped');
      this.a.onended = () => finish('done');
      this.a.onerror = () => finish('stopped');
      this.a.onplaying = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
      };
      this.a.play().catch(() => finish('stopped'));
    });
  }
  stop() {
    this.a.pause();
    this.ended?.();
    this.release();
  }
  private release() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
  }
}
