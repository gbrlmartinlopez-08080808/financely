import { useCallback, useEffect, useRef, useState } from 'react';
import { bestVoice, detectLanguage, LANG_NAME, listVoices, openVoiceInstall, speak, speechText, stopSpeaking, ttsAvailable, type Voice } from '../lib/tts';
import { NEURAL_PREFIX, NEURAL_VOICES, NeuralPlayer, sharedEngine, isNeural, lighterThan, neuralId, neuralStored, neuralSupported } from '../lib/neural';
import { VoiceSheet } from './VoiceSheet';
import { Scrub } from './Scrub';
import { goPage } from './paged';
import { firstVisibleSentence, markSaying, sentenceAtPoint, sentenceRaw, sentenceText, wrapSentences } from './dom';
import { updateSettings, useStore } from '../lib/store';
import { isNative, mediaStart, mediaStop, mediaUpdate, onMediaAction, tap } from '../lib/native';
import { notifyPermission } from '../lib/reminders';
import * as db from '../lib/db';
import { Icon } from '../ui/Icon';
import { Ruler, Sheet, toast } from '../ui/kit';

interface Props {
  root: HTMLElement | null;
  scroller: HTMLElement | null;
  startAt?: number | null; // sentence index to start from (e.g. "Listen from here")
  onPlaying: (p: boolean) => void;
  docId: string;
  title?: string;
  coverId?: string;
}

const SLEEP = [0, 10, 20, 30, 60];
/** The reading language chips: auto first, then the languages with natural voices. */
const LANG_CYCLE = ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt'];
const LANG_CODES: Record<string, string> = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT' };

