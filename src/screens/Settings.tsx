import { useEffect, useState } from 'react';
import { updateSettings, useStore } from '../lib/store';
import * as db from '../lib/db';
import { Icon } from '../ui/Icon';
import { Ruler, Segmented, Sheet, Toggle, toast } from '../ui/kit';
import { isNative } from '../lib/native';
import { notifyPermission, refreshReminder } from '../lib/reminders';
import { getFolders, linkFolder, rescanAll, unlinkFolder, type LinkedFolder } from '../lib/linked';
import { formatSize } from '../lib/library';
import { FontsSheet } from '../reader/sheets';
import { About } from './About';
import { APP_VERSION } from '../lib/config';
import { fontById } from '../lib/fonts';
import { LANGS, detectLang, ensureNaturalVoice } from '../lib/voices';

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore((x) => x.settings);
  const docs = useStore((x) => x.docs);
  const [usage, setUsage] = useState<string>('');
  const [name, setName] = useState(s.name);
  const [fonts, setFonts] = useState(false);
  const [about, setAbout] = useState(false);
  const [adv, setAdv] = useState(false);
  const [folders, setFolders] = useState<LinkedFolder[]>([]);
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(s.name);
    if (isNative) getFolders().then(setFolders);
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
            onChange={(e) => {
              const v = e.target.value.replace(/^@+/, '').slice(0, 24);
              setName(v);
              updateSettings({ name: v.trim() || 'reader' });
            }}
            placeholder="your name"
            maxLength={24}
            style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontSize: 16, fontWeight: 600, height: 44 }}
            aria-label="Your name"
          />
        </div>

        <div className="section-label">reading</div>
        <div className="row">
          <Icon name="ear" />
          <div className="grow">
            <div className="row-label">Reading language</div>
            <div className="row-sub">Decides your natural reading voice</div>
          </div>
          <select
            className="lang-select"
            value={s.lang || detectLang()}
            onChange={(e) => {
              updateSettings({ lang: e.target.value });
              void ensureNaturalVoice(e.target.value, { force: true });
            }}
            aria-label="Reading language"
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <button className="row" style={{ width: '100%', textAlign: 'left' }} onClick={() => setFonts(true)}>
          <Icon name="text" />
          <div className="grow">
            <div className="row-label">Reading fonts</div>
            <div className="row-sub">
              {s.fontFaves.map((f) => fontById(f).name).join(' · ')}
            </div>
          </div>
          <Icon name="right" size={18} />
        </button>
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

        <div className="section-label">reminders</div>
        <div className="row">
          <Icon name="timer" />
          <div className="grow">
            <div className="row-label">Evening reminder</div>
            <div className="row-sub">{isNative ? 'A quiet nudge to keep your streak. Skipped on days you’ve already reached your goal.' : 'Available in the Android app.'}</div>
          </div>
          <Toggle
            on={s.reminders}
            onChange={async (v) => {
              if (v && !(await notifyPermission(true))) return toast('Allow notifications for Frogity in Android settings to get reminders');
              updateSettings({ reminders: v });
              setTimeout(refreshReminder, 450);
            }}
            label="Evening reminder"
          />
        </div>
        {s.reminders && (
          <div className="row">
            <div className="grow">
              <div className="row-label">Remind me at</div>
            </div>
            <input
              type="time"
              className="time-field"
              value={s.reminderTime}
              onChange={(e) => {
                updateSettings({ reminderTime: e.target.value || '20:30' });
                setTimeout(refreshReminder, 450);
              }}
              aria-label="Reminder time"
            />
          </div>
        )}

        <div className="section-label">ask (free ai)</div>
        <div className="row">
          <Icon name="ask" />
          <div className="grow">
            <div className="row-label">Ask this document</div>
            <div className="row-sub">Sends your question and a few short excerpts to a free open AI service. Off until you turn it on.</div>
          </div>
          <Toggle on={s.aiOk} onChange={(v) => updateSettings({ aiOk: v })} label="Ask this document" />
        </div>

        <div className="section-label">files</div>
        {isNative && (
          <>
            {folders.map((f) => (
              <div className="row" key={f.uri}>
                <Icon name="book" />
                <div className="grow">
                  <div className="row-label" style={{ fontSize: 15 }}>
                    {f.name}
                  </div>
                  <div className="row-sub">linked · {docs.filter((d) => d.folder === f.uri).length} documents</div>
                </div>
                <button
                  className="pill sm ghost"
                  onClick={async () => {
                    await unlinkFolder(f.uri);
                    setFolders(await getFolders());
                    toast('Folder unlinked (your files are untouched)');
                  }}
                >
                  Unlink
                </button>
              </div>
            ))}
            <div className="row">
              <Icon name="plus" />
              <div className="grow">
                <div className="row-label">Link a folder</div>
                <div className="row-sub">Documents inside appear in your library without being copied. Android won’t allow linking the Downloads folder itself — use Add → Files for those.</div>
              </div>
              <button
                className="pill sm"
                onClick={async () => {
                  const r = await linkFolder();
                  setFolders(await getFolders());
                  if (r.folder) toast(`${r.added} documents added`);
                }}
              >
                Choose
              </button>
            </div>
            {folders.length > 0 && (
              <div className="row">
                <Icon name="convert" />
                <div className="grow">
                  <div className="row-label">Rescan folders</div>
                </div>
                <button
                  className="pill sm ghost"
                  disabled={scanning}
                  onClick={async () => {
                    setScanning(true);
                    const n = await rescanAll();
                    setScanning(false);
                    toast(n ? `${n} new documents` : 'Up to date');
                  }}
                >
                  {scanning ? 'Scanning…' : 'Scan now'}
                </button>
              </div>
            )}
          </>
        )}
        <div className="row">
          <Icon name="book" />
          <div className="grow">
            <div className="row-label">Make Frogity your default reader</div>
            <div className="row-sub">
              {isNative
                ? 'Open any PDF/EPUB/DOCX in your file manager → “Open with” → Frogity → “Always”. Frogity also appears in the Share menu.'
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
        <button className="row" style={{ width: '100%', textAlign: 'left' }} onClick={() => { onClose(); updateSettings({ onboarded: false }); }}>
          <Icon name="ask" />
          <div className="grow">
            <div className="row-label">Replay the introduction</div>
            <div className="row-sub">The short tour of everything Frogity does</div>
          </div>
          <Icon name="right" size={18} />
        </button>
        <div className="section-label">advanced</div>
        <button className="row" style={{ width: '100%', textAlign: 'left' }} onClick={() => setAdv((v) => !v)} aria-expanded={adv}>
          <Icon name="gear" />
          <div className="grow">
            <div className="row-label">Daily goal</div>
            <div className="row-sub">{s.dailyGoal} min a day · changing it re-scales every streak mark</div>
          </div>
          <Icon name={adv ? 'up' : 'right'} size={18} />
        </button>
        {adv && (
          <>
            <p className="muted" style={{ margin: '4px 4px 6px', fontSize: 13 }}>
              A day counts toward your streak after one minute of reading. The goal fills the ring and decides what each mark in the calendar means.
            </p>
            <Ruler value={s.dailyGoal} min={5} max={120} step={5} onChange={(v) => updateSettings({ dailyGoal: v })} format={(v) => `${v}m`} label="Daily goal" />
          </>
        )}
        <button className="row" style={{ width: '100%', textAlign: 'left' }} onClick={() => setAbout(true)}>
          <Icon name="info" />
          <div className="grow">
            <div className="row-label">About, privacy & licences</div>
            <div className="row-sub">What leaves the phone, sources and open-source credits</div>
          </div>
          <Icon name="right" size={18} />
        </button>
        <div style={{ textAlign: 'center', padding: '26px 0 10px' }} className="mono muted">
          <div style={{ fontSize: 11 }}>frogity {APP_VERSION} · free · no ads · no accounts · no tracking</div>
          <div style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.5 }}>
            Your library stays on this phone.
            <br />
            Only word lookups, saved links and Ask use the internet.
          </div>
        </div>
      </div>
      <FontsSheet open={fonts} onClose={() => setFonts(false)} />
      <About open={about} onClose={() => setAbout(false)} />
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
