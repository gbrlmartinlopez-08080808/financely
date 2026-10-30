// Forms: spotting them, listing their fields in order, filling them in, and writing the answers back into a PDF.
// Real PDF forms (with fields) are filled through the fields themselves; "flat" forms (underscores and colons on a
// page) get the answers written onto the blanks.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import * as db from './db';
import type { PDFDocumentProxy } from './formats/pdf';

export type FieldKind = 'text' | 'multiline' | 'check' | 'choice' | 'date' | 'sign';

export interface FormField {
  id: string;
  label: string;
  kind: FieldKind;
  page: number; // 1-based
  rect: [number, number, number, number]; // x0, y0, x1, y1 in PDF points (origin bottom-left)
  options?: string[];
  acro?: { name: string; type: 'Tx' | 'check' | 'radio' | 'Ch' | 'Sig' };
  /** every box of a radio group (the group is one field, one answer) */
  widgets?: { value: string; rect: [number, number, number, number]; page: number }[];
  value: string; // text, ISO date, "true"/"false", or the chosen option
}

export interface FormModel {
  kind: 'acro' | 'flat';
  fields: FormField[];
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const humanize = (name: string) =>
  clean(
    (name.split('.').pop() ?? name)
      .replace(/\[\d+\]/g, '')
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b(txt|chk|cb|tf|fld|field|text)\b/gi, '')
      .replace(/\b(\d+)\b/g, ' $1'),
  ).replace(/^./, (c) => c.toUpperCase());

const kindFromLabel = (label: string, fallback: FieldKind): FieldKind => {
  if (/\bsign(ature|ed)?\b|sign here|signed by/i.test(label)) return 'sign';
  if (fallback === 'text' && /\b(date|dob|birth)\b/i.test(label)) return 'date';
  return fallback;
};

interface TItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function pageItems(pdf: PDFDocumentProxy, n: number): Promise<{ items: TItem[]; w: number; h: number }> {
  const page = await pdf.getPage(n);
  const v = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: TItem[] = [];
  for (const it of tc.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    const t = it.transform as number[];
    items.push({ str: it.str, x: t[4], y: t[5], w: it.width, h: Math.abs(t[3]) || it.height || 10 });
  }
  return { items, w: v.width, h: v.height };
}

/** The words that sit next to a box: to its left on the same line, else just above it. */
function nearbyLabel(items: TItem[], r: [number, number, number, number]): string {
  const cy = (r[1] + r[3]) / 2;
  const tol = Math.max(5, (r[3] - r[1]) * 0.7);
  const left = items.filter((i) => i.str.trim() && Math.abs(i.y + i.h * 0.3 - cy) < tol && i.x + i.w <= r[0] + 6).sort((a, b) => b.x - a.x);
  if (left.length) {
    const group: TItem[] = [left[0]];
    for (const it of left.slice(1)) {
      const last = group[group.length - 1];
      if (last.x - (it.x + it.w) < 14) group.push(it);
      else break;
    }
    const s = clean(group.reverse().map((g) => g.str).join(' '));
    if (s && r[0] - (left[0].x + left[0].w) < 160) return s.replace(/[:_*.\s]+$/, '').slice(-60);
  }
  const above = items
    .filter((i) => i.str.trim() && i.y > r[3] - 2 && i.y - r[3] < 26 && i.x < r[2] && i.x + i.w > r[0] - 4)
    .sort((a, b) => a.y - b.y)[0];
  return above ? clean(above.str).replace(/[:_*.\s]+$/, '').slice(0, 60) : '';
}

