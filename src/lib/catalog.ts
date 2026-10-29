// Free catalogues: public-domain and open-access books and papers, found and fetched straight from their own
// open APIs (no account, no key). "Shop" results only describe a book and send you to the web.
export type SourceId = 'books' | 'archive' | 'papers' | 'shop';

export interface Item {
  id: string;
  source: SourceId;
  title: string;
  author?: string;
  blurb?: string;
  cover?: string;
  /** a file Quire can fetch for you (always free) */
  get?: { url: string; name: string };
  /** where to read more / buy / borrow (opens the web) */
  web?: string;
  tag?: string; // e.g. "epub", "pdf", "free preview", "for sale"
}

export interface Page {
  items: Item[];
  next?: number;
}

export const SOURCES: { id: SourceId; label: string; sub: string; topics: { label: string; q: string }[] }[] = [
  {
    id: 'books',
    label: 'Classics',
    sub: 'Project Gutenberg · 70,000 free books',
    topics: [
      { label: 'Popular', q: '' },
      { label: 'Fiction', q: 'topic:fiction' },
      { label: 'Philosophy', q: 'topic:philosophy' },
      { label: 'Science', q: 'topic:science' },
      { label: 'History', q: 'topic:history' },
      { label: 'Poetry', q: 'topic:poetry' },
      { label: 'Adventure', q: 'topic:adventure' },
      { label: 'Children', q: 'topic:children' },
    ],
  },
  {
    id: 'archive',
    label: 'Archive',
    sub: 'Internet Archive · free PDFs',
    topics: [
      { label: 'Popular', q: '' },
      { label: 'Mathematics', q: 'subject:mathematics' },
      { label: 'Physics', q: 'subject:physics' },
      { label: 'Biology', q: 'subject:biology' },
      { label: 'Economics', q: 'subject:economics' },
      { label: 'Art', q: 'subject:art' },
      { label: 'Law', q: 'subject:law' },
    ],
  },
  {
    id: 'papers',
    label: 'Papers',
    sub: 'arXiv · open research papers',
    topics: [
      { label: 'AI', q: 'cat:cs.AI' },
      { label: 'Language', q: 'cat:cs.CL' },
      { label: 'Vision', q: 'cat:cs.CV' },
      { label: 'Maths', q: 'cat:math.HO OR cat:math.GM' },
      { label: 'Physics', q: 'cat:physics.pop-ph OR cat:quant-ph' },
      { label: 'Biology', q: 'cat:q-bio.NC' },
      { label: 'Economics', q: 'cat:econ.GN' },
    ],
  },
  {
    id: 'shop',
    label: 'Shop & borrow',
    sub: 'Google Books · Open Library · opens the web',
    topics: [],
  },
];

const J = async (url: string) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (r.status === 429) throw new Error('That catalogue is busy right now — try again in a minute.');
  if (!r.ok) throw new Error(`The catalogue answered ${r.status}.`);
  return r.json();
};
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const safeName = (t: string, ext: string) => `${clean(t).replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'book'}.${ext}`;

// ------------------------------------------------------------------ Project Gutenberg (Gutendex)
async function gutenberg(q: string, page: number): Promise<Page> {
  const qs = new URLSearchParams({ page: String(page), languages: 'en' });
  const topic = q.match(/^topic:(.+)$/)?.[1];
  if (topic) qs.set('topic', topic);
  else if (q) qs.set('search', q);
  const j = (await J(`https://gutendex.com/books/?${qs}`)) as {
    next: string | null;
    results: { id: number; title: string; authors: { name: string }[]; subjects: string[]; formats: Record<string, string> }[];
  };
  return {
    items: j.results.map((b) => {
      const f = b.formats;
      const epub = f['application/epub+zip'];
      const html = f['text/html'] ?? f['text/html; charset=utf-8'];
      const pdf = f['application/pdf'];
      const get = pdf ? { url: pdf, name: safeName(b.title, 'pdf') } : epub ? { url: epub, name: safeName(b.title, 'epub') } : html ? { url: html, name: safeName(b.title, 'html') } : undefined;
      const who = b.authors[0]?.name?.split(', ').reverse().join(' ');
      return {
        id: `g${b.id}`,
        source: 'books' as const,
        title: clean(b.title),
        author: who,
        blurb: b.subjects[0]?.replace(/ -- /g, ' · '),
        cover: f['image/jpeg'],
        get,
        web: `https://www.gutenberg.org/ebooks/${b.id}`,
        tag: pdf ? 'pdf' : epub ? 'epub' : 'html',
      };
    }),
    next: j.next ? page + 1 : undefined,
  };
}

