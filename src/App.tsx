import { useCallback, useEffect, useRef, useState } from 'react';
import { init, useStore, updateSettings, getState, dayKey, applyFreeze, streakInfo } from './lib/store';
import * as db from './lib/db';
import { importFile, importText, upgradeCovers } from './lib/library';
import { initBackButton, isNative, listenIncoming, manageSelectionMenu, readIncoming, setStatusBar, tap, widgetUpdate } from './lib/native';
import { glyphFor } from './lib/glyphs';
import { linkFolder, linkPickedFiles, rescanAll } from './lib/linked';
import type { DocMeta } from './lib/types';
import { Library } from './screens/Library';
import { Reader } from './reader/Reader';
import { StatsBubble } from './screens/Stats';
import { AddSheet } from './screens/AddSheet';
import { Discover } from './screens/Discover';
import { ScanBadge } from './screens/ScanBadge';
import { prefetch as prefetchCatalog } from './lib/catalog';
import { isGuide } from './lib/harvest';
import { refreshReminder } from './lib/reminders';
import { importUrl, looksLikeUrl } from './lib/links';
import { Settings } from './screens/Settings';
import { RateSheet } from './screens/RateSheet';
import { Onboarding, type Finish } from './screens/Onboarding';
import { ConvertSheet } from './screens/Convert';
import { ScanSheet } from './screens/Scan';
import { PixelLoader, Toasts, toast } from './ui/kit';
import welcome from './samples/welcome.md?raw';

