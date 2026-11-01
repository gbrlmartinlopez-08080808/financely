// "Studio" voices: neural text-to-speech that runs on the phone itself (Piper voices through ONNX Runtime Web).
// A voice is downloaded once (about 60 MB, plus a one-time ~30 MB speech engine; free, no account) into the app's
// private storage and then works offline. Synthesis runs in a worker that keeps the voice loaded, and the audio is
// scheduled sentence by sentence on one timeline, so phrases follow each other without gaps.
export type VoiceId = string;

export type Tier = 'light' | 'standard' | 'hd';
export interface NeuralVoice {
  id: VoiceId;
  label: string;
  note: string;
  lang: string; // BCP-47
  mb: number;
  /** light: smallest and fastest · standard: balanced (the default) · hd: richest, for recent phones */
  tier: Tier;
  /** the one offered first for its language */
  rec?: boolean;
}

export const TIER_INFO: Record<Tier, { label: string; hint: string }> = {
  light: { label: 'Light', hint: 'small and very fast — any phone' },
  standard: { label: 'Standard', hint: 'natural and quick — most phones' },
  hd: { label: 'HD', hint: 'richest sound — needs a recent phone' },
};

/** Languages the studio voices cover (the order they are listed in). */
export const VOICE_LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
];

export const NEURAL_VOICES: NeuralVoice[] = [
  { id: 'en_US-hfc_female-medium', label: 'Ava', note: 'warm, clear · US woman', lang: 'en-US', mb: 63, tier: 'standard', rec: true },
  { id: 'en_US-ryan-medium', label: 'Ryan', note: 'steady narrator · US man', lang: 'en-US', mb: 63, tier: 'standard' },
  { id: 'en_US-lessac-medium', label: 'Lessac', note: 'audiobook style · US', lang: 'en-US', mb: 63, tier: 'standard' },
  { id: 'en_GB-alba-medium', label: 'Alba', note: 'gentle · Scottish woman', lang: 'en-GB', mb: 63, tier: 'standard' },
  { id: 'en_GB-alan-medium', label: 'Alan', note: 'calm · British man', lang: 'en-GB', mb: 63, tier: 'standard' },
  { id: 'en_US-lessac-high', label: 'Lessac HD', note: 'audiobook · US', lang: 'en-US', mb: 114, tier: 'hd' },
  { id: 'en_US-ryan-high', label: 'Ryan HD', note: 'narrator · US man', lang: 'en-US', mb: 121, tier: 'hd' },
  { id: 'en_GB-cori-high', label: 'Cori HD', note: 'British woman', lang: 'en-GB', mb: 114, tier: 'hd' },
  { id: 'es_ES-carlfm-x_low', label: 'Carlos', note: 'español · hombre', lang: 'es-ES', mb: 28, tier: 'light' },
  { id: 'es_ES-davefx-medium', label: 'Dave', note: 'español · hombre', lang: 'es-ES', mb: 63, tier: 'standard', rec: true },
  { id: 'es_MX-ald-medium', label: 'Ald', note: 'español (México) · hombre', lang: 'es-MX', mb: 63, tier: 'standard' },
  { id: 'es_MX-claude-high', label: 'Claude', note: 'español (México) · más natural', lang: 'es-MX', mb: 63, tier: 'hd' },
  { id: 'fr_FR-siwis-low', label: 'Siwis', note: 'français · femme', lang: 'fr-FR', mb: 28, tier: 'light' },
  { id: 'fr_FR-siwis-medium', label: 'Siwis', note: 'français · femme', lang: 'fr-FR', mb: 63, tier: 'standard', rec: true },
  { id: 'de_DE-eva_k-x_low', label: 'Eva', note: 'Deutsch · Frau', lang: 'de-DE', mb: 21, tier: 'light' },
  { id: 'de_DE-thorsten-medium', label: 'Thorsten', note: 'Deutsch · Mann', lang: 'de-DE', mb: 63, tier: 'standard', rec: true },
  { id: 'de_DE-thorsten-high', label: 'Thorsten HD', note: 'Deutsch · Mann', lang: 'de-DE', mb: 114, tier: 'hd' },
  { id: 'it_IT-riccardo-x_low', label: 'Riccardo', note: 'italiano · uomo', lang: 'it-IT', mb: 28, tier: 'light', rec: true },
  { id: 'it_IT-paola-medium', label: 'Paola', note: 'italiano · donna', lang: 'it-IT', mb: 64, tier: 'standard' },
  { id: 'pt_BR-faber-medium', label: 'Faber', note: 'português · homem', lang: 'pt-BR', mb: 63, tier: 'standard', rec: true },
];

