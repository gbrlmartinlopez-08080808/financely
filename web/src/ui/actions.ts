// Things that can be done to documents from anywhere (library, palette, menus).
import { docById, toast } from '../lib/store';
import { deleteDoc, getFile, importFiles, updateDoc } from '../sync/engine';
import { ask, download, prompt } from './bits';
import { forgetTabs, openDoc } from './state';

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
