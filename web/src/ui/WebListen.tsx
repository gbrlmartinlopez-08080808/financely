import { useEffect, useRef, useState } from 'react';
import { Reader, bestFor, guessLang, voices, type SpeakVoice } from '../lib/speak';
import { Icon } from './Icon';
import { Pixel } from './px';

/** A small player for hearing the open text read aloud (the browser's own voices; free, offline for local ones). */
export function WebListen({ getRoot, onClose }: { getRoot: () => HTMLElement | null; onClose: () => void }) {
  const [vs, setVs] = useState<SpeakVoice[]>([]);
  const [uri, setUri] = useState(() => localStorage.getItem('frogity-voice') ?? '');
  const [rate, setRate] = useState(() => Number(localStorage.getItem('frogity-rate')) || 1);
  const [state, setState] = useState({ playing: false, i: 0, n: 0 });
  const reader = useRef<Reader | null>(null);
  const live = useRef({ rate, uri, vs, lang: 'en' });
  live.current = { ...live.current, rate, uri, vs };

  useEffect(() => {
    void voices().then(setVs);
    const root = getRoot();
    if (!root) return;
    live.current.lang = guessLang(root.textContent?.slice(0, 4000) ?? '');
    const r = new Reader(root, {
      rate: () => live.current.rate,
      voice: () => bestFor(live.current.vs, live.current.lang, live.current.uri || undefined),
      lang: () => live.current.lang,
      onState: (playing, i, n) => setState({ playing, i, n }),
      onEnd: () => {},
    });
    reader.current = r;
    r.play();
    return () => r.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lang = live.current.lang;
  const mine = vs.filter((v) => v.lang.toLowerCase().startsWith(lang));
  const others = vs.filter((v) => !v.lang.toLowerCase().startsWith(lang));
  const cur = bestFor(vs, lang, uri || undefined);
  return (
    <div className="listenbar" role="region" aria-label="Listening">
      <button aria-label="Previous sentence" onClick={() => reader.current?.skip(-1)}>
        <Icon name="prev" size={17} />
      </button>
      <button className="play" aria-label={state.playing ? 'Pause' : 'Play'} onClick={() => (state.playing ? reader.current?.pause() : reader.current?.play(state.i))}>
        <Icon name={state.playing ? 'pause' : 'play'} size={18} stroke={2.6} />
      </button>
      <button aria-label="Next sentence" onClick={() => reader.current?.skip(1)}>
        <Icon name="next" size={17} />
      </button>
      <span className="st">{state.n ? `${Math.min(state.n, state.i + 1)} / ${state.n}` : 'reading…'}</span>
      <select
        aria-label="Speed"
        value={rate}
        onChange={(e) => {
          setRate(Number(e.target.value));
          localStorage.setItem('frogity-rate', e.target.value);
          setTimeout(() => reader.current?.restart(), 0);
        }}
      >
        {[0.8, 1, 1.15, 1.3, 1.5, 1.8, 2.2].map((r) => (
          <option key={r} value={r}>
            {r.toFixed(2).replace(/0$/, '')}×
          </option>
        ))}
      </select>
      <select
        aria-label="Voice"
        value={cur?.uri ?? ''}
        onChange={(e) => {
          setUri(e.target.value);
          localStorage.setItem('frogity-voice', e.target.value);
          setTimeout(() => reader.current?.restart(), 0);
        }}
      >
        {!vs.length && <option>No voices found</option>}
        {mine.length > 0 && (
          <optgroup label="For this text">
            {mine.map((v) => (
              <option key={v.uri} value={v.uri}>
                {v.name}
                {v.natural ? ' · natural' : ''}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="Other languages">
            {others.map((v) => (
              <option key={v.uri} value={v.uri}>
                {v.name} · {v.lang}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button aria-label="Stop listening" onClick={onClose}>
        <Pixel name="plusminus" size={0} style={{ display: 'none' }} />
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
