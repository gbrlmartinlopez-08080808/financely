import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type LocalDoc } from '../lib/store';
import { KIND_LABEL } from '../lib/kinds';
import { indexLibrary, searchText, type Hit } from '../lib/search';
import { importFiles, prefetch } from '../sync/engine';
import { openDoc, setUi } from './state';
import { Icon } from './Icon';
import { Ascii, Pixel, hasPixel } from './px';
import { KIND_PIXEL } from '../lib/pixels';
import { ago, formatSize, pickFiles, showMenu } from './bits';
import { convertToFr, deleteDocs, downloadOriginal, exportMarks, importNotes, mergePdfs, newFrDoc, pasteFromDocs, renameDoc, setFinished } from './actions';

type Sort = 'recent' | 'added' | 'title' | 'size' | 'progress';
const FILTERS: [string, string][] = [
  ['all', 'All'],
  ['pdf', 'PDF'],
  ['books', 'Books'],
  ['docs', 'Documents'],
  ['media', 'Media'],
  ['reading', 'Reading'],
  ['finished', 'Finished'],
];
const matches = (d: LocalDoc, f: string) => {
  const k = d.meta.doc.kind;
  if (f === 'all') return true;
  if (f === 'pdf') return k === 'pdf' || k === 'scan';
  if (f === 'books') return k === 'epub' || (k === 'pdf' && (d.meta.doc.pages ?? 0) > 60);
  if (f === 'docs') return ['docx', 'markdown', 'text', 'html', 'odt', 'rtf', 'code', 'sheet', 'slides'].includes(k);
  if (f === 'media') return ['image', 'audio', 'video'].includes(k);
  if (f === 'reading') return d.meta.doc.progress > 0.01 && d.meta.doc.progress < 0.98 && !d.meta.doc.finished;
  if (f === 'finished') return !!d.meta.doc.finished || d.meta.doc.progress >= 0.98;
  return true;
};

