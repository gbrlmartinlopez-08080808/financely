import { Art } from '../ui/Art';
import { useEffect, useState } from 'react';
import type { DocMeta } from '../lib/types';
import { getFile, importFile, loadContent } from '../lib/library';
import * as db from '../lib/db';
import { saveFile, shareFile } from '../lib/native';
import { Pixel, PixelBar, PixelLoader, Sheet, toast } from '../ui/kit';
import type { PixelName } from '../lib/pixels';
import { Icon } from '../ui/Icon';

type T = { id: string; label: string; ext: string; pixel: PixelName; note?: string };

function targetsFor(doc: DocMeta): T[] {
  const pdf: T = { id: 'pdf', label: 'PDF', ext: 'pdf', pixel: 'page' };
  const txt: T = { id: 'txt', label: 'Text', ext: 'txt', pixel: 'lines' };
  const md: T = { id: 'md', label: 'Markdown', ext: 'md', pixel: 'type' };
  const html: T = { id: 'html', label: 'Web page', ext: 'html', pixel: 'code' };
  switch (doc.kind) {
    case 'pdf':
      return [
        { ...txt, note: 'liquid text' },
        { ...md, note: 'liquid text' },
        { ...html, note: 'keeps math' },
        { id: 'png', label: 'Images', ext: 'zip', pixel: 'image', note: 'one per page' },
        { id: 'liquidpdf', label: 'Phone PDF', ext: 'pdf', pixel: 'drop', note: 'reflowed A4' },
      ];
    case 'image':
      return [
        { ...pdf, note: 'one page' },
        { id: 'png', label: 'PNG', ext: 'png', pixel: 'image' },
        { id: 'jpg', label: 'JPEG', ext: 'jpg', pixel: 'image' },
        { id: 'ocr', label: 'Text (OCR)', ext: 'txt', pixel: 'scan' },
      ];
    case 'sheet':
      return [{ id: 'csv', label: 'CSV', ext: 'csv', pixel: 'sheet' }, pdf, html, md];
    case 'audio':
    case 'video':
    case 'unknown':
      return [];
    case 'scan':
      return [{ ...pdf, note: 'searchable' }, txt, md, html];
    default:
      return [pdf, txt, md, html];
  }
}

/** Render a document's liquid HTML into an off-screen element so converters can walk it. */
async function offscreenRoot(doc: DocMeta, onProgress: (p: number) => void): Promise<HTMLElement> {
  const div = document.createElement('div');
  div.className = 'flow';
  div.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px;visibility:hidden;';
  document.body.appendChild(div);
  const c = await loadContent(doc);
  if (c.type === 'flow') div.innerHTML = c.liquid.html;
  else if (c.type === 'pdf') {
    const { pdfToLiquid, blocksToHtml } = await import('../lib/formats/liquidPdf');
    const urls: string[] = [];
    const cached = await db.get<{ blocks: import('../lib/formats/liquidPdf').LBlock[] }>('cache', `${doc.id}:lq8`);
    if (cached) div.innerHTML = blocksToHtml(cached.blocks, urls);
    else {
      const res = await pdfToLiquid(c.blob, (_, p) => onProgress(p.page / p.pages));
      await db.put('cache', `${doc.id}:lq8`, { blocks: res.blocks, scanned: res.scannedPages });
      div.innerHTML = blocksToHtml(res.blocks, urls);
    }
  } else if (c.type === 'sheet') {
    const { sheetsToHtml } = await import('../lib/formats/flow');
    div.innerHTML = sheetsToHtml(c.sheets);
  } else if (c.type === 'code') {
    const pre = document.createElement('pre');
    pre.textContent = c.text;
    div.appendChild(pre);
  }
  return div;
}

