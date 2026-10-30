import { slice } from './ocr';

// Page layout for scans: where the columns are, which blocks are text and which are pictures. It works on a small
// black-and-white copy of the page (fast), cutting the page along its white gutters again and again (an "XY cut"),
// then judging each piece by how line-like its ink is. Text pieces are read by the OCR; pictures are kept as pictures.

export type LeafKind = 'text' | 'figure' | 'table';
export interface Leaf {
  kind: LeafKind;
  /** in the pixels of the picture that was analysed */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** typical height of one line of ink (text only) */
  lh: number;
  lines: number;
}

interface Bin {
  noise: number; // share of the dark specks that were lone dots (0 = clean, 1 = all grain)
  w: number;
  h: number;
  ink: Uint8Array;
  s: number; // working scale (working px per source px)
}

async function binarize(src: HTMLCanvasElement): Promise<Bin> {
  const s = Math.min(1, 1000 / src.width); // a modest working size: it averages away grain and speckle
  const w = Math.max(8, Math.round(src.width * s));
  const h = Math.max(8, Math.round(src.height * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'blur(0.6px)'; // grain and speckle go; letters stay
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < w * h; i += 4, j++) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    gray[j] = g;
    hist[g]++;
  }
  await slice();
  // Otsu, kept in a sensible range (the page was flattened first, so paper is near white)
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wb = 0;
  let sb = 0;
  let best = 0;
  let thr = 160;
  for (let t = 0; t < 256; t++) {
    wb += hist[t];
    if (!wb) continue;
    const wf = w * h - wb;
    if (!wf) break;
    sb += t * hist[t];
    const mb = sb / wb;
    const mf = (sum - sb) / wf;
    const v = wb * wf * (mb - mf) * (mb - mf);
    if (v > best) {
      best = v;
      thr = t;
    }
  }
  thr = Math.max(115, Math.min(200, thr)); // averaged thin strokes are paler than the paper-black extremes
  const ink = new Uint8Array(w * h);
  const raw = new Uint8Array(w * h);
  for (let j = 0; j < w * h; j++) raw[j] = gray[j] < thr ? 1 : 0;
  // keep only ink that is part of a stroke (3+ pixels in a row or in a column): lone specks are not writing
  const keep = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!raw[y * w + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < w && raw[y * w + e]) e++;
      if (e - x >= 3) for (let k = x; k < e; k++) keep[y * w + k] = 1;
      x = e;
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!raw[y * w + x]) {
        y++;
        continue;
      }
      let e = y;
      while (e < h && raw[e * w + x]) e++;
      if (e - y >= 3) for (let k = y; k < e; k++) keep[k * w + x] = 1;
      y = e;
    }
  }
  let rawN = 0;
  let keepN = 0;
  for (let j = 0; j < w * h; j++) {
    ink[j] = keep[j];
    rawN += raw[j];
    keepN += keep[j];
  }
  const noise = rawN ? 1 - keepN / rawN : 0;
  // dark scanner edges and page borders are not content: wipe a frame where it is almost solid ink
  const band = Math.round(Math.min(w, h) * 0.035);
  const wipe = (x0: number, y0: number, x1: number, y1: number) => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += ink[y * w + x];
    if (n > (x1 - x0) * (y1 - y0) * 0.3) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink[y * w + x] = 0;
  };
  wipe(0, 0, w, band);
  wipe(0, h - band, w, h);
  wipe(0, 0, band, h);
  wipe(w - band, 0, w, h);
  return { w, h, ink, s, noise };
}

interface R {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  return b[b.length >> 1];
};

/** The typical size when bigger things count for more (specks of noise must not drag the answer down). */
const heavyMedian = (a: number[]) => {
  const b = [...a].sort((x, y) => x - y);
  const total = b.reduce((s, v) => s + v, 0);
  let acc = 0;
  for (const v of b) {
    acc += v;
    if (acc >= total / 2) return v;
  }
  return 0;
};

