// Allowlist HTML sanitizer used for every document that arrives as markup (EPUB, DOCX, HTML, Markdown).

const TAGS = new Set(
  (
    'a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em ' +
    'figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp section ' +
    'small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr ' +
    // MathML core
    'math mi mn mo ms mspace mtext mrow mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup ' +
    'munder mover munderover mmultiscripts mprescripts none mtable mtr mtd mlabeledtr semantics annotation annotation-xml'
  ).split(' '),
);

const DROP = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'head', 'title', 'svg', 'canvas', 'video', 'audio', 'template']);

const ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'id', 'lang', 'dir', 'width', 'height', 'start', 'reversed', 'type',
  // MathML presentational attributes
  'mathvariant', 'display', 'displaystyle', 'scriptlevel', 'fence', 'separator', 'stretchy', 'symmetric', 'largeop', 'movablelimits', 'accent', 'accentunder', 'linethickness', 'lspace', 'rspace', 'notation', 'columnalign', 'rowalign', 'encoding', 'xmlns']);

export interface SanitizeOpts {
  /** Map an src/href found in the document to a usable URL (e.g. a blob URL from inside a zip). */
  resolveSrc?: (src: string) => string | undefined;
  idPrefix?: string;
  /** Map a relative link (e.g. another EPUB chapter) to an in-document anchor. */
  resolveHref?: (href: string) => string | undefined;
}

export function sanitizeHtml(input: string | Document | Element, opts: SanitizeOpts = {}): string {
  let root: Element;
  if (typeof input === 'string') {
    const doc = new DOMParser().parseFromString(input, 'text/html');
    root = doc.body;
  } else if ('body' in input && (input as Document).body) {
    root = (input as Document).body;
  } else if ('documentElement' in input) {
    root = (input as Document).documentElement;
  } else root = input as Element;
  const out = document.createElement('div');
  for (const child of Array.from(root.childNodes)) {
    const c = clean(child, opts);
    if (c) out.appendChild(c);
  }
  return out.innerHTML;
}

function clean(node: Node, opts: SanitizeOpts): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.localName.toLowerCase();
  if (DROP.has(tag)) {
    // Keep inline SVG images that are pure pictures? Too risky — drop.
    return null;
  }
  const kids = () => {
    const frag = document.createDocumentFragment();
    for (const ch of Array.from(el.childNodes)) {
      const c = clean(ch, opts);
      if (c) frag.appendChild(c);
    }
    return frag;
  };
  if (!TAGS.has(tag)) return kids(); // unwrap unknown elements (body, font, center, epub:switch...)
  const isMath = el.namespaceURI === 'http://www.w3.org/1998/Math/MathML' || tag === 'math';
  const out = isMath
    ? document.createElementNS('http://www.w3.org/1998/Math/MathML', tag)
    : document.createElement(tag);
  for (const a of Array.from(el.attributes)) {
    const name = a.name.toLowerCase();
    if (!ATTRS.has(name)) continue;
    let v = a.value;
    if (name === 'id') v = (opts.idPrefix ?? '') + v;
    if (name === 'href') {
      if (/^\s*javascript:/i.test(v)) continue;
      if (opts.resolveHref && !/^[a-z]+:/i.test(v)) v = opts.resolveHref(v) ?? '#';
      else if (v.startsWith('#')) v = '#' + (opts.idPrefix ?? '') + v.slice(1);
      else if (opts.idPrefix !== undefined && !/^[a-z]+:/i.test(v)) {
        // internal link to another chapter: keep the fragment only
        const frag = v.split('#')[1];
        v = frag ? '#' + opts.idPrefix + frag : '#';
      }
    }
    if (name === 'src') {
      const r = opts.resolveSrc?.(v);
      if (r) v = r;
      else if (!/^(https?:|data:image\/|blob:)/i.test(v)) continue;
    }
    out.setAttribute(name, v);
  }
  if (tag === 'img' && !out.getAttribute('src')) {
    // EPUB images sometimes use xlink:href inside svg>image; handled by caller.
    return null;
  }
  if (tag === 'a') {
    const href = out.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) {
      out.setAttribute('target', '_blank');
      out.setAttribute('rel', 'noopener');
    }
  }
  out.appendChild(kids());
  return out;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