export function ConvertSheet({ doc, root, onClose, onOpenDoc }: { doc: DocMeta | null; root?: HTMLElement | null; onClose: () => void; onOpenDoc: (id: string) => void }) {
  const [busy, setBusy] = useState<{ label: string; p: number } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  useEffect(() => {
    setBusy(null);
    setResult(null);
  }, [doc]);
  if (!doc) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const targets = targetsFor(doc);
  const base = doc.name.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'document';

  const run = async (t: T) => {
    setBusy({ label: `making ${t.label.toLowerCase()}`, p: 0 });
    const conv = await import('../lib/convert');
    let made: HTMLElement | null = null;
    try {
      let blob: Blob;
      const prog = (p: number) => setBusy((b) => (b ? { ...b, p } : b));
      const getRoot = async () => root ?? (made = await offscreenRoot(doc, prog));
      if (doc.kind === 'image') {
        const f = (await getFile(doc.id))!;
        if (t.id === 'pdf') blob = await conv.imagesToPdf([f]);
        else if (t.id === 'png' || t.id === 'jpg') blob = await conv.imageConvert(f, t.id);
        else {
          const { recognize, prepareScan } = await import('../lib/ocr');
          const r = await recognize(await prepareScan(f), (p) => prog(p));
          blob = new Blob([r.text], { type: 'text/plain' });
        }
      } else if (doc.kind === 'scan' && t.id === 'pdf') {
        const pages = await Promise.all((doc.scanPages ?? []).map((p) => db.get<Blob>('blobs', p)));
        const html = (await db.get<string>('cache', doc.id + ':ocr')) ?? '';
        const div = document.createElement('div');
        div.innerHTML = html;
        const perPage = Array.from(div.querySelectorAll('section')).map((s) => s.textContent ?? '');
        blob = await conv.imagesToPdf(pages.filter(Boolean) as Blob[], perPage.length ? perPage : [div.textContent ?? '']);
      } else if (doc.kind === 'pdf' && t.id === 'png') {
        const f = (await getFile(doc.id))!;
        blob = await conv.pdfToPngZip(await f.arrayBuffer(), base, prog);
      } else if (doc.kind === 'sheet' && t.id === 'csv') {
        const c = await loadContent(doc);
        if (c.type !== 'sheet') throw new Error('not a sheet');
        blob = new Blob([conv.rowsToCsv(c.sheets[0]?.rows ?? [])], { type: 'text/csv' });
      } else {
        const r = await getRoot();
        if (t.id === 'pdf' || t.id === 'liquidpdf') blob = await conv.flowToPdf(r, doc.name, prog);
        else if (t.id === 'txt') blob = new Blob([conv.flowToText(r)], { type: 'text/plain' });
        else if (t.id === 'md') blob = new Blob([conv.flowToMarkdown(r)], { type: 'text/markdown' });
        else blob = new Blob([await conv.flowToHtml(r, doc.name)], { type: 'text/html' });
      }
      setResult({ blob, name: `${base}${t.id === 'liquidpdf' ? ' (liquid)' : ''}.${t.ext}` });
    } catch (e) {
      console.error(e);
      toast(`Conversion failed: ${(e as Error).message}`);
    } finally {
      (made as HTMLElement | null)?.remove();
      setBusy(null);
    }
  };

  return (
    <Sheet open={!!doc} onClose={onClose} title="Convert">
      <div className="sheet-body" style={{ paddingBottom: 16 }}>
        <Art name="convert" />
        <div className="mono muted" style={{ fontSize: 12, textAlign: 'center', margin: '-4px 0 16px' }}>
          {doc.fileName}
        </div>
        {busy ? (
          <div style={{ display: 'grid', justifyItems: 'center', gap: 16, padding: '28px 0 34px' }}>
            <PixelLoader grid={4} size={7} label={busy.label} />
            <PixelBar value={busy.p} />
          </div>
        ) : result ? (
          <div style={{ display: 'grid', gap: 10, padding: '6px 0 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, background: 'var(--surface-2)' }}>
              <Pixel name="check" size={22} />
              <div style={{ minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {result.name}
                </div>
                <div className="muted mono" style={{ fontSize: 11 }}>
                  {(result.blob.size / 1024).toFixed(0)} KB · ready
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button className="pill" onClick={async () => toast(await saveFile(result.blob, result.name))}>
                <Icon name="down" size={18} /> Save
              </button>
              <button className="pill ghost" onClick={() => shareFile(result.blob, result.name).catch(() => {})}>
                <Icon name="share" size={18} /> Share
              </button>
            </div>
            {!/\.(zip)$/.test(result.name) && (
              <button
                className="pill ghost"
                onClick={async () => {
                  const m = await importFile(result.blob, result.name);
                  toast('Added to your shelf');
                  onClose();
                  onOpenDoc(m.id);
                }}
              >
                <Icon name="book" size={18} /> Add to library & open
              </button>
            )}
          </div>
        ) : targets.length ? (
          <div className="cgrid">
            {targets.map((t) => (
              <button key={t.id} onClick={() => run(t)}>
                <Pixel name={t.pixel} size={28} />
                {t.label}
                {t.note && <small>{t.note}</small>}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ textAlign: 'center', padding: 20 }}>
            Nothing to convert this file to yet.
          </p>
        )}
      </div>
    </Sheet>
  );
}
