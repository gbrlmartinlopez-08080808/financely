// Liquid mode for PDFs: turns fixed pages into a single reflowable column without destroying math.
//
// Strategy per page:
//  1. Render the page to a canvas and read its text items with real font names.
//  2. Build an "ink grid" of everything drawn that is NOT text: images, plots, rules, fraction bars, radicals.
//  3. Group text into rows → segments, detect a column gutter and produce reading order.
//  4. Classify rows: prose, heading, list item, display math. Display math (and any complex, stacked line) is
//     cropped from the rendered page and later shown as a CSS mask sized in `em`, so it scales with the reader's
//     font size and is drawn in the current text colour (works in dark mode). Nothing is re-typeset, so the
//     structure of equations is preserved exactly.
//  5. Figures and ruled tables become image blocks; their internal labels are removed from the text flow.
//  6. Lines are joined into paragraphs (de-hyphenated), with sub/superscripts and italics kept inline.

import { openPdf, openPdfBlob, renderPage, pdfjs, type PDFDocumentProxy, type PDFPageProxy } from './pdf';
import { slice } from '../ocr';
import { escapeHtml } from '../sanitize';

export type LBlock =
  | { t: 'h'; level: number; html: string; page: number }
  | { t: 'p'; html: string; page: number; cont?: boolean }
  | { t: 'li'; html: string; page: number }
  | { t: 'img'; blob: Blob; w: number; h: number; em: number; mask: boolean; kind: 'math' | 'figure' | 'table' | 'line' | 'scan'; page: number; alt?: string; num?: string; ref?: boolean; unread?: boolean }
  | { t: 'page'; page: number }
  | { t: 'inl'; id: string; blob: Blob; em: number; hem: number; dem: number };

interface Item {
  str: string;
  x0: number;
  x1: number;
  base: number; // baseline y (canvas px, down)
  top: number;
  bot: number;
  fh: number; // font height px
  font: string;
  math: boolean;
  bold: boolean;
  italic: boolean;
  big: boolean; // big operator font (cmex)
  frag?: boolean; // stacked piece of inline math (numerator, limit, radical sign)
  body?: boolean; // set in the document's main text font
}

interface Row {
  items: Item[];
  x0: number;
  x1: number;
  top: number;
  bot: number;
  base: number;
  fh: number;
}

type Elem =
  | { k: 'line'; row: Row; col: number }
  | { k: 'img'; x0: number; x1: number; top: number; bot: number; kind: 'figure' | 'table'; col: number };

const MATH_FONT = /(CMMI|CMSY|CMEX|MSAM|MSBM|EUFM|EUSM|EURM|EUEX|RSFS|STIXMath|STIXGeneral|STIXSize|LMMath|LatinModernMath|XITSMath|Cambria\s*Math|CambriaMath|Asana|esint|wasy|stmary|txsy|txmi|pxsy|pxmi|MTSY|MTMI|MathematicalPi|Symbol|TeXGyre\w*Math|NewCMMath|Euclid|rtxmi|zxmi|ntxmi|ntxsy|cmmib|cmbsy)/i;
const BIG_FONT = /(CMEX|EUEX|STIXSize|esint|txex|pxex)/i;
const BOLD_FONT = /(Bold|CMBX|CMB\d|Black|Heavy|Semibold|SemiBold|Demi|Medi\b|,B\b|-B$|\.B$)/i;
const ITALIC_FONT = /(Italic|Oblique|CMTI|CMSL|-It\b|-Ital|,I\b)/i;
const MATH_CHARS = /[∑∏∫∮√∞≤≥≠≈≡∈∉⊂⊃⊆⊇∪∩∀∃∂∇±∓×÷→←↔⇒⇐⇔↦∝∼≃≅⊕⊗⊥∥∠⟨⟩‖αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΥΦΨΩϵϑϕϱ∘·⋅∗†‡ℓℝℕℤℚℂ𝔼]/u;

export interface LiquidProgress {
  page: number;
  pages: number;
}

export interface LiquidOpts {
  /** pages already done in an earlier run (skipped) */
  have?: Set<number>;
  /** called with each finished page; when given, pages are not collected in memory (long books) */
  onPage?: (page: number, blocks: LBlock[], scanned: boolean) => Promise<void> | void;
}

export async function pdfToLiquid(
  data: ArrayBuffer | Blob,
  onBlocks: (blocks: LBlock[], p: LiquidProgress) => void,
  signal?: AbortSignal,
  opts: LiquidOpts = {},
): Promise<{ blocks: LBlock[]; scannedPages: number[] }> {
  const pdf = data instanceof Blob ? await openPdfBlob(data) : await openPdf(data);
  const all: LBlock[] = [];
  const scanned: number[] = [];
  const ctx: DocCtx = { fontHist: new Map(), sizeHist: new Map(), seenMargins: new Map(), bodyFh: 0 };
  try {
    // Prime body size from a couple of pages so page 1 (title page) does not skew it.
    await primeBodySize(pdf, ctx);
    for (let i = 1; i <= pdf.numPages; i++) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (opts.have?.has(i)) {
        onBlocks([], { page: i, pages: pdf.numPages });
        continue;
      }
      // one strange page (a broken font, a drawing that never ends) must not stop the book: after a while, or on an
      // error, the page is handed to the reader that works from its picture instead
      let res: { blocks: LBlock[]; scanned: boolean };
      try {
        const page = await pdf.getPage(i);
        res = await Promise.race([
          processPage(page, i, ctx).finally(() => page.cleanup()),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('page took too long')), 45_000)),
        ]);
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        console.warn('page handed to the reader', i, e);
        res = { blocks: [await placeholder(i)], scanned: true };
      }
      if (res.scanned) scanned.push(i);
      const blocks: LBlock[] = [{ t: 'page', page: i }, ...res.blocks];
      if (opts.onPage) await opts.onPage(i, blocks, res.scanned);
      else all.push(...blocks);
      onBlocks(blocks, { page: i, pages: pdf.numPages });
      await slice(0); // a turn for the screen between pages (without timers: those crawl in the background)
    }
  } finally {
    pdf.loadingTask.destroy();
  }
  return { blocks: all, scannedPages: scanned };
}

/** Stands in for a page the converter gave up on, until its reading takes its place. */
async function placeholder(page: number): Promise<LBlock> {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const cx = c.getContext('2d')!;
  cx.fillStyle = '#fff';
  cx.fillRect(0, 0, 2, 2);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  return { t: 'img', blob, w: 2, h: 2, em: 0, mask: false, kind: 'scan', page, alt: `Page ${page}` };
}

interface DocCtx {
  fontHist: Map<string, number>; // font name -> chars (to find the prose font)
  sizeHist: Map<number, number>; // font size (pt, rounded to .5) -> chars
  seenMargins: Map<string, number>;
  bodyFh: number; // pt
}

async function primeBodySize(pdf: PDFDocumentProxy, ctx: DocCtx) {
  const n = Math.min(pdf.numPages, 4);
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const fh = Math.hypot(it.transform[2], it.transform[3]);
      const k = Math.round(fh * 2) / 2;
      ctx.sizeHist.set(k, (ctx.sizeHist.get(k) ?? 0) + it.str.length);
    }
  }
  ctx.bodyFh = modeOf(ctx.sizeHist) || 10;
}

const modeOf = (m: Map<number, number>) => {
  let best = 0;
  let bk = 0;
  m.forEach((v, k) => {
    if (v > best) {
      best = v;
      bk = k;
    }
  });
  return bk;
};

