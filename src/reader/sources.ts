// The sources at the back of a book or paper (references, bibliography, notes, index) folded into one closed block:
// they are there when wanted, but don't stand between the reader and the end, and Listen goes past them.

const HEAD = /^(\d+(\.\d+)*\.?\s+)?(references|reference list|bibliography|works cited|sources|literature( cited)?|notes|endnotes|index|referencias|bibliograf[ií]a|bibliographie|literatur(verzeichnis)?|riferimenti|r[ée]f[ée]rences)\.?$/i;
const LEVEL = (el: Element) => (/^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 0);
const isSourcesHead = (el: Element) => LEVEL(el) > 0 && HEAD.test((el.textContent ?? '').trim());

/** Folds the sources of a Liquid view; safe to call again as the view grows (new pages join the fold). */
export function foldSources(root: HTMLElement) {
  // 1. a heading such as "References" starts a fold
  for (const h of Array.from(root.querySelectorAll('h1,h2,h3,h4,h5'))) {
    if (h.closest('.lq-sources') || !isSourcesHead(h)) continue;
    const d = document.createElement('details');
    d.className = 'lq-sources';
    d.dataset.level = String(LEVEL(h));
    d.dataset.title = (h.textContent ?? '').trim().replace(/^[\d.\s]+/, '');
    d.append(document.createElement('summary'));
    h.before(d);
    d.append(h);
  }
  // 2. each fold takes what follows it, up to the next heading of the same rank or higher; a fold right after it joins it
  const absorb = () => {
    for (const d of Array.from(root.querySelectorAll<HTMLElement>('details.lq-sources'))) {
      if (!d.isConnected) continue;
      const level = Number(d.dataset.level) || 1;
      for (let n = d.nextElementSibling; n; n = d.nextElementSibling) {
        if (n.matches('details.lq-sources')) {
          for (const k of Array.from(n.children)) if (!k.matches('summary')) d.append(k);
          n.remove();
          continue;
        }
        const lv = LEVEL(n);
        if (n.matches('details') || (lv && lv <= level && !isSourcesHead(n))) break;
        if (n.matches('.lq-wait')) break; // still being read: it joins once it has arrived
        d.append(n);
      }
    }
  };
  absorb();
  // 3. pages of sources that were kept as pictures (not read, to save time) start one too, or join the one before
  for (const f of Array.from(root.querySelectorAll('figure.lq-ref'))) {
    if (f.closest('.lq-sources')) continue;
    let prev = f.previousElementSibling;
    while (prev && prev.matches('.pg')) prev = prev.previousElementSibling;
    if (prev?.matches('details.lq-sources')) continue; // joins it below
    const d = document.createElement('details');
    d.className = 'lq-sources';
    d.dataset.level = '1';
    d.dataset.title = 'Sources';
    d.append(document.createElement('summary'));
    f.before(d);
  }
  absorb();
  for (const d of Array.from(root.querySelectorAll<HTMLElement>('details.lq-sources'))) {
    const entries = d.querySelectorAll('p, li').length;
    const pics = d.querySelectorAll('figure.lq-ref').length;
    const bits = [entries ? `${entries} ${entries === 1 ? 'entry' : 'entries'}` : '', pics ? `${pics} ${pics === 1 ? 'page' : 'pages'} kept as pictures` : ''].filter(Boolean);
    const sum = d.querySelector(':scope > summary')!;
    sum.innerHTML = `<b>${d.dataset.title}</b><span>${bits.join(' · ') || 'folded away'} · tap to open</span>`;
  }
}