/** The voice offered first for a language (light on slow phones). */
export const recommendedFor = (lang: string, tier: Tier = 'standard') => NEURAL_VOICES.find((v) => v.lang.slice(0, 2) === lang && v.tier === tier && (v.rec || tier !== 'standard')) ?? NEURAL_VOICES.find((v) => v.lang.slice(0, 2) === lang && v.rec) ?? NEURAL_VOICES.find((v) => v.lang.slice(0, 2) === lang);
/** The lighter voice of the same language, if there is one. */
export const lighterThan = (v: NeuralVoice) => NEURAL_VOICES.find((x) => x.lang.slice(0, 2) === v.lang.slice(0, 2) && (v.tier === 'hd' ? x.tier === 'standard' && x.rec : v.tier === 'standard' ? x.tier === 'light' : false));

export const NEURAL_PREFIX = 'neural:';
export const isNeural = (voice?: string): voice is string => !!voice && voice.startsWith(NEURAL_PREFIX);
export const neuralId = (voice: string) => voice.slice(NEURAL_PREFIX.length) as VoiceId;

const HF = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main';
const RUNTIME: { name: string; url: string }[] = [
  { name: 'ort-wasm-simd.wasm', url: 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/ort-wasm-simd.wasm' },
  { name: 'piper_phonemize.wasm', url: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm' },
  { name: 'piper_phonemize.data', url: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data' },
];

/** A short recording of the voice (about 5 s), streamed when you tap ▶ — no download of the voice needed. */
export const sampleUrl = (id: VoiceId) => `https://huggingface.co/rhasspy/piper-voices/resolve/main/${voicePath(id).split('/').slice(0, -1).join('/')}/samples/speaker_0.mp3`;

/** en_US-ryan-medium → en/en_US/ryan/medium/en_US-ryan-medium */
const voicePath = (id: string) => {
  const [loc, ...rest] = id.split('-');
  const quality = rest[rest.length - 1];
  const name = rest.slice(0, -1).join('-');
  return `${loc.split('_')[0]}/${loc}/${name}/${quality}/${id}`;
};

/** Needs WebAssembly, workers and the browser's private file store (all current Android WebViews have them). */
export const neuralSupported = () => typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined' && !!navigator.storage?.getDirectory;

const dir = async (name: string, create = false) => (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create });
const has = async (d: FileSystemDirectoryHandle, name: string) => {
  try {
    await d.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
};

async function runtimeReady() {
  try {
    return await has(await dir('piper-rt'), 'rt.ok');
  } catch {
    return false;
  }
}

/** Voices that are fully installed (voice files and the speech engine). */
export async function neuralStored(): Promise<string[]> {
  try {
    if (!(await runtimeReady())) return [];
    const d = await dir('piper', true);
    const out: string[] = [];
    for await (const k of d.keys()) if (k.endsWith('.onnx') && (await has(d, `${k}.json`))) out.push(k.slice(0, -5));
    return out;
  } catch {
    return [];
  }
}

async function save(d: FileSystemDirectoryHandle, name: string, url: string, onBytes: (n: number) => void) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`download failed (${r.status})`);
  const w = await (await d.getFileHandle(name, { create: true })).createWritable();
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await w.write(value);
    onBytes(value.length);
  }
  await w.close();
}

export async function neuralDownload(id: VoiceId, onProgress: (fraction: number) => void): Promise<void> {
  const needRt = !(await runtimeReady());
  const total = (needRt ? 29_300_000 : 0) + (NEURAL_VOICES.find((v) => v.id === id)?.mb ?? 63) * 1_000_000;
  let got = 0;
  const bump = (n: number) => onProgress(Math.min(0.99, (got += n) / total));
  if (needRt) {
    const d = await dir('piper-rt', true);
    for (const f of RUNTIME) await save(d, f.name, f.url, bump);
    await (await d.getFileHandle('rt.ok', { create: true })).createWritable().then((w) => w.close());
  }
  const d = await dir('piper', true);
  const base = `${HF}/${voicePath(id)}.onnx`;
  await save(d, `${id}.onnx.json`, `${base}.json`, bump);
  await save(d, `${id}.onnx`, base, bump);
  onProgress(1);
}

export async function neuralRemove(id: VoiceId) {
  try {
    const d = await dir('piper');
    await d.removeEntry(`${id}.onnx`).catch(() => {});
    await d.removeEntry(`${id}.onnx.json`).catch(() => {});
  } catch {
    /* already gone */
  }
}

