import { useCallback, useEffect, useRef, useState } from 'react';
import { bestVoice, listVoices, openVoiceInstall, speak, speechText, stopSpeaking, ttsAvailable, guessLang, type Voice } from '../lib/tts';
import { NEURAL_PREFIX, NEURAL_VOICES, Player, isNeural, neuralDownload, neuralId, neuralRemove, neuralStored, neuralSupported, neuralSynth } from '../lib/neural';
import { firstVisibleSentence, markSaying, sentenceText, wrapSentences } from './dom';
import { updateSettings, useStore } from '../lib/store';
import { isNative, tap } from '../lib/native';
import { Icon } from '../ui/Icon';
import { Ruler, Sheet, toast } from '../ui/kit';

interface Props {
  root: HTMLElement | null;
  scroller: HTMLElement | null;
  startAt?: number | null; // sentence index to start from (e.g. "Listen from here")
  onPlaying: (p: boolean) => void;
  docId: string;
}

const SLEEP = [0, 10, 20, 30, 60];

export function ListenBar({ root, scroller, startAt, onPlaying, docId }: Props) {
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
  const player = useRef<Player | null>(null);
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

  /** Natural (on-device neural) voice: sentences are voiced a few at a time while the next group is prepared. */
  const runNeural = async (from: number, my: number, sel: string, n: number) => {
    if (!root) return;
    const vid = neuralId(sel);
    const pl = (player.current ??= new Player());
    type Part = { i: number; w: number };
    const chunks: { text: string; parts: Part[] }[] = [];
    let cur: { text: string; parts: Part[] } = { text: '', parts: [] };
    for (let i = from; i < n; i++) {
      const t = speechText(sentenceText(root, i));
      if (!t || !/[\p{L}\p{N}]/u.test(t)) continue;
      const limit = chunks.length === 0 ? 150 : 420; // a short first chunk so playback starts quickly
      if (cur.text && (cur.text.length + t.length > limit || cur.parts.length >= 4)) {
        chunks.push(cur);
        cur = { text: '', parts: [] };
      }
      cur.text += (cur.text ? ' ' : '') + t;
      cur.parts.push({ i, w: t.length + 14 });
    }
    if (cur.text) chunks.push(cur);
    const jobs = new Map<number, Promise<Blob>>();
    const synth = (k: number) => {
      if (k >= chunks.length) return undefined;
      if (!jobs.has(k)) jobs.set(k, neuralSynth(chunks[k].text, vid));
      return jobs.get(k)!;
    };
    for (let k = 0; k < chunks.length; k++) {
      if (my !== token.current) return;
      let blob: Blob;
      setBusy(true);
      try {
        blob = await synth(k)!;
      } catch (e) {
        console.warn('neural voice failed', e);
        setBusy(false);
        neuralBroken.current = true;
        toast('The natural voice couldn’t start — using the phone’s voice');
        if (my === token.current) run(chunks[k].parts[0]?.i ?? from);
        return;
      }
      setBusy(false);
      if (my !== token.current) return;
      synth(k + 1);
      const { parts } = chunks[k];
      const W = parts.reduce((a, b) => a + b.w, 0);
      let shown = -1;
      const r = await pl.play(blob, opts.current.ttsRate, (t, d) => {
        if (!d || my !== token.current) return;
        let acc = 0;
        const at = (t / d) * W;
        let part = parts[parts.length - 1];
        for (const p of parts) {
          acc += p.w;
          if (at < acc) {
            part = p;
            break;
          }
        }
        if (part.i !== shown) {
          shown = part.i;
          setIdx(part.i);
          localStorage.setItem('listen:' + docId, String(part.i));
          follow(markSaying(root, part.i));
        }
      });
      jobs.delete(k);
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
  };

  const run = useCallback(
    async (from: number) => {
      if (!root) return;
      const my = ++token.current;
      setPlaying(true);
      onPlaying(true);
      const n = Number(root.dataset.wrapped ?? 0);
      const chosen = opts.current.ttsVoice;
      if (isNeural(chosen) && !neuralBroken.current) return runNeural(from, my, chosen, n);
      for (let i = from; i < n; i++) {
        if (my !== token.current) return;
        setIdx(i);
        localStorage.setItem('listen:' + docId, String(i));
        const el = markSaying(root, i);
        follow(el);
        const text = speechText(sentenceText(root, i));
        if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;
        const s = opts.current;
        const r = await speak(text, { rate: s.ttsRate, pitch: s.ttsPitch, voice: chosen ?? bestRef.current, lang: lang.current });
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

  // tap a sentence while listening → jump there
  useEffect(() => {
    if (!root) return;
    const on = (e: MouseEvent) => {
      if (window.getSelection()?.toString()) return;
      const s = (e.target as HTMLElement).closest<HTMLElement>('.s');
      if (!s || !playing) return;
      e.stopPropagation();
      pause();
      setTimeout(() => run(Number(s.dataset.i)), 60);
    };
    root.addEventListener('click', on, true);
    return () => root.removeEventListener('click', on, true);
  }, [root, playing, run, pause]);

  useEffect(() => () => pause(), []); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!ttsAvailable())
    return (
      <div className="listen">
        <div className="listen-top">Text-to-speech is not available on this device.</div>
      </div>
    );

  const wpm = 165 * settings.ttsRate;
  const leftWords = root ? Math.round(((total - idx) / Math.max(1, total)) * ((root.textContent ?? '').split(/\s+/).length || 0)) : 0;
  const leftMin = Math.max(1, Math.round(leftWords / wpm));
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
              if (isNeural(opts.current.ttsVoice) && !neuralBroken.current) return player.current?.setRate(v);
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
      <div className="listen-scrub" aria-hidden>
        <i style={{ width: `${total ? ((idx + 1) / total) * 100 : 0}%` }} />
      </div>
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
                <b>Studio voices</b>
                <span>the most natural · free · on this phone</span>
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
            <b>This phone’s voices</b>
            <span>{sortedVoices.some((v) => v.natural) ? 'natural ones first' : 'tip: install a high-quality voice for a more natural sound'}</span>
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