/** Shrinks a box to the ink inside it (nothing left → null). */
function trim(b: Bin, r: R): R | null {
  let { x0, y0, x1, y1 } = r;
  const rowHas = (y: number) => {
    let n = 0;
    for (let x = x0; x < x1; x++) n += b.ink[y * b.w + x];
    return n > 1;
  };
  const colHas = (x: number) => {
    let n = 0;
    for (let y = y0; y < y1; y++) n += b.ink[y * b.w + x];
    return n > 1;
  };
  while (y0 < y1 && !rowHas(y0)) y0++;
  while (y1 > y0 && !rowHas(y1 - 1)) y1--;
  while (x0 < x1 && !colHas(x0)) x0++;
  while (x1 > x0 && !colHas(x1 - 1)) x1--;
  return x1 - x0 < 3 || y1 - y0 < 3 ? null : { x0, y0, x1, y1 };
}

/** Runs of "has ink" along one axis → [start, end) pairs. */
function runs(profile: number[], limit: number): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let i = 0; i < profile.length; i++) {
    const on = profile[i] > limit;
    if (on && s < 0) s = i;
    else if (!on && s >= 0) {
      out.push([s, i]);
      s = -1;
    }
  }
  if (s >= 0) out.push([s, profile.length]);
  return out;
}

function rowProfile(b: Bin, r: R) {
  const p: number[] = [];
  for (let y = r.y0; y < r.y1; y++) {
    let n = 0;
    for (let x = r.x0; x < r.x1; x++) n += b.ink[y * b.w + x];
    p.push(n);
  }
  return p;
}
function colProfile(b: Bin, r: R) {
  const p = new Array<number>(r.x1 - r.x0).fill(0);
  for (let y = r.y0; y < r.y1; y++) {
    const o = y * b.w;
    for (let x = r.x0; x < r.x1; x++) p[x - r.x0] += b.ink[o + x];
  }
  return p;
}

/** The cut-points of a profile: white stretches at least `min` long that have ink on both sides. */
function gaps(profile: number[], limit: number, min: number): [number, number][] {
  const on = runs(profile, limit);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < on.length; i++) if (on[i + 1][0] - on[i][1] >= min) out.push([on[i][1], on[i + 1][0]]);
  return out;
}

function cut(b: Bin, r0: R, out: R[], depth: number) {
  const r = trim(b, r0);
  if (!r) return;
  const bw = r.x1 - r.x0;
  const bh = r.y1 - r.y0;
  if (depth > 9 || bw < 12 || bh < 6) {
    out.push(r);
    return;
  }
  const rows = rowProfile(b, r);
  const rl = Math.max(1.5, bw * 0.008);
  const lineRuns = runs(rows, rl);
  // the line size comes from the small runs (text); a big picture in the same block must not stretch it
  const allRuns = lineRuns.map(([a, z]) => z - a);
  const small = allRuns.filter((h) => h <= Math.max(48, bh * 0.1));
  const lh = Math.max(4, heavyMedian(small.length ? small : allRuns));
  const minGapY = Math.max(4, lh * 0.75);
  const minGapX = Math.max(6, b.w * 0.022);
  const gy = gaps(rows, rl, minGapY);
  const cols = colProfile(b, r);
  const gx = gaps(cols, Math.max(1, bh * 0.004), minGapX);
  const ry = gy.length ? Math.max(...gy.map(([a, z]) => z - a)) / minGapY : 0;
  const rx = gx.length ? Math.max(...gx.map(([a, z]) => z - a)) / minGapX : 0;
  if (ry < 1 && rx < 1) {
    out.push(r);
    return;
  }
  // an even cut: prefer the bigger gap, relative to what counts as a gap in that direction
  if (ry >= rx) {
    let from = r.y0;
    for (const [a, z] of gy) {
      cut(b, { x0: r.x0, x1: r.x1, y0: from, y1: r.y0 + a }, out, depth + 1);
      from = r.y0 + z;
    }
    cut(b, { x0: r.x0, x1: r.x1, y0: from, y1: r.y1 }, out, depth + 1);
  } else {
    let from = r.x0;
    for (const [a, z] of gx) {
      cut(b, { x0: from, x1: r.x0 + a, y0: r.y0, y1: r.y1 }, out, depth + 1);
      from = r.x0 + z;
    }
    cut(b, { x0: from, x1: r.x1, y0: r.y0, y1: r.y1 }, out, depth + 1);
  }
}

