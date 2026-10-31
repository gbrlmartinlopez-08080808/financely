// DOM utilities for the liquid reading column.
import { sentences } from '../lib/tts';

const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,dd,dt,td,th,pre';

/** Wrap every sentence in <span class="s" data-i> (possibly several spans per sentence). Returns sentence count. */
export function wrapSentences(root: HTMLElement, lang = 'en'): number {
  if (root.dataset.wrapped) return Number(root.dataset.wrapped);
  let n = 0;
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCKS)).filter((b) => !b.querySelector(BLOCKS) || b.tagName === 'LI');
  for (const b of blocks) {
    if (b.closest('.katex, math, pre') && b.tagName !== 'PRE') continue;
    if (b.closest('.lq-sources')) continue; // the folded sources at the back are not read aloud
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => (t.parentElement?.closest('.katex, math, .s, .eqno') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes: Text[] = [];
    let full = '';
    const starts: number[] = [];
    for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
      starts.push(full.length);
      nodes.push(t);
      full += t.data;
    }
    if (!full.trim()) continue;
    const segs = sentences(full, lang);
    if (!segs.length) continue;
    // boundaries: absolute offsets where a new sentence begins
    const bounds = segs.map((s) => s.start);
    const sentenceAt = (off: number) => {
      let lo = 0;
      let hi = bounds.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (bounds[mid] <= off) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const base = n;
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k];
      const s0 = starts[k];
      const len = node.data.length;
      // split node at boundaries inside it
      const cuts: number[] = [0];
      for (const bd of bounds) if (bd > s0 && bd < s0 + len) cuts.push(bd - s0);
      cuts.push(len);
      const frag = document.createDocumentFragment();
      for (let c = 0; c < cuts.length - 1; c++) {
        const piece = node.data.slice(cuts[c], cuts[c + 1]);
        if (!piece) continue;
        if (!piece.trim()) {
          frag.appendChild(document.createTextNode(piece));
          continue;
        }
        const span = document.createElement('span');
        span.className = 's';
        span.dataset.i = String(base + sentenceAt(s0 + cuts[c]));
        span.textContent = piece;
        frag.appendChild(span);
      }
      node.replaceWith(frag);
    }
    n += segs.length;
  }
  root.dataset.wrapped = String(n);
  return n;
}

export function sentenceText(root: HTMLElement, i: number): string {
  return Array.from(root.querySelectorAll<HTMLElement>(`.s[data-i="${i}"]`))
    .map((s) => s.textContent ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The sentence's text exactly as it is in the page (whitespace not collapsed), so offsets into it match what was tapped. */
export function sentenceRaw(root: HTMLElement, i: number): string {
  return Array.from(root.querySelectorAll<HTMLElement>(`.s[data-i="${i}"]`))
    .map((s) => s.textContent ?? '')
    .join('');
}

/** Which sentence, and which character inside it, a screen point lands on (the start of the tapped word). */
export function sentenceAtPoint(root: HTMLElement, x: number, y: number): { i: number; offset: number } | null {
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null; caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  let node: Node | null = null;
  let off = 0;
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    node = r?.startContainer ?? null;
    off = r?.startOffset ?? 0;
  } else if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    node = p?.offsetNode ?? null;
    off = p?.offset ?? 0;
  }
  const el = (node?.nodeType === 3 ? node.parentElement : (node as HTMLElement | null))?.closest<HTMLElement>('.s');
  if (!el || !node || !root.contains(el)) return null;
  const i = Number(el.dataset.i);
  let before = 0;
  for (const s of Array.from(root.querySelectorAll<HTMLElement>(`.s[data-i="${i}"]`))) {
    if (s === el) break;
    before += (s.textContent ?? '').length;
  }
  // position inside this span's text
  let inside = 0;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    if (t === node) {
      inside += off;
      break;
    }
    inside += (t as Text).data.length;
  }
  let offset = before + inside;
  const raw = sentenceRaw(root, i);
  while (offset > 0 && /\S/.test(raw[offset - 1] ?? ' ')) offset--; // back to the start of the word
  return { i, offset };
}

export function markSaying(root: HTMLElement, i: number | null) {
  root.querySelectorAll('.s.say').forEach((s) => s.classList.remove('say'));
  if (i === null) return null;
  const els = root.querySelectorAll<HTMLElement>(`.s[data-i="${i}"]`);
  els.forEach((s) => s.classList.add('say'));
  return els[0] ?? null;
}

/** First sentence index visible in the scroll container. */
export function firstVisibleSentence(root: HTMLElement, scroller: HTMLElement): number {
  const top = scroller.getBoundingClientRect().top + 80;
  const spans = root.querySelectorAll<HTMLElement>('.s');
  let lo = 0;
  let hi = spans.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].getBoundingClientRect().bottom < top) lo = mid + 1;
    else hi = mid;
  }
  return spans[lo] ? Number(spans[lo].dataset.i) : 0;
}

