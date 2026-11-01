import { useEffect, useRef, useState } from 'react';
import { NEURAL_PREFIX, NEURAL_VOICES, TIER_INFO, VOICE_LANGS, neuralDownload, neuralRemove, sampleUrl, type NeuralVoice, type Tier } from '../lib/neural';
import { openVoiceInstall, type Voice } from '../lib/tts';
import { updateSettings, useStore } from '../lib/store';
import { isNative } from '../lib/native';
import { Icon } from '../ui/Icon';
import { Sheet, Toggle, toast } from '../ui/kit';

const TIERS: Tier[] = ['light', 'standard', 'hd'];

/**
 * Choosing how Frogity reads aloud: voices grouped by language and then by weight (light · standard · HD), with a
 * sample to hear before downloading. The reading language comes first; everything else is a tap away.
 */
export function VoiceSheet({
  open,
  onClose,
  docLang,
  stored,
  refreshStored,
  voices,
  bestId,
  onPicked,
}: {
  open: boolean;
  onClose: () => void;
  docLang: string;
  stored: string[];
  refreshStored: () => Promise<void>;
  voices: Voice[];
  bestId?: string;
  onPicked: () => void;
}) {
  const s = useStore((x) => x.settings);
  const mine = VOICE_LANGS.some((l) => l.code === s.lang) ? s.lang : 'en';
  const order = [...new Set([mine, docLang, ...VOICE_LANGS.map((l) => l.code)])].filter((c) => VOICE_LANGS.some((l) => l.code === c));
  const [openLang, setOpenLang] = useState<string | null>(null);
  const [sys, setSys] = useState(false);
  const [dl, setDl] = useState<{ id: string; p: number } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (open) setOpenLang(order[0]);
    else stop();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  };
  const sample = (v: NeuralVoice) => {
    if (playing === v.id) return stop();
    stop();
    const a = new Audio(sampleUrl(v.id));
    audio.current = a;
    setPlaying(v.id);
    a.onended = () => setPlaying(null);
    a.onerror = () => {
      setPlaying(null);
      toast('Samples need an internet connection');
    };
    a.play().catch(() => setPlaying(null));
  };
  const use = async (v: NeuralVoice) => {
    stop();
    if (!stored.includes(v.id)) {
      setDl({ id: v.id, p: 0 });
      try {
        await neuralDownload(v.id, (p) => setDl({ id: v.id, p }));
        await refreshStored();
      } catch {
        toast('Download failed — check your connection');
        setDl(null);
        return;
      }
      setDl(null);
      toast(`${v.label} is ready`);
    }
    await updateSettings({ ttsVoice: NEURAL_PREFIX + v.id });
    onClose();
    onPicked();
  };
  const row = (v: NeuralVoice) => {
    const have = stored.includes(v.id);
    const on = s.ttsVoice === NEURAL_PREFIX + v.id;
    const busy = dl?.id === v.id;
    return (
      <div key={v.id} className="voice-row">
        <button className="vplay" aria-label={`Hear ${v.label}`} onClick={() => sample(v)}>
          <Icon name={playing === v.id ? 'pause' : 'play'} size={16} />
        </button>
        <button className="action" disabled={busy} onClick={() => use(v)}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block' }}>
              {v.label}
              {v.rec && <b className="vtag">for you</b>}
            </span>
            <small className="muted mono" style={{ fontSize: 10.5 }}>
              {busy ? `downloading ${Math.round((dl?.p ?? 0) * 100)}%` : `${v.note}${have ? ' · installed' : ` · ${v.mb} MB`}`}
            </small>
          </span>
          {on ? <Icon name="check" /> : !have && !busy ? <span className="mono" style={{ fontSize: 11 }}>get</span> : null}
        </button>
        {have && !on && (
          <button
            className="chip"
            aria-label={`Remove ${v.label}`}
            onClick={async () => {
              await neuralRemove(v.id).catch(() => {});
              await refreshStored();
            }}
          >
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
    );
  };
  const nameOf = (id?: string) => {
    const n = NEURAL_VOICES.find((v) => NEURAL_PREFIX + v.id === id);
    if (n) return `${n.label} · ${TIER_INFO[n.tier].label}`;
    return voices.find((v) => v.id === id)?.name ?? (id ? 'Phone voice' : 'Automatic');
  };
  return (
    <Sheet open={open} onClose={onClose} title="Voice">
      <div className="sheet-body">
        <div className="vnow">
          <small className="mono muted">reading with</small>
          <b>{nameOf(s.ttsVoice)}</b>
        </div>
        <div className="row" style={{ padding: '4px 0 10px' }}>
          <div className="grow">
            <div className="row-label" style={{ fontSize: 14.5 }}>Match each book’s language</div>
            <div className="row-sub">A Spanish book is read in Spanish, an English one in English — with voices you have installed.</div>
          </div>
          <Toggle on={s.autoVoice !== false} onChange={(v) => updateSettings({ autoVoice: v })} label="Match each book's language" />
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: '0 0 6px' }}>
          Tap ▶ to hear a voice before you download it. <b>Light</b> voices start and flow on any phone; <b>HD</b> voices sound richer but need a recent one.
        </p>
        {order.map((code) => {
          const list = NEURAL_VOICES.filter((v) => v.lang.slice(0, 2) === code);
          const label = VOICE_LANGS.find((l) => l.code === code)!.label;
          const here = openLang === code;
          const installed = list.filter((v) => stored.includes(v.id)).length;
          return (
            <div key={code} className="vlang">
              <button className="vlang-h" onClick={() => setOpenLang(here ? null : code)} aria-expanded={here}>
                <b>{label}</b>
                {code === mine && <span className="vtag">your language</span>}
                <small className="mono muted">{installed ? `${installed} installed` : `${list.length} voices`}</small>
                <Icon name={here ? 'up' : 'down'} size={16} />
              </button>
              {here &&
                TIERS.map((t) => {
                  const vs = list.filter((v) => v.tier === t);
                  return vs.length ? (
                    <div key={t} className="vtier">
                      <div className="voice-h">
                        <b>{TIER_INFO[t].label}</b>
                        <span>{TIER_INFO[t].hint}</span>
                      </div>
                      <div className="actions">{vs.map(row)}</div>
                    </div>
                  ) : null;
                })}
            </div>
          );
        })}
        <div className="vlang">
          <button className="vlang-h" onClick={() => setSys((x) => !x)} aria-expanded={sys}>
            <b>This phone’s own voices</b>
            <small className="mono muted">instant · many accents</small>
            <Icon name={sys ? 'up' : 'down'} size={16} />
          </button>
          {sys && (
            <div style={{ paddingTop: 6 }}>
              {isNative && (
                <button className="pill ghost sm" style={{ margin: '0 0 10px' }} onClick={() => openVoiceInstall()}>
                  Get more voices from Android
                </button>
              )}
              {!voices.length && <p className="muted mono" style={{ fontSize: 12 }}>No voices reported by the system. Install voices in Android Settings → Text-to-speech.</p>}
              <div className="actions">
                {[...voices]
                  .sort((a, b) => Number(b.lang.startsWith(docLang)) - Number(a.lang.startsWith(docLang)) || b.score - a.score)
                  .slice(0, 60)
                  .map((v) => (
                    <button
                      key={v.id}
                      className="action"
                      onClick={async () => {
                        await updateSettings({ ttsVoice: v.id });
                        onClose();
                        onPicked();
                      }}
                    >
                      <span className="ic mono" style={{ fontSize: 11 }}>
                        {v.lang.slice(0, 2)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                      {v.natural && <span className="mono" style={{ fontSize: 10, opacity: 0.6 }}>natural</span>}
                      {(s.ttsVoice === v.id || (!s.ttsVoice && bestId === v.id)) && <Icon name="check" />}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
