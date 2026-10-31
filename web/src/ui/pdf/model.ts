// A PDF being worked on: its pages (in the order shown, each from some source PDF or blank, with a rotation) and
// the marks drawn on them. Saving writes a real PDF with pdf-lib — the marks become part of the pages.
import type { PDFDocumentProxy } from '../../lib/pdf';

export interface PageRef {
  /** stable key of this page in the workspace */
  key: string;
  /** 'self' (this document), another document's id, a dropped file's key, or 'blank' */
  src: string;
  /** 0-based page index in the source */
  index: number;
  /** extra rotation chosen here (0, 90, 180, 270), on top of the page's own */
  rot: number;
  /** the page's own size (points, unrotated) and rotation */
  w: number;
  h: number;
  own: number;
}

export type AnnType = 'text' | 'hl' | 'ink' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'note' | 'img' | 'white';
/** Positions are fractions (0‥1) of the page as shown (rotation included), from its top-left. */
export interface Ann {
  id: string;
  page: string;
  type: AnnType;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** stroke width or font size, in points */
  size: number;
  opacity?: number;
  text?: string;
  font?: 'sans' | 'serif' | 'mono';
  bold?: boolean;
  /** ink: points as fractions, x,y,x,y… ; line/arrow: x1,y1,x2,y2 */
  pts?: number[];
  /** img: data URL */
  src?: string;
  /** a highlight made from selected text keeps its words (it also becomes a synced highlight) */
  mark?: string;
}

export interface Model {
  pages: PageRef[];
  anns: Ann[];
  form: Record<string, string | boolean>;
}

export interface Source {
  pdf: PDFDocumentProxy;
  bytes: Uint8Array;
}

export const shownSize = (p: PageRef) => {
  const r = (p.own + p.rot) % 180;
  return r ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
};

const hex = (c: string) => {
  const m = c.replace('#', '');
  const n = parseInt(m.length === 3 ? m.replace(/(.)/g, '$1$1') : m, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
};

/** Text the standard PDF fonts can draw (they only know Western characters). */
const winAnsi = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff€]/g, '?');

/**
 * Writes the workspace as a PDF. `sources` holds the bytes of every PDF a page comes from. When the pages are still
 * the original ones in their order, the original file is changed in place (its forms stay fillable); otherwise a new
 * PDF is put together.
 */