async function processPage(page: PDFPageProxy, pageNo: number, ctx: DocCtx): Promise<{ blocks: LBlock[]; scanned: boolean }> {
  const vp1 = page.getViewport({ scale: 1 });
  const S = Math.min(3, Math.max(1.6, 1500 / vp1.width));
  const { canvas, viewport } = await renderPage(page, S);
  const W = canvas.width;
  const H = canvas.height;
  await slice();
  const tc = await page.getTextContent();
  const body = ctx.bodyFh * S; // body font height in canvas px

  // ---------- 1. text items ----------
  const items: Item[] = [];
  const rotated: { x0: number; x1: number; top: number; bot: number }[] = [];
  for (const raw of tc.items) {
    if (!('str' in raw)) continue;
    if (!raw.str || !raw.str.trim()) continue;
    const tx = pdfjs.Util.transform(viewport.transform, raw.transform) as number[];
    const fh = Math.hypot(tx[2], tx[3]);
    if (fh < 1) continue;
    let fontName = raw.fontName;
    try {
      if (page.commonObjs.has(raw.fontName)) fontName = (page.commonObjs.get(raw.fontName) as { name?: string }).name || fontName;
    } catch {
      /* font not loaded */
    }
    const style = tc.styles[raw.fontName];
    const family = `${fontName} ${style?.fontFamily ?? ''}`;
    const w = raw.width * S;
    const isRot = Math.abs(tx[1]) > Math.abs(tx[0]) * 0.2 || Math.abs(tx[2]) > Math.abs(tx[3]) * 0.2;
    const ascent = style?.ascent && style.ascent > 0.4 && style.ascent < 1.2 ? style.ascent : 0.8;
    if (isRot) {
      rotated.push({ x0: tx[4] - fh, x1: tx[4] + fh, top: tx[5] - w, bot: tx[5] + w });
      continue;
    }
    const math = MATH_FONT.test(family) || (MATH_CHARS.test(raw.str) && raw.str.trim().length <= 3);
    const big = BIG_FONT.test(family);
    // TeX radicals and big operators hang below their baseline.
    const hangs = big || (math && /^[√∑∏∫]$/.test(raw.str.trim()));
    items.push({
      str: raw.str,
      x0: tx[4],
      x1: tx[4] + w,
      base: tx[5],
      top: hangs ? tx[5] - fh * 0.1 : tx[5] - fh * ascent,
      bot: hangs ? tx[5] + fh * (big ? 1.2 : 0.95) : tx[5] + fh * 0.22,
      fh,
      font: family,
      math,
      bold: BOLD_FONT.test(family),
      italic: ITALIC_FONT.test(family),
      big,
    });
  }

  // Some PDFs draw every word twice (a shadow, a fake bold, an invisible copy left by a converter): keep one of each.
  dedupeItems(items);

  const totalChars = items.reduce((a, i) => a + i.str.length, 0);
  for (const it of items) {
    const name = it.font.split(' ')[0];
    if (!it.math) ctx.fontHist.set(name, (ctx.fontHist.get(name) ?? 0) + it.str.length);
  }
  let bodyFont = '';
  let bodyCount = 0;
  ctx.fontHist.forEach((v, k) => {
    if (v > bodyCount) {
      bodyCount = v;
      bodyFont = k;
    }
  });
  for (const it of items) it.body = it.font.split(' ')[0] === bodyFont;

  // ---------- 2. ink grid (non-text marks) ----------
  const C = Math.max(3, Math.round(S * 2)); // cell size px
  const gw = Math.ceil(W / C);
  const gh = Math.ceil(H / C);
  const ink = new Uint8Array(gw * gh); // 1 = ink, 2 = text
  const cx = canvas.getContext('2d')!;
  const img = cx.getImageData(0, 0, W, H).data;
  let inkCells = 0;
  for (let gy = 0; gy < gh; gy++) {
    const y0 = gy * C;
    const y1 = Math.min(H, y0 + C);
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * C;
      const x1 = Math.min(W, x0 + C);
      let hit = false;
      for (let y = y0; y < y1 && !hit; y += 1) {
        let p = (y * W + x0) * 4;
        for (let x = x0; x < x1; x++, p += 4) {
          if (img[p] < 215 || img[p + 1] < 215 || img[p + 2] < 215) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        ink[gy * gw + gx] = 1;
        inkCells++;
      }
    }
  }

  await slice(); // the page was a long stretch of work: a turn for the screen
  // Scanned page: lots of ink but (almost) no text.
  if (totalChars < 25 && inkCells > gw * gh * 0.02) {
    const blob = await cropBlob(canvas, 0, 0, W, H, false);
    return {
      blocks: [{ t: 'img', blob, w: W, h: H, em: 0, mask: false, kind: 'scan', page: pageNo, alt: `Scanned page ${pageNo}` }],
      scanned: true,
    };
  }

  const markText = (x0: number, top: number, x1: number, bot: number, v: number) => {
    const a = Math.max(0, Math.floor(x0 / C) - 1);
    const b = Math.min(gw - 1, Math.floor(x1 / C) + 1);
    const c = Math.max(0, Math.floor(top / C) - 1);
    const d = Math.min(gh - 1, Math.floor(bot / C) + 1);
    for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) if (ink[y * gw + x] === 1 || v === 3) ink[y * gw + x] = v;
  };
  for (const it of items) markText(it.x0, it.top, it.x1, it.bot, 2);
  for (const r of rotated) markText(r.x0, r.top, r.x1, r.bot, 2);

  // Connected components of leftover ink, merging cells within a small gap.
  const comps = components(ink, gw, gh, Math.max(2, Math.round((body * 0.6) / C))).map((c) => ({
    x0: c.x0 * C,
    x1: (c.x1 + 1) * C,
    top: c.y0 * C,
    bot: (c.y1 + 1) * C,
    cells: c.n,
  }));

  await slice();
  // Classify components.
  const figures: Box[] = [];
  const rules: Box[] = [];
  const smalls: Box[] = [];
  for (const c of comps) {
    const w = c.x1 - c.x0;
    const h = c.bot - c.top;
    if (h <= C * 2.2 && w > body * 3) rules.push(c);
    else if (w > body * 3.5 && h > body * 2.2 && c.cells > 30) figures.push(c);
    else smalls.push(c);
  }
  // Tables: stacks of horizontal rules that overlap horizontally.
  const tables: Box[] = [];
  const usedRule = new Set<Box>();
  const sortedRules = [...rules].sort((a, b) => a.top - b.top);
  for (let i = 0; i < sortedRules.length; i++) {
    const r = sortedRules[i];
    if (usedRule.has(r)) continue;
    const group = [r];
    let last = r;
    for (let j = i + 1; j < sortedRules.length; j++) {
      const s = sortedRules[j];
      if (usedRule.has(s)) continue;
      const overlap = Math.min(last.x1, s.x1) - Math.max(last.x0, s.x0);
      if (overlap > 0.6 * Math.min(last.x1 - last.x0, s.x1 - s.x0) && s.top - last.bot < body * 12) {
        // Only group if text sits between (otherwise it is e.g. two separate underlines)
        group.push(s);
        last = s;
      }
    }
    if (group.length >= 2) {
      const box = unionBoxes(group);
      // must contain several text rows and not be a full page
      const inside = items.filter((it) => centerIn(it, box)).length;
      if (inside >= 4 && box.bot - box.top < H * 0.8) {
        group.forEach((g) => usedRule.add(g));
        tables.push(box);
      }
    }
  }

  // Writing that is a picture (a scanned body under typed headings, text turned into outlines): the page is read as a
  // whole, so every line comes out as text, in the order it is printed, with nothing left behind as a picture.
  const pageArea = W * H;
  // (lines of such writing may come apart into separate marks, so wide marks are put back together first)
  const lead = Math.max(body, H / 80) * 1.2;
  const patches = mergeOverlapping(
    comps.filter((c) => c.x1 - c.x0 > W * 0.18 && c.bot - c.top > C * 2.2).map((c) => ({ x0: c.x0, x1: c.x1, top: c.top - lead, bot: c.bot + lead })),
  ).map((c) => ({ ...c, top: Math.max(0, c.top + lead), bot: Math.min(H, c.bot - lead) }));
  const writing = patches.filter((f) => looksLikeWriting(img, W, f)).reduce((a, f) => a + (f.x1 - f.x0) * (f.bot - f.top), 0);
  // (a typed page with one screenshot in it keeps its typed text: the screenshot is looked at later on its own)
  const typed = items.reduce((a, i) => a + (i.x1 - i.x0) * (i.bot - i.top), 0);
  if (writing > pageArea * 0.08 && writing > typed * 0.6) {
    console.debug(`[lq] page ${pageNo}: writing printed as a picture (${Math.round((writing / pageArea) * 100)}% of the page): read as a whole`);
    const blob = await cropBlob(canvas, 0, 0, W, H, false);
    return {
      blocks: [{ t: 'img', blob, w: W, h: H, em: 0, mask: false, kind: 'scan', page: pageNo, alt: `Page ${pageNo}` }],
      scanned: true,
    };
  }

  // Figures absorb text whose centre lies inside them (axis labels, legends); tables absorb their cells.
  // Rule pieces of one table can form several groups; fuse any that overlap or touch.
  const fused = mergeOverlapping(tables.map((t) => ({ ...t, top: t.top - body * 0.5, bot: t.bot + body * 0.5 }))).map((t) => ({ ...t, top: t.top + body * 0.5, bot: t.bot - body * 0.5 }));
  tables.length = 0;
  tables.push(...fused);
  const figs = mergeOverlapping(figures).filter((f) => {
    const t = tables.find((tb) => intersects(tb, f));
    if (!t) return true;
    Object.assign(t, unionBoxes([t, f]));
    return false;
  });
  const imgBoxes: (Box & { kind: 'figure' | 'table' })[] = [
    ...figs.map((b) => ({ ...b, kind: 'figure' as const })),
    ...tables.map((b) => ({ ...b, kind: 'table' as const })),
  ];
  // Grow figure boxes by the text inside/touching them, then drop that text from the flow.
  const absorbed = new Set<Item>();
  for (const b of imgBoxes) {
    for (const it of items) {
      if (absorbed.has(it)) continue;
      // small labels (legends, axis ticks) may sit a little outside the drawing
      const pad = it.fh < body * 0.85 ? body * 1.4 : body * 0.4;
      const inside = centerIn(it, { x0: b.x0 - pad, x1: b.x1 + pad, top: b.top - pad, bot: b.bot + pad });
      if (inside) {
        absorbed.add(it);
        b.x0 = Math.min(b.x0, it.x0);
        b.x1 = Math.max(b.x1, it.x1);
        b.top = Math.min(b.top, it.top);
        b.bot = Math.max(b.bot, it.bot);
      }
    }
  }
  // Rotated text (e.g. y-axis labels) inside figures is fine; arXiv side stamps are dropped entirely.

  // ---------- 3. rows & segments ----------
  const flowItems = items.filter((i) => !absorbed.has(i));
  const gutter = findGutter(flowItems, W, body);
  const rows = mergeFragments(buildRows(flowItems, body), body);
  const segs: Row[] = [];
  for (const r of rows) segs.push(...splitRow(r, gutter));

  // Margin furniture: page numbers and running headers/footers.
  const keep = segs.filter((s) => {
    const inMargin = s.top < H * 0.075 || s.bot > H * 0.93;
    if (!inMargin) return true;
    const text = rowText(s).trim();
    if (/^(\d+|[ivxlcdm]+|page \d+( of \d+)?|\d+\s*\/\s*\d+|– ?\d+ ?–|- ?\d+ ?-)$/i.test(text)) return false;
    const key = text.replace(/\d+/g, '#').toLowerCase().slice(0, 80);
    const seen = ctx.seenMargins.get(key) ?? 0;
    ctx.seenMargins.set(key, seen + 1);
    // a running header comes back page after page, in small type; a heading or the first line of a page is kept
    if (seen > 0) return false;
    return text.length > 0 && (pageNo <= 2 || s.fh >= body * 0.97);
  });

  // ---------- 4. columns & reading order ----------
  const colOf = (x0: number, x1: number) => {
    if (gutter === null) return 0;
    if (x1 <= gutter + body * 0.3) return 1;
    if (x0 >= gutter - body * 0.3) return 2;
    return 0; // spans
  };
  const elems: Elem[] = [
    ...keep.map((row) => ({ k: 'line' as const, row, col: colOf(row.x0, row.x1) })),
    ...imgBoxes.map((b) => ({ k: 'img' as const, ...b, col: colOf(b.x0, b.x1) })),
  ];
  const topOf = (e: Elem) => (e.k === 'line' ? e.row.top : e.top);
  elems.sort((a, b) => topOf(a) - topOf(b));
  const ordered: Elem[] = [];
  if (gutter === null) ordered.push(...elems);
  else {
    let band: Elem[] = [];
    const flush = () => {
      ordered.push(...band.filter((e) => e.col === 1), ...band.filter((e) => e.col === 2));
      band = [];
    };
    for (const e of elems) {
      if (e.col === 0) {
        flush();
        ordered.push(e);
      } else band.push(e);
    }
    flush();
  }

  // ---------- 5. blocks ----------
  const blocks: LBlock[] = [];
  // Column bounds for indentation / short-line checks
  const colBounds = new Map<number, { l: number; r: number }>();
  for (const e of ordered) {
    if (e.k !== 'line') continue;
    const b = colBounds.get(e.col) ?? { l: Infinity, r: -Infinity };
    b.l = Math.min(b.l, e.row.x0);
    b.r = Math.max(b.r, e.row.x1);
    colBounds.set(e.col, b);
  }
  // Column bounds via percentiles is more robust; approximate with min/max but ignore outliers
  for (const [col, b] of colBounds) {
    const lines = ordered.filter((e): e is Extract<Elem, { k: 'line' }> => e.k === 'line' && e.col === col);
    const ls = lines.map((l) => l.row.x0).sort((a, b) => a - b);
    const rs = lines.map((l) => l.row.x1).sort((a, b) => a - b);
    if (ls.length > 4) {
      b.l = ls[Math.floor(ls.length * 0.1)];
      b.r = rs[Math.floor(rs.length * 0.9)];
    }
  }

  // Identify display math / complex rows first.
  const lineElems = ordered.filter((e): e is Extract<Elem, { k: 'line' }> => e.k === 'line');
  const isMathRow = new Set<Row>();
  for (const e of lineElems) {
    const r = e.row;
    const chars = r.items.reduce((a, i) => a + i.str.replace(/\s/g, '').length, 0);
    const mchars = r.items.reduce((a, i) => a + (i.math || MATH_CHARS.test(i.str) ? i.str.replace(/\s/g, '').length : 0), 0);
    // prose letters: body font, or any non-math text font other than TeX's roman (used for "sin", "softmax" in equations)
    const bodyLetters = r.items.some((i) => !i.math && /[A-Za-z]{2,}/.test(i.str) && (i.body || !/(^|\+)(CMR\d|CMSS\d|LMRoman|CMU|LMMathRoman)/i.test(i.font)));
    const anyMath = r.items.some((i) => i.math);
    const ratio = !bodyLetters && anyMath ? 1 : mchars / Math.max(1, chars);
    const cb = colBounds.get(e.col)!;
    const colW = cb.r - cb.l;
    const words = rowText(r).split(/\s+/).filter((w) => /^[A-Za-z]{3,}[.,;:]?$/.test(w)).length;
    const hasBig = r.items.some((i) => i.big);
    const eqNo = /\(\s*\d+(\.\d+)*[a-z]?\s*\)\s*$/.test(rowText(r)) && r.x1 > cb.r - body * 2;
    const stacked = r.items.some((i) => i.frag || (Math.abs(i.base - r.base) > r.fh * 0.45 && i.fh > r.fh * 0.75));
    const indentedBoth = r.x0 > cb.l + body * 1.5 && r.x1 < cb.r - body * 1.5;
    let display = false;
    if (hasBig && words < 6) display = true;
    else if (ratio >= 0.45 && words <= 4) display = true;
    else if (ratio >= 0.3 && (indentedBoth || eqNo) && words <= 6) display = true;
    else if (eqNo && words <= 3 && ratio > 0.1) display = true;
    else if (stacked && ratio > 0.25 && words < 8) display = true;
    // tiny math fragments (numerators, limits) that sit between lines
    else if (chars <= 6 && ratio >= 0.5 && r.fh < body * 0.95) display = true;
    if (display && r.x1 - r.x0 > colW * 0.98 && words > 8) display = false;
    // A short last line of a paragraph that happens to be mostly symbols is not a display.
    if (display && !hasBig && !eqNo && r.x0 <= cb.l + body * 0.4 && !r.items.some((i) => i.frag)) display = false;
    if (display) isMathRow.add(r);
  }

  const dbg = (globalThis as { __lq?: unknown[] }).__lq;
  if (dbg) {
    for (const e of ordered) {
      if (e.k === 'line') dbg.push({ page: pageNo, col: e.col, math: isMathRow.has(e.row), frag: e.row.items.filter((i) => i.frag).map((i) => i.str).join('|'), top: Math.round(e.row.top), x0: Math.round(e.row.x0), x1: Math.round(e.row.x1), fh: +(e.row.fh / body).toFixed(2), t: rowText(e.row).slice(0, 70), f: [...new Set(e.row.items.map((i) => i.font.split(' ')[0].replace(/^[A-Z]{6}\+/, '')))].join(',').slice(0, 60) });
      else dbg.push({ page: pageNo, img: e.kind, top: Math.round(e.top), bot: Math.round(e.bot), x0: Math.round(e.x0), x1: Math.round(e.x1) });
    }
  }
  const mathItems = new Set([...isMathRow].flatMap((r) => r.items));
  const proseItems = flowItems.filter((it) => !mathItems.has(it));

  // Inline stacked math (e.g. 1/√d inside a sentence) becomes a small baseline-aligned crop.
  const inlTokens = new Map<Item, string>();
  const inlSkip = new Set<Item>();
  let inlN = 0;
  for (const e of lineElems) {
    const r = e.row;
    if (isMathRow.has(r) || !r.items.some((i) => i.frag)) continue;
    const clusters: { items: Item[]; box: Box }[] = [];
    for (const seed of r.items.filter((i) => i.frag)) {
      let c = clusters.find((cl) => seed.x0 < cl.box.x1 + r.fh * 0.15 && seed.x1 > cl.box.x0 - r.fh * 0.15);
      if (!c) {
        c = { items: [], box: { x0: seed.x0, x1: seed.x1, top: seed.top, bot: seed.bot } };
        clusters.push(c);
      }
      c.items.push(seed);
      c.box = unionBoxes([c.box, seed]);
    }
    for (const c of clusters) {
      // pull in line items overlapping the cluster horizontally, then touching math glyphs
      let grew = true;
      while (grew) {
        grew = false;
        for (const it of r.items) {
          if (c.items.includes(it)) continue;
          const overlap = it.x0 < c.box.x1 - 0.5 && it.x1 > c.box.x0 + 0.5;
          const touching = it.math && (Math.abs(it.x0 - c.box.x1) < r.fh * 0.12 || Math.abs(c.box.x0 - it.x1) < r.fh * 0.12) && it.str.trim().length <= 3;
          if (overlap || touching) {
            c.items.push(it);
            c.box = unionBoxes([c.box, it]);
            grew = true;
          }
        }
      }
      const box = takeSmallsNear(c.box, smalls, r.fh);
      const pad = 1.5;
      box.x0 -= pad;
      box.x1 += pad;
      box.top -= pad;
      box.bot += pad;
      const blk = await imgBlock(canvas, box, 'math', pageNo, body, undefined, proseItems.filter((it) => !c.items.includes(it)));
      if (blk.t !== 'img') continue;
      const id = `${pageNo}_${inlN++}`;
      blocks.push({ t: 'inl', id, blob: blk.blob, em: blk.em, hem: blk.h / body, dem: (box.bot - r.base) / body });
      const first = [...c.items].sort((a, b) => a.x0 - b.x0)[0];
      inlTokens.set(first, `\u0001${id}\u0001`);
      for (const it of c.items) if (it !== first) inlSkip.add(it);
    }
  }

  // Typical gap between consecutive lines (to spot paragraph spacing).
  const gaps: number[] = [];
  for (let k = 1; k < lineElems.length; k++) {
    const a = lineElems[k - 1].row;
    const b = lineElems[k].row;
    const g = b.top - a.bot;
    if (lineElems[k].col === lineElems[k - 1].col && g > -body && g < body * 2) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const lineGap = Math.max(0, gaps.length ? gaps[Math.floor(gaps.length / 2)] : body * 0.2);

  // Walk ordered elements and assemble blocks.
  let para: { html: string; lastRow: Row; col: number; li: boolean } | null = null;
  let lastBottom = -Infinity;
  let lastCol = -1;
  const deferred: LBlock[] = [];
  const flushPara = () => {
    if (para) {
      const html = para.html.trim();
      if (html) blocks.push(para.li ? { t: 'li', html, page: pageNo } : { t: 'p', html, page: pageNo });
      para = null;
    }
    if (deferred.length) blocks.push(...deferred.splice(0));
  };
  // Footnotes: small-font rows in the lower part of the page; emitted after the page's text.
  const footRows = new Set<Row>();
  for (const e of lineElems) {
    const r = e.row;
    if (r.fh < body * 0.92 && r.top > H * 0.62 && !isMathRow.has(r) && rowText(r).trim().length > 3) footRows.add(r);
  }
  // Only keep runs that start with a footnote marker.
  for (const r of [...footRows]) {
    const first = r.items[0];
    const starts = /^([\d*†‡§¶]|[a-z]\s)/.test(rowText(r).trim()) || (first && first.fh < r.fh * 0.86);
    const prevRow = lineElems.find((e) => e.row !== r && footRows.has(e.row) && r.top - e.row.bot < r.fh && r.top > e.row.top && Math.abs(e.row.x0 - r.x0) < body * 2);
    if (!starts && !prevRow) footRows.delete(r);
  }
  const footnotes: string[] = [];

  const pendingSmalls = [...smalls];
  const takeSmalls = (box: Box) => {
    // absorb fraction bars, radicals, etc. that intersect a math box
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = pendingSmalls.length - 1; i >= 0; i--) {
        const s = pendingSmalls[i];
        if (intersects(s, { x0: box.x0 - body * 0.3, x1: box.x1 + body * 0.3, top: box.top - body * 0.25, bot: box.bot + body * 0.25 })) {
          box.x0 = Math.min(box.x0, s.x0);
          box.x1 = Math.max(box.x1, s.x1);
          box.top = Math.min(box.top, s.top);
          box.bot = Math.max(box.bot, s.bot);
          pendingSmalls.splice(i, 1);
          grew = true;
        }
      }
    }
    return box;
  };

  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    if (e.k === 'line' && footRows.has(e.row)) {
      const t = rowHtml(e.row, body, inlTokens, inlSkip);
      const starts = /^(<sup>)?[\d*†‡§¶]/.test(t);
      if (starts || !footnotes.length) footnotes.push(t);
      else footnotes[footnotes.length - 1] += (/[A-Za-z]-$/.test(footnotes[footnotes.length - 1]) ? '' : ' ') + t;
      continue;
    }
    if (e.k === 'img') {
      const box = { x0: e.x0, x1: e.x1, top: e.top, bot: e.bot };
      const blk = await imgBlock(canvas, box, e.kind, pageNo, body, undefined, proseItems);
      // A figure dropped in mid-sentence waits until the paragraph ends.
      const p = para as { html: string } | null;
      if (p && !/[.!?:"”)]\s*$/.test(p.html.replace(/<[^>]+>/g, ''))) {
        deferred.push(blk);
        continue;
      }
      flushPara();
      blocks.push(blk);
      lastBottom = e.bot;
      lastCol = e.col;
      continue;
    }
    const r = e.row;
    if (isMathRow.has(r)) {
      flushPara();
      // gather consecutive math rows of the same column that are vertically close
      const group: Row[] = [r];
      let j = i + 1;
      while (j < ordered.length) {
        const n = ordered[j];
        if (n.k !== 'line' || n.col !== e.col || !isMathRow.has(n.row)) break;
        const prev = group[group.length - 1];
        if (n.row.top - prev.bot > body * 1.4) break;
        group.push(n.row);
        j++;
      }
      i = j - 1;
      const EQNO = /^\(\s*\d+(\.\d+)*[a-z]?\s*\)$/;
      const numItems = group.flatMap((g) => g.items).filter((it) => EQNO.test(it.str.trim()) && it.x0 > (group[0].x0 + group[0].x1) / 2);
      const eqItems = group.flatMap((g) => g.items).filter((it) => !numItems.includes(it));
      const box = takeSmalls(unionBoxes(eqItems.length ? eqItems : group));
      // pad
      const pad = body * 0.25;
      box.x0 = Math.max(0, box.x0 - pad);
      box.x1 = Math.min(W, box.x1 + pad);
      box.top = Math.max(0, box.top - pad);
      box.bot = Math.min(H, box.bot + pad);
      const blk = await imgBlock(canvas, box, 'math', pageNo, body, group.map(rowText).join(' '), [...proseItems, ...numItems]);
      if (blk.t === 'img' && numItems.length) blk.num = numItems.map((n) => n.str.trim()).join(' ');
      blocks.push(blk);
      lastBottom = box.bot;
      lastCol = e.col;
      continue;
    }

    const text = rowHtml(r, body, inlTokens, inlSkip);
    const plain = rowText(r).trim();
    const cb = colBounds.get(e.col)!;
    const gap = r.top - lastBottom;
    const sizeRatio = r.fh / body;
    const allBold = r.items.every((it) => it.bold || !/[A-Za-z]/.test(it.str));
    const isHeading =
      plain.length < 120 &&
      !/[,;]$/.test(plain) &&
      ((sizeRatio > 1.18 && plain.length > 1) ||
        (allBold && plain.length < 80 && !/\.$/.test(plain) && (gap > body * 0.5 || lastCol !== e.col) && /^[A-Z0-9§]/.test(plain)));
    if (isHeading) {
      // merge multi-line headings with same size
      const prevBlock = blocks[blocks.length - 1];
      if (!para && prevBlock?.t === 'h' && gap < r.fh * 0.8 && Math.abs(sizeRatio - (prevBlock as { _s?: number })._s!) < 0.05) {
        prevBlock.html += ' ' + text;
      } else {
        flushPara();
        const level = sizeRatio > 1.6 ? 1 : sizeRatio > 1.3 ? 2 : 3;
        const hb = { t: 'h' as const, level, html: text, page: pageNo } as LBlock & { _s?: number };
        hb._s = sizeRatio;
        blocks.push(hb);
      }
      lastBottom = r.bot;
      lastCol = e.col;
      continue;
    }

    const bullet = /^([•●◦▪‣∙·\-–—*]\s|\(?[a-z0-9ivx]{1,3}[.)]\s)/i.test(plain) && r.x0 <= cb.l + body * 3;
    let newPara = !para;
    if (para) {
      const prev = para.lastRow;
      const prevText = rowText(prev).trim();
      const prevShort = prev.x1 < cb.r - body * 2.5;
      const indented = r.x0 > cb.l + body * 0.7 && r.x0 < cb.l + body * 4;
      const sameCol = e.col === para.col;
      if (!sameCol && e.col !== 0 && para.col !== 0) {
        // column switch: continue unless previous line was short (paragraph ended)
        newPara = prevShort && /[.!?:"”)]$/.test(prevText);
        if (indented) newPara = true;
      } else {
        if (gap > Math.max(body * 0.75, prev.fh * 0.75)) newPara = true;
        else if (indented && (prevShort || /[.!?:"”]$/.test(prevText))) newPara = true;
        else if (prevShort && /[.!?:"”)]$/.test(prevText)) newPara = true;
        else if (gap > lineGap * 2.5 + body * 0.2) newPara = true;
        else if (Math.abs(r.fh - prev.fh) > body * 0.2) newPara = true;
      }
      if (bullet) newPara = true;
    }
    if (newPara) {
      flushPara();
      para = { html: text, lastRow: r, col: e.col, li: bullet };
    } else if (para) {
      // de-hyphenate
      if (/[A-Za-z]-$/.test(para.html) && /^[a-z]/.test(plain)) para.html = para.html.slice(0, -1) + text;
      else para.html += ' ' + text;
      para.lastRow = r;
      para.col = e.col;
    }
    lastBottom = r.bot;
    lastCol = e.col;
  }
  flushPara();
  for (const f of footnotes) blocks.push({ t: 'p', html: `<small class="fn">${f}</small>`, page: pageNo });

  // Over-long "headings" are really emphasised paragraphs.
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.t === 'h' && b.html.replace(/<[^>]+>/g, '').length > 110) blocks[k] = { t: 'p', html: b.html, page: b.page };
  }

  // Mark first paragraph as a possible continuation of the previous page.
  const first = blocks.find((b) => b.t === 'p' || b.t === 'h' || b.t === 'img' || b.t === 'li');
  if (first && first.t === 'p' && /^[a-z(]/.test(first.html.replace(/<[^>]+>/g, ''))) first.cont = true;

  return { blocks, scanned: false };
}

// ---------- helpers ----------

/**
 * Drops text drawn twice in (almost) the same place. The copies are not always cut into the same pieces ("Wh" + "y T…"
 * beside "Why T…"), so it works letter by letter: a letter that sits on top of the same letter already kept is a copy.
 * A piece made only of copies goes; copied letters at either end of a piece are cut off.
 */
function dedupeItems(items: Item[]) {
  type Ch = { c: string; x: number; base: number; fh: number };
  const grid = new Map<number, Ch[]>(); // by baseline band
  const band = (y: number) => Math.round(y / 4);
  const near = (ch: Ch, cw: number) => {
    for (let b = band(ch.base) - 2; b <= band(ch.base) + 2; b++) {
      for (const o of grid.get(b) ?? []) {
        if (o.c !== ch.c) continue;
        if (Math.abs(o.base - ch.base) > ch.fh * 0.35 || Math.abs(o.fh - ch.fh) > ch.fh * 0.25) continue;
        if (Math.abs(o.x - ch.x) < Math.max(cw * 0.5, ch.fh * 0.12)) return true;
      }
    }
    return false;
  };
  const out: Item[] = [];
  for (const it of items) {
    const n = it.str.length;
    const cw = (it.x1 - it.x0) / Math.max(1, n);
    const chars: Ch[] = Array.from(it.str, (c, k) => ({ c, x: it.x0 + cw * (k + 0.5), base: it.base, fh: it.fh }));
    const dup = chars.map((ch) => (/\s/.test(ch.c) ? null : near(ch, cw)));
    const solid = dup.filter((d) => d !== null).length;
    const copies = dup.filter((d) => d === true).length;
    if (solid && copies >= solid * 0.7) continue; // a copy
    let a = 0;
    let b = n;
    if (copies) {
      while (a < b && dup[a] !== false) a++;
      while (b > a && dup[b - 1] !== false) b--;
      if (a > 0 || b < n) {
        it.str = it.str.slice(a, b);
        it.x0 += cw * a;
        it.x1 -= cw * (n - b);
      }
    }
    if (!it.str.trim()) continue;
    for (const ch of chars.slice(a, b)) {
      const k = band(ch.base);
      const list = grid.get(k);
      if (list) list.push(ch);
      else grid.set(k, [ch]);
    }
    out.push(it);
  }
  items.length = 0;
  items.push(...out);
}

/**
 * Is this patch of ink lines of writing (a picture of text) rather than a drawing or a photo? Writing has rows of
 * ink of about the same height, with thin white gaps between them at a steady rhythm, and neither solid nor sparse ink.
 */
function looksLikeWriting(px: Uint8ClampedArray, W: number, b: Box): boolean {
  const x0 = Math.max(0, Math.floor(b.x0));
  const x1 = Math.min(W, Math.ceil(b.x1));
  const y0 = Math.max(0, Math.floor(b.top));
  const y1 = Math.ceil(b.bot);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 120 || h < 60) return false;
  const step = Math.max(1, Math.floor(w / 400)); // a few hundred samples per row are plenty
  const prof: number[] = [];
  let dark = 0;
  let mid = 0;
  let samples = 0;
  for (let y = y0; y < y1; y++) {
    let n = 0;
    let p = (y * W + x0) * 4;
    for (let x = x0; x < x1; x += step, p += 4 * step) {
      const v = (px[p] * 3 + px[p + 1] * 6 + px[p + 2]) / 10;
      samples++;
      if (v < 140) n++, dark++;
      else if (v < 215) mid++;
    }
    prof.push(n / Math.ceil(w / step));
  }
  // photos are full of grey; writing is dark ink on white
  if (mid > samples * 0.25 || dark > samples * 0.4 || dark < samples * 0.02) return false;
  const runs: { a: number; b: number }[] = [];
  let s = -1;
  for (let y = 0; y <= prof.length; y++) {
    const on = y < prof.length && prof[y] > 0.004;
    if (on && s < 0) s = y;
    else if (!on && s >= 0) {
      if (y - s >= 3) runs.push({ a: s, b: y });
      s = -1;
    }
  }
  if (runs.length < 3) return false;
  const hs = runs.map((r) => r.b - r.a).sort((p, q) => p - q);
  const mh = hs[hs.length >> 1];
  if (mh < 6 || mh > h * 0.4) return false;
  // most rows are about one line high
  const lineish = hs.filter((x) => x > mh * 0.45 && x < mh * 2.2).length;
  if (lineish < runs.length * 0.7) return false;
  // the rows cover a good part of the patch, at a steady pitch
  const pitches = runs.slice(1).map((r, i) => r.a - runs[i].a).sort((p, q) => p - q);
  const mp = pitches[pitches.length >> 1];
  const steady = pitches.filter((p) => Math.abs(p - mp) < mp * 0.45).length;
  if (steady < pitches.length * 0.55 || mp > mh * 3.5) return false;
  // and each row is made of letters: many small marks side by side, not one long stroke (the grid lines of a
  // chart and the rules of a table also come at a steady pitch, but they are lines)
  const lettered = (r: { a: number; b: number }) => {
    let best = 0;
    for (const f of [0.35, 0.55, 0.75]) {
      const y = y0 + r.a + Math.floor((r.b - r.a) * f);
      let marks = 0;
      let run = 0;
      let longest = 0;
      let was = false;
      for (let x = x0, p = (y * W + x0) * 4; x < x1; x++, p += 4) {
        const ink = (px[p] * 3 + px[p + 1] * 6 + px[p + 2]) / 10 < 160;
        if (ink) {
          if (!was) marks++;
          run++;
          if (run > longest) longest = run;
        } else run = 0;
        was = ink;
      }
      const used = marks >= Math.max(5, w / 60) && longest < Math.max(mh * 2.5, w * 0.06);
      if (used) best++;
    }
    return best >= 2;
  };
  return runs.filter(lettered).length >= runs.length * 0.7;
}

interface Box {
  x0: number;
  x1: number;
  top: number;
  bot: number;
}

const centerIn = (it: Box, b: Box) => {
  const cx = (it.x0 + it.x1) / 2;
  const cy = (it.top + it.bot) / 2;
  return cx >= b.x0 && cx <= b.x1 && cy >= b.top && cy <= b.bot;
};
const intersects = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.top < b.bot && a.bot > b.top;

function unionBoxes(bs: Box[]): Box {
  return {
    x0: Math.min(...bs.map((b) => b.x0)),
    x1: Math.max(...bs.map((b) => b.x1)),
    top: Math.min(...bs.map((b) => b.top)),
    bot: Math.max(...bs.map((b) => b.bot)),
  };
}

function mergeOverlapping(bs: Box[]): Box[] {
  const out = bs.map((b) => ({ ...b }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++)
      for (let j = i + 1; j < out.length && !merged; j++)
        if (intersects(out[i], out[j])) {
          out[i] = unionBoxes([out[i], out[j]]);
          out.splice(j, 1);
          merged = true;
        }
  }
  return out;
}

function components(grid: Uint8Array, gw: number, gh: number, gap: number) {
  const seen = new Uint8Array(gw * gh);
  const out: { x0: number; x1: number; y0: number; y1: number; n: number }[] = [];
  const stack: number[] = [];
  for (let s = 0; s < grid.length; s++) {
    if (grid[s] !== 1 || seen[s]) continue;
    let x0 = gw;
    let x1 = 0;
    let y0 = gh;
    let y1 = 0;
    let n = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % gw;
      const y = (p / gw) | 0;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -gap; dy <= gap; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -gap; dx <= gap; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= gw) continue;
          const q = yy * gw + xx;
          if (grid[q] === 1 && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    out.push({ x0, x1, y0, y1, n });
  }
  return out;
}

function buildRows(items: Item[], body: number): Row[] {
  const hangs = (it: Item) => it.bot - it.base > it.fh * 0.5;
  const isSmall = (it: Item) => it.fh < body * 0.86 || hangs(it);
  const big = items.filter((i) => !isSmall(i)).sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const small = items.filter(isSmall).sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const rows: Row[] = [];
  const add = (r: Row, it: Item, setBase: boolean) => {
    r.items.push(it);
    r.x0 = Math.min(r.x0, it.x0);
    r.x1 = Math.max(r.x1, it.x1);
    r.top = Math.min(r.top, it.top);
    r.bot = Math.max(r.bot, it.bot);
    if (setBase && it.fh > r.fh && it.str.trim().length > 2) {
      r.fh = it.fh;
      r.base = it.base;
    }
  };
  const fresh = (it: Item): Row => ({ items: [it], x0: it.x0, x1: it.x1, top: it.top, bot: it.bot, base: it.base, fh: it.fh });
  // pass 1: main-size glyphs establish baselines
  for (const it of big) {
    let target: Row | null = null;
    for (let k = rows.length - 1; k >= 0 && k >= rows.length - 8; k--) {
      const r = rows[k];
      if (Math.abs(it.base - r.base) < Math.min(it.fh, r.fh) * 0.3) {
        target = r;
        break;
      }
    }
    if (target) add(target, it, true);
    else rows.push(fresh(it));
  }
  // pass 2: scripts attach to the nearest compatible line
  const smallRows: Row[] = [];
  for (const it of small) {
    let best: Row | null = null;
    let bestD = Infinity;
    for (const r of rows) {
      if (it.x1 < r.x0 - r.fh * 1.5 || it.x0 > r.x1 + r.fh * 1.5) continue;
      if (hangs(it)) {
        // attach by vertical overlap (radical signs, big operators)
        const ov = Math.min(it.bot, r.bot) - Math.max(it.top, r.top);
        const score = -ov;
        if (ov > (it.bot - it.top) * 0.4 && score < bestD) {
          bestD = score;
          best = r;
        }
        continue;
      }
      const d = Math.abs(it.base - r.base);
      if (d < r.fh * 0.55 && d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (best) {
      add(best, it, false);
      continue;
    }
    const sr = smallRows.find((r) => Math.abs(it.base - r.base) < Math.min(it.fh, r.fh) * 0.3);
    if (sr) add(sr, it, true);
    else smallRows.push(fresh(it));
  }
  const out = [...rows, ...smallRows].sort((a, b) => a.top - b.top);
  for (const r of out) {
    r.items.sort((a, b) => a.x0 - b.x0);
    // Stacked pieces (inline fractions, limits): items overlapping horizontally at different heights.
    for (const a of r.items) {
      for (const b of r.items) {
        if (a === b) continue;
        const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        if (ov > Math.min(a.x1 - a.x0, b.x1 - b.x0) * 0.4 && Math.abs(a.base - b.base) > Math.min(a.fh, b.fh) * 0.3 && (a.math || b.math || isSmall(a) || isSmall(b))) {
          a.frag = true;
          b.frag = true;
        }
      }
    }
  }
  return out;
}

/** Fold tiny rows (numerators, limits, radical signs) into the line they belong to. */
function mergeFragments(rows: Row[], body: number): Row[] {
  const out = [...rows];
  const charsOf = (r: Row) => r.items.reduce((a, it) => a + it.str.trim().length, 0);
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    const symbolOnly = !/[A-Za-z0-9]/.test(r.items.map((it) => it.str).join(''));
    if (charsOf(r) > 6 && !symbolOnly) continue;
    if (!symbolOnly && r.fh > body * 0.95 && !r.items.every((it) => it.math)) continue;
    let best: Row | null = null;
    let bestD = Infinity;
    for (const o of out) {
      if (o === r || charsOf(o) <= 3) continue;
      if (r.x0 < o.x0 - o.fh || r.x1 > o.x1 + o.fh) continue;
      const d = Math.max(0, Math.max(o.top - r.bot, r.top - o.bot));
      if (d < o.fh * 0.45 && d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) continue;
    const mid = (r.top + r.bot) / 2;
    const inside = mid > best.top && mid < best.bot;
    const clash = best.items.some((it) => it.x0 < r.x1 - 0.5 && it.x1 > r.x0 + 0.5);
    if (clash || !inside) for (const it of r.items) it.frag = !symbolOnly || clash;
    best.items.push(...r.items);
    best.items.sort((a, b) => a.x0 - b.x0);
    best.x0 = Math.min(best.x0, r.x0);
    best.x1 = Math.max(best.x1, r.x1);
    best.top = Math.min(best.top, r.top);
    best.bot = Math.max(best.bot, r.bot);
    out.splice(i, 1);
    i--;
  }
  return out;
}

function takeSmallsNear(box: Box, smalls: Box[], fh: number): Box {
  const b = { ...box };
  for (const s of smalls) {
    if (s.x0 >= b.x0 - fh * 0.2 && s.x1 <= b.x1 + fh * 0.4 && s.top >= b.top - fh * 0.3 && s.bot <= b.bot + fh * 0.3) {
      b.x0 = Math.min(b.x0, s.x0);
      b.x1 = Math.max(b.x1, s.x1);
      b.top = Math.min(b.top, s.top);
      b.bot = Math.max(b.bot, s.bot);
    }
  }
  return b;
}

function splitRow(r: Row, gutter: number | null): Row[] {
  const out: Row[] = [];
  let cur: Item[] = [];
  const push = () => {
    if (!cur.length) return;
    const fh = Math.max(...cur.map((i) => i.fh));
    const main = cur.find((i) => i.fh === fh)!;
    out.push({
      items: cur,
      x0: Math.min(...cur.map((i) => i.x0)),
      x1: Math.max(...cur.map((i) => i.x1)),
      top: Math.min(...cur.map((i) => i.top)),
      bot: Math.max(...cur.map((i) => i.bot)),
      base: main.base,
      fh,
    });
    cur = [];
  };
  let lastX1 = -Infinity;
  for (const it of r.items) {
    const eqNo = /^\(\s*\d+(\.\d+)*[a-z]?\s*\)$/.test(it.str.trim());
    const crossesGutter = gutter !== null && lastX1 <= gutter && it.x0 >= gutter;
    if (cur.length && (crossesGutter || (!eqNo && it.x0 - lastX1 > Math.max(r.fh * 2.4, 14)))) push();
    cur.push(it);
    lastX1 = Math.max(lastX1, it.x1);
  }
  push();
  return out;
}

/** Find the white channel between two text columns, using individual text runs (which never cross it). */
function findGutter(items: Item[], W: number, body: number): number | null {
  if (items.length < 30) return null;
  const bins = 300;
  const cov = new Float64Array(bins);
  for (const it of items) {
    const a = Math.max(0, Math.floor((it.x0 / W) * bins));
    const b = Math.min(bins - 1, Math.floor((it.x1 / W) * bins));
    for (let i = a; i <= b; i++) cov[i] += it.bot - it.top;
  }
  const nz = [...cov].filter((v) => v > 0).sort((a, b) => a - b);
  const typical = nz[Math.floor(nz.length * 0.6)] ?? 0;
  if (!typical) return null;
  const lo = Math.floor(bins * 0.3);
  const hi = Math.ceil(bins * 0.7);
  let best: { x: number; width: number } | null = null;
  let i = lo;
  while (i < hi) {
    if (cov[i] < typical * 0.15) {
      let j = i;
      while (j < hi && cov[j] < typical * 0.15) j++;
      const width = ((j - i) / bins) * W;
      if (width >= body * 0.5 && (!best || width > best.width)) best = { x: ((i + j) / 2 / bins) * W, width };
      i = j;
    } else i++;
  }
  if (!best) return null;
  const g = best.x;
  const left = items.filter((it) => it.x1 < g);
  const right = items.filter((it) => it.x0 > g);
  if (left.length < 15 || right.length < 15) return null;
  const paired = left.filter((l) => right.some((r) => Math.abs(r.base - l.base) < body * 0.8)).length;
  if (paired < left.length * 0.3) return null;
  return g;
}

function rowText(r: Row): string {
  let s = '';
  let lastX1 = -Infinity;
  for (const it of r.items) {
    if (s && it.x0 - lastX1 > it.fh * 0.12 && !s.endsWith(' ') && !it.str.startsWith(' ')) s += ' ';
    s += it.str;
    lastX1 = it.x1;
  }
  return s.replace(/\s+/g, ' ');
}

function rowHtml(r: Row, body: number, tokens?: Map<Item, string>, skip?: Set<Item>): string {
  let s = '';
  let lastX1 = -Infinity;
  let open: string | null = null; // current wrapper tag
  const close = () => {
    if (open) s += `</${open}>`;
    open = null;
  };
  for (const it of r.items) {
    if (skip?.has(it)) continue;
    const tok = tokens?.get(it);
    if (tok) {
      close();
      if (s && !s.endsWith(' ') && it.x0 - lastX1 > it.fh * 0.12) s += ' ';
      s += tok;
      lastX1 = Math.max(lastX1, it.x1, ...r.items.filter((o) => skip?.has(o) && Math.abs(o.x0 - it.x0) < it.fh * 3).map((o) => o.x1));
      continue;
    }
    let tag: string | null = null;
    const small = it.fh < r.fh * 0.86;
    if (small && it.base < r.base - r.fh * 0.12) tag = 'sup';
    else if (small && it.base > r.base + r.fh * 0.08) tag = 'sub';
    else if (it.bold && !it.math) tag = 'b';
    else if ((it.italic || (it.math && /^[A-Za-z]+$/.test(it.str.trim()))) && /[A-Za-z]/.test(it.str)) tag = 'i';
    const needSpace = s && it.x0 - lastX1 > it.fh * 0.12 && !it.str.startsWith(' ');
    if (tag !== open) {
      close();
      if (needSpace && !s.endsWith(' ')) s += ' ';
      if (tag) {
        s += `<${tag}>`;
        open = tag;
      }
    } else if (needSpace && !s.endsWith(' ')) s += ' ';
    s += escapeHtml(it.str);
    lastX1 = it.x1;
  }
  close();
  void body;
  return s.replace(/\s+/g, ' ');
}

async function imgBlock(
  canvas: HTMLCanvasElement,
  box: Box,
  kind: 'math' | 'figure' | 'table',
  page: number,
  body: number,
  alt?: string,
  foreign: Box[] = [],
): Promise<LBlock> {
  const x = Math.max(0, Math.floor(box.x0));
  const y = Math.max(0, Math.floor(box.top));
  const w = Math.min(canvas.width - x, Math.ceil(box.x1 - box.x0));
  const h = Math.min(canvas.height - y, Math.ceil(box.bot - box.top));
  // Erase text that belongs to the surrounding prose but intrudes into the crop.
  const intruders = foreign.filter((f) => intersects(f, box) && !centerIn(f, { x0: box.x0, x1: box.x1, top: box.top + 2, bot: box.bot - 2 }) || (intersects(f, box) && kind === 'math'));
  if (intruders.length) {
    const cx = canvas.getContext('2d')!;
    cx.save();
    cx.fillStyle = '#fff';
    for (const f of intruders) cx.fillRect(f.x0 - 1, f.top - 1, f.x1 - f.x0 + 2, f.bot - f.top + 2);
    cx.restore();
  }
  const sub = canvas.getContext('2d')!.getImageData(x, y, Math.max(1, w), Math.max(1, h));
  // Decide whether we can turn it into a theme-coloured mask (mostly white background, no colour)
  let white = 0;
  let colour = 0;
  const d = sub.data;
  const n = d.length / 4;
  for (let p = 0; p < d.length; p += 16) {
    const r = d[p];
    const g = d[p + 1];
    const b = d[p + 2];
    if (r > 235 && g > 235 && b > 235) white++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colour++;
  }
  const samples = n / 4;
  const mask = kind === 'math' || (white / samples > 0.6 && colour / samples < 0.01);
  const blob = await cropBlob(canvas, x, y, w, h, mask);
  return { t: 'img', blob, w, h, em: w / body, mask, kind, page, alt };
}

async function cropBlob(src: HTMLCanvasElement, x: number, y: number, w: number, h: number, mask: boolean): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const cx = c.getContext('2d')!;
  cx.drawImage(src, x, y, w, h, 0, 0, w, h);
  if (mask) {
    const id = cx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    for (let p = 0; p < d.length; p += 4) {
      const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
      const a = Math.max(0, Math.min(255, ((245 - lum) * 255) / 205));
      d[p] = d[p + 1] = d[p + 2] = 0;
      d[p + 3] = a;
    }
    cx.putImageData(id, 0, 0);
  }
  return new Promise((r) => c.toBlob((b) => r(b!), mask ? 'image/png' : 'image/jpeg', 0.88));
}

// ---------- HTML rendering of blocks ----------

export function blocksToHtml(blocks: LBlock[], urls: string[]): string {
  let html = '';
  let hi = 0;
  const inl = new Map<string, string>();
  for (const b of blocks) {
    if (b.t !== 'inl') continue;
    const url = URL.createObjectURL(b.blob);
    urls.push(url);
    inl.set(b.id, `<span class="im" role="img" style="width:${b.em.toFixed(2)}em;height:${b.hem.toFixed(2)}em;vertical-align:-${b.dem.toFixed(2)}em;--m:url(${url})"></span>`);
  }
  const fill = (h: string) => h.replace(/\u0001([\w]+)\u0001/g, (_, id) => inl.get(id) ?? '');
  for (const b0 of blocks) {
    // never mutate the blocks: they are cached and blob URLs are per-session
    const b = b0.t === 'p' || b0.t === 'li' || b0.t === 'h' ? { ...b0, html: fill(b0.html) } : b0;
    switch (b.t) {
      case 'page':
        html += `<span class="pg" id="page-${b.page}" data-page="${b.page}"></span>`;
        break;
      case 'h':
        html += `<h${b.level + 1} id="h-${hi++}" data-page="${b.page}">${b.html}</h${b.level + 1}>`;
        break;
      case 'p':
        html += `<p data-page="${b.page}"${b.cont ? ' class="cont"' : ''}>${b.html}</p>`;
        break;
      case 'li':
        html += `<p class="li" data-page="${b.page}">${b.html}</p>`;
        break;
      case 'img': {
        const url = URL.createObjectURL(b.blob);
        urls.push(url);
        const ratio = `${b.w} / ${b.h}`;
        if (b.mask) {
          html += `<figure class="lq lq-${b.kind}${b.num ? ' numbered' : ''}" data-page="${b.page}" data-src="${url}" data-w="${b.w}" data-h="${b.h}"><span class="mask" role="img" aria-label="${escapeHtml(b.alt ?? b.kind)}" style="width:${b.em.toFixed(2)}em;aspect-ratio:${ratio};--m:url(${url})"></span>${b.num ? `<span class="eqno">${escapeHtml(b.num)}</span>` : ''}</figure>`;
        } else {
          html += `<figure class="lq lq-${b.kind}${b.ref ? ' lq-ref' : ''}${b.unread ? ' lq-unread' : ''}" data-page="${b.page}" data-src="${url}" data-w="${b.w}" data-h="${b.h}"><img src="${url}" alt="${escapeHtml(b.alt ?? b.kind)}" style="aspect-ratio:${ratio}${b.em ? `;width:${b.em.toFixed(2)}em` : ''}" loading="lazy"/></figure>`;
        }
        break;
      }
    }
  }
  return html;
}
