// Things that can be done to documents from anywhere (library, palette, menus).
import { docById, toast } from '../lib/store';
import { deleteDoc, getFile, importFiles, updateDoc } from '../sync/engine';
import { ask, download, prompt } from './bits';
import { forgetTabs, openDoc } from './state';
import { makeFr } from '../lib/fr';
import { cleanHtml } from '../lib/convert';

export async function newDocument(title = 'Untitled') {
  const name = await prompt('New document', title, 'Create');
  if (!name) return;
  const [id] = await importFiles([{ name: `${name}.md`, blob: new Blob([`# ${name}\n\n`], { type: 'text/markdown' }) }]);
  if (id) openDoc(id);
}

export async function renameDoc(id: string) {
  const d = docById(id);
  if (!d) return;
  const name = await prompt('Rename', d.meta.doc.name);
  if (name && name !== d.meta.doc.name) await updateDoc(id, { name });
}

export async function deleteDocs(ids: string[]) {
  if (!ids.length) return;
  const one = ids.length === 1 ? docById(ids[0])?.meta.doc.name : null;
  const ok = await ask(one ? `Delete “${one}”?` : `Delete ${ids.length} documents?`, 'It is removed from this computer and from your phone, with its highlights and bookmarks. Files the phone only links to (in a folder) stay in that folder.', 'Delete', true);
  if (!ok) return;
  forgetTabs(ids);
  for (const id of ids) await deleteDoc(id);
  toast(ids.length === 1 ? 'Deleted' : `${ids.length} documents deleted`);
}

export async function downloadOriginal(id: string) {
  const d = docById(id);
  if (!d) return;
  try {
    download(await getFile(id), d.meta.doc.fileName || d.meta.doc.name);
  } catch (e) {
    toast((e as Error).message);
  }
}

export async function setFinished(id: string, finished: boolean) {
  await updateDoc(id, { finished, progress: finished ? 1 : docById(id)?.meta.doc.progress ?? 0 });
}

/** Several PDFs → one new PDF, in the order given. */
export async function mergePdfs(ids: string[]) {
  const pdfs = ids.filter((id) => docById(id)?.meta.doc.kind === 'pdf');
  if (pdfs.length < 2) return toast('Pick two or more PDFs to merge');
  const name = await prompt('Name of the merged PDF', `${docById(pdfs[0])!.meta.doc.name} + ${pdfs.length - 1} more`, 'Merge');
  if (!name) return;
  toast('Merging…');
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const id of pdfs) {
    const src = await PDFDocument.load(await (await getFile(id)).arrayBuffer(), { ignoreEncryption: true });
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  const bytes = await out.save();
  const [nid] = await importFiles([{ name: `${name}.pdf`, blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }) }]);
  if (nid) openDoc(nid);
}

/** Every highlight and note of the given documents as Markdown. */
export function marksMarkdown(ids: string[]) {
  let md = '';
  for (const id of ids) {
    const d = docById(id);
    if (!d || !d.meta.marks.h.length) continue;
    md += `## ${d.meta.doc.name}\n\n`;
    for (const h of [...d.meta.marks.h].sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.at - b.at)) {
      md += `> ${h.text.replace(/\n+/g, ' ')}\n`;
      if (h.page) md += `>\n> — page ${h.page}\n`;
      if (h.note) md += `\n${h.note}\n`;
      md += '\n';
    }
  }
  return md;
}
export async function exportMarks(ids: string[]) {
  const md = marksMarkdown(ids);
  if (!md) return toast('No highlights yet');
  download(new Blob([md], { type: 'text/markdown' }), 'Frogity highlights.md');
}

// ---------------------------------------------------------------- Frogity documents (.fr): editable everywhere
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A new, empty note; it opens ready to write in (and appears on the phone). */
export async function newFrDoc(title = 'Untitled note'): Promise<string | undefined> {
  const name = await prompt('New note', title, 'Create');
  if (!name) return;
  const [id] = await importFiles([{ name: `${name}.fr`, blob: makeFr(name, '') }]);
  if (id) openDoc(id);
  return id;
}
/** The HTML of a document, for turning it into a Frogity document. */
async function htmlOf(blob: Blob, kind: string): Promise<string | null> {
  if (kind === 'docx') return (await (await import('mammoth')).convertToHtml({ arrayBuffer: await blob.arrayBuffer() })).value;
  if (kind === 'markdown') return await (await import('marked')).marked.parse(await blob.text(), { gfm: true });
  if (kind === 'html') return cleanHtml(await blob.text());
  if (kind === 'text' || kind === 'code') return (await blob.text()).split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  return null;
}
/** Word, Markdown, web pages and text become Frogity documents: editable on the computer and the phone alike. */
export async function convertToFr(id: string): Promise<string | undefined> {
  const d = docById(id);
  if (!d) return;
  try {
    const html = await htmlOf(await getFile(id), d.meta.doc.kind);
    if (html === null) return void toast('This kind of file can’t be turned into an editable note yet');
    const [nid] = await importFiles([{ name: `${d.meta.doc.name}.fr`, blob: makeFr(d.meta.doc.name, html) }]);
    toast('Made an editable copy — it is on your phone too');
    return nid;
  } catch (e) {
    toast('Could not convert: ' + (e as Error).message);
  }
}
/** Notes from Word, Google Docs (downloaded as Word), Markdown or text: each becomes a Frogity document. */
export async function importNotes(files: File[]) {
  const made: string[] = [];
  for (const f of files) {
    const kind = (await import('../lib/kinds')).kindOf(f.name, f.type);
    if (kind === 'pdf' || kind === 'epub' || kind === 'image') {
      const ids = await importFiles([f]);
      made.push(...ids);
      continue;
    }
    const html = await htmlOf(f, kind).catch(() => null);
    if (html === null) {
      toast(`“${f.name}” can’t be turned into a note — added as it is`);
      made.push(...(await importFiles([f])));
      continue;
    }
    const title = f.name.replace(/\.[^.]+$/, '');
    made.push(...(await importFiles([{ name: `${title}.fr`, blob: makeFr(title, html) }])));
  }
  if (made.length === 1) openDoc(made[0]);
  return made;
}
/** Paste from Google Docs or Word: a new note opens, ready for ⌘V. */
export async function pasteFromDocs() {
  const id = await newFrDoc('Pasted from Docs');
  if (id) toast('Now paste (⌘V) — headings, lists, bold and links come with it');
}
