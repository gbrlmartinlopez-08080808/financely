import { useCallback, useEffect, useRef, useState } from 'react';
import { init, useStore, updateSettings } from './lib/store';
import { importFile, importText, upgradeCovers } from './lib/library';
import { initBackButton, isNative, listenIncoming, manageSelectionMenu, readIncoming, setStatusBar, tap } from './lib/native';
import { linkFolder, linkPickedFiles, rescanAll } from './lib/linked';
import type { DocMeta } from './lib/types';
import { Library } from './screens/Library';
import { Reader } from './reader/Reader';
import { StatsBubble } from './screens/Stats';
import { AddSheet } from './screens/AddSheet';
import { importUrl, looksLikeUrl } from './lib/links';
import { Settings } from './screens/Settings';
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
  const [settings, setSettings] = useState(false);
  const [convert, setConvert] = useState<{ doc: DocMeta; root?: HTMLElement | null } | null>(null);
  const [scanFiles, setScanFiles] = useState<File[] | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
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

  // first run: put the welcome guide on the shelf
  useEffect(() => {
    if (!ready || onboarded) return;
    updateSettings({ onboarded: true });
    if (docs.length === 0) importFile(new Blob([welcome], { type: 'text/markdown' }), 'Welcome to Quire.md', { title: 'Welcome to Quire' });
  }, [ready, onboarded]); // eslint-disable-line react-hooks/exhaustive-deps

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
        onSample={() => importFile(new Blob([welcome], { type: 'text/markdown' }), 'Welcome to Quire.md', { title: 'Welcome to Quire' }).then((m) => setOpenId(m.id))}
      />
      <StatsBubble open={stats} onClose={() => setStats(false)} />
      {openDoc && <Reader key={openDoc.id} doc={openDoc} onClose={() => setOpenId(null)} onConvert={(doc, root) => setConvert({ doc, root })} />}
      <Settings open={settings} onClose={() => setSettings(false)} />
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