// ------------------------------------------------------------------ text search & highlight anchoring

function textIndex(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => (t.parentElement?.closest('.katex-mathml, .eqno') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: { node: Text; start: number }[] = [];
  let text = '';
  for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
    nodes.push({ node: t, start: text.length });
    text += t.data;
  }
  return { nodes, text };
}

function rangeFor(idx: ReturnType<typeof textIndex>, start: number, end: number): Range | null {
  const find = (off: number, isEnd: boolean) => {
    let lo = 0;
    let hi = idx.nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (idx.nodes[mid].start <= off - (isEnd ? 1 : 0)) lo = mid;
      else hi = mid - 1;
    }
    const n = idx.nodes[lo];
    return n ? { node: n.node, off: Math.min(n.node.data.length, off - n.start) } : null;
  };
  const a = find(start, false);
  const b = find(end, true);
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.off);
  r.setEnd(b.node, b.off);
  return r;
}

/** Wrap a range's text nodes with <mark> elements (works across element boundaries). */
function wrapRange(range: Range, cls: string, data?: Record<string, string>): HTMLElement[] {
  const marks: HTMLElement[] = [];
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentNode! : range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) if (range.intersectsNode(t)) texts.push(t);
  if (root.nodeType === Node.TEXT_NODE) texts.push(root as Text);
  for (const t of texts) {
    let node = t;
    let s = 0;
    let e = t.data.length;
    if (t === range.startContainer) s = range.startOffset;
    if (t === range.endContainer) e = range.endOffset;
    if (s >= e) continue;
    if (e < node.data.length) node.splitText(e);
    if (s > 0) node = node.splitText(s);
    const m = document.createElement('mark');
    m.className = cls;
    if (data) Object.entries(data).forEach(([k, v]) => (m.dataset[k] = v));
    node.replaceWith(m);
    m.appendChild(node);
    marks.push(m);
  }
  return marks;
}

export function clearMarks(root: HTMLElement, cls: string) {
  root.querySelectorAll(`mark.${cls}`).forEach((m) => {
    const p = m.parentNode!;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
    p.normalize?.();
  });
}

export function findAll(root: HTMLElement, query: string, limit = 500): HTMLElement[][] {
  clearMarks(root, 'find');
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const idx = textIndex(root);
  const hay = idx.text.toLowerCase();
  const hits: [number, number][] = [];
  let at = hay.indexOf(q);
  while (at >= 0 && hits.length < limit) {
    hits.push([at, at + q.length]);
    at = hay.indexOf(q, at + q.length);
  }
  // wrap from the end so earlier offsets stay valid
  const groups: HTMLElement[][] = [];
  for (let i = hits.length - 1; i >= 0; i--) {
    const r = rangeFor(idx, hits[i][0], hits[i][1]);
    if (r) groups.unshift(wrapRange(r, 'find'));
  }
  return groups;
}

/** Selection → serialisable anchor (text + prefix). */
export function anchorFromSelection(root: HTMLElement, sel: Selection) {
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.commonAncestorContainer)) return null;
  const text = sel.toString();
  if (!text.trim()) return null;
  const pre = document.createRange();
  pre.setStart(root, 0);
  pre.setEnd(r.startContainer, r.startOffset);
  const before = pre.toString();
  return { text, prefix: before.slice(-40) };
}

export function applyHighlights(root: HTMLElement, list: { id: string; text: string; prefix: string }[]) {
  clearMarks(root, 'hl');
  if (!list.length) return;
  const idx = textIndex(root);
  const found: { id: string; s: number; e: number }[] = [];
  for (const h of list) {
    let at = idx.text.indexOf(h.prefix + h.text);
    let s = at >= 0 ? at + h.prefix.length : -1;
    if (s < 0) {
      at = idx.text.indexOf(h.text);
      s = at;
    }
    if (s >= 0) found.push({ id: h.id, s, e: s + h.text.length });
  }
  found.sort((a, b) => b.s - a.s);
  for (const f of found) {
    const r = rangeFor(idx, f.s, f.e);
    if (r) wrapRange(r, 'hl', { id: f.id });
  }
}

export function wordAt(x: number, y: number): { word: string; rect: DOMRect; range: Range } | null {
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const r = doc.caretRangeFromPoint?.(x, y);
  if (!r || r.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const t = r.startContainer as Text;
  const s = t.data;
  let a = r.startOffset;
  let b = r.startOffset;
  const isW = (c: string) => /[\p{L}\p{N}'’-]/u.test(c);
  while (a > 0 && isW(s[a - 1])) a--;
  while (b < s.length && isW(s[b])) b++;
  const word = s.slice(a, b).replace(/^['’-]+|['’-]+$/g, '');
  if (!word) return null;
  const range = document.createRange();
  range.setStart(t, a);
  range.setEnd(t, b);
  return { word, rect: range.getBoundingClientRect(), range };
}
