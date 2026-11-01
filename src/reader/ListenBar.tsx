import { useCallback, useEffect, useRef, useState } from 'react';
import { bestVoice, listVoices, openVoiceInstall, speak, speechText, stopSpeaking, ttsAvailable, guessLang, type Voice } from '../lib/tts';
import { NEURAL_PREFIX, NEURAL_VOICES, NeuralPlayer, enginePool, sharedEngine, warmSecond, isNeural, neuralDownload, neuralId, neuralRemove, neuralStored, neuralSupported } from '../lib/neural';
import { Scrub } from './Scrub';
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
  const [dl, setDl] = useState<{ id: string; p: number } | null>(null);
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
    lang.current = guessLang(root.textContent?.slice(0, 3000) ?? '');
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
    sharedEngine.init(neuralId(v)).then(() => warmSecond(neuralId(v)), () => {});
  }, [settings.ttsVoice]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listVoices().then(setVoices);
    neuralStored().then(setStored);
  }, []);
  useEffect(() => {
    bestRef.current = bestVoice(voices, lang.current)?.id;
  }, [voices, total]);

  const follow = (el: HTMLElement | null) => {
    if (!el || !scroller) return;
    const r = el.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
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
      let t = speechText(raw);
      if (!t || !/[\p{L}\p{N}]/u.test(t)) continue;
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
   * Studio voice. A worker keeps the voice loaded and voices chunk after chunk; every chunk is placed on one audio
   * clock right behind the previous one, so speech flows without gaps. The highlight follows that clock.
   */
  const runNeural = async (from: number, my: number, sel: string, n: number, offset: number) => {
    if (!root) return;
    setBusy(true);
    let engines: Awaited<ReturnType<typeof enginePool>>;
    try {
      engines = await enginePool(neuralId(sel), (e) => my === token.current && !engines.includes(e) && engines.push(e));
    } catch (e) {
      console.warn('studio voice failed to load', e);
      setBusy(false);
      neuralBroken.current = true;
      toast('The studio voice couldn’t start — using the phone’s voice');
      if (my === token.current) run(from, offset);
      return;
    }
    if (my !== token.current) return;
    const rate = opts.current.ttsRate;
    const say = Math.min(rate, 2);
    const tempo = rate > 2 ? rate / 2 : 1; // beyond 2× the voice itself stops getting faster: speed up playback a little
    // starts the moment the first (short) piece is ready; the next ones are made while it plays
    const pl = (player.current = new NeuralPlayer(tempo, 0.3));
    let shown = -1;
    let finished = false;
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
      if (sleepAt.current && Date.now() > sleepAt.current && pl.started()) {
        sleepAt.current = 0;
        setSleep(0);
        toast('Sleep timer — paused. Sweet dreams.');
        return pause();
      }
      if (finished && (pl.drained() || pl.empty())) {
        setPlaying(false);
        onPlaying(false);
        return;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);

    // A pipeline: up to one piece per engine is being made at any moment, and pieces are played in order. The first
    // piece is a short phrase (it is heard within about a second), the second a little longer, then whole runs of
    // sentences sized so each is ready long before the speech in hand runs out.
    type Job = { ch: NonNullable<ReturnType<typeof buildChunk>>; p: Promise<{ samples: Float32Array; rate: number }> };
    const jobs: Job[] = [];
    let at = from;
    let off = offset;
    let made = 0;
    let turn = 0;
    let rtf = 0.5; // seconds of work per second of speech, per engine (measured as we go)
    // how many characters may the next piece have, so it is ready before the speech ahead of it has been heard?
    const CPS = 14; // characters per second of speech at 1×
    const size = () => {
      if (made === 0) return 22;
      const ahead = pl.buffered() + jobs.reduce((x, j) => x + j.ch.text.length / (CPS * say), 0);
      const budget = Math.round(((ahead * CPS * say) / rtf) * 0.55);
      // grow gently at the start, then up to whole runs of sentences
      return Math.max(30, Math.min(made < 3 ? 40 * 2 ** made : 340, budget));
    };
    /** The next piece: whole sentences when they fit, otherwise the next phrase of a long sentence. */
    const piece = (target: number) => {
      const ch = buildChunk(at, n, off, target);
      if (!ch || !root || ch.text.length <= target * 1.15) return ch;
      const first = ch.parts[0];
      if (ch.parts.length > 1) {
        // several sentences and too long: keep only those that fit
        const keep = ch.parts.filter((p) => p.at + p.w <= target * 1.15);
        if (keep.length) {
          const last = keep[keep.length - 1];
          return { text: ch.text.slice(0, last.at + last.w), parts: keep, next: last.i + 1 };
        }
      }
      // one long sentence: up to its first natural break after a little while (or a space)
      const startOff = first.i === at ? off : 0;
      const raw = sentenceRaw(root, first.i).slice(startOff);
      const lo = Math.min(made === 0 ? 12 : 20, raw.length);
      const hi = Math.max(lo + 10, Math.round(target * 1.1));
      const m = raw.slice(lo, hi).search(/[,;:—–)]\s/);
      const cut = m >= 0 ? lo + m + 1 : lo + Math.max(0, raw.slice(lo, hi).lastIndexOf(' '));
      if (cut <= 10 || cut >= raw.length - 8) return ch;
      const head = speechText(raw.slice(0, cut));
      if (!head) return ch;
      return { text: head, parts: [{ i: first.i, at: 0, w: head.length }], next: first.i, off: startOff + cut };
    };
    const fill = () => {
      while (my === token.current && at < n && jobs.length < engines.length + 1 && pl.ahead() < 40) {
        const ch = piece(size()) as (NonNullable<ReturnType<typeof buildChunk>> & { off?: number }) | null;
        if (!ch) {
          at = n;
          break;
        }
        off = ch.off ?? 0;
        at = ch.next;
        const eng = engines[turn++ % engines.length];
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
        console.debug(`[studio] ${job.ch.parts.length} sentence(s), ${(r.samples.length / r.rate).toFixed(1)} s of speech · ${pl.ahead().toFixed(1)} s ready ahead · ${engines.length} engine(s) · rtf ${rtf.toFixed(2)}`);
        // a breath after a full stop, a shorter one after a phrase
        // pauses like a narrator's: a breath after a sentence, a longer one between paragraphs and after a heading,
        // a short one at a phrase break inside a sentence
        const lastI = job.ch.parts[job.ch.parts.length - 1].i;
        const endsSentence = /[.!?…]["”’)\]]*$/.test(job.ch.text) && job.ch.next > lastI;
        const blockOf = (i: number) => root.querySelector(`.s[data-i="${i}"]`)?.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, td, pre, dd, dt');
        const here = endsSentence ? blockOf(lastI) : null;
        const gap = !endsSentence ? (/[,;:—–]$/.test(job.ch.text) ? 0.08 : 0.02) : here && /^H\d$/.test(here.tagName) ? 0.55 : here && here !== blockOf(lastI + 1) ? 0.42 : 0.17;
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
      // keep at most about forty seconds ready
      while (my === token.current && pl.ahead() > 40) await new Promise((r) => setTimeout(r, 250));
    }
    pl.release();
    finished = true;
  };

  const run = useCallback(
    async (from: number, offset = 0) => {
      if (!root) return;
      const my = ++token.current;
      setPlaying(true);
      onPlaying(true);
      const n = Number(root.dataset.wrapped ?? 0);
      const chosen = opts.current.ttsVoice;
      if (isNeural(chosen) && !neuralBroken.current) return runNeural(from, my, chosen, n, offset);
      // The phone's own voice: several sentences per request (so it doesn't end every sentence on a falling note), and the
      // engine's word positions move the highlight. Engines that don't report positions get an estimate from the clock.
      let at = from;
      let off = offset;
      let first = true;
      while (at < n) {
        if (my !== token.current) return;
        const ch = buildChunk(at, n, off, first ? 120 : 300);
        off = 0;
        first = false;
        if (!ch) break;
        at = ch.next;
        const show = (k: number) => {
          const i = ch.parts[k].i;
          setIdx(i);
          localStorage.setItem('listen:' + docId, String(i));
          follow(markSaying(root, i));
        };
        let cur = 0;
        let heard = false;
        const t0 = Date.now();
        show(0);
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
        if (my !== token.current || r === 'stopped') return;
        if (sleepAt.current && Date.now() > sleepAt.current) {
          sleepAt.current = 0;
          setSleep(0);
          toast('Sleep timer — paused. Sweet dreams.');
          break;
        }
      }
      if (my === token.current) {
        setPlaying(false);
        onPlaying(false);
      }
    },
    [root, docId, onPlaying], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pause = useCallback(() => {
    token.current++;
    stopSpeaking();
    player.current?.stop();
    player.current = null;
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
  const docLang = lang.current.slice(0, 2);
  const sortedVoices = [...voices].sort((a, b) => Number(b.lang.startsWith(docLang)) - Number(a.lang.startsWith(docLang)) || b.score - a.score || a.lang.localeCompare(b.lang));
  const studio = [...NEURAL_VOICES].sort((a, b) => Number(b.lang.startsWith(docLang)) - Number(a.lang.startsWith(docLang)));

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
        <span className="grow">{busy ? 'preparing the voice…' : playing ? 'reading aloud' : 'paused'} · {idx + 1}/{total || '–'}</span>
        <span>{leftMin} min left</span>
      </div>
      <Scrub
        className="listen-scrub2"
        ariaLabel="Position in the track"
        value={total > 1 ? idx / (total - 1) : 0}
        label={(v) => {
          const i = Math.round(v * Math.max(0, total - 1));
          return `${i + 1} / ${total} · ${Math.max(0, Math.round(((total - i) / Math.max(1, total)) * leftAll))} min left`;
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
      <div className="listen-ctrl">
        <button className="sm" onClick={() => skip(-1)} aria-label="Previous sentence">
          <Icon name="rew" size={22} />
        </button>
        <button className="sm" onClick={() => skip(-5)} aria-label="Back five sentences" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
          −5
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
        <button className="sm" onClick={() => skip(5)} aria-label="Forward five sentences" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
          +5
        </button>
        <button className="sm" onClick={() => skip(1)} aria-label="Next sentence">
          <Icon name="fwd" size={22} />
        </button>
      </div>
      <div className="listen-chips">
        <button className={pop === 'speed' ? 'on' : ''} onClick={() => setPop(pop === 'speed' ? null : 'speed')}>
          <Icon name="speed" size={15} /> {settings.ttsRate.toFixed(1)}×
        </button>
        <button onClick={() => setVoiceSheet(true)}>
          <Icon name="voice" size={15} /> {nv ? nv.label : voice ? voice.name.replace(/^(Google|Microsoft)\s*/, '').slice(0, 14) : 'Voice'}
        </button>
        <button
          className={sleep ? 'on' : ''}
          onClick={() => {
            const next = SLEEP[(SLEEP.indexOf(sleep) + 1) % SLEEP.length];
            setSleep(next);
            sleepAt.current = next ? Date.now() + next * 60_000 : 0;
            toast(next ? `Sleep in ${next} min` : 'Sleep timer off');
          }}
        >
          <Icon name="timer" size={15} /> {sleep ? `${sleep}m` : 'Sleep'}
        </button>
        <button className={settings.focusListen ? 'on' : ''} onClick={() => updateSettings({ focusListen: !settings.focusListen })}>
          <Icon name="ear" size={15} /> Focus
        </button>
      </div>
      <Sheet open={voiceSheet} onClose={() => setVoiceSheet(false)} title="Voice">
        <div className="sheet-body">
          {neuralSupported() && (
            <>
              <div className="voice-h">
                <b>Natural voices</b>
                <span>{stored.length ? 'the most natural · free · works offline' : 'the most natural · free · the first one also installs a ~30 MB speech engine'}</span>
              </div>
              <div className="actions">
                {studio.map((v) => {
                  const have = stored.includes(v.id);
                  const on = settings.ttsVoice === NEURAL_PREFIX + v.id;
                  const busyDl = dl?.id === v.id;
                  return (
                    <div key={v.id} className="voice-row">
                      <button
                        className="action"
                        disabled={busyDl}
                        onClick={async () => {
                          if (have) {
                            neuralBroken.current = false;
                            await updateSettings({ ttsVoice: NEURAL_PREFIX + v.id });
                            setVoiceSheet(false);
                            restartAtCurrent();
                            return;
                          }
                          setDl({ id: v.id, p: 0 });
                          try {
                            await neuralDownload(v.id, (p) => setDl({ id: v.id, p }));
                            setStored(await neuralStored());
                            neuralBroken.current = false;
                            await updateSettings({ ttsVoice: NEURAL_PREFIX + v.id });
                            toast(`${v.label} is ready`);
                            setVoiceSheet(false);
                            restartAtCurrent();
                          } catch {
                            toast('Download failed — check your connection');
                          } finally {
                            setDl(null);
                          }
                        }}
                      >
                        <span className="ic mono" style={{ fontSize: 11 }}>
                          {v.lang.slice(0, 2)}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block' }}>{v.label}</span>
                          <small className="muted mono" style={{ fontSize: 10.5 }}>
                            {busyDl ? `downloading ${Math.round((dl?.p ?? 0) * 100)}%` : `${v.note}${have ? '' : ` · ${v.mb} MB`}`}
                          </small>
                        </span>
                        {on ? <Icon name="check" /> : !have && !busyDl ? <span className="mono" style={{ fontSize: 11 }}>get</span> : null}
                      </button>
                      {have && (
                        <button
                          className="chip"
                          aria-label={`Remove ${v.label}`}
                          onClick={async () => {
                            await neuralRemove(v.id).catch(() => {});
                            setStored(await neuralStored());
                            if (on) updateSettings({ ttsVoice: undefined });
                          }}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <div className="voice-h" style={{ marginTop: 18 }}>
            <b>Fast voices</b>
            <span>this phone’s own voices, in many accents · start instantly</span>
          </div>
          {isNative && (
            <button className="pill ghost sm" style={{ margin: '0 0 10px' }} onClick={() => openVoiceInstall()}>
              Get more natural voices
            </button>
          )}
          {!voices.length && <p className="muted mono" style={{ fontSize: 12 }}>No voices reported by the system. Install voices in Android Settings → Text-to-speech.</p>}
          <div className="actions">
            {sortedVoices.slice(0, 80).map((v) => (
              <button
                key={v.id}
                className="action"
                onClick={async () => {
                  await updateSettings({ ttsVoice: v.id });
                  setVoiceSheet(false);
                  restartAtCurrent();
                }}
              >
                <span className="ic mono" style={{ fontSize: 11 }}>
                  {v.lang.slice(0, 2)}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                {v.natural && <span className="mono" style={{ fontSize: 10, opacity: 0.6 }}>natural</span>}
                {(settings.ttsVoice === v.id || (!settings.ttsVoice && bestRef.current === v.id)) && <Icon name="check" />}
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
