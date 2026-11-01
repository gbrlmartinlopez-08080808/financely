import { useEffect, useState } from 'react';
import { docById, toast, useStore } from '../lib/store';
import { importFiles } from '../sync/engine';
import { closeTab, getUi, openDoc, setUi, useUi } from './state';
import { Pair } from './Pair';
import { Library } from './Library';
import { Workspace } from './Workspace';
import { Marks } from './Marks';
import { Palette } from './Palette';
import { Devices, Keys } from './Dialogs';
import { Toasts, ago } from './bits';
import { Mark, Pixel, PixelLoader, hasPixel } from './px';
import { Icon } from './Icon';
import { newFrDoc } from './actions';
import { Welcome } from './Welcome';

export function App() {
  const phase = useStore((s) => s.phase);
  return (
    <>
      <div className="small-screen">
        <div>
          <Mark size={96} />
          <h1>Made for big screens</h1>
          <p className="muted">Frogity for the computer needs a wider window. On your phone, use the Frogity app — it has everything.</p>
        </div>
      </div>
      {phase === 'loading' ? (
        <div className="loading" style={{ height: '100%' }}>
          <PixelLoader grid={4} size={7} />
        </div>
      ) : phase === 'unpaired' ? (
        <Pair />
      ) : (
        <Shell />
      )}
      <Toasts />
    </>
  );
}

function Shell() {
  const tabs = useUi((u) => u.tabs);
  const active = useUi((u) => u.active);
  const split = useUi((u) => u.split);
  const palette = useUi((u) => u.palette);
  const dialog = useUi((u) => u.dialog);
  const docs = useStore((s) => s.docs);
  const [drag, setDrag] = useState(false);
  const [welcome, setWelcome] = useState(() => !localStorage.getItem('frogity-welcome'));

  // tabs of documents deleted elsewhere close themselves
  useEffect(() => {
    const gone = tabs.filter((t) => !docById(t));
    if (gone.length && docs.length) gone.forEach(closeTab);
  }, [docs, tabs]);

  // the keyboard
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]');
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setUi((u) => ({ palette: !u.palette }));
      } else if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void pick();
      } else if (mod && e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void newFrDoc();
      } else if (mod && e.key.toLowerCase() === 'w' && getUi().active !== 'library' && getUi().active !== 'marks') {
        e.preventDefault();
        closeTab(getUi().active);
      } else if (mod && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const u = getUi();
        const n = Number(e.key);
        setUi({ active: n === 1 ? 'library' : (u.tabs[n - 2] ?? u.active) });
      } else if (e.key === '?' && !typing) setUi({ dialog: 'keys' });
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  // files dropped anywhere join the library (a PDF dropped on an open PDF's pages view is handled there instead)
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => has(e) && (depth++, setDrag(true));
    const leave = (e: DragEvent) => has(e) && --depth <= 0 && ((depth = 0), setDrag(false));
    const over = (e: DragEvent) => has(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      depth = 0;
      setDrag(false);
      if (!has(e) || e.defaultPrevented) return;
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void importFiles(files).then((ids) => ids.length === 1 && openDoc(ids[0]));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const pick = async () => {
    const { pickFiles } = await import('./bits');
    const f = await pickFiles();
    if (f.length) {
      const ids = await importFiles(f);
      if (ids.length === 1) openDoc(ids[0]);
    }
  };

  return (
    <div className="shell">
      <div className="tabs">
        <div className="logo">
          <Mark size={26} />
        </div>
        <button className={`tab${active === 'library' ? ' on' : ''}`} onClick={() => setUi({ active: 'library' })} style={{ paddingRight: 12 }}>
          <Pixel name="block" size={14} className="px" />
          <span>Library</span>
        </button>
        <button className={`tab${active === 'marks' ? ' on' : ''}`} onClick={() => setUi({ active: 'marks' })} style={{ paddingRight: 12 }}>
          <Pixel name="note" size={14} className="px" />
          <span>Highlights</span>
        </button>
        {tabs.map((id) => {
          const d = docById(id);
          if (!d) return null;
          return (
            <div
              key={id}
              role="tab"
              className={`tab${active === id ? ' on' : ''}`}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(id);
                } else if (e.button === 0) setUi({ active: id });
              }}
              title={d.meta.doc.name}
            >
              <span>{d.meta.doc.name}</span>
              {split === id && <Icon name="split" size={13} />}
              <button
                className="x"
                aria-label="Close tab"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(id);
                }}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          );
        })}
        <div className="grow" />
        <div className="right">
          <button className="ib" data-tip="Search and commands  ⌘K" onClick={() => setUi({ palette: true })}>
            <Icon name="search" size={17} />
          </button>
          <button className="ib" data-tip="Add files  ⌘O" onClick={pick}>
            <Icon name="plus" size={17} />
          </button>
          <SyncDot />
        </div>
      </div>
      <div className="main">
        <div className="pane">{active === 'library' ? <Library /> : active === 'marks' ? <Marks /> : docById(active) ? <Workspace key={active} id={active} /> : <Library />}</div>
        {split && split !== active && docById(split) && (
          <div className="pane">
            <Workspace key={'split:' + split} id={split} secondary />
          </div>
        )}
      </div>
      {palette && <Palette />}
      {dialog === 'devices' && <Devices />}
      {dialog === 'keys' && <Keys />}
      {welcome && (
        <Welcome
          onDone={() => {
            localStorage.setItem('frogity-welcome', '1');
            setWelcome(false);
          }}
        />
      )}
      {drag && (
        <div className="drop">
          <div>Drop to add to your library</div>
        </div>
      )}
    </div>
  );
}

function SyncDot() {
  const s = useStore((x) => x.sync);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);
  const cls = s.error === 'offline' ? 'off' : s.error ? 'err' : s.busy ? 'busy' : s.live ? '' : 'off';
  const text = s.transfer
    ? `${s.transfer.name.slice(0, 18)} · ${Math.round((s.transfer.done / s.transfer.total) * 100)}%`
    : s.error === 'offline'
      ? 'offline — saved here'
      : s.error
        ? 'sync problem'
        : s.busy
          ? 'syncing…'
          : s.last
            ? `synced ${ago(s.last)}`
            : 'connecting…';
  return (
    <button
      className={`syncdot ${cls}`}
      title={s.error && s.error !== 'offline' ? s.error : 'Devices and sync'}
      onClick={() => {
        if (s.error && s.error !== 'offline') toast(s.error);
        setUi({ dialog: 'devices' });
      }}
    >
      <Pixel name={s.error && s.error !== 'offline' ? 'dash' : 'plug'} size={12} />
      {text}
    </button>
  );
}
