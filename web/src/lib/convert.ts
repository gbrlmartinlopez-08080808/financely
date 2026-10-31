// Turning the editor's HTML back into the document's own format: Markdown, plain text, or a simple Word file.
import JSZip from 'jszip';

/** HTML (from the editor) → Markdown. */
export function htmlToMarkdown(root: HTMLElement): string {
  const out: string[] = [];
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? '').replace(/\s+/g, ' ').replace(/([*_`[\]])/g, '\\$1');
    if (!(n instanceof HTMLElement)) return '';
    const kids = () => Array.from(n.childNodes).map(inline).join('');
    switch (n.tagName) {
      case 'STRONG':
      case 'B': {
        const t = kids().trim();
        return t ? `**${t}**` : '';
      }
      case 'EM':
      case 'I': {
        const t = kids().trim();
        return t ? `*${t}*` : '';
      }
      case 'U':
        return `<u>${kids()}</u>`;
      case 'S':
      case 'STRIKE':
      case 'DEL':
        return `~~${kids()}~~`;
      case 'CODE':
        return '`' + (n.textContent ?? '') + '`';
      case 'A':
        return `[${kids()}](${n.getAttribute('href') ?? ''})`;
      case 'IMG':
        return `![${n.getAttribute('alt') ?? ''}](${n.getAttribute('src') ?? ''})`;
      case 'BR':
        return '  \n';
      default:
        return kids();
    }
  };
  const block = (n: Node, depth = 0): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = (n.textContent ?? '').trim();
      if (t) out.push(t, '');
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    const tag = n.tagName;
    if (/^H[1-6]$/.test(tag)) out.push('#'.repeat(Number(tag[1])) + ' ' + inline(n).trim(), '');
    else if (tag === 'P' || tag === 'DIV') {
      if (Array.from(n.children).some((c) => /^(P|DIV|UL|OL|H\d|BLOCKQUOTE|PRE|TABLE)$/.test(c.tagName))) Array.from(n.childNodes).forEach((c) => block(c, depth));
      else {
        const t = inline(n).trim();
        if (t) out.push(t, '');
      }
    } else if (tag === 'UL' || tag === 'OL') {
      let i = 1;
      for (const li of Array.from(n.children)) {
        if (li.tagName !== 'LI') continue;
        const nested = Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
        const own = Array.from(li.childNodes).filter((c) => !nested.includes(c as Element)).map(inline).join('').trim();
        out.push(`${'  '.repeat(depth)}${tag === 'OL' ? `${i++}.` : '-'} ${own}`);
        nested.forEach((x) => block(x, depth + 1));
      }
      if (!depth) out.push('');
    } else if (tag === 'BLOCKQUOTE') {
      const inner = htmlToMarkdown(n).trim();
      out.push(inner.split('\n').map((l) => '> ' + l).join('\n'), '');
    } else if (tag === 'PRE') out.push('```', (n.textContent ?? '').replace(/\n$/, ''), '```', '');
    else if (tag === 'HR') out.push('---', '');
    else if (tag === 'TABLE') {
      const rows = Array.from(n.querySelectorAll('tr')).map((r) => Array.from(r.children).map((c) => inline(c).trim().replace(/\|/g, '\\|')));
      if (rows.length) {
        out.push('| ' + rows[0].join(' | ') + ' |', '|' + rows[0].map(() => ' --- ').join('|') + '|');
        rows.slice(1).forEach((r) => out.push('| ' + r.join(' | ') + ' |'));
        out.push('');
      }
    } else if (tag === 'IMG') out.push(inline(n), '');
    else Array.from(n.childNodes).forEach((c) => block(c, depth));
  };
  Array.from(root.childNodes).forEach((c) => block(c));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** HTML (from the editor) → a simple .docx: headings, paragraphs, bold/italic/underline, lists, quotes, links as text. */
export async function htmlToDocx(root: HTMLElement): Promise<Blob> {
  const paras: string[] = [];
  const runs = (n: Node, f: { b?: boolean; i?: boolean; u?: boolean; code?: boolean } = {}): string => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = (n.textContent ?? '').replace(/\s+/g, ' ');
      if (!t) return '';
      const pr = `${f.b ? '<w:b/>' : ''}${f.i ? '<w:i/>' : ''}${f.u ? '<w:u w:val="single"/>' : ''}${f.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ''}`;
      return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(t)}</w:t></w:r>`;
    }
    if (!(n instanceof HTMLElement)) return '';
    const t = n.tagName;
    if (t === 'BR') return '<w:r><w:br/></w:r>';
    const g = { ...f, b: f.b || t === 'B' || t === 'STRONG', i: f.i || t === 'I' || t === 'EM', u: f.u || t === 'U' || t === 'A', code: f.code || t === 'CODE' };
    return Array.from(n.childNodes).map((c) => runs(c, g)).join('');
  };
  const p = (inner: string, style?: string, extra = '') => paras.push(`<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${inner}</w:p>`);
  const walk = (n: Node, quote = false, level = 0) => {
    if (n.nodeType === Node.TEXT_NODE) {
      if ((n.textContent ?? '').trim()) p(runs(n));
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    const t = n.tagName;
    if (/^H[1-6]$/.test(t)) p(runs(n), `Heading${Math.min(3, Number(t[1]))}`);
    else if (t === 'UL' || t === 'OL') {
      let i = 1;
      for (const li of Array.from(n.children)) {
        const nested = Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
        const own = Array.from(li.childNodes).filter((c) => !nested.includes(c as Element));
        p(`<w:r><w:t xml:space="preserve">${t === 'OL' ? `${i++}.` : '•'}\t</w:t></w:r>` + own.map((c) => runs(c)).join(''), undefined, `<w:ind w:left="${360 + level * 360}" w:hanging="360"/>`);
        nested.forEach((x) => walk(x, quote, level + 1));
      }
    } else if (t === 'BLOCKQUOTE') Array.from(n.childNodes).forEach((c) => walk(c, true, level));
    else if (t === 'PRE') (n.textContent ?? '').split('\n').forEach((l) => p(runs(document.createTextNode(l), { code: true })));
    else if (t === 'TABLE') n.querySelectorAll('tr').forEach((r) => p(runs(document.createTextNode(Array.from(r.children).map((c) => c.textContent?.trim()).join('\t')))));
    else if (t === 'HR') p('', undefined, '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>');
    else if (t === 'P' || (t === 'DIV' && !n.querySelector('p, div, ul, ol, h1, h2, h3, blockquote, pre, table'))) p(runs(n), quote ? 'Quote' : undefined);
    else Array.from(n.childNodes).forEach((c) => walk(c, quote, level));
  };
  Array.from(root.childNodes).forEach((c) => walk(c));
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  const h = (id: string, name: string, size: number) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${h('Heading1', 'heading 1', 36)}${h('Heading2', 'heading 2', 30)}${h('Heading3', 'heading 3', 26)}<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style></w:styles>`,
  );
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/** Removes scripts and event handlers from HTML before it is shown or edited. */
export function cleanHtml(html: string): string {
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach((n) => n.remove());
  d.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name) || (a.name === 'href' && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
  });
  return d.body.innerHTML;
}