export default function App() {
  const ready = useStore((s) => s.ready);
  const docs = useStore((s) => s.docs);
  const appTheme = useStore((s) => s.settings.appTheme);
  const onboarded = useStore((s) => s.settings.onboarded);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stats, setStats] = useState(false);
  const [reward, setReward] = useState<string | null>(null);
  const [rate, setRate] = useState(false);
  const [demo, setDemo] = useState<number | null>(null); // testers: play the frog flight for N days
  const [settings, setSettings] = useState(false);
  const [convert, setConvert] = useState<{ doc: DocMeta; root?: HTMLElement | null } | null>(null);
  const [scanFiles, setScanFiles] = useState<File[] | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [discover, setDiscover] = useState(false);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const camIn = useRef<HTMLInputElement>(null);

  useEffect(() => {
    init();
    initBackButton();
    manageSelectionMenu();
  }, []);

  // app theme (light / dark / system)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = appTheme === 'dark' || (appTheme === 'system' && mq.matches);
      document.documentElement.dataset.appTheme = dark ? 'dark' : 'light';
      if (!openId) setStatusBar(dark, dark ? '#0d0d0d' : '#efeeec');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [appTheme, openId]);

  const addFiles = useCallback(async (files: { blob: Blob; name: string }[], openFirst: boolean) => {
    let first: DocMeta | null = null;
    for (const f of files) {
      setImporting(f.name);
      try {
        // a shared link arrives as a tiny text file: save the page instead
        if (f.blob.size < 2048 && /\.txt$/i.test(f.name)) {
          const t = (await f.blob.text()).trim();
          if (looksLikeUrl(t)) {
            const m = await importUrl(t);
            first ??= m;
            continue;
          }
        }
        const m = await importFile(f.blob, f.name);
        first ??= m;
      } catch (e) {
        console.error(e);
        toast(`Couldn't import ${f.name}`);
      }
    }
    setImporting(null);
    if (first) {
      tap();
      if (openFirst) setOpenId(first.id);
      else toast(files.length > 1 ? `Added ${files.length} files` : 'Added to your shelf');
    }
  }, []);

  const saveLink = async (url: string) => {
    setLinkErr(null);
    setLinkBusy('fetching');
    try {
      const m = await importUrl(url, (l) => setLinkBusy(l));
      setAddOpen(false);
      tap();
      toast('Saved to your shelf');
      setOpenId(m.id);
    } catch (e) {
      const msg = (e as Error).message || 'Couldn’t save that page.';
      setLinkErr(/Failed to fetch|NetworkError|Load failed/i.test(msg) ? 'Couldn’t reach that site. Check the link and your connection.' : msg);
    } finally {
      setLinkBusy(null);
    }
  };

  // files shared / "opened with" from other Android apps
  useEffect(() => {
    if (!ready) return;
    let off = () => {};
    listenIncoming(async (incoming) => {
      const files = await Promise.all(incoming.map(async (f) => ({ blob: await readIncoming(f), name: f.name })));
      // reopen if we already have the same file
      const known = files.length === 1 ? docs.find((d) => d.fileName === files[0].name && d.size === files[0].blob.size) : undefined;
      if (known) setOpenId(known.id);
      else addFiles(files, true);
    }).then((o) => (off = o));
    return () => off();
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // covers made by older versions get rebuilt quietly, one at a time
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => upgradeCovers(), 5000);
    return () => clearTimeout(t);
  }, [ready]);

  // keep linked folders fresh (new files appear, deleted ones go)
  useEffect(() => {
    if (ready && isNative) rescanAll().then((n) => n && toast(`${n} new document${n === 1 ? '' : 's'} found`));
  }, [ready]);

  const pickFiles = async () => {
    if (!isNative) return fileIn.current?.click();
    try {
      const added = await linkPickedFiles();
      if (added.length === 1) setOpenId(added[0].id);
      else if (added.length) toast(`Added ${added.length} files — nothing was copied`);
    } catch (e) {
      toast((e as Error).message || 'Couldn’t open the file picker');
    }
  };
  const pickFolder = async () => {
    try {
      const r = await linkFolder();
      if (r.folder) toast(r.added ? `Linked “${r.folder.name}” · ${r.added} documents` : `Linked “${r.folder.name}” · nothing new`);
    } catch (e) {
      toast((e as Error).message || 'Couldn’t read that folder');
    }
  };

  // plan the evening reminder again whenever things change
  useEffect(() => {
    if (!ready) return;
    const go = () => refreshReminder();
    go();
    document.addEventListener('visibilitychange', go);
    window.addEventListener('quire:goal', go);
    return () => {
      document.removeEventListener('visibilitychange', go);
      window.removeEventListener('quire:goal', go);
    };
  }, [ready]);

  // warm the free-books catalogue quietly, so opening it is instant
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(prefetchCatalog, 6000);
    return () => clearTimeout(t);
  }, [ready]);

  // today's goal reached → say so; at the end of a day that reached it, the light is awarded
  useEffect(() => {
    if (!ready) return;
    const onGoal = () => toast('Goal reached — today’s light is blinking', 'award');
    const checkAward = async () => {
      const s = getState();
      const y = dayKey(new Date(Date.now() - 864e5));
      if ((s.days[y] ?? 0) < s.settings.dailyGoal * 60_000) return;
      const last = await db.get<string>('kv', 'awarded');
      if (last && last >= y) return;
      await db.put('kv', 'awarded', y);
      toast('Yesterday’s light is on your map', 'award', () => {
        setReward(y);
        setStats(true);
      });
    };
    window.addEventListener('quire:goal', onGoal);
    const t = setTimeout(checkAward, 2500);
    const iv = setInterval(checkAward, 60_000);
    document.addEventListener('visibilitychange', checkAward);
    return () => {
      window.removeEventListener('quire:goal', onGoal);
      clearTimeout(t);
      clearInterval(iv);
      document.removeEventListener('visibilitychange', checkAward);
    };
  }, [ready]);

  // a missed day is covered by a freeze (once a week, plus any you've earned)
  useEffect(() => {
    if (!ready) return;
    const onFreeze = () => toast(`A freeze day saved your ${streakInfo(getState().days).current}-day streak`, 'award');
    const check = () => document.visibilityState === 'visible' && applyFreeze();
    window.addEventListener('quire:freeze', onFreeze);
    document.addEventListener('visibilitychange', check);
    const t = setTimeout(check, 1500);
    return () => {
      window.removeEventListener('quire:freeze', onFreeze);
      document.removeEventListener('visibilitychange', check);
      clearTimeout(t);
    };
  }, [ready]);

  // keep the home-screen widget's numbers fresh
  const days = useStore((st) => st.days);
  const dailyGoal = useStore((st) => st.settings.dailyGoal);
  useEffect(() => {
    if (!ready || !isNative) return;
    const t = setTimeout(() => {
      const st = getState();
      const goalMs = dailyGoal * 60_000;
      let week = '';
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const k = dayKey(d);
        const ms = st.days[k] ?? 0;
        week += ms < 60_000 && st.freeze.used.includes(k) ? '~' : glyphFor(ms, goalMs).ch;
      }
      widgetUpdate({ day: dayKey(), streak: streakInfo(st.days).current, today: Math.floor((st.days[dayKey()] ?? 0) / 60_000), goal: dailyGoal, week });
    }, 1200);
    return () => clearTimeout(t);
  }, [ready, days, dailyGoal]);

  // after the first streak milestone (3 days) ask, once, how it's going — and offer a freeze day for feedback
  const idle = !openId && !stats && !settings && !addOpen && !discover && !convert && !scanFiles;
  useEffect(() => {
    if (!ready || !onboarded || !idle || rate) return;
    let alive = true;
    const t = setTimeout(async () => {
      const seen = await db.get<{ at: number; asks: number; done?: boolean }>('kv', 'rate');
      if (!alive || seen?.done) return;
      if (seen && (seen.asks >= 2 || Date.now() - seen.at < 14 * 864e5)) return;
      if (streakInfo(getState().days).current >= 3) setRate(true);
    }, 5000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [ready, onboarded, idle, rate]);
  const closeRate = async (sent: boolean) => {
    setRate(false);
    const seen = await db.get<{ at: number; asks: number }>('kv', 'rate');
    await db.put('kv', 'rate', { at: Date.now(), asks: (seen?.asks ?? 0) + 1, done: sent });
  };

  // end of the introduction: the welcome guide goes on the shelf (once), then whatever they chose
  const finishIntro = async (f: Finish) => {
    updateSettings({ onboarded: true });
    let guide = docs.find(isGuide);
    if (!guide) guide = await importFile(new Blob([welcome], { type: 'text/markdown' }), 'Welcome to Frogity.md', { title: 'Welcome to Frogity' });
    if (f === 'guide') setOpenId(guide.id);
    else if (f === 'add') setAddOpen(true);
  };

  // drag & drop on desktop
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const fs = Array.from(e.dataTransfer?.files ?? []);
      if (fs.length) addFiles(fs.map((f) => ({ blob: f, name: f.name })), fs.length === 1);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [addFiles]);

  if (!ready)
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <PixelLoader grid={4} size={7} />
      </div>
    );

  if (!onboarded) return <Onboarding onDone={finishIntro} />;

  const openDoc = docs.find((d) => d.id === openId);

  return (
    <>
      <Library
        onOpen={setOpenId}
        onAdd={() => setAddOpen(true)}
        onScan={() => camIn.current?.click()}
        onStats={() => setStats(true)}
        onSettings={() => setSettings(true)}
        onConvert={(doc) => setConvert({ doc })}
        onDiscover={() => setDiscover(true)}
        onSample={() => importFile(new Blob([welcome], { type: 'text/markdown' }), 'Welcome to Frogity.md', { title: 'Welcome to Frogity' }).then((m) => setOpenId(m.id))}
      />
      <StatsBubble open={stats} onClose={() => (setStats(false), setReward(null), setDemo(null))} reward={reward} demo={demo} onRewardDone={() => setDemo(null)} />
      {openDoc && <Reader key={openDoc.id} doc={openDoc} onClose={() => setOpenId(null)} onConvert={(doc, root) => setConvert({ doc, root })} />}
      <Settings
        open={settings}
        onClose={() => setSettings(false)}
        onFrogDemo={(n) => {
          setSettings(false);
          setDemo(null);
          setTimeout(() => (setDemo(n), setStats(true)), 320);
        }}
      />
      <RateSheet open={rate} onClose={closeRate} streak={streakInfo(getState().days).current} />
      <ConvertSheet doc={convert?.doc ?? null} root={convert?.root} onClose={() => setConvert(null)} onOpenDoc={setOpenId} />
      <ScanSheet
        files={scanFiles}
        onClose={() => setScanFiles(null)}
        onDone={(id) => {
          setScanFiles(null);
          setOpenId(id);
        }}
      />
      {importing && (
        <div className="toast" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <PixelLoader size={4} gap={2} /> adding {importing.length > 26 ? importing.slice(0, 26) + '…' : importing}
        </div>
      )}
      <AddSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onFiles={pickFiles}
        onFolder={isNative ? pickFolder : undefined}
        onScan={() => camIn.current?.click()}
        onDiscover={() => setDiscover(true)}
        onLink={saveLink}
        onPaste={async (text, title) => {
          const m = await importText(text, title);
          setAddOpen(false);
          toast('Saved to your shelf');
          setOpenId(m.id);
        }}
        busy={linkBusy}
        error={linkErr}
      />
      {discover && <Discover onClose={() => setDiscover(false)} onOpen={setOpenId} />}
      <ScanBadge />
      <Toasts />
      <input
        ref={fileIn}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (fs.length) addFiles(fs.map((f) => ({ blob: f, name: f.name })), fs.length === 1);
        }}
      />
      <input
        ref={camIn}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (fs.length) setScanFiles(fs);
        }}
      />
    </>
  );
}