// ------------------------------------------------------------------ Internet Archive
async function archive(q: string, page: number): Promise<Page> {
  const subj = q.match(/^subject:(.+)$/)?.[1];
  const terms = subj ? `subject:(${subj})` : q ? `(title:(${q}) OR creator:(${q}) OR subject:(${q}))` : 'collection:(opensource OR gutenberg OR americana)';
  const query = `${terms} AND mediatype:texts AND format:(Text PDF) AND -access-restricted-item:true`;
  const qs = new URLSearchParams({ q: query, rows: '20', page: String(page), output: 'json', sort: 'downloads desc' });
  ['identifier', 'title', 'creator', 'year', 'description'].forEach((f) => qs.append('fl[]', f));
  const j = (await J(`https://archive.org/advancedsearch.php?${qs}`)) as {
    response: { numFound: number; docs: { identifier: string; title?: string; creator?: string | string[]; year?: string | number; description?: string | string[] }[] };
  };
  const per = 20;
  return {
    items: j.response.docs.map((d) => {
      const creator = Array.isArray(d.creator) ? d.creator[0] : d.creator;
      const desc = Array.isArray(d.description) ? d.description[0] : d.description;
      return {
        id: `a${d.identifier}`,
        source: 'archive' as const,
        title: clean(d.title ?? d.identifier),
        author: [creator, d.year].filter(Boolean).join(' · ') || undefined,
        blurb: desc ? clean(desc.replace(/<[^>]+>/g, ' ')).slice(0, 140) : undefined,
        cover: `https://archive.org/services/img/${d.identifier}`,
        web: `https://archive.org/details/${d.identifier}`,
        tag: 'pdf',
      };
    }),
    next: page * per < j.response.numFound ? page + 1 : undefined,
  };
}

/** The Archive keeps the actual PDF name in the item's metadata. */
export async function archivePdf(identifier: string): Promise<{ url: string; name: string }> {
  const j = (await J(`https://archive.org/metadata/${identifier}`)) as { files?: { name: string; format?: string; size?: string }[]; metadata?: { title?: string } };
  const pdfs = (j.files ?? []).filter((f) => /\.pdf$/i.test(f.name) && !/_text\.pdf$/i.test(f.name));
  if (!pdfs.length) throw new Error('This item has no downloadable PDF.');
  pdfs.sort((a, b) => Number(a.size ?? 0) - Number(b.size ?? 0));
  const best = pdfs.find((f) => Number(f.size ?? 0) > 20_000) ?? pdfs[0];
  return { url: `https://archive.org/download/${identifier}/${encodeURIComponent(best.name)}`, name: safeName(j.metadata?.title ?? identifier, 'pdf') };
}

