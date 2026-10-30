import { useEffect, useRef, useState } from 'react';
import * as db from '../lib/db';
import { saveDoc } from '../lib/store';
import { generatedCover } from '../lib/library';
import { escapeHtml } from '../lib/sanitize';
import type { DocMeta } from '../lib/types';
import { Icon } from '../ui/Icon';
import { PixelBar, PixelLoader, Sheet, Toggle, toast } from '../ui/kit';

/** Photograph pages → cleaned images + on-device OCR → a searchable "scan" document. */
export function ScanSheet({ files, onClose, onDone }: { files: File[] | null; onClose: () => void; onDone: (id: string) => void }) {
  const [pages, setPages] = useState<{ blob: Blob; url: string }[]>([]);
  const [title, setTitle] = useState('');
  const [ocr, setOcr] = useState(true);
  const [busy, setBusy] = useState<{ label: string; p: number } | null>(null);
  const more = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!files) return;
    setPages(files.map((f) => ({ blob: f, url: URL.createObjectURL(f) })));
    setTitle(`Scan ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
    setBusy(null);
  }, [files]);

  const create = async () => {
    if (!pages.length) return;
    const { prepareScan } = await import('../lib/ocr');
    const id = db.uid();
    const ids: string[] = [];
    const cleaned: Blob[] = [];
    for (let i = 0; i < pages.length; i++) {
      setBusy({ label: `cleaning page ${i + 1}`, p: i / pages.length });
      const img = await prepareScan(pages[i].blob);
      cleaned.push(img);
      const k = `${id}:scan:${i}`;
      await db.put('blobs', k, img);
      ids.push(k);
    }
    setBusy({ label: 'saving', p: 1 });
    const { imagesToPdf } = await import('../lib/convert');
    const pdf = await imagesToPdf(cleaned).catch(() => null);
    // the words are read in the background after the pages are saved (a corner badge shows how far it is)
    await db.put('kv', `scan:${id}`, ocr ? 'pending' : 'skip');
    await db.put('files', id, pdf ?? cleaned[0]);
    const coverId = id + ':cover';
    const firstCover = await createImageBitmap(cleaned[0]).then(async (b) => {
      const c = document.createElement('canvas');
      const s = 480 / Math.max(b.width, b.height);
      c.width = b.width * s;
      c.height = b.height * s;
      c.getContext('2d')!.drawImage(b, 0, 0, c.width, c.height);
      return new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
    });
    await db.put('blobs', coverId, firstCover ?? (await generatedCover(title, 'scan')));
    const now = Date.now();
    const meta: DocMeta = {
      id,
      name: title || 'Scan',
      fileName: `${title || 'scan'}.pdf`,
      kind: 'scan',
      mime: 'application/pdf',
      size: pdf?.size ?? cleaned[0].size,
      addedAt: now,
      openedAt: now,
      progress: 0,
      pages: pages.length,
      coverId,
      readMs: 0,
      scanPages: ids,
    };
    await saveDoc(meta);
    pages.forEach((p) => URL.revokeObjectURL(p.url));
    setBusy(null);
    toast(ocr ? 'Scanned — reading the words in the background' : 'Scanned');
    onDone(id);
  };

  return (
    <Sheet open={!!files} onClose={busy ? () => {} : onClose} title="Scan">
      <div className="sheet-body" style={{ paddingBottom: 16 }}>
        {busy ? (
          <div style={{ display: 'grid', justifyItems: 'center', gap: 16, padding: '30px 0 36px' }}>
            <PixelLoader grid={4} size={7} label={busy.label} />
            <PixelBar value={busy.p} />
          </div>
        ) : (
          <>
            <div className="scan-pages">
              {pages.map((p, i) => (
                <div key={p.url}>
                  <img src={p.url} alt={`Page ${i + 1}`} />
                  <button onClick={() => setPages((l) => l.filter((x) => x !== p))} aria-label="Remove page">
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
              <div className="add" role="button" onClick={() => more.current?.click()}>
                <span style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
                  <Icon name="camera" size={26} />
                  <span className="mono" style={{ fontSize: 11 }}>
                    add page
                  </span>
                </span>
              </div>
            </div>
            <input
              ref={more}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(e) => {
                const fs = Array.from(e.target.files ?? []);
                setPages((l) => [...l, ...fs.map((f) => ({ blob: f as Blob, url: URL.createObjectURL(f) }))]);
                e.target.value = '';
              }}
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              style={{ width: '100%', height: 48, borderRadius: 14, border: '1px solid var(--line-2)', padding: '0 14px', background: 'var(--surface-2)', fontSize: 16, marginTop: 4 }}
            />
            <div className="row">
              <div className="grow">
                <div className="row-label">Recognise text</div>
                <div className="row-sub">On-device OCR — search, listen, define, convert</div>
              </div>
              <Toggle on={ocr} onChange={setOcr} label="Recognise text" />
            </div>
            <button className="pill" style={{ width: '100%', marginTop: 10 }} onClick={create} disabled={!pages.length}>
              Create document · {pages.length} page{pages.length === 1 ? '' : 's'}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
