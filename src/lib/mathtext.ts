// Typeset LaTeX that shows up in definitions, etymologies and Wikipedia summaries.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { escapeHtml, sanitizeHtml } from './sanitize';

const render = (tex: string, display: boolean) => {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' });
  } catch {
    return escapeHtml(tex);
  }
};

const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$\d])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g;

/** Plain text that may contain $…$, $$…$$, \(…\) or \[…\] → safe HTML with the maths typeset. */
export function texToHtml(text: string): string {
  const parts: string[] = [];
  const src = text.replace(MATH, (_m, a, b, c, d) => {
    const display = a !== undefined || b !== undefined;
    parts.push(display ? `<div class="math-display">${render(a ?? b, true)}</div>` : render(c ?? d, false));
    return `\u0002${parts.length - 1}\u0002`;
  });
  return escapeHtml(src).replace(/\u0002(\d+)\u0002/g, (_x, i) => parts[Number(i)] ?? '');
}

const cleanTex = (t: string) => t.trim().replace(/^\{\\(?:display|text|script)style\s*/, '').replace(/\}\s*$/, '').trim();

/**
 * Wikipedia's HTML summary → sanitised HTML. Formulas arrive as MathML (with the original LaTeX tucked inside)
 * plus a fallback image; we re-typeset the LaTeX with KaTeX and drop the images.
 */
export function wikiHtmlToRich(html: string): { html: string; text: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const maths: string[] = [];
  doc.querySelectorAll('math').forEach((m) => {
    const tex = cleanTex(m.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? m.getAttribute('alttext') ?? '');
    const display = m.getAttribute('display') === 'block';
    const holder = doc.createTextNode(tex ? `\u0002${maths.push(render(tex, display)) - 1}\u0002` : (m.textContent ?? ''));
    m.replaceWith(holder);
  });
  doc.querySelectorAll('img, .mw-empty-elt, style, link').forEach((n) => n.remove());
  doc.querySelectorAll('p').forEach((p) => {
    if (!(p.textContent ?? '').trim()) p.remove();
  });
  const text = (doc.body.textContent ?? '').replace(/\u0002\d+\u0002/g, ' ').replace(/\s+/g, ' ').trim();
  let out = sanitizeHtml(doc.body);
  out = out.replace(/\u0002(\d+)\u0002/g, (_x, i) => maths[Number(i)] ?? '');
  return { html: out, text };
}