// ------------------------------------------------------------------ engine (worker)
export class NeuralEngine {
  private w: Worker | null = null;
  private seq = 0;
  private waits = new Map<number, { ok: (v: { samples: Float32Array; rate: number } | { rtf: number } | void) => void; fail: (e: Error) => void; say: boolean }>();
  private voice = '';
  /** how long this phone takes to make one second of speech with the loaded voice (measured when it loaded) */
  rtf = 0;
  private loading: { voice: string; p: Promise<void> } | null = null;

  private worker() {
    if (!this.w) {
      this.w = new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' });
      this.w.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; id: number; samples?: Float32Array; rate?: number; message?: string; rtf?: number };
        const t = this.waits.get(m.id);
        if (!t) return;
        this.waits.delete(m.id);
        if (m.type === 'error') t.fail(new Error(m.message));
        else if (m.type === 'ready') t.ok({ rtf: m.rtf ?? 0 });
        else t.ok(m.samples ? { samples: m.samples, rate: m.rate! } : undefined);
      };
      this.w.onerror = (e) => {
        const err = new Error(e.message || 'the voice engine stopped');
        this.waits.forEach((t) => t.fail(err));
        this.waits.clear();
      };
    }
    return this.w;
  }
  private call<T>(msg: Record<string, unknown>): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((ok, fail) => {
      this.waits.set(id, { ok: ok as never, fail, say: msg.type === 'say' });
      this.worker().postMessage({ ...msg, id });
    });
  }
  isReady(voice: VoiceId) {
    return this.voice === voice;
  }
  async init(voice: VoiceId) {
    if (this.voice === voice) return;
    // asked again while it is loading: wait for the same load
    if (this.loading?.voice === voice) return this.loading.p;
    const p = this.call<{ rtf: number }>({ type: 'init', voice }).then((r) => {
      this.voice = voice;
      this.rtf = r.rtf;
    });
    this.loading = { voice, p };
    try {
      await p;
    } finally {
      if (this.loading?.p === p) this.loading = null;
    }
  }
  say(text: string, rate: number) {
    const job = this.call<{ samples: Float32Array; rate: number }>({ type: 'say', text, rate });
    // a piece that takes this long means the engine is stuck (a phone short of memory, a worker that died quietly):
    // start the engine afresh and say so, instead of waiting for ever
    let timer = 0;
    const limit = new Promise<never>((_, no) => {
      timer = window.setTimeout(() => {
        this.dispose();
        no(new Error('the voice engine stopped answering'));
      }, Math.max(25_000, text.length * 400));
    });
    return Promise.race([job, limit]).finally(() => clearTimeout(timer));
  }
  /** Stops at once: sentences waiting are dropped (the one being made finishes, and its result is ignored). */
  cancel() {
    if (!this.w) return;
    this.w.postMessage({ type: 'cancel' });
    const err = new Error('stopped');
    for (const [id, t] of [...this.waits]) {
      if (!t.say) continue; // a voice that is loading carries on: it is wanted again soon
      this.waits.delete(id);
      t.fail(err);
    }
  }
  dispose() {
    this.w?.terminate();
    this.w = null;
    this.voice = '';
    this.loading = null;
    this.waits.forEach((t) => t.fail(new Error('stopped')));
    this.waits.clear();
  }
}

/** One engine for the whole app: the voice stays loaded between books, so Listen starts at once. */
export const sharedEngine = new NeuralEngine();

// ------------------------------------------------------------------ gapless playback
interface Slot {
  i: number; // sentence index
  start: number; // seconds on the audio clock
  end: number;
}
/** One stretch of speech that covers several sentences; `w` is each sentence's share of the text, used to time the highlight. */
export interface Part {
  i: number;
  w: number;
}