export function ListenBar({ root, scroller, startAt, onPlaying, docId, title = 'Frogity', coverId }: Props) {
  const settings = useStore((s) => s.settings);
  const [idx, setIdx] = useState(0);
  const [total, setTotal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pop, setPop] = useState<'speed' | null>(null);
  const [voiceSheet, setVoiceSheet] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [sleep, setSleep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [langTag, setLangTag] = useState('en-US'); // the language the book is read in
  const [langAuto, setLangAuto] = useState(true);
  const neuralSlow = useRef(false); // the studio voice could not keep up on this phone: the phone's own voice reads
  const storedRef = useRef<string[]>([]);
  storedRef.current = stored;
  const player = useRef<NeuralPlayer | null>(null);
  const neuralBroken = useRef(false);
  const bestRef = useRef<string | undefined>(undefined);
  const sleepAt = useRef(0);
  const rateT = useRef(0);
  const token = useRef(0);
  const lang = useRef('en-US');
  const idxRef = useRef(0);
  idxRef.current = idx;
  const opts = useRef(settings);
  opts.current = settings;

  // prepare sentences
  useEffect(() => {
    if (!root) return;
    const n = wrapSentences(root);
    setTotal(n);
    const forced = localStorage.getItem('lang:' + docId);
    const found = forced && forced !== 'auto' ? LANG_CODES[forced] ?? forced : detectLanguage(root.textContent ?? '').lang;
    lang.current = found;
    setLangTag(found);
    setLangAuto(!forced || forced === 'auto');
    root.classList.add('listening');
    const saved = Number(localStorage.getItem('listen:' + docId) ?? NaN);
    const first = scroller ? firstVisibleSentence(root, scroller) : 0;
    setIdx(Number.isFinite(saved) && Math.abs(saved - first) < 40 ? saved : first);
    return () => {
      root.classList.remove('listening', 'focus');
      markSaying(root, null);
    };
  }, [root, scroller, docId]);

  useEffect(() => {
    root?.classList.toggle('focus', settings.focusListen && playing);
  }, [root, settings.focusListen, playing]);

  // ---- listening as a "track": lock-screen / notification player, keeps going with the screen off
  const media = useRef(false);
  const handlers = useRef<Record<string, () => void>>({});
  const coverB64 = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!isNative || !coverId) return;
    db.get<Blob>('blobs', coverId).then((b) => {
      if (!b) return;
      const r = new FileReader();
      r.onload = () => (coverB64.current = String(r.result).split(',')[1]);
      r.readAsDataURL(b);
    });
  }, [coverId]);
  useEffect(() => {
    let off = () => {};
    onMediaAction((a) => handlers.current[a]?.()).then((f) => (off = f));
    return () => {
      off();
      if (media.current) mediaStop();
      media.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isNative) return;
    const left = total ? Math.max(1, Math.round(((total - idx) / total) * ((root?.textContent ?? '').split(/\s+/).length || 0) / (165 * settings.ttsRate))) : 0;
    const subtitle = `${left ? left + ' min left · ' : ''}${idx + 1}/${total || '–'}`;
    if (playing && !media.current) {
      media.current = true;
      notifyPermission(true).finally(() => mediaStart({ title, subtitle, playing: true, cover: coverB64.current }));
    } else if (media.current) mediaUpdate({ title, subtitle, playing });
  }, [playing, Math.floor(idx / 8)]); // eslint-disable-line react-hooks/exhaustive-deps

  // load the studio voice as soon as listening opens, so pressing play starts at once
  useEffect(() => {
    const v = settings.ttsVoice;
    if (!isNeural(v) || !neuralSupported() || neuralBroken.current) return;
    // the first engine first, then the helper (so the first one never competes for the phone while it loads)
    // the voice loads while the reader looks at the controls; pressing play never waits for it (the phone's voice covers)
    const t = setTimeout(() => sharedEngine.init(neuralId(v)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [settings.ttsVoice]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listVoices().then(setVoices);
    neuralStored().then(setStored);
  }, []);
  useEffect(() => {
    bestRef.current = bestVoice(voices, lang.current)?.id;
  }, [voices, total, langTag]);

  const follow = (el: HTMLElement | null) => {
    if (!el || !scroller) return;
    const r = el.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    if (scroller.classList.contains('paged')) {
      // flipping pages: turn to the page the sentence is on
      if (r.left < sr.left - 2 || r.right > sr.right + 2) goPage(scroller, Math.round((scroller.scrollLeft + r.left - sr.left) / Math.max(1, scroller.clientWidth)));
      return;
    }
    if (r.top < sr.top + 90 || r.bottom > sr.bottom - 260) {
      scroller.scrollTo({ top: scroller.scrollTop + r.top - sr.top - sr.height * 0.3, behavior: 'smooth' });
    }
  };

  /**
   * What to say next: a few whole sentences together, so the voice carries its intonation from one to the next
   * instead of finishing every sentence as if it were the end. `offset` starts the first sentence mid-way (a tapped word).
   */
  const buildChunk = (from: number, n: number, offset: number, target: number) => {
    if (!root) return null;
    const parts: { i: number; at: number; w: number }[] = [];
    let text = '';
    let i = from;
    for (; i < n; i++) {
      const raw = i === from && offset > 0 ? sentenceRaw(root, i).slice(offset) : sentenceText(root, i);
      let t = speechText(raw, lang.current.slice(0, 2));
      if (!t || !speakable(t)) continue;
      if (!/[.!?…:;,"”’)\]]$/.test(t)) t += '.'; // a heading or list line: a breath before the next one
      if (text && text.length + t.length > target * 1.35) break;
      parts.push({ i, at: text ? text.length + 1 : 0, w: t.length });
      text += (text ? ' ' : '') + t;
      if (text.length >= target) {
        i++;
        break;
      }
    }
    return text ? { text, parts, next: i } : null;
  };

  /**
   * The voice to use for this book: the chosen one while it speaks the book's language; otherwise a natural voice of that
   * language if one is on the phone, otherwise the phone's best voice for it (never an English voice reading Spanish).
   */
  const resolveVoice = (): string | undefined => {
    const chosen = opts.current.ttsVoice;
    const dl = lang.current.slice(0, 2);
    const cl = !chosen ? dl : isNeural(chosen) ? NEURAL_VOICES.find((v) => NEURAL_PREFIX + v.id === chosen)?.lang.slice(0, 2) : voices.find((v) => v.id === chosen)?.lang.slice(0, 2);
    if (chosen && (opts.current.autoVoice === false || !cl || cl === dl)) return chosen;
    const mine = NEURAL_VOICES.filter((v) => v.lang.slice(0, 2) === dl && storedRef.current.includes(v.id)).sort((x, y) => Number(y.lang === lang.current) - Number(x.lang === lang.current) || Number(!!y.rec) - Number(!!x.rec))[0];
    if (mine) return NEURAL_PREFIX + mine.id;
    return bestVoice(voices, lang.current)?.id; // none natural installed: the phone's own voice for that language
  };
  /** Said once per book: the book is in a language that has no voice on this phone yet. */
  const told = useRef('');
  const tellVoice = () => {
    const dl = lang.current.slice(0, 2);
    if (told.current === dl || dl === 'en') return;
    told.current = dl;
    const name = LANG_NAME[dl] ?? dl;
    const natural = NEURAL_VOICES.some((v) => v.lang.slice(0, 2) === dl);
    if (storedRef.current.some((id) => NEURAL_VOICES.find((v) => v.id === id)?.lang.slice(0, 2) === dl)) return;
    if (bestVoice(voices, lang.current)) return toast(`Reading in ${name} with the phone’s ${name} voice${natural ? ' · a natural one is in Voice' : ''}`, undefined, natural ? () => setVoiceSheet(true) : undefined);
    toast(natural ? `This book is in ${name}. Get a natural ${name} voice →` : `This book is in ${name} but the phone has no ${name} voice. Install one →`, undefined, () => (natural ? setVoiceSheet(true) : openVoiceInstall()));
  };

  /** Skips what is not worth hearing: rows of numbers, formulas, table cells. */
  const speakable = (t: string) => {
    const letters = (t.match(/\p{L}/gu) ?? []).length;
    return letters >= 2 && (t.length < 14 || letters / t.length > 0.45);
  };

  /**
   * Studio voice. One engine keeps the voice loaded; pieces are made ahead and placed on one audio clock right behind
   * the last, so speech flows. If the phone ever falls behind, playback waits (a short, deliberate pause while it catches
   * up) instead of stuttering. While the voice is still loading, the phone's own voice reads and hands over by itself.
   */
  const runNeural = async (from: number, my: number, sel: string, n: number, offset: number) => {
    if (!root) return;
    const eng = sharedEngine;
    const vid = neuralId(sel);
    if (!eng.isReady(vid)) {
      // never make the reader wait for the voice to load: the phone's own voice starts now, the studio voice joins when ready
      setBusy(true);
      setNote('starting with the phone’s voice · the studio voice is loading');
      let ready = false;
      let failed = false;
      const cut = () => {
        // the phone's voice is cut short and the studio voice takes over from the sentence being heard
        if (my === token.current) stopSpeaking();
      };
      eng.init(vid).then(
        () => {
          ready = true;
          cut();
        },
        (e) => {
          failed = true;
          console.warn('studio voice failed to load', e);
          cut();
        },
      );
      const sys = await runSystem(from, my, n, offset, undefined, () => ready || failed, true);
      if (my !== token.current) return;
      if (failed) {
        neuralBroken.current = true;
        setNote('');
        toast('The studio voice couldn’t start — using the phone’s voice');
        return void run(sys.at, 0);
      }
      setNote('');
      if (sys.done) return;
      return runNeural(sys.at, my, sel, n, 0);
    }
    setNote('');
    // a slow phone: a lighter voice of this language plays smoother
    if (eng.rtf > 0.9) {
      const cur = NEURAL_VOICES.find((v) => v.id === vid);
      const light = cur && lighterThan(cur);
      if (light && storedRef.current.includes(light.id)) {
        await updateSettings({ ttsVoice: NEURAL_PREFIX + light.id });
        toast(`${cur.label} is heavy for this phone — using ${light.label}`);
        return void run(from, offset);
      }
      if (light) toast(`${cur.label} is heavy for this phone. “${light.label}” would play smoother — open Voice to get it`, undefined, () => setVoiceSheet(true));
    }
    const rate = opts.current.ttsRate;
    const say = Math.min(rate, 2);
    const tempo = rate > 2 ? rate / 2 : 1; // beyond 2× the voice itself stops getting faster: speed up playback a little
    const pl = (player.current = new NeuralPlayer(tempo, 0.25));
    setBusy(true);

    // the pipeline: pieces being made (in order), what has been placed, how fast this phone is
    type Job = { ch: NonNullable<ReturnType<typeof buildChunk>>; p: Promise<{ samples: Float32Array; rate: number }> };
    const jobs: Job[] = [];
    let at = from;
    let off = offset;
    let made = 0;
    let rtf = Math.max(0.15, eng.rtf || 0.5); // seconds of work per second of speech (measured, then kept up to date)
    let finished = false;
    let shown = -1;
    let holding = false;
    let holdSince = 0;
    const dry: number[] = []; // when it ran dry, over the last minute and a half
    let gaveUp = false;
    const CPS = 14; // characters per second of speech at 1×

    /** This phone cannot make speech as fast as it is spoken: carry on with the phone's own voice, at the sentence being heard. */
    const giveUp = () => {
      if (gaveUp || my !== token.current) return;
      gaveUp = true;
      neuralSlow.current = true;
      const here = pl.current() ?? idxRef.current;
      pl.stop();
      const cur = NEURAL_VOICES.find((v) => v.id === vid);
      const light = cur && lighterThan(cur);
      toast(
        light && !storedRef.current.includes(light.id)
          ? `${cur.label} is too heavy for this phone — reading with the phone’s voice. “${light.label}” would run smoothly →`
          : 'The studio voice cannot keep up on this phone right now — reading with the phone’s voice',
        undefined,
        light && !storedRef.current.includes(light.id) ? () => setVoiceSheet(true) : undefined,
      );
      void run(here, 0);
    };

    const watch = () => {
      if (my !== token.current) return;
      const i = pl.current();
      if (i !== null && i !== shown) {
        shown = i;
        setBusy(false);
        setIdx(i);
        localStorage.setItem('listen:' + docId, String(i));
        follow(markSaying(root, i));
      }
      const now = Date.now();
      // ran dry while more is on its way: wait quietly for a few seconds (never longer), then go on with what there is
      if (!holding && pl.started() && !finished && pl.ahead() < 0.12 && (jobs.length || at < n)) {
        dry.push(now);
        while (dry.length && now - dry[0] > 90_000) dry.shift();
        if (dry.length >= 3) return giveUp();
        holding = true;
        holdSince = now;
        pl.hold();
        setNote('catching up…');
      } else if (holding && (pl.ahead() >= 2.5 || now - holdSince > 6000 || (finished && jobs.length === 0))) {
        holding = false;
        pl.unhold();
        setNote('');
      }
      if (sleepAt.current && Date.now() > sleepAt.current && pl.started()) {
        sleepAt.current = 0;
        setSleep(0);
        toast('Sleep timer — paused. Sweet dreams.');
        return pause();
      }
      if (finished && !holding && (pl.drained() || pl.empty())) {
        setPlaying(false);
        onPlaying(false);
        return;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);

    // how many characters may the next piece have, so it is ready before the speech ahead of it has been heard?
    const size = () => {
      if (made === 0) return 24;
      const ahead = pl.buffered() + jobs.reduce((x, j) => x + j.ch.text.length / (CPS * say), 0);
      const budget = Math.round(((ahead * CPS * say) / rtf) * 0.55);
      return Math.max(made < 3 ? 30 : 110, Math.min(made < 3 ? 40 * 2 ** made : 340, budget));
    };
    /** The next piece: whole sentences when they fit, otherwise the next phrase of a long sentence. */
    const piece = (target: number) => {
      const ch = buildChunk(at, n, off, target);
      if (!ch || ch.text.length <= target * 1.15) return ch;
      const first = ch.parts[0];
      if (ch.parts.length > 1) {
        const keep = ch.parts.filter((p) => p.at + p.w <= target * 1.15);
        if (keep.length) {
          const last = keep[keep.length - 1];
          return { text: ch.text.slice(0, last.at + last.w), parts: keep, next: last.i + 1 };
        }
      }
      const startOff = first.i === at ? off : 0;
      const raw = sentenceRaw(root, first.i).slice(startOff);
      const lo = Math.min(made === 0 ? 12 : 20, raw.length);
      const hi = Math.max(lo + 10, Math.round(target * 1.1));
      const m = raw.slice(lo, hi).search(/[,;:—–)]\s/);
      const cut = m >= 0 ? lo + m + 1 : lo + Math.max(0, raw.slice(lo, hi).lastIndexOf(' '));
      if (cut <= 10 || cut >= raw.length - 8) return ch;
      const head = speechText(raw.slice(0, cut), lang.current.slice(0, 2));
      if (!head) return ch;
      return { text: head, parts: [{ i: first.i, at: 0, w: head.length }], next: first.i, off: startOff + cut };
    };
    const fill = () => {
      while (my === token.current && at < n && jobs.length < 2 && pl.ahead() < 40) {
        const ch = piece(size()) as (NonNullable<ReturnType<typeof buildChunk>> & { off?: number }) | null;
        if (!ch) {
          at = n;
          break;
        }
        off = ch.off ?? 0;
        at = ch.next;
        const t0 = performance.now();
        const p = eng.say(ch.text, say).then((r) => {
          const secs = r.samples.length / r.rate / say;
          rtf = rtf * 0.6 + Math.max(0.1, (performance.now() - t0) / 1000 / Math.max(0.4, secs)) * 0.4;
          return r;
        });
        p.catch(() => {});
        jobs.push({ ch, p });
        made++;
      }
    };
    while (my === token.current) {
      fill();
      const job = jobs.shift();
      if (!job) break;
      try {
        const r = await job.p;
        if (my !== token.current) return;
        console.debug(`[studio] ${job.ch.parts.length} sentence(s), ${(r.samples.length / r.rate).toFixed(1)} s of speech · ${pl.ahead().toFixed(1)} s ready ahead · rtf ${rtf.toFixed(2)}`);
        // pauses like a narrator's: a breath after a sentence, a longer one between paragraphs and after a heading
        const lastI = job.ch.parts[job.ch.parts.length - 1].i;
        const endsSentence = /[.!?…]["”’)\]]*$/.test(job.ch.text) && job.ch.next > lastI;
        const blockOf = (i: number) => root.querySelector(`.s[data-i="${i}"]`)?.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, td, pre, dd, dt');
        const here = endsSentence ? blockOf(lastI) : null;
        const gap = !endsSentence ? (/[,;:—–]$/.test(job.ch.text) ? 0.08 : 0.02) : here && /^H\d$/.test(here.tagName) ? 0.5 : here && here !== blockOf(lastI + 1) ? 0.38 : 0.2;
        pl.enqueue(job.ch.parts.map((p) => ({ i: p.i, w: p.w })), r.samples, r.rate, gap);
      } catch (e) {
        if (my !== token.current) return;
        console.warn('studio voice failed', e);
        neuralBroken.current = true;
        pl.stop();
        toast('The studio voice stopped — using the phone’s voice');
        run(job.ch.parts[0].i);
        return;
      }
      while (my === token.current && pl.ahead() > 40) await new Promise((r) => setTimeout(r, 250));
    }
    if (my !== token.current) return;
    pl.release();
    finished = true;
  };

  /**
   * The phone's own voice: several sentences per request (so it doesn't end every sentence on a falling note), and the
   * engine's word positions move the highlight. `handoff` is asked after each piece: when it says yes, this returns and the
   * studio voice takes over from the next sentence.
   */
  const runSystem = async (from: number, my: number, n: number, offset: number, chosen: string | undefined, handoff?: () => boolean, short = false): Promise<{ at: number; done: boolean }> => {
    let at = from;
    let off = offset;
    let first = true;
    let fails = 0;
    while (at < n) {
      if (my !== token.current) return { at, done: true };
      if (handoff?.()) return { at, done: false };
      const ch = buildChunk(at, n, off, first || short ? 90 : 300);
      const chunkOff = off;
      const chunkFrom = at;
      off = 0;
      first = false;
      if (!ch) break;
      at = ch.next;
      const show = (k: number) => {
        const i = ch.parts[k].i;
        setIdx(i);
        localStorage.setItem('listen:' + docId, String(i));
        follow(markSaying(root!, i));
      };
      let cur = 0;
      let heard = false;
      const t0 = Date.now();
      show(0);
      setBusy(false);
      const move = (pos: number) => {
        let k = cur;
        while (k + 1 < ch.parts.length && ch.parts[k + 1].at <= pos) k++;
        if (k !== cur) {
          cur = k;
          show(k);
        }
      };
      const s = opts.current;
      const timer = setInterval(() => !heard && move(((Date.now() - t0) / 1000) * 14 * s.ttsRate), 250);
      const r = await speak(ch.text, { rate: s.ttsRate, pitch: s.ttsPitch, voice: chosen ?? bestRef.current, lang: lang.current }, (ci) => {
        heard = true;
        move(ci);
      });
      clearInterval(timer);
      if (my !== token.current) return { at, done: true };
      // handed over mid-piece: the sentence being heard is read again by the new voice
      if (r === 'stopped' && handoff?.()) return { at: ch.parts[Math.min(cur, ch.parts.length - 1)].i, done: false };
      if (r === 'stopped') {
        // not stopped by the reader (that is caught above) and not handed over: the phone's engine dropped out
        // (another app took the audio, the engine restarted). Start the same piece again; if it keeps failing, say so.
        if (++fails <= 3) {
          await new Promise((res) => setTimeout(res, 300 * fails));
          at = chunkFrom;
          off = chunkOff;
          continue;
        }
        if (my === token.current) {
          setPlaying(false);
          onPlaying(false);
          setBusy(false);
          toast('The phone’s voice stopped — tap play to go on', undefined, () => setVoiceSheet(true));
        }
        return { at, done: true };
      }
      fails = 0;
      if (sleepAt.current && Date.now() > sleepAt.current) {
        sleepAt.current = 0;
        setSleep(0);
        toast('Sleep timer — paused. Sweet dreams.');
        return { at, done: true };
      }
    }
    if (my === token.current) {
      setPlaying(false);
      onPlaying(false);
    }
    return { at, done: true };
  };

  const run = useCallback(
    async (from: number, offset = 0) => {
      if (!root) return;
      // whatever was playing stops first, completely: no old audio, no sentences still being made
      player.current?.stop();
      player.current = null;
      stopSpeaking();
      sharedEngine.cancel();
      const my = ++token.current;
      setPlaying(true);
      onPlaying(true);
      const n = Number(root.dataset.wrapped ?? 0);
      const chosen = resolveVoice();
      tellVoice();
      if (isNeural(chosen) && !neuralBroken.current && !neuralSlow.current) return runNeural(from, my, chosen, n, offset);
      await runSystem(from, my, n, offset, chosen);
    },
    [root, docId, onPlaying], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pause = useCallback(() => {
    token.current++;
    stopSpeaking();
    player.current?.stop();
    player.current = null;
    sharedEngine.cancel();
    setNote('');
    setBusy(false);
    setPlaying(false);
    onPlaying(false);
  }, [onPlaying]);

  // external "listen from here"
  useEffect(() => {
    if (startAt !== null && startAt !== undefined && root) {
      pause();
      setTimeout(() => run(startAt), 60);
    }
  }, [startAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // tap any word (playing or paused) → carry on reading from that word
  useEffect(() => {
    if (!root) return;
    const on = (e: MouseEvent) => {
      if (window.getSelection()?.toString()) return;
      if ((e.target as HTMLElement).closest('a, button, input, textarea')) return;
      const hit = sentenceAtPoint(root, e.clientX, e.clientY);
      if (!hit) return;
      e.stopPropagation();
      e.preventDefault();
      tap('select');
      pause();
      setIdx(hit.i);
      follow(markSaying(root, hit.i));
      setTimeout(() => run(hit.i, hit.offset), 60);
    };
    root.addEventListener('click', on, true);
    return () => root.removeEventListener('click', on, true);
  }, [root, run, pause]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      pause(); // the voice itself stays loaded in the app, ready for the next book
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const restartAtCurrent = () => {
    if (playing) {
      pause();
      setTimeout(() => run(idxRef.current), 80);
    }
  };

  const skip = (d: number) => {
    tap();
    const next = Math.max(0, Math.min(total - 1, idx + d));
    setIdx(next);
    if (playing) {
      pause();
      setTimeout(() => run(next), 60);
    } else if (root) follow(markSaying(root, next));
  };

  handlers.current = {
    toggle: () => (playing ? pause() : run(idxRef.current)),
    play: () => (playing ? undefined : run(idxRef.current)),
    pause: () => (playing ? pause() : undefined),
    next: () => skip(5),
    prev: () => skip(-5),
    stop: () => {
      pause();
      mediaStop();
      media.current = false;
    },
  };

  if (!ttsAvailable())
    return (
      <div className="listen">
        <div className="listen-top">Text-to-speech is not available on this device.</div>
      </div>
    );

  const wpm = 165 * settings.ttsRate;
  const leftWords = root ? Math.round(((total - idx) / Math.max(1, total)) * ((root.textContent ?? '').split(/\s+/).length || 0)) : 0;
  const leftMin = Math.max(1, Math.round(leftWords / wpm));
  /** the whole track, in minutes (for the scrubber's label) */
  const leftAll = total ? (leftMin * total) / Math.max(1, total - idx) : 0;
  const nv = isNeural(settings.ttsVoice) ? NEURAL_VOICES.find((v) => NEURAL_PREFIX + v.id === settings.ttsVoice) : undefined;
  const voice = voices.find((v) => v.id === settings.ttsVoice) ?? (nv ? undefined : voices.find((v) => v.id === bestRef.current));
  const docLang = langTag.slice(0, 2);
  const pct = total > 1 ? Math.round((idx / (total - 1)) * 100) : 0;
  const status = note || (busy ? 'getting ready…' : playing ? 'reading aloud' : 'paused');

  return (
    <div className="listen" style={{ position: 'relative' }}>
      {pop === 'speed' && (
        <div className="popover">
          <Ruler
            value={settings.ttsRate}
            min={0.5}
            max={3}
            step={0.1}
            format={(v) => `${v.toFixed(1)}×`}
            onChange={(v) => {
              updateSettings({ ttsRate: v });
              opts.current = { ...opts.current, ttsRate: v };
              clearTimeout(rateT.current);
              rateT.current = window.setTimeout(restartAtCurrent, 450);
            }}
            label="Speed"
          />
        </div>
      )}
      <div className="listen-top">
        <span className={`eq${playing ? ' on' : ''}`} aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="grow">{status}</span>
        <span className="mono">{leftMin} min left</span>
      </div>
      <Scrub
        className="listen-scrub2"
        ariaLabel="Position in the track"
        value={total > 1 ? idx / (total - 1) : 0}
        label={(v) => {
          const i = Math.round(v * Math.max(0, total - 1));
          return `${Math.round(v * 100)}% · ${Math.max(0, Math.round(((total - i) / Math.max(1, total)) * leftAll))} min left`;
        }}
        onChange={(v, final) => {
          const i = Math.round(v * Math.max(0, total - 1));
          if (!root) return;
          if (!final) {
            follow(markSaying(root, i));
            return;
          }
          setIdx(i);
          localStorage.setItem('listen:' + docId, String(i));
          if (playing) run(i);
          else follow(markSaying(root, i));
        }}
      />
      <div className="listen-times mono" aria-hidden>
        <span>{pct}%</span>
        <span>
          {idx + 1} / {total || '–'}
        </span>
      </div>
      <div className="listen-ctrl">
        <button className="sm" onClick={() => skip(-5)} aria-label="Back five sentences">
          <Icon name="rew" size={22} />
        </button>
        <button className="sm" onClick={() => skip(-1)} aria-label="Previous sentence">
          <Icon name="prev" size={22} />
        </button>
        <button
          className="big"
          onClick={() => {
            tap('medium');
            if (playing) pause();
            else run(idx);
          }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={26} stroke={2.6} />
        </button>
        <button className="sm" onClick={() => skip(1)} aria-label="Next sentence">
          <Icon name="next" size={22} />
        </button>
        <button className="sm" onClick={() => skip(5)} aria-label="Forward five sentences">
          <Icon name="fwd" size={22} />
        </button>
      </div>
      <div className="listen-chips">
        <button className={pop === 'speed' ? 'on' : ''} onClick={() => setPop(pop === 'speed' ? null : 'speed')}>
          <Icon name="speed" size={15} /> {settings.ttsRate.toFixed(1)}×
        </button>
        <button onClick={() => setVoiceSheet(true)}>
          <Icon name="voice" size={15} /> {nv ? nv.label : voice ? voice.name.replace(/^(Google|Microsoft)\s*/, '').slice(0, 12) : 'Voice'}
        </button>
        <button
          className={langAuto ? '' : 'on'}
          onClick={() => {
            const cur = langAuto ? 'auto' : localStorage.getItem('lang:' + docId) ?? 'auto';
            const next = LANG_CYCLE[(Math.max(0, LANG_CYCLE.indexOf(cur)) + 1) % LANG_CYCLE.length];
            localStorage.setItem('lang:' + docId, next);
            const found = next === 'auto' ? detectLanguage(root?.textContent ?? '').lang : LANG_CODES[next];
            lang.current = found;
            setLangTag(found);
            setLangAuto(next === 'auto');
            told.current = '';
            toast(next === 'auto' ? `Language: automatic · ${LANG_NAME[found.slice(0, 2)] ?? found}` : `Reading in ${LANG_NAME[next]}`);
            restartAtCurrent();
          }}
          aria-label={`Reading language: ${LANG_NAME[docLang] ?? docLang}${langAuto ? ' (automatic)' : ''}`}
        >
          <Icon name="globe" size={15} /> {docLang.toUpperCase()}
          {langAuto && <small>auto</small>}
        </button>
        <button
          className={sleep ? 'on' : ''}
          onClick={() => {
            const next = SLEEP[(SLEEP.indexOf(sleep) + 1) % SLEEP.length];
            setSleep(next);
            sleepAt.current = next ? Date.now() + next * 60_000 : 0;
            toast(next ? `Sleep in ${next} min` : 'Sleep timer off');
          }}
          aria-label="Sleep timer"
        >
          <Icon name="timer" size={15} /> {sleep ? `${sleep}m` : 'Sleep'}
        </button>
        <button className={settings.focusListen ? 'on' : ''} onClick={() => updateSettings({ focusListen: !settings.focusListen })} aria-label="Focus on the sentence being read">
          <Icon name="ear" size={15} />
        </button>
      </div>
      <VoiceSheet
        open={voiceSheet}
        onClose={() => setVoiceSheet(false)}
        docLang={docLang}
        stored={stored}
        refreshStored={async () => setStored(await neuralStored())}
        voices={voices}
        bestId={bestRef.current}
        onPicked={() => {
          neuralBroken.current = false;
          neuralSlow.current = false;
          restartAtCurrent();
        }}
      />
    </div>
  );
}