export function Library() {
  const docs = useStore((s) => s.docs);
  const covers = useStore((s) => s.covers);
  const cached = useStore((s) => s.cached);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(() => localStorage.getItem('frogity-filter') ?? 'all');
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem('frogity-sort') as Sort) ?? 'recent');
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('frogity-view') as 'grid' | 'list') ?? 'grid');
  const [sel, setSel] = useState<string[]>([]);
  const hov = useRef(0);
  const hover = (id: string) => {
    clearTimeout(hov.current);
    hov.current = window.setTimeout(() => prefetch(id), 280);
  };
  const unhover = () => clearTimeout(hov.current);
  const [hits, setHits] = useState<Hit[]>([]);
  const [indexed, setIndexed] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    localStorage.setItem('frogity-filter', filter);
    localStorage.setItem('frogity-sort', sort);
    localStorage.setItem('frogity-view', view);
  }, [filter, sort, view]);

  // the full-text index fills up quietly in the background
  useEffect(() => {
    const t = setTimeout(() => void indexLibrary((done, total) => setIndexed(done < total ? { done, total } : null)), 1500);
    return () => clearTimeout(t);
  }, [docs.length]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = docs.filter((d) => matches(d, filter) && (!needle || `${d.meta.doc.name} ${d.meta.doc.author ?? ''} ${d.meta.doc.fileName}`.toLowerCase().includes(needle)));
    const by: Record<Sort, (a: LocalDoc, b: LocalDoc) => number> = {
      recent: (a, b) => (b.meta.doc.openedAt || 0) - (a.meta.doc.openedAt || 0),
      added: (a, b) => b.meta.doc.addedAt - a.meta.doc.addedAt,
      title: (a, b) => a.meta.doc.name.localeCompare(b.meta.doc.name),
      size: (a, b) => b.meta.doc.size - a.meta.doc.size,
      progress: (a, b) => b.meta.doc.progress - a.meta.doc.progress,
    };
    return list.sort(by[sort]);
  }, [docs, q, filter, sort]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const h = q.trim().length >= 3 ? await searchText(q) : [];
      if (alive) setHits(h);
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, indexed]);

  const click = (e: React.MouseEvent, id: string) => {
    if (e.metaKey || e.ctrlKey) return setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    if (e.shiftKey && sel.length) {
      const a = shown.findIndex((d) => d.id === sel[sel.length - 1]);
      const b = shown.findIndex((d) => d.id === id);
      const [x, y] = a < b ? [a, b] : [b, a];
      return setSel([...new Set([...sel, ...shown.slice(x, y + 1).map((d) => d.id)])]);
    }
    if (sel.length) return setSel([]);
    openDoc(id);
  };
  const menu = (e: React.MouseEvent, d: LocalDoc) => {
    const ids = sel.includes(d.id) ? sel : [d.id];
    const many = ids.length > 1;
    showMenu(e, [
      { label: 'Open', icon: <Icon name="book" size={15} />, run: () => openDoc(d.id), hidden: many },
      { label: 'Open beside the current one', icon: <Icon name="split" size={15} />, run: () => setUi((u) => ({ split: d.id, active: u.active === 'library' || u.active === 'marks' ? u.tabs[0] ?? 'library' : u.active, tabs: u.tabs.includes(d.id) ? u.tabs : [...u.tabs, d.id] })), hidden: many },
      { label: 'Rename', icon: <Icon name="edit" size={15} />, run: () => renameDoc(d.id), hidden: many },
      { label: d.meta.doc.finished ? 'Mark as not finished' : 'Mark as finished', icon: <Icon name="check" size={15} />, run: () => ids.forEach((id) => setFinished(id, !d.meta.doc.finished)) },
      { label: `Merge ${ids.length} PDFs into one`, icon: <Icon name="merge" size={15} />, run: () => mergePdfs(ids), hidden: !many },
      { label: 'Make an editable Frogity copy (.fr)', icon: <Icon name="edit" size={15} />, run: () => void convertToFr(d.id).then((n) => n && openDoc(n)), hidden: many || !['docx', 'markdown', 'html', 'text'].includes(d.meta.doc.kind) },
      { label: 'Download original', icon: <Icon name="download" size={15} />, run: () => ids.forEach(downloadOriginal) },
      { label: 'Export highlights (Markdown)', icon: <Icon name="hl" size={15} />, run: () => exportMarks(ids) },
      { sep: true },
      { label: many ? `Delete ${ids.length} documents` : 'Delete', icon: <Icon name="trash" size={15} />, danger: true, run: () => deleteDocs(ids).then(() => setSel([])) },
    ]);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (e.key === 'Escape') setSel([]);
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) void deleteDocs(sel).then(() => setSel([]));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSel(shown.map((d) => d.id));
      }
      if (e.key === '/') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.lib-bar .search input')?.focus();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [sel, shown]);

  const sub = (d: LocalDoc) => {
    const m = d.meta.doc;
    const p = Math.round(m.progress * 100);
    return m.finished ? 'finished' : p > 0 ? `${p}% · ${ago(m.openedAt)}` : m.pages ? `${m.pages} pages` : formatSize(m.size);
  };

  return (
    <div className="lib">
      <div className="lib-head">
        <h1>
          Library<small>{docs.length} documents</small>
        </h1>
        <button className="btn ghost" onClick={() => newFrDoc()}>
          <Icon name="edit" size={15} /> New note
        </button>
        <button
          className="btn ghost"
          onClick={async () => {
            const f = await pickFiles('.docx,.doc,.md,.markdown,.txt,.html,.htm,.fr');
            if (f.length) await importNotes(f);
          }}
          title="Notes from Word, Google Docs (File → Download → Word), Markdown or text become editable Frogity notes"
        >
          <Pixel name="note" size={14} /> Import notes
        </button>
        <button className="btn ghost" onClick={() => pasteFromDocs()} title="Copy from Google Docs or Word, paste into a new note">
          <Pixel name="plus" size={14} /> Paste from Docs
        </button>
        <button
          className="btn"
          onClick={async () => {
            const f = await pickFiles();
            if (f.length) await importFiles(f);
          }}
        >
          <Icon name="plus" size={15} /> Add files
        </button>
      </div>
      <div className="lib-bar">
        <div className="search">
          <Icon name="search" size={16} />
          <input className="field" placeholder="Search titles and the text inside every document  ( / )" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
        </div>
        <select className="field" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ background: 'var(--surface)' }} aria-label="Sort">
          <option value="recent">Recently read</option>
          <option value="added">Recently added</option>
          <option value="title">Title</option>
          <option value="size">Size</option>
          <option value="progress">Progress</option>
        </select>
        <button className={`ib${view === 'grid' ? ' on' : ''}`} onClick={() => setView('grid')} aria-label="Covers">
          <Icon name="grid" size={16} />
        </button>
        <button className={`ib${view === 'list' ? ' on' : ''}`} onClick={() => setView('list')} aria-label="List">
          <Icon name="list" size={16} />
        </button>
      </div>
      <div className="chips" style={{ marginBottom: 22 }}>
        {FILTERS.map(([k, l]) => (
          <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
        {indexed && (
          <span className="mono muted" style={{ fontSize: 11, alignSelf: 'center', marginLeft: 8 }}>
            preparing search · {indexed.done}/{indexed.total}
          </span>
        )}
      </div>

      {hits.length > 0 && (
        <>
          <p className="section-label">Inside documents · {hits.length} matches</p>
          <div className="results">
            {hits.slice(0, 30).map((h, i) => {
              const d = docs.find((x) => x.id === h.id);
              if (!d) return null;
              return (
                <button key={i} className="hit" onClick={() => openDoc(h.id, h.page)}>
                  <b>{d.meta.doc.name}</b>
                  <small>{d.meta.doc.kind === 'pdf' ? `page ${h.page}` : d.meta.doc.kind === 'epub' ? `chapter ${h.page}` : ''}</small>
                  <p>
                    {h.snippet[0]}
                    <mark>{h.snippet[1]}</mark>
                    {h.snippet[2]}
                  </p>
                </button>
              );
            })}
          </div>
          {shown.length > 0 && <p className="section-label">Titles</p>}
        </>
      )}

      {docs.length === 0 ? (
        <div className="empty">
          <Ascii art="shelf" />
          <h2>Your library is on its way</h2>
          <p>Documents from your phone appear here, covers first, as they arrive. You can also drop files anywhere on this page.</p>
        </div>
      ) : shown.length === 0 && !hits.length ? (
        <div className="empty">
          <h2>Nothing here</h2>
          <p>No document matches{q ? ` “${q}”` : ' this filter'}.</p>
        </div>
      ) : view === 'grid' ? (
        <div className="grid">
          {shown.map((d) => (
            <button key={d.id} className={`card${sel.includes(d.id) ? ' sel' : ''}`} onClick={(e) => click(e, d.id)} onContextMenu={(e) => menu(e, d)} title={d.meta.doc.name}>
              <div className="cv" style={covers[d.id] ? { backgroundImage: `url(${covers[d.id]})` } : undefined} onMouseEnter={() => hover(d.id)} onMouseLeave={unhover}>
                {!covers[d.id] && (
                  <span className="kind">
                    <Pixel name={KIND_PIXEL[d.meta.doc.kind] ?? 'block'} size={11} /> {KIND_LABEL[d.meta.doc.kind] ?? 'File'}
                  </span>
                )}
                {d.fileDirty ? (
                  <span className="away loading" title="Sending to your phone">
                    <Pixel name="eject" size={13} />
                  </span>
                ) : !cached[d.id] && (d.fileStored === false || !d.fileVer) ? (
                  <span className="away" title="On your phone — opens when you click it">
                    <Pixel name="plug" size={13} />
                  </span>
                ) : null}
                {d.meta.doc.progress > 0.005 && <span className="prog" style={{ width: `${Math.min(100, d.meta.doc.progress * 100)}%` }} />}
              </div>
              <div className="t">{d.meta.doc.name}</div>
              <div className="s">{sub(d)}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rows">
          {shown.map((d) => (
            <button key={d.id} className={`row${sel.includes(d.id) ? ' sel' : ''}`} onClick={(e) => click(e, d.id)} onContextMenu={(e) => menu(e, d)}>
              <span className="mini" style={covers[d.id] ? { backgroundImage: `url(${covers[d.id]})` } : undefined} />
              <span className="n">
                {d.meta.doc.name}
                {d.meta.doc.author && <span className="m"> · {d.meta.doc.author}</span>}
              </span>
              <span className="m">{KIND_LABEL[d.meta.doc.kind] ?? 'File'}</span>
              <span className="m">{formatSize(d.meta.doc.size)}</span>
              <span className="m">{ago(d.meta.doc.openedAt || d.meta.doc.addedAt)}</span>
              <span className="m">{Math.round(d.meta.doc.progress * 100)}%</span>
            </button>
          ))}
        </div>
      )}

      {sel.length > 0 && (
        <div className="selbar">
          {sel.length} selected
          <button className="btn sm" onClick={() => mergePdfs(sel)}>
            Merge PDFs
          </button>
          <button className="btn sm" onClick={() => exportMarks(sel)}>
            Export highlights
          </button>
          <button className="btn sm" onClick={() => sel.forEach(downloadOriginal)}>
            Download
          </button>
          <button className="btn sm" onClick={() => deleteDocs(sel).then(() => setSel([]))}>
            Delete
          </button>
          <button className="ib" style={{ color: 'inherit' }} onClick={() => setSel([])} aria-label="Clear selection">
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