/** Plays chunk after chunk on one audio clock: each starts the instant the last one ends. */
export class NeuralPlayer {
  private ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  private nextAt = 0;
  private slots: Slot[] = [];
  private srcs: AudioBufferSourceNode[] = [];
  private held: { parts: Part[]; buf: AudioBuffer; gap: number }[] = [];
  private heldSecs = 0;
  private released = false;
  private born = performance.now();
  private paused = false; // we stopped the clock on purpose (waiting for the next piece)
  private watch = 0;
  constructor(
    private tempo = 1,
    private prebuffer = 1.4, // seconds of speech to have in hand before starting, so the first words never run dry
  ) {
    this.ctx.resume().catch(() => {});
    // the phone may stop the audio clock by itself (an incoming call, another app, the screen going off): start it again
    const wake = () => {
      if (!this.paused && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
    };
    this.ctx.onstatechange = wake;
    this.watch = window.setInterval(wake, 800);
    document.addEventListener('visibilitychange', wake);
    this.dropWake = () => document.removeEventListener('visibilitychange', wake);
  }
  private dropWake = () => {};
  /** seconds of speech that are scheduled but not yet heard */
  ahead() {
    return Math.max(0, this.nextAt - this.ctx.currentTime);
  }
  /** seconds of speech in hand that have not been heard yet, counting what is held back before the start */
  buffered() {
    return this.released ? this.ahead() : this.heldSecs;
  }
  /** Quiet trimmed from both ends (just enough so chunks join without a click), then a short, natural pause. */
  enqueue(parts: Part[], samples: Float32Array, rate: number, gapAfter: number) {
    let a = 0;
    let b = samples.length;
    const quiet = 0.006;
    while (a < b - 1 && Math.abs(samples[a]) < quiet) a++;
    while (b > a + 1 && Math.abs(samples[b - 1]) < quiet) b--;
    a = Math.max(0, a - Math.round(rate * 0.02));
    b = Math.min(samples.length, b + Math.round(rate * 0.03));
    const buf = this.ctx.createBuffer(1, b - a, rate);
    const data = samples.slice(a, b);
    // a very short fade on both ends: no clicks where one chunk meets the next
    const f = Math.min(data.length >> 1, Math.round(rate * 0.012));
    for (let k = 0; k < f; k++) {
      data[k] *= k / f;
      data[data.length - 1 - k] *= k / f;
    }
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    if (!this.released) {
      this.held.push({ parts, buf, gap: gapAfter });
      this.heldSecs += buf.duration / this.tempo;
      if (this.heldSecs >= this.prebuffer) this.release();
      return;
    }
    this.place(parts, buf, gapAfter);
  }
  private place(parts: Part[], buf: AudioBuffer, gapAfter: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = this.tempo;
    src.connect(this.ctx.destination);
    const at = Math.max(this.nextAt, this.ctx.currentTime + 0.05);
    if (this.nextAt && at - this.nextAt > 0.02) console.debug(`[studio] gap ${(at - this.nextAt).toFixed(2)} s (the next piece was not ready in time)`);
    if (!this.nextAt) console.debug(`[studio] first sound at +${Math.round(performance.now() - this.born)} ms`);
    const dur = buf.duration / this.tempo;
    src.start(at);
    // the highlight moves through the chunk's sentences in proportion to how much text each holds
    const sum = parts.reduce((x, p) => x + p.w, 0) || 1;
    let acc = 0;
    for (const p of parts) {
      this.slots.push({ i: p.i, start: at + (dur * acc) / sum, end: at + (dur * (acc + p.w)) / sum });
      acc += p.w;
    }
    this.nextAt = at + dur + gapAfter;
    this.srcs.push(src);
    src.onended = () => {
      const k = this.srcs.indexOf(src);
      if (k >= 0) this.srcs.splice(k, 1);
    };
  }
  /** Start playing what has been gathered so far (called automatically, or when there is no more to wait for). */
  release() {
    if (this.released) return;
    this.released = true;
    for (const h of this.held) this.place(h.parts, h.buf, h.gap);
    this.held = [];
  }
  /** Wait: the clock stops (nothing is heard) until `unhold`; what is placed meanwhile plays right after. */
  hold() {
    this.paused = true;
    this.ctx.suspend().catch(() => {});
  }
  unhold() {
    this.paused = false;
    this.ctx.resume().catch(() => {});
  }
  /** nothing at all was voiced */
  empty() {
    return this.slots.length === 0 && this.held.length === 0;
  }
  /** The sentence being heard now (stays on the last one through the pause that follows it). */
  current(): number | null {
    const t = this.ctx.currentTime;
    let cur: number | null = null;
    for (const s of this.slots) {
      if (s.start <= t + 0.01) cur = s.i;
      else break;
    }
    return cur;
  }
  /** everything scheduled has been heard */
  drained() {
    return this.slots.length > 0 && this.ctx.currentTime >= (this.slots[this.slots.length - 1].end ?? 0);
  }
  started() {
    return this.slots.length > 0 && this.ctx.currentTime >= this.slots[0].start;
  }
  stop() {
    this.srcs.forEach((s) => {
      try {
        s.onended = null;
        s.stop();
      } catch {
        /* already stopped */
      }
    });
    this.srcs = [];
    this.slots = [];
    clearInterval(this.watch);
    this.dropWake();
    this.ctx.onstatechange = null;
    this.ctx.close().catch(() => {});
  }
}
