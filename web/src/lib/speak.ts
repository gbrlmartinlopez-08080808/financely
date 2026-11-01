// Listening on the computer: the browser's own voices (free, nothing is sent anywhere). The text is read sentence by
// sentence, the sentence being read is highlighted, and the page follows along.
import { guessLang } from './fr';

export interface SpeakVoice {
  uri: string;
  name: string;
  lang: string;
  natural: boolean;
  local: boolean;
}
const NATURAL = /natural|neural|online|premium|enhanced|siri|google/i;
let cache: SpeakVoice[] | null = null;
export async function voices(): Promise<SpeakVoice[]> {
  if (cache?.length) return cache;
  const synth = window.speechSynthesis;
  if (!synth) return [];
  let vs = synth.getVoices();
  if (!vs.length)
    vs = await new Promise((r) => {
      const t = setTimeout(() => r(synth.getVoices()), 1500);
      synth.onvoiceschanged = () => (clearTimeout(t), r(synth.getVoices()));
    });
  cache = vs.map((v) => ({ uri: v.voiceURI, name: v.name.replace(/^(Microsoft|Google)\s+/i, ''), lang: v.lang, natural: NATURAL.test(v.name), local: v.localService }));
  return cache;
}
/** The best voice for a language: a natural-sounding one in that language, else any in it. */
export function bestFor(vs: SpeakVoice[], lang: string, prefer?: string): SpeakVoice | undefined {
  const mine = vs.filter((v) => v.lang.toLowerCase().startsWith(lang));
  const pref = mine.find((v) => v.uri === prefer);
  if (pref) return pref;
  return [...mine].sort((a, b) => Number(b.natural) - Number(a.natural) || Number(b.local) - Number(a.local))[0];
}
export { guessLang };

/** Cuts a block of text into sentences, keeping where each one starts. */
export function sentencesOf(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const re = /[^.!?…]+(?:[.!?…]+["”’)\]]*|$)\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const t = m[0].trim();
    if (t.length > 1 && /[\p{L}\p{N}]/u.test(t)) out.push({ text: t, start: m.index + (m[0].length - m[0].trimStart().length) });
    if (re.lastIndex >= text.length) break;
  }
  return out;
}

/** Text that reads well aloud (no reference marks or links read out letter by letter). */
export const speakable = (t: string) =>
  t
    .replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, '')
    .replace(/https?:\/\/\S+|www\.\S+/g, 'link')
    .replace(/\be\.g\./gi, 'for example')
    .replace(/\bi\.e\./gi, 'that is')
    .replace(/\s+/g, ' ')
    .trim();

type Unit = { block: HTMLElement; text: string; range?: Range };
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, figcaption, dd, dt';

/** The sentences of an element, each with the range that covers it (for highlighting). */
export function unitsOf(root: HTMLElement): Unit[] {
  const out: Unit[] = [];
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCKS)).filter((b) => !b.querySelector(BLOCKS));
  for (const block of blocks) {
    const nodes: Text[] = [];
    let full = '';
    const starts: number[] = [];
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
      starts.push(full.length);
      nodes.push(n);
      full += n.data;
    }
    for (const s of sentencesOf(full)) {
      const t = speakable(s.text);
      if (!t || (t.match(/\p{L}/gu)?.length ?? 0) < 2) continue;
      const at = (off: number) => {
        let i = starts.length - 1;
        while (i > 0 && starts[i] > off) i--;
        return { node: nodes[i], off: off - starts[i] };
      };
      let range: Range | undefined;
      try {
        range = document.createRange();
        const a = at(s.start);
        const b = at(s.start + s.text.length);
        range.setStart(a.node, Math.min(a.off, a.node.length));
        range.setEnd(b.node, Math.min(b.off, b.node.length));
      } catch {
        range = undefined;
      }
      out.push({ block, text: t, range });
    }
  }
  return out;
}

/** A reader that speaks `units` one after another. */
export class Reader {
  private i = 0;
  private token = 0;
  private units: Unit[] = [];
  playing = false;
  constructor(
    private root: HTMLElement,
    private opts: { rate: () => number; voice: () => SpeakVoice | undefined; lang: () => string; onState: (playing: boolean, i: number, n: number) => void; onEnd: () => void },
  ) {}
  private show(u?: Unit) {
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    this.root.querySelectorAll('.saying').forEach((e) => e.classList.remove('saying'));
    if (!u) return reg?.delete('saying');
    if (reg && u.range && 'Highlight' in window) reg.set('saying', new (window as unknown as { Highlight: new (r: Range) => unknown }).Highlight(u.range));
    else u.block.classList.add('saying');
    const r = (u.range ?? new Range()).getBoundingClientRect?.() ?? u.block.getBoundingClientRect();
    const box = (u.range && r.height ? r : u.block.getBoundingClientRect());
    const sc = u.block.closest('.reading, .viewer') as HTMLElement | null;
    if (sc) {
      const s = sc.getBoundingClientRect();
      if (box.top < s.top + 80 || box.bottom > s.bottom - 120) sc.scrollTo({ top: sc.scrollTop + box.top - s.top - s.height * 0.3, behavior: 'smooth' });
    }
  }
  /** Starts at the sentence nearest to `from` (an element or a point), or the first one on screen. */
  play(from?: number) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    this.units = unitsOf(this.root);
    if (!this.units.length) return this.opts.onEnd();
    if (from !== undefined) this.i = Math.max(0, Math.min(this.units.length - 1, from));
    else {
      const sc = this.root.closest('.reading, .viewer') as HTMLElement | null;
      const top = sc?.getBoundingClientRect().top ?? 0;
      const first = this.units.findIndex((u) => u.block.getBoundingClientRect().bottom > top + 60);
      this.i = Math.max(0, first);
    }
    this.go();
  }
  private go() {
    const synth = window.speechSynthesis;
    const my = ++this.token;
    synth.cancel();
    this.playing = true;
    const step = () => {
      if (my !== this.token) return;
      const u = this.units[this.i];
      if (!u) {
        this.playing = false;
        this.show();
        this.opts.onState(false, this.units.length, this.units.length);
        return this.opts.onEnd();
      }
      this.show(u);
      this.opts.onState(true, this.i, this.units.length);
      // a short run of sentences of one paragraph, in one utterance: the voice keeps its intonation
      const ut = new SpeechSynthesisUtterance(u.text);
      ut.rate = this.opts.rate();
      const v = this.opts.voice();
      if (v) ut.voice = window.speechSynthesis.getVoices().find((x) => x.voiceURI === v.uri) ?? null;
      ut.lang = v?.lang ?? this.opts.lang();
      ut.onend = () => {
        if (my !== this.token) return;
        this.i++;
        step();
      };
      ut.onerror = (e) => {
        if (my !== this.token || e.error === 'canceled' || e.error === 'interrupted') return;
        this.i++;
        step();
      };
      synth.speak(ut);
    };
    step();
  }
  pause() {
    this.token++;
    window.speechSynthesis?.cancel();
    this.playing = false;
    this.opts.onState(false, this.i, this.units.length);
  }
  skip(d: number) {
    const was = this.playing;
    this.i = Math.max(0, Math.min(this.units.length - 1, this.i + d));
    this.show(this.units[this.i]);
    if (was) this.go();
    else this.opts.onState(false, this.i, this.units.length);
  }
  /** Changing the speed or the voice takes effect from the sentence being read. */
  restart() {
    if (this.playing) this.go();
  }
  stop() {
    this.token++;
    window.speechSynthesis?.cancel();
    this.playing = false;
    this.show();
  }
}