// ------------------------------------------------------------------ real form fields
async function acroFields(pdf: PDFDocumentProxy): Promise<FormField[]> {
  const out: FormField[] = [];
  const radios = new Map<string, FormField>();
  const n = Math.min(pdf.numPages, 24);
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const anns = (await page.getAnnotations()) as {
      subtype: string;
      fieldType?: string;
      fieldName?: string;
      fieldValue?: unknown;
      rect: number[];
      checkBox?: boolean;
      radioButton?: boolean;
      pushButton?: boolean;
      readOnly?: boolean;
      hidden?: boolean;
      multiLine?: boolean;
      options?: { exportValue: string; displayValue: string }[];
      exportValue?: string;
      buttonValue?: string;
      alternativeText?: string;
    }[];
    const widgets = anns.filter((a) => a.subtype === 'Widget' && a.fieldType && a.fieldName && !a.pushButton && !a.readOnly && !a.hidden);
    if (!widgets.length) continue;
    const { items } = await pageItems(pdf, p);
    for (const a of widgets) {
      const rect = a.rect as [number, number, number, number];
      const name = a.fieldName!;
      const label = clean(a.alternativeText ?? '') || nearbyLabel(items, rect) || humanize(name);
      if (a.fieldType === 'Btn' && a.radioButton) {
        const val = a.buttonValue ?? a.exportValue ?? 'On';
        let g = radios.get(name);
        if (!g) {
          g = { id: `r:${name}`, label: label || humanize(name), kind: 'choice', page: p, rect, options: [], acro: { name, type: 'radio' }, widgets: [], value: '' };
          radios.set(name, g);
          out.push(g);
        }
        g.options!.push(val);
        g.widgets!.push({ value: val, rect, page: p });
        if (a.fieldValue === val) g.value = val;
        continue;
      }
      if (a.fieldType === 'Btn' && a.checkBox) {
        out.push({ id: `c:${name}:${p}:${Math.round(rect[0])}:${Math.round(rect[1])}`, label, kind: 'check', page: p, rect, acro: { name, type: 'check' }, value: a.fieldValue && a.fieldValue !== 'Off' ? 'true' : 'false' });
      } else if (a.fieldType === 'Ch') {
        out.push({ id: `h:${name}`, label, kind: 'choice', page: p, rect, options: (a.options ?? []).map((o) => o.exportValue || o.displayValue), acro: { name, type: 'Ch' }, value: String(a.fieldValue ?? '') });
      } else if (a.fieldType === 'Sig') {
        out.push({ id: `s:${name}`, label: label || 'Signature', kind: 'sign', page: p, rect, acro: { name, type: 'Sig' }, value: '' });
      } else if (a.fieldType === 'Tx') {
        const k = kindFromLabel(label, a.multiLine ? 'multiline' : 'text');
        out.push({ id: `t:${name}:${p}:${Math.round(rect[0])}:${Math.round(rect[1])}`, label, kind: k, page: p, rect, acro: { name, type: 'Tx' }, value: String(Array.isArray(a.fieldValue) ? a.fieldValue[0] : (a.fieldValue ?? '')) });
      }
    }
  }
  return order(out);
}

// ------------------------------------------------------------------ "flat" forms: blanks on the page
async function flatFields(pdf: PDFDocumentProxy): Promise<{ fields: FormField[]; wordy: boolean }> {
  const out: FormField[] = [];
  let wordy = false;
  const n = Math.min(pdf.numPages, 8);
  for (let p = 1; p <= n; p++) {
    const { items, w: pw } = await pageItems(pdf, p);
    if (p === 1 && /\b(form|application|registration|declaration|consent|enrol?ment|questionnaire|claim|request|agreement)\b/i.test(items.slice(0, 40).map((i) => i.str).join(' '))) wordy = true;
    // group the words into lines
    const lines: TItem[][] = [];
    for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const ln = lines[lines.length - 1]; // sorted top to bottom, so a line is always the last one started
      if (ln && Math.abs(ln[0].y - it.y) < 3) ln.push(it);
      else lines.push([it]);
    }
    lines.forEach((ln) => ln.sort((a, b) => a.x - b.x));
    const add = (label: string, kind: FieldKind, x0: number, y: number, h: number, w: number, idx: number) => {
      const lab = clean(label).replace(/[:_*.\s]+$/, '').slice(-60);
      if (!lab && kind !== 'check') return;
      out.push({ id: `f:${p}:${Math.round(x0)}:${Math.round(y)}:${idx}`, label: lab || 'Option', kind: kindFromLabel(lab, kind), page: p, rect: [x0, y - 2, x0 + w, y + h], value: kind === 'check' ? 'false' : '' });
    };
    lines.forEach((ln, li) => {
      let before = '';
      ln.forEach((it, ii) => {
        const s = it.str;
        // checkbox glyphs, alone or at the start of the label's own text: "[ ] I agree"
        const cb = s.match(/^\s*(\[\s\]|\(\s\)|[☐□❑◻⬜])\s*(.*)$/);
        if (cb) {
          const rest = clean(`${cb[2]} ${ln.slice(ii + 1).map((x) => x.str).join(' ')}`).split(/[☐□❑◻⬜]|\[\s\]/)[0];
          if (rest) add(rest, 'check', it.x, it.y, Math.min(it.h, 12), Math.min(it.h, 12), ii);
          return;
        }
        // underscores and dot leaders: each blank is named by the words since the previous blank
        const re = /(_{3,}|\.{6,}|…{3,}|-{8,})/g;
        let m: RegExpExecArray | null;
        let cursor = 0;
        while ((m = re.exec(s))) {
          const x0 = it.x + it.w * (m.index / Math.max(1, s.length));
          const w = it.w * (m[0].length / Math.max(1, s.length));
          let label = (cursor === 0 ? before + ' ' : '') + s.slice(cursor, m.index);
          if (!clean(label).replace(/[:_*.]/g, '')) {
            const above = lines[li - 1];
            if (above && above.length <= 3 && !/[_.]{3,}/.test(above.map((a) => a.str).join(''))) label = above.map((a) => a.str).join(' ');
          }
          add(label, w > 150 && /(comment|note|describe|detail|reason|address)/i.test(label) ? 'multiline' : 'text', x0, it.y, it.h, w, ii * 10 + cursor);
          cursor = m.index + m[0].length;
        }
        if (cursor) {
          before = s.slice(cursor);
          return;
        }
        // "Label:" followed by empty space
        if (/:\s*$/.test(s)) {
          const next = ln[ii + 1];
          const room = (next ? next.x : pw - 40) - (it.x + it.w) - 8;
          if (room > 45 && clean(s).length > 1 && clean(s).length < 50) add(s, 'text', it.x + it.w + 4, it.y, it.h, Math.min(room, 260), ii);
        }
        before += (before ? ' ' : '') + s;
      });
    });
  }
  return { fields: order(out), wordy };
}