/** How "line-like" a block is, and what kind it is. */
function judge(b: Bin, r: R): Omit<Leaf, 'x0' | 'y0' | 'x1' | 'y1'> {
  const bw = r.x1 - r.x0;
  const bh = r.y1 - r.y0;
  const rows = rowProfile(b, r);
  const rl = Math.max(1.5, bw * 0.008);
  const lr = runs(rows, rl).filter(([a, z]) => z - a >= 3);
  const hs = lr.map(([a, z]) => z - a);
  const mh = heavyMedian(hs);
  let ink = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) ink += b.ink[y * b.w + x];
  const ratio = ink / (bw * bh);
  // spread of line heights (text lines are alike; drawings are not)
  const real = hs.filter((h) => h >= mh * 0.5);
  const mean = real.reduce((a, c) => a + c, 0) / Math.max(1, real.length);
  const cv = real.length > 1 ? Math.sqrt(real.reduce((a, c) => a + (c - mean) ** 2, 0) / real.length) / mean : 0;
  // ruled tables: several long thin horizontal strokes
  let longRows = 0;
  for (let y = r.y0; y < r.y1; y++) {
    let run = 0;
    let best = 0;
    for (let x = r.x0; x < r.x1; x++) {
      if (b.ink[y * b.w + x]) {
        run++;
        if (run > best) best = run;
      } else run = 0;
    }
    if (best > bw * 0.7) longRows++;
  }
  const ruled = longRows >= 4 && bh > 30;
  const lineLike = lr.length >= 2 && cv < 0.6 && mh >= 5 && mh <= 80 && ratio >= 0.02 && ratio <= 0.4;
  const oneLine = lr.length === 1 && mh >= 5 && mh <= 90 && bw / bh > 2.2 && ratio <= 0.65;
  if (ruled && lr.length >= 4) return { kind: 'table', lh: mh / b.s, lines: lr.length };
  if (lineLike || oneLine) return { kind: 'text', lh: mh / b.s, lines: lr.length };
  return { kind: 'figure', lh: mh / b.s, lines: lr.length };
}

/**
 * Pictures first: a drawing, chart, photo or ruled box is one big connected shape, which writing never is (letters are
 * small). Each such shape (with everything inside it, labels and axes included) is filled in solid so the cutting step
 * treats it as one block that cannot be sliced into "lines".
 */
async function markFigures(b: Bin): Promise<void> {
  const { w, h, ink } = b;
  const label = new Int32Array(w * h).fill(-1);
  const comps: { x0: number; y0: number; x1: number; y1: number; n: number }[] = [];
  const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if ((i & 0x3fff) === 0) await slice();
    if (!ink[i] || label[i] >= 0) continue;
    const id = comps.length;
    const c = { x0: w, y0: h, x1: 0, y1: 0, n: 0 };
    let sp = 0;
    stack[sp++] = i;
    label[i] = id;
    while (sp) {
      const q = stack[--sp];
      const x = q % w;
      const y = (q / w) | 0;
      c.n++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx;
          if (ink[k] && label[k] < 0) {
            label[k] = id;
            stack[sp++] = k;
          }
        }
    }
    comps.push(c);
  }
  // how tall are letters on this page?
  const hs = comps.filter((c) => c.n >= 6 && c.y1 - c.y0 + 1 >= 5 && c.y1 - c.y0 + 1 <= 70 && c.x1 - c.x0 + 1 <= 90).map((c) => c.y1 - c.y0 + 1);
  const h0 = Math.max(6, median(hs) || 12);
  type Box = { x0: number; y0: number; x1: number; y1: number };
  let figs: Box[] = comps
    .filter((c) => {
      const cw = c.x1 - c.x0 + 1;
      const ch = c.y1 - c.y0 + 1;
      return Math.min(cw, ch) > h0 * 4.5 && Math.max(cw, ch) > h0 * 7;
    })
    .map((c) => ({ x0: c.x0, y0: c.y0, x1: c.x1 + 1, y1: c.y1 + 1 }));
  // shapes that overlap or nearly touch belong to one figure (a chart and its legend)
  const near = h0 * 1.2;
  for (let changed = true; changed; ) {
    changed = false;
    outer: for (let i = 0; i < figs.length; i++)
      for (let j = i + 1; j < figs.length; j++) {
        const a = figs[i];
        const c = figs[j];
        if (a.x0 - near < c.x1 && c.x0 - near < a.x1 && a.y0 - near < c.y1 && c.y0 - near < a.y1) {
          figs[i] = { x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) };
          figs.splice(j, 1);
          changed = true;
          break outer;
        }
      }
  }
  figs = figs.filter((f) => (f.x1 - f.x0) * (f.y1 - f.y0) > w * h * 0.004);
  for (const f of figs) for (let y = f.y0; y < f.y1; y++) ink.fill(1, y * w + f.x0, y * w + f.x1);
}

