// Opens an EPUB: its chapters in reading order, with pictures, cleaned of scripts and styles.
import JSZip from 'jszip';

export interface Chapter {
  title: string;
  html: string;
  text: string;
}
const resolve = (base: string, rel: string) => {
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '').concat(rel).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return decodeURIComponent(out.join('/'));
};

export async function epubChapters(blob: Blob, withImages = false): Promise<Chapter[]> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error('This EPUB has no table of contents file.');
  const opf = new DOMParser().parseFromString((await zip.file(opfPath)?.async('string')) ?? '', 'application/xml');
  const manifest = new Map<string, { href: string; type: string }>();
  opf.querySelectorAll('manifest > item').forEach((it) => manifest.set(it.getAttribute('id') ?? '', { href: it.getAttribute('href') ?? '', type: it.getAttribute('media-type') ?? '' }));
  const urls = new Map<string, string>();
  const imageUrl = async (path: string) => {
    if (urls.has(path)) return urls.get(path)!;
    const f = zip.file(path);
    if (!f) return '';
    const u = URL.createObjectURL(new Blob([await f.async('uint8array')] as BlobPart[]));
    urls.set(path, u);
    return u;
  };
  const out: Chapter[] = [];
  for (const ref of Array.from(opf.querySelectorAll('spine > itemref'))) {
    const it = manifest.get(ref.getAttribute('idref') ?? '');
    if (!it || !/html|xml/.test(it.type)) continue;
    const path = resolve(opfPath, it.href);
    const src = await zip.file(path)?.async('string');
    if (!src) continue;
    const doc = new DOMParser().parseFromString(src, /xhtml|xml/.test(it.type) ? 'application/xhtml+xml' : 'text/html');
    const body = doc.querySelector('body') ?? doc.documentElement;
    body.querySelectorAll('script, style, link, iframe, object, embed').forEach((n) => n.remove());
    body.querySelectorAll('*').forEach((el) => {
      for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name) || a.name === 'style') el.removeAttribute(a.name);
    });
    if (withImages)
      for (const img of Array.from(body.querySelectorAll('img, image'))) {
        const attr = img.tagName.toLowerCase() === 'image' ? 'xlink:href' : 'src';
        const v = img.getAttribute(attr) ?? img.getAttribute('href');
        if (v && !/^(data|https?):/.test(v)) img.setAttribute(attr === 'xlink:href' ? 'href' : 'src', await imageUrl(resolve(path, v)));
      }
    const text = (body.textContent ?? '').replace(/\s+\n/g, '\n').trim();
    if (!text && !body.querySelector('img, image')) continue;
    out.push({ title: body.querySelector('h1, h2, h3')?.textContent?.trim() ?? '', html: body.innerHTML, text });
  }
  return out;
}