/** top to bottom, and left to right within a row */
const order = (f: FormField[]) => [...f].sort((a, b) => a.page - b.page || (Math.abs(a.rect[3] - b.rect[3]) < 6 ? a.rect[0] - b.rect[0] : b.rect[3] - a.rect[3]));

/** Does this PDF look like a form? If so, its fields in reading order. */
export async function detectForm(pdf: PDFDocumentProxy): Promise<FormModel | null> {
  try {
    // forms are short: never spend time on a long book or a stack of notes
    if (pdf.numPages > 40) return null;
    let hasAcro = false;
    try {
      const fo = await pdf.getFieldObjects(); // instant: null when the file has no form fields at all
      hasAcro = !!fo && Object.keys(fo).length > 0;
    } catch {
      hasAcro = false;
    }
    if (hasAcro) {
      const acro = await acroFields(pdf);
      if (acro.length) {
        // a printed "Signature: ____" line next to real fields still deserves a signature box
        if (!acro.some((f) => f.kind === 'sign')) {
          const { fields } = await flatFields(pdf);
          const extra = fields.filter((f) => f.kind === 'sign').slice(0, 2);
          if (extra.length) return { kind: 'acro', fields: order([...acro, ...extra]) };
        }
        return { kind: 'acro', fields: acro };
      }
    }
    // a printed form: look at the first page's words before doing any real work
    const first = await pageItems(pdf, 1);
    const text = first.items.map((i) => i.str).join(' ');
    const blanks = (text.match(/_{4,}|\.{6,}|\[\s\]|\(\s\)|[☐□❑◻⬜]/g) ?? []).length;
    const wordy = /\b(form|application|registration|declaration|consent|enrol?ment|questionnaire|claim|request|agreement)\b/i.test(text.slice(0, 600));
    if (blanks < 3 && !(wordy && blanks >= 1)) return null;
    const { fields, wordy: w2 } = await flatFields(pdf);
    if (fields.length >= 4 || (fields.length >= 2 && w2)) return { kind: 'flat', fields };
  } catch (e) {
    console.warn('form detection failed', e);
  }
  return null;
}

// ------------------------------------------------------------------ "my details" and the signature (kept on the phone)
export interface Profile {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  zip: string;
  country: string;
  dob: string;
}
export const EMPTY_PROFILE: Profile = { name: '', email: '', phone: '', address: '', city: '', zip: '', country: '', dob: '' };
export const loadProfile = async (): Promise<Profile> => ({ ...EMPTY_PROFILE, ...((await db.get<Profile>('kv', 'profile')) ?? {}) });
export const saveProfile = (p: Profile) => db.put('kv', 'profile', p);
export const loadSignature = () => db.get<string>('kv', 'signature');
export const saveSignature = (d: string) => db.put('kv', 'signature', d);
export const forgetSignature = () => db.del('kv', 'signature');

export const today = () => new Date().toISOString().slice(0, 10);

/** What goes in a box, judging by its label, from the saved details. */
export function guessValue(f: FormField, p: Profile): string {
  const l = f.label.toLowerCase();
  const [first, ...rest] = p.name.trim().split(/\s+/);
  if (f.kind === 'date') return /birth|dob/.test(l) ? p.dob : today();
  if (f.kind !== 'text' && f.kind !== 'multiline') return '';
  if (/e-?mail/.test(l)) return p.email;
  if (/(phone|tel\b|mobile|cell)/.test(l)) return p.phone;
  if (/(first|given)\s*name|forename/.test(l)) return first ?? '';
  if (/(last|sur|family)\s*name/.test(l)) return rest.join(' ');
  if (/\bname\b/.test(l) && !/(company|employer|school|bank|contact|emergency|parent|guardian|spouse)/.test(l)) return p.name;
  if (/(street|address)/.test(l) && !/e-?mail/.test(l)) return p.address;
  if (/\b(city|town)\b/.test(l)) return p.city;
  if (/(zip|post(al)?\s*code)/.test(l)) return p.zip;
  if (/country/.test(l)) return p.country;
  return '';
}