/** Finds the text blocks and pictures of a (flattened) page, in reading order. */
export async function segmentPage(flat: HTMLCanvasElement): Promise<Leaf[] & { noise: number }> {
  const b = await binarize(flat);
  await markFigures(b);
  const boxes: R[] = [];
  cut(b, { x0: 0, y0: 0, x1: b.w, y1: b.h }, boxes, 0);
  const pageArea = b.w * b.h;
  const leaves: Leaf[] = [];
  for (const r of boxes) {
    const j = judge(b, r);
    const area = (r.x1 - r.x0) * (r.y1 - r.y0);
    if (j.kind !== 'text' && area < pageArea * 0.004) continue; // specks and stray marks
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    // thin bands (a scanner shadow, a page edge, a rule) and scraps glued to the page edge are not content
    if (j.kind !== 'text' && Math.min(w, h) < 0.03 * Math.max(b.w, b.h)) continue;
    const edge = b.w * 0.012;
    if ((r.x0 < edge || r.y0 < edge || r.x1 > b.w - edge || r.y1 > b.h - edge) && (w < b.w * 0.14 || h < b.h * 0.02)) continue;
    leaves.push({ ...j, x0: r.x0 / b.s, y0: r.y0 / b.s, x1: r.x1 / b.s, y1: r.y1 / b.s });
  }
  // neighbouring text blocks of one column become one block (fewer, larger reads)
  const out: Leaf[] = [];
  for (const l of leaves) {
    const p = out[out.length - 1];
    const gap = p ? l.y0 - p.y1 : 0;
    const biggest = p ? Math.max(p.lh, l.lh) : 0;
    // same column: left edges line up, the new block is no wider (a short last line or heading is fine), and it is close below
    if (p && p.kind === 'text' && l.kind === 'text' && Math.abs(p.x0 - l.x0) < flat.width * 0.04 && l.x1 <= p.x1 + flat.width * 0.06 && gap < biggest * 3 && (l.lines <= 1 || p.lines <= 1 || Math.abs(p.lh - l.lh) < biggest * 0.3)) {
      p.x0 = Math.min(p.x0, l.x0);
      p.x1 = Math.max(p.x1, l.x1);
      p.y1 = l.y1;
      if (l.lines > p.lines) p.lh = l.lh; // the size that most of the lines have
      p.lines += l.lines;
    } else out.push({ ...l });
  }
  return Object.assign(out, { noise: b.noise });
}

/**
 * How much a page is tilted, in degrees (positive = clockwise to put right). Lines of text give the sharpest row
 * profile when the page is straight, so try a few angles and keep the one with the most "peaky" profile.
 */
export async function estimateSkew(flat: HTMLCanvasElement): Promise<number> {
  const b = await binarize(flat);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < b.h; y++) for (let x = (y & 1); x < b.w; x += 2) if (b.ink[y * b.w + x]) (xs.push(x), ys.push(y));
  if (xs.length < 400) return 0;
  const score = (deg: number) => {
    const t = Math.tan((deg * Math.PI) / 180);
    const off = Math.ceil(b.w * Math.abs(t)) + 2;
    const hist = new Float64Array(b.h + 2 * off + 2);
    for (let i = 0; i < xs.length; i++) hist[Math.round(ys[i] + xs[i] * t) + off]++;
    let sc = 0;
    for (let i = 0; i < hist.length; i++) sc += hist[i] * hist[i];
    return sc;
  };
  let best = 0;
  let bs = score(0);
  const base = bs;
  for (let d = -4; d <= 4.001; d += 0.5) {
    const v = score(d);
    if (v > bs) {
      bs = v;
      best = d;
    }
  }
  for (let d = best - 0.45; d <= best + 0.451; d += 0.1) {
    const v = score(d);
    if (v > bs) {
      bs = v;
      best = d;
    }
  }
  return bs > base * 1.03 ? best : 0;
}

/** Turns a canvas by `deg` degrees around its middle, filling the corners with white. */
export function rotateCanvas(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

