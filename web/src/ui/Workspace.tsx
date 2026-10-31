import { lazy, Suspense, useEffect, useState } from 'react';
import { docById, useStore } from '../lib/store';
import { KIND_LABEL } from '../lib/kinds';
import { getFile } from '../sync/engine';
import { formatSize } from './bits';
import { downloadOriginal } from './actions';
import { Icon } from './Icon';

const PdfWorkspace = lazy(() => import('./pdf/PdfWorkspace').then((m) => ({ default: m.PdfWorkspace })));
const TextWorkspace = lazy(() => import('./TextWorkspace').then((m) => ({ default: m.TextWorkspace })));
const Viewers = { epub: lazy(() => import('./Viewers').then((m) => ({ default: m.EpubView }))), image: lazy(() => import('./Viewers').then((m) => ({ default: m.ImageView }))), media: lazy(() => import('./Viewers').then((m) => ({ default: m.MediaView }))), sheet: lazy(() => import('./Viewers').then((m) => ({ default: m.SheetView }))) };

const Spinner = () => (
  <div className="loading">
    <i className="spin" />
  </div>
);

/** Opens a document in the right tool for its kind (fetching and decrypting the file first if needed). */
export function Workspace({ id, secondary }: { id: string; secondary?: boolean }) {
  const doc = useStore((s) => s.docs.find((d) => d.id === id));
  const transfer = useStore((s) => s.sync.transfer);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [err, setErr] = useState('');
  const [ver, setVer] = useState(0);
  useEffect(() => {
    let alive = true;
    setErr('');
    getFile(id).then(
      (b) => alive && setBlob(b),
      (e) => alive && setErr((e as Error).message),
    );
    return () => {
      alive = false;
    };
  }, [id, ver, doc?.fileVer === null]); // eslint-disable-line react-hooks/exhaustive-deps
  // a newer version came from the phone (or another computer): show it
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<{ id: string }>).detail.id === id && (setBlob(null), setVer((v) => v + 1));
    window.addEventListener('frogity:file', on);
    return () => window.removeEventListener('frogity:file', on);
  }, [id]);

  if (!doc) return null;
  if (err)
    return (
      <div className="loading">
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <p>{err}</p>
          <button className="btn ghost" onClick={() => setVer((v) => v + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  if (!blob)
    return (
      <div className="loading">
        <div style={{ textAlign: 'center' }}>
          <i className="spin" style={{ margin: '0 auto 12px' }} />
          {transfer ? `Bringing it over · ${Math.round((transfer.done / transfer.total) * 100)}%` : 'Opening…'}
        </div>
      </div>
    );
  const k = doc.meta.doc.kind;
  const d = docById(id) ?? doc;
  return (
    <Suspense fallback={<Spinner />}>
      {k === 'pdf' || (k === 'scan' && doc.meta.doc.mime === 'application/pdf') ? (
        <PdfWorkspace key={doc.fileVer ?? 'x'} doc={d} blob={blob} secondary={secondary} />
      ) : ['markdown', 'text', 'html', 'docx', 'code', 'rtf'].includes(k) ? (
        <TextWorkspace key={ver} doc={d} blob={blob} secondary={secondary} />
      ) : k === 'epub' ? (
        <Viewers.epub doc={d} blob={blob} />
      ) : k === 'image' || k === 'scan' ? (
        <Viewers.image doc={d} blob={blob} />
      ) : k === 'audio' || k === 'video' ? (
        <Viewers.media doc={d} blob={blob} />
      ) : k === 'sheet' && /csv|tsv|text/.test(doc.meta.doc.mime + doc.meta.doc.fileName) ? (
        <Viewers.sheet doc={d} blob={blob} />
      ) : (
        <div className="loading">
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <Icon name="book" size={30} style={{ margin: '0 auto 10px' }} />
            <p>
              <b>{doc.meta.doc.name}</b>
              <br />
              <span className="muted">
                {KIND_LABEL[k] ?? 'File'} · {formatSize(doc.meta.doc.size)} — this kind of file can't be shown here yet.
              </span>
            </p>
            <button className="btn" onClick={() => downloadOriginal(id)}>
              <Icon name="download" size={15} /> Download
            </button>
          </div>
        </div>
      )}
    </Suspense>
  );
}