export function autoFill(fields: FormField[], p: Profile, current: Record<string, string>): Record<string, string> {
  const out = { ...current };
  for (const f of fields) if (!out[f.id]) {
    const v = guessValue(f, p);
    if (v) out[f.id] = v;
  }
  return out;
}

// ------------------------------------------------------------------ writing the answers into the PDF
const safe = (font: PDFFont, s: string) => {
  try {
    font.encodeText(s);
    return s;
  } catch {
    return [...s].map((c) => { try { font.encodeText(c); return c; } catch { return '?'; } }).join('');
  }
};

const dateText = (iso: string) => {
  const d = new Date(iso + 'T12:00:00');
  return Number.isNaN(+d) ? iso : d.toLocaleDateString();
};

export async function exportFilled(data: ArrayBuffer, model: FormModel, values: Record<string, string>, sigs: Record<string, string>, flatten = true): Promise<Uint8Array> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const form = model.kind === 'acro' ? doc.getForm() : null;

  const drawSignature = async (f: FormField) => {
    const url = sigs[f.id];
    if (!url) return;
    const img = await doc.embedPng(await (await fetch(url)).arrayBuffer());
    const page = pages[f.page - 1];
    const [x0, y0, x1, y1] = f.rect;
    // flat signature lines are thin: give the signature room above the line
    const w = Math.max(x1 - x0, 120);
    const h = Math.max(y1 - y0, 38);
    const s = Math.min(w / img.width, h / img.height);
    page.drawImage(img, { x: x0 + 2, y: y0 + 1, width: img.width * s, height: img.height * s });
  };

  for (const f of model.fields) {
    const v = values[f.id] ?? '';
    if (f.kind === 'sign') {
      await drawSignature(f);
      continue;
    }
    if (form && f.acro) {
      try {
        if (f.acro.type === 'Tx') form.getTextField(f.acro.name).setText(safe(font, f.kind === 'date' && v ? dateText(v) : v));
        else if (f.acro.type === 'check') {
          const cb = form.getCheckBox(f.acro.name);
          if (v === 'true') cb.check();
          else cb.uncheck();
        } else if (f.acro.type === 'radio') {
          if (v) form.getRadioGroup(f.acro.name).select(v);
        } else if (f.acro.type === 'Ch') {
          if (v) {
            try {
              form.getDropdown(f.acro.name).select(v);
            } catch {
              form.getOptionList(f.acro.name).select(v);
            }
          }
        }
      } catch (e) {
        console.warn('field not filled', f.label, e);
      }
      continue;
    }
    // flat: write straight onto the page
    const page = pages[f.page - 1];
    const [x0, y0, x1, y1] = f.rect;
    if (f.kind === 'check') {
      if (v === 'true') page.drawText('X', { x: x0 + 1, y: y0 + 2, size: Math.max(8, y1 - y0), font, color: rgb(0.05, 0.05, 0.05) });
      continue;
    }
    if (!v) continue;
    const text = safe(font, f.kind === 'date' ? dateText(v) : v);
    const width = Math.max(40, x1 - x0 - 4);
    if (f.kind === 'multiline') {
      const size = 10;
      const lines: string[] = [];
      let cur = '';
      for (const w of text.split(/\s+/)) {
        if (font.widthOfTextAtSize(`${cur} ${w}`.trim(), size) > width && cur) {
          lines.push(cur);
          cur = w;
        } else cur = `${cur} ${w}`.trim();
      }
      if (cur) lines.push(cur);
      lines.slice(0, 4).forEach((ln, i) => page.drawText(ln, { x: x0 + 2, y: y0 + 2 - i * (size + 2), size, font, color: rgb(0.05, 0.05, 0.05) }));
    } else {
      let size = Math.min(11, Math.max(7, (y1 - y0) * 0.9));
      while (size > 6 && font.widthOfTextAtSize(text, size) > width) size -= 0.5;
      page.drawText(text, { x: x0 + 2, y: y0 + 2, size, font, color: rgb(0.05, 0.05, 0.05) });
    }
  }
  if (form) {
    try {
      form.updateFieldAppearances(font);
      if (flatten) form.flatten();
    } catch (e) {
      console.warn('could not flatten', e);
    }
  }
  return doc.save();
}
