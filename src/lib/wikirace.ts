// A race or event as Wikipedia tells it: the short description, and the candidates read from the lists on its page.
export interface Wp {
  extract: string;
  url: string;
}
export async function summary(title: string): Promise<Wp | null> {
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const j = await r.json();
    return { extract: j.extract ?? '', url: j.content_urls?.desktop?.page ?? '' };
  } catch {
    return null;
  }
}
export interface Cand {
  group: string;
  items: { text: string; wiki?: string }[];
}
/** the candidates, read from the race's Wikipedia page: each list item under the primaries and the general election */
export async function candidates(title: string): Promise<Cand[]> {
  try {
    const base = 'https://en.wikipedia.org/w/api.php?format=json&origin=*&redirects=1&action=parse&page=' + encodeURIComponent(title);
    const secs = (await (await fetch(`${base}&prop=sections`, { signal: AbortSignal.timeout(9000) })).json())?.parse?.sections as { index: string; line: string; level: string; toclevel: number }[] | undefined;
    const tops = (secs ?? []).filter((x) => x.toclevel === 1 && /^candidates$|^general election$|primar/i.test(x.line.replace(/<[^>]+>/g, ''))).slice(0, 3);
    if (!tops.length) return [];
    const out: Cand[] = [];
    for (const top of tops) {
      const html = (await (await fetch(`${base}&prop=text&section=${top.index}`, { signal: AbortSignal.timeout(12000) })).json())?.parse?.text?.['*'] as string | undefined;
      if (!html) continue;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      let group = top.line.replace(/<[^>]+>/g, '');
      doc.body.querySelectorAll('h2,h3,h4,h5,ul').forEach((el) => {
        if (/^H\d$/.test(el.tagName)) {
          const t = (el.textContent ?? '').replace(/\[edit\]/g, '').trim();
          // a heading names the group: "Republican primary", "Declared"
          group = /^(declared|candidates|withdrawn|declined|failed to qualify|disqualified|eliminated|potential)/i.test(t) ? `${top.line.replace(/<[^>]+>/g, '')} · ${t}` : t;
          return;
        }
        if (el.closest('table, .reflist, .navbox, .hatnote') || el.parentElement?.closest('li')) return;
        const items = Array.from(el.querySelectorAll(':scope > li'))
          .map((li) => {
            const a = li.querySelector('a[href^="/wiki/"]:not([href*=":"])');
            const text = (li.textContent ?? '').replace(/\[\d+\]|\[[a-z]\]/g, '').replace(/\s+/g, ' ').trim();
            return { text: text.length > 150 ? text.slice(0, 147) + '…' : text, wiki: a ? decodeURIComponent(a.getAttribute('href')!.slice(6)).replace(/_/g, ' ') : undefined };
          })
          .filter((x) => x.text.length > 3);
        if (items.length && !/^(withdrawn|declined|potential|failed|disqualified)/i.test(group.split(' · ').pop() ?? '')) out.push({ group: group || 'Candidates', items: items.slice(0, 10) });
      });
    }
    return out.slice(0, 8);
  } catch {
    return [];
  }
}