export async function buildPdf(model: Model, sources: Map<string, Source>): Promise<Uint8Array> {
  const lib = await import('pdf-lib');
  const { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle, BlendMode } = lib;
  const self = sources.get('self');
  const loaded = new Map<string, import('pdf-lib').PDFDocument>();
  const load = async (src: string) => {
    if (!loaded.has(src)) loaded.set(src, await PDFDocument.load(sources.get(src)!.bytes, { ignoreEncryption: true, updateMetadata: false }));
    return loaded.get(src)!;
  };
  const selfCount = self ? (await load('self')).getPageCount() : 0;
  const inPlace = !!self && model.pages.length === selfCount && model.pages.every((p, i) => p.src === 'self' && p.index === i);

  let out: import('pdf-lib').PDFDocument;
  const pages: import('pdf-lib').PDFPage[] = [];
  if (inPlace) {
    out = await load('self');
    fillForm(lib, out, model.form, false);
    pages.push(...out.getPages());
  } else {
    out = await PDFDocument.create();
    if (self) {
      const s = await load('self');
      fillForm(lib, s, model.form, true); // a form whose pages are moved around is written into the page
      const t = s.getTitle();
      if (t) out.setTitle(t);
    }
    for (const p of model.pages) {
      if (p.src === 'blank') {
        pages.push(out.addPage([p.w, p.h]));
        continue;
      }
      const src = await load(p.src);
      const [copy] = await out.copyPages(src, [p.index]);
      pages.push(out.addPage(copy));
    }
  }

  const fonts = new Map<string, import('pdf-lib').PDFFont>();
  const font = async (f: Ann['font'] = 'sans', bold = false) => {
    const name = f === 'serif' ? (bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman) : f === 'mono' ? (bold ? StandardFonts.CourierBold : StandardFonts.Courier) : bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica;
    if (!fonts.has(name)) fonts.set(name, await out.embedFont(name));
    return fonts.get(name)!;
  };

  for (let i = 0; i < model.pages.length; i++) {
    const ref = model.pages[i];
    const page = pages[i];
    const R = (ref.own + ref.rot) % 360;
    page.setRotation(degrees(R));
    const anns = model.anns.filter((a) => a.page === ref.key);
    if (!anns.length) continue;
    const box = page.getCropBox();
    const W = box.width;
    const H = box.height;
    const sw = R % 180 ? H : W; // shown width in points
    const sh = R % 180 ? W : H;
    // a point on the page as shown (fractions from top-left) → PDF user space
    const at = (u: number, v: number) => {
      if (R === 90) return { x: box.x + v * W, y: box.y + u * H };
      if (R === 180) return { x: box.x + W - u * W, y: box.y + v * H };
      if (R === 270) return { x: box.x + W - v * W, y: box.y + H - u * H };
      return { x: box.x + u * W, y: box.y + H - v * H };
    };
    const rectOf = (a: Ann) => {
      const p1 = at(a.x, a.y);
      const p2 = at(a.x + a.w, a.y + a.h);
      return { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y) };
    };
    for (const a of anns) {
      const [r, g, b] = hex(a.color);
      const color = rgb(r, g, b);
      if (a.type === 'hl') {
        for (const rc of a.pts && a.pts.length >= 4 ? chunk4(a.pts) : [[a.x, a.y, a.w, a.h]])
          page.drawRectangle({ ...rectOf({ ...a, x: rc[0], y: rc[1], w: rc[2], h: rc[3] }), color, opacity: a.opacity ?? 0.38, blendMode: BlendMode.Multiply });
      } else if (a.type === 'white') {
        page.drawRectangle({ ...rectOf(a), color: rgb(1, 1, 1) });
      } else if (a.type === 'rect') {
        page.drawRectangle({ ...rectOf(a), borderColor: color, borderWidth: a.size, opacity: 0, borderOpacity: a.opacity ?? 1 });
      } else if (a.type === 'ellipse') {
        const rc = rectOf(a);
        page.drawEllipse({ x: rc.x + rc.width / 2, y: rc.y + rc.height / 2, xScale: rc.width / 2, yScale: rc.height / 2, borderColor: color, borderWidth: a.size, opacity: 0 });
      } else if ((a.type === 'line' || a.type === 'arrow') && a.pts) {
        const s = at(a.pts[0], a.pts[1]);
        const e = at(a.pts[2], a.pts[3]);
        page.drawLine({ start: s, end: e, thickness: a.size, color, lineCap: LineCapStyle.Round });
        if (a.type === 'arrow') {
          const ang = Math.atan2(e.y - s.y, e.x - s.x);
          const L = Math.max(6, a.size * 4);
          for (const d of [-0.45, 0.45]) page.drawLine({ start: e, end: { x: e.x - L * Math.cos(ang + d), y: e.y - L * Math.sin(ang + d) }, thickness: a.size, color, lineCap: LineCapStyle.Round });
        }
      } else if (a.type === 'ink' && a.pts && a.pts.length >= 4) {
        for (let k = 2; k < a.pts.length; k += 2) {
          const s = at(a.pts[k - 2], a.pts[k - 1]);
          const e = at(a.pts[k], a.pts[k + 1]);
          page.drawLine({ start: s, end: e, thickness: a.size, color, opacity: a.opacity ?? 1, lineCap: LineCapStyle.Round });
        }
      } else if (a.type === 'text' && a.text) {
        const f = await font(a.font, a.bold);
        const size = a.size;
        const lines = winAnsi(a.text).split('\n');
        lines.forEach((ln, k) => {
          // the baseline of line k, as shown, then into PDF space; the text turns with the page so it reads upright
          const o = at(a.x, a.y + (size * (0.92 + k * 1.2)) / sh);
          page.drawText(ln, { x: o.x, y: o.y, size, font: f, color, rotate: degrees(R) });
        });
      } else if (a.type === 'note') {
        const rc = rectOf({ ...a, w: 16 / sw, h: 16 / sh });
        page.drawRectangle({ ...rc, color: rgb(1, 0.82, 0.25), borderColor: rgb(0.75, 0.58, 0.05), borderWidth: 0.6 });
        if (a.text) {
          const f = await font('sans');
          const words = winAnsi(a.text).split(/\s+/);
          const lines: string[] = [];
          let cur = '';
          for (const w of words) {
            const t = cur ? cur + ' ' + w : w;
            if (f.widthOfTextAtSize(t, 7.5) > 150 && cur) (lines.push(cur), (cur = w));
            else cur = t;
          }
          if (cur) lines.push(cur);
          const tw = Math.min(160, Math.max(...lines.map((l) => f.widthOfTextAtSize(l, 7.5))) + 8);
          const th = lines.length * 9.5 + 6;
          const bx = rectOf({ ...a, x: a.x + 20 / sw, w: tw / sw, h: th / sh });
          page.drawRectangle({ ...bx, color: rgb(1, 0.97, 0.84), borderColor: rgb(0.85, 0.75, 0.4), borderWidth: 0.5 });
          lines.forEach((l, k) => {
            const o = at(a.x + 24 / sw, a.y + (11 + k * 9.5) / sh);
            page.drawText(l, { x: o.x, y: o.y, size: 7.5, font: f, color: rgb(0.15, 0.15, 0.15), rotate: degrees(R) });
          });
        }
      } else if (a.type === 'img' && a.src) {
        const bytes = await (await fetch(a.src)).arrayBuffer();
        const img = a.src.startsWith('data:image/png') ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        // bottom-left corner of the picture as shown; it turns with the page
        const o = at(a.x, a.y + a.h);
        page.drawImage(img, { x: o.x, y: o.y, width: a.w * sw, height: a.h * sh, rotate: degrees(R) });
      }
    }
  }
  return out.save({ useObjectStreams: true });
}

