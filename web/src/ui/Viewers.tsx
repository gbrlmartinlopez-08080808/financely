import { useEffect, useRef, useState } from 'react';
import type { LocalDoc } from '../lib/store';
import { updateDoc } from '../sync/engine';
import { epubChapters, type Chapter } from '../lib/epub';
import { cleanHtml } from '../lib/convert';
import { getUi } from './state';
import { Icon } from './Icon';
import { downloadOriginal } from './actions';

/** An EPUB as one long, comfortable column, with its chapters at the side. */
export function EpubView({ doc, blob }: { doc: LocalDoc; blob: Blob }) {
  const [chs, setChs] = useState<Chapter[] | null>(null);
  const [err, setErr] = useState('');
  const [t, setT] = useState(() => localStorage.getItem('frogity-read-theme') ?? 'paper');
  const [size, setSize] = useState(() => Number(localStorage.getItem('frogity-read-size')) || 20);
  const [side, setSide] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    epubChapters(blob, true).then(setChs, (e) => setErr((e as Error).message));
  }, [blob]);
  useEffect(() => {
    localStorage.setItem('frogity-read-theme', t);
    localStorage.setItem('frogity-read-size', String(size));
  }, [t, size]);
  useEffect(() => {
    if (!chs || !scroller.current) return;
    const el = scroller.current;
    const jump = getUi().jump[doc.id];
    requestAnimationFrame(() => {
      if (jump) el.querySelector(`[data-ch="${jump - 1}"]`)?.scrollIntoView();
      else if (doc.meta.doc.progress > 0.01) el.scrollTop = doc.meta.doc.progress * (el.scrollHeight - el.clientHeight);
    });
    void updateDoc(doc.id, { openedAt: Date.now() });
    let tm = 0;
    const on = () => {
      clearTimeout(tm);
      tm = window.setTimeout(() => {
        const p = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
        void updateDoc(doc.id, { progress: p, position: { mode: 'liquid', value: p } });
      }, 1500);
    };
    el.addEventListener('scroll', on);
    return () => el.removeEventListener('scroll', on);
  }, [chs]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="loading">{err}</div>;
  if (!chs)
    return (
      <div className="loading">
        <i className="spin" />
      </div>
    );
  return (
    <div className="ws">
      <div className="toolbar">
        <button className={`ib${side ? ' on' : ''}`} onClick={() => setSide((s) => !s)} data-tip="Chapters">
          <Icon name="sidebar" size={17} />
        </button>
        <span className="title">{doc.meta.doc.name}</span>
        <div className="grow" />
        {['paper', 'white', 'night'].map((x) => (
          <button key={x} className={`chip${t === x ? ' on' : ''}`} onClick={() => setT(x)} style={{ marginLeft: 4 }}>
            {x}
          </button>
        ))}
        <button className="ib" onClick={() => setSize((s) => Math.max(14, s - 1))} data-tip="Smaller">
          <span style={{ font: '600 12px var(--mono)' }}>A−</span>
        </button>
        <button className="ib" onClick={() => setSize((s) => Math.min(30, s + 1))} data-tip="Bigger">
          <span style={{ font: '600 12px var(--mono)' }}>A+</span>
        </button>
      </div>
      <div className="body">
        {side && (
          <div className="side panel" style={{ width: 240 }}>
            <h4>Chapters</h4>
            {chs.map((c, i) => (
              <button key={i} className="mk" onClick={() => scroller.current?.querySelector(`[data-ch="${i}"]`)?.scrollIntoView({ behavior: 'smooth' })}>
                {c.title || `Part ${i + 1}`}
              </button>
            ))}
          </div>
        )}
        <div className="reading" data-t={t} ref={scroller}>
          <div className="column" style={{ fontSize: size }}>
            {chs.map((c, i) => (
              <section key={i} data-ch={i} dangerouslySetInnerHTML={{ __html: cleanHtml(c.html) }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ImageView({ doc, blob }: { doc: LocalDoc; blob: Blob }) {
  const [url] = useState(() => URL.createObjectURL(blob));
  const [z, setZ] = useState<number | null>(null);
  const [rot, setRot] = useState(0);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="ws">
      <div className="toolbar">
        <span className="title">{doc.meta.doc.name}</span>
        <div className="grow" />
        <button className="ib" data-tip="Rotate" onClick={() => setRot((r) => (r + 90) % 360)}>
          <Icon name="rotR" size={16} />
        </button>
        <button className="ib" data-tip="Zoom out" onClick={() => setZ((v) => Math.max(0.1, (v ?? 1) / 1.25))}>
          <Icon name="zoomout" size={16} />
        </button>
        <button className="zoom" onClick={() => setZ(null)}>
          {z ? Math.round(z * 100) + '%' : 'fit'}
        </button>
        <button className="ib" data-tip="Zoom in" onClick={() => setZ((v) => Math.min(8, (v ?? 1) * 1.25))}>
          <Icon name="zoomin" size={16} />
        </button>
        <button className="ib" data-tip="Download" onClick={() => downloadOriginal(doc.id)}>
          <Icon name="download" size={16} />
        </button>
      </div>
      <div className="mediaview">
        <img src={url} alt={doc.meta.doc.name} style={{ transform: `rotate(${rot}deg) scale(${z ?? 1})`, maxWidth: z ? 'none' : '92%', maxHeight: z ? 'none' : '88vh', transition: 'transform .15s' }} />
      </div>
      {doc.meta.text && (
        <div className="notice" style={{ margin: 16, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          <b className="mono" style={{ fontSize: 11 }}>TEXT READ BY THE PHONE</b>
          <br />
          {doc.meta.text}
        </div>
      )}
    </div>
  );
}

export function MediaView({ doc, blob }: { doc: LocalDoc; blob: Blob }) {
  const [url] = useState(() => URL.createObjectURL(blob));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="ws">
      <div className="toolbar">
        <span className="title">{doc.meta.doc.name}</span>
      </div>
      <div className="mediaview">{doc.meta.doc.kind === 'video' ? <video src={url} controls style={{ maxWidth: '92%', maxHeight: '80vh' }} /> : <audio src={url} controls style={{ width: 520 }} />}</div>
    </div>
  );
}

export function SheetView({ doc, blob }: { doc: LocalDoc; blob: Blob }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  useEffect(() => {
    void blob.text().then((t) => setRows(parseCsv(t, /\.tsv$/i.test(doc.meta.doc.fileName) ? '\t' : t.split('\n')[0].includes(';') && !t.split('\n')[0].includes(',') ? ';' : ',').slice(0, 5000)));
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows)
    return (
      <div className="loading">
        <i className="spin" />
      </div>
    );
  return (
    <div className="ws">
      <div className="toolbar">
        <span className="title">{doc.meta.doc.name}</span>
        <span className="dirty">
          {rows.length} rows · {rows[0]?.length ?? 0} columns
        </span>
      </div>
      <div className="reading" style={{ background: 'var(--page-bg)' }}>
        <table className="sheettable">
          <thead>
            <tr>
              {rows[0]?.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((r, i) => (
              <tr key={i}>
                {r.map((c, k) => (
                  <td key={k}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function parseCsv(t: string, sep: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) row.push(cell), (cell = '');
    else if (c === '\n') row.push(cell.replace(/\r$/, '')), out.push(row), (row = []), (cell = '');
    else cell += c;
  }
  if (cell || row.length) row.push(cell), out.push(row);
  return out;
}
