import { useEffect, useState } from 'react';
import { updateSettings, useStore } from '../lib/store';
import * as db from '../lib/db';
import { Icon } from '../ui/Icon';
import { Ruler, Segmented, Sheet, Toggle, toast } from '../ui/kit';
import { isNative } from '../lib/native';
import { formatSize } from '../lib/library';

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore((x) => x.settings);
  const docs = useStore((x) => x.docs);
  const [usage, setUsage] = useState<string>('');
  const [name, setName] = useState(s.name);
  useEffect(() => {
    if (!open) return;
    setName(s.name);
    navigator.storage?.estimate?.().then((e) => setUsage(e.usage ? formatSize(e.usage) : ''));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onClose={onClose} title="App Settings" onBackBtn={onClose}>
      <div className="sheet-body">
        <Segmented
          light
          value={s.appTheme}
          onChange={(v) => updateSettings({ appTheme: v })}
          options={[
            { value: 'light', label: <Icon name="sun" size={18} />, aria: 'Light' },
            { value: 'system', label: <><HalfCircle /> System</>, aria: 'System' },
            { value: 'dark', label: <Icon name="moon" size={18} />, aria: 'Dark' },
          ]}
          className="w100 big-seg"
        />
        <hr className="hairline" style={{ margin: '22px 0 4px' }} />

        <div className="section-label">you</div>
        <div className="row">
          <span className="row-label" style={{ flex: 'none' }}>
            @
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.replace(/\s+/g, '').slice(0, 20))}
            onBlur={() => updateSettings({ name: name || 'reader' })}
            style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontSize: 16, fontWeight: 600, height: 44 }}
            aria-label="Your name"
          />
        </div>

        <div className="section-label">reading</div>
        <div className="row">
          <div className="grow">
            <div className="row-label">Daily goal</div>
            <div className="row-sub">Fills the ring on your library</div>
          </div>
        </div>
        <Ruler value={s.dailyGoal} min={5} max={120} step={5} onChange={(v) => updateSettings({ dailyGoal: v })} format={(v) => `${v}m`} label="Daily goal" />
        <div className="row" style={{ marginTop: 8 }}>
          <div className="grow">
            <div className="row-label">Open PDFs in</div>
          </div>
          <Segmented
            light
            value={s.defaultPdfMode}
            onChange={(v) => updateSettings({ defaultPdfMode: v })}
            options={[
              { value: 'page', label: 'Pages' },
              { value: 'liquid', label: 'Liquid' },
            ]}
          />
        </div>
        <div className="row">
          <Icon name="ear" />
          <div className="grow">
            <div className="row-label">Focus while listening</div>
            <div className="row-sub">Dim everything except the sentence being read</div>
          </div>
          <Toggle on={s.focusListen} onChange={(v) => updateSettings({ focusListen: v })} label="Focus while listening" />
        </div>
        <div className="row">
          <Icon name="voice" />
          <div className="grow">
            <div className="row-label">Haptic Feedback</div>
          </div>
          <Toggle on={s.haptics} onChange={(v) => updateSettings({ haptics: v })} label="Haptic feedback" />
        </div>

        <div className="section-label">files</div>
        <div className="row">
          <Icon name="book" />
          <div className="grow">
            <div className="row-label">Make Quire your default reader</div>
            <div className="row-sub">
              {isNative
                ? 'Open any PDF/EPUB/DOCX in your file manager → “Open with” → Quire → “Always”. Quire also appears in the Share menu.'
                : 'Install the Android app to open files straight from your file manager.'}
            </div>
          </div>
        </div>
        <div className="row">
          <Icon name="grid" />
          <div className="grow">
            <div className="row-label">Storage</div>
            <div className="row-sub">
              {docs.length} documents{usage ? ` · ${usage} used` : ''} · all on this device
            </div>
          </div>
          <button
            className="pill sm ghost"
            onClick={async () => {
              const keys = await db.entries('cache');
              for (const [k] of keys) await db.del('cache', k);
              toast('Cleared liquid-mode cache');
            }}
          >
            Clear cache
          </button>
        </div>
        <div style={{ textAlign: 'center', padding: '26px 0 10px' }} className="mono muted">
          <div style={{ fontSize: 11 }}>quire 1.0 · no ads, no paywalls, no tracking</div>
        </div>
      </div>
    </Sheet>
  );
}

function HalfCircle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    </svg>
  );
}