function chunk4(a: number[]) {
  const out: number[][] = [];
  for (let i = 0; i + 3 < a.length; i += 4) out.push([a[i], a[i + 1], a[i + 2], a[i + 3]]);
  return out;
}

type Lib = typeof import('pdf-lib');
function fillForm(lib: Lib, doc: import('pdf-lib').PDFDocument, values: Record<string, string | boolean>, flatten: boolean) {
  const names = Object.keys(values);
  if (!names.length && !flatten) return;
  let form;
  try {
    form = doc.getForm();
  } catch {
    return;
  }
  for (const f of form.getFields()) {
    const v = values[f.getName()];
    if (v === undefined) continue;
    try {
      if (f instanceof lib.PDFTextField) f.setText(String(v));
      else if (f instanceof lib.PDFCheckBox) (v ? f.check() : f.uncheck());
      else if (f instanceof lib.PDFDropdown) f.select(String(v));
      else if (f instanceof lib.PDFRadioGroup) f.select(String(v));
      else if (f instanceof lib.PDFOptionList) f.select(String(v));
    } catch {
      /* a value the field doesn't take */
    }
  }
  if (flatten && form.getFields().length) {
    try {
      form.flatten();
    } catch {
      /* some forms can't be flattened: their values stay as fields */
    }
  }
}

/** The fields of a PDF form, for the form panel. */
export async function formFields(bytes: Uint8Array): Promise<{ name: string; type: string; value: string | boolean; options?: string[] }[]> {
  try {
    const lib = await import('pdf-lib');
    const doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });
    return doc
      .getForm()
      .getFields()
      .map((f) => {
        let type = 'Other';
        let value: string | boolean = '';
        let options: string[] | undefined;
        try {
          if (f instanceof lib.PDFTextField) (type = 'TextField'), (value = f.getText() ?? '');
          else if (f instanceof lib.PDFCheckBox) (type = 'CheckBox'), (value = f.isChecked());
          else if (f instanceof lib.PDFDropdown || f instanceof lib.PDFOptionList) (type = 'Dropdown'), (options = f.getOptions()), (value = f.getSelected()[0] ?? '');
          else if (f instanceof lib.PDFRadioGroup) (type = 'RadioGroup'), (options = f.getOptions()), (value = f.getSelected() ?? '');
          else if (f instanceof lib.PDFButton) type = 'Button';
          else if (f instanceof lib.PDFSignature) type = 'Signature';
        } catch {
          /* unreadable value */
        }
        return { name: f.getName(), type, value, options };
      })
      .filter((f) => f.type !== 'Button' && f.type !== 'Signature');
  } catch {
    return [];
  }
}