// ------------------------------------------------------------------ arXiv
async function arxiv(q: string, page: number): Promise<Page> {
  const per = 20;
  const search = /^(cat|all|ti|au):/.test(q) || / OR /.test(q) ? q : `all:${q.trim().replace(/\s+/g, '+AND+all:')}`;
  const url = `https://export.arxiv.org/api/query?search_query=${search}&start=${(page - 1) * per}&max_results=${per}&sortBy=${q.startsWith('cat:') ? 'submittedDate' : 'relevance'}&sortOrder=descending`;
  const r = await fetch(url);
  if (r.status === 429) throw new Error('arXiv is busy right now — try again in a minute.');
  if (!r.ok) throw new Error(`arXiv answered ${r.status}.`);
  const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
  const total = Number(xml.querySelector('totalResults')?.textContent ?? 0);
  const items: Item[] = Array.from(xml.querySelectorAll('entry')).map((e) => {
    const id = (e.querySelector('id')?.textContent ?? '').replace(/^https?:\/\/arxiv\.org\/abs\//, '');
    const title = clean(e.querySelector('title')?.textContent ?? id);
    const authors = Array.from(e.querySelectorAll('author > name')).map((n) => n.textContent ?? '');
    return {
      id: `x${id}`,
      source: 'papers' as const,
      title,
      author: authors.slice(0, 3).join(', ') + (authors.length > 3 ? ' et al.' : ''),
      blurb: clean(e.querySelector('summary')?.textContent ?? '').slice(0, 160),
      get: { url: `https://arxiv.org/pdf/${id}`, name: safeName(title, 'pdf') },
      web: `https://arxiv.org/abs/${id}`,
      tag: 'pdf',
    };
  });
  return { items, next: page * per < total ? page + 1 : undefined };
}

// ------------------------------------------------------------------ Google Books + Open Library (descriptions only)
async function shop(q: string, page: number): Promise<Page> {
  if (!q.trim()) return { items: [] };
  const per = 20;
  const items: Item[] = [];
  const g = (await J(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${per}&startIndex=${(page - 1) * per}&printType=books`).catch(() => null)) as {
    totalItems?: number;
    items?: {
      id: string;
      volumeInfo: { title?: string; authors?: string[]; description?: string; imageLinks?: { thumbnail?: string }; infoLink?: string; previewLink?: string };
      saleInfo?: { saleability?: string; buyLink?: string };
      accessInfo?: { viewability?: string; pdf?: { isAvailable?: boolean; downloadLink?: string } };
    }[];
  } | null;
  for (const v of g?.items ?? []) {
    const vi = v.volumeInfo;
    const free = v.accessInfo?.pdf?.isAvailable && v.accessInfo.pdf.downloadLink;
    items.push({
      id: `s${v.id}`,
      source: 'shop',
      title: clean(vi.title ?? 'Untitled'),
      author: vi.authors?.slice(0, 2).join(', '),
      blurb: vi.description ? clean(vi.description).slice(0, 140) : undefined,
      cover: vi.imageLinks?.thumbnail?.replace(/^http:/, 'https:'),
      get: free ? { url: v.accessInfo!.pdf!.downloadLink!, name: safeName(vi.title ?? 'book', 'pdf') } : undefined,
      web: v.saleInfo?.buyLink ?? vi.infoLink ?? vi.previewLink,
      tag: free ? 'free pdf' : v.saleInfo?.saleability === 'FOR_SALE' ? 'for sale' : v.accessInfo?.viewability === 'PARTIAL' ? 'preview' : 'info',
    });
  }
  if (page === 1) {
    const o = (await J(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=8&fields=key,title,author_name,cover_i,ebook_access`).catch(() => null)) as {
      docs?: { key: string; title: string; author_name?: string[]; cover_i?: number; ebook_access?: string }[];
    } | null;
    for (const d of o?.docs ?? []) {
      items.push({
        id: `o${d.key}`,
        source: 'shop',
        title: clean(d.title),
        author: d.author_name?.slice(0, 2).join(', '),
        cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : undefined,
        web: `https://openlibrary.org${d.key}`,
        tag: d.ebook_access === 'borrowable' ? 'borrow free' : d.ebook_access === 'public' ? 'free to read' : 'info',
      });
    }
  }
  if (!items.length && !g) throw new Error('The book catalogues are busy right now — try again in a minute.');
  return { items, next: g?.totalItems && page * per < g.totalItems ? page + 1 : undefined };
}

export function search(source: SourceId, q: string, page = 1): Promise<Page> {
  switch (source) {
    case 'books':
      return gutenberg(q, page);
    case 'archive':
      return archive(q, page);
    case 'papers':
      return arxiv(q || 'cat:cs.AI', page);
    default:
      return shop(q, page);
  }
}

/** Download a file (free). Uses the app's native HTTP, so catalogue sites need no CORS headers. */
export async function fetchFile(url: string): Promise<Blob> {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`Download failed (${r.status}).`);
  const b = await r.blob();
  if (b.size < 800) throw new Error('That download looks empty.');
  return b;
}
