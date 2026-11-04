import { useEffect, useState } from 'react';
import * as db from '../lib/db';

const mem = new Map<string, string>();
/** The picture of a Wikipedia article (for a club, party or event: its logo), fetched once and kept on the phone. */
export function useWikiImage(title?: string) {
  const [src, setSrc] = useState(title ? mem.get(title) ?? '' : '');
  useEffect(() => {
    if (!title) return;
    if (mem.has(title)) return setSrc(mem.get(title)!);
    let live = true;
    (async () => {
      const key = `wi:${title}`;
      const saved = await db.get<{ at: number; u: string }>('kv', key).catch(() => undefined);
      if (saved && Date.now() - saved.at < 30 * 864e5) {
        mem.set(title, saved.u);
        return live && setSrc(saved.u);
      }
      try {
        const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { signal: AbortSignal.timeout(8000) });
        const j = r.ok ? await r.json() : null;
        let u: string = j?.thumbnail?.source ?? '';
        // parties, clubs and organisations often have no lead picture: their logo is on Wikidata (property P154)
        if (!u && j?.wikibase_item) {
          try {
            const w = await (await fetch(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${j.wikibase_item}&property=P154&format=json&origin=*`, { signal: AbortSignal.timeout(8000) })).json();
            const file: string | undefined = w?.claims?.P154?.[0]?.mainsnak?.datavalue?.value;
            if (file) u = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=160`;
          } catch {
            /* no logo on file */
          }
        }
        mem.set(title, u);
        db.put('kv', key, { at: Date.now(), u }).catch(() => {});
        if (live) setSrc(u);
      } catch {
        /* offline: the placeholder stays */
      }
    })();
    return () => {
      live = false;
    };
  }, [title]);
  return src;
}

const emoji = (cc: string) => (/^[a-z]{2}$/i.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '🏳');

/** A country flag (ISO code, or gb-eng style for the home nations); the emoji flag stands in if the picture cannot load. */
export function Flag({ cc, size = 30 }: { cc: string; size?: number }) {
  const [bad, setBad] = useState(false);
  const h = Math.round(size * 0.72);
  return bad ? (
    <span className="ico flag" style={{ width: size, height: h, fontSize: h * 0.9 }} aria-hidden>
      {emoji(cc.slice(0, 2))}
    </span>
  ) : (
    <img className="ico flag" src={`https://flagcdn.com/w80/${cc.toLowerCase()}.png`} alt="" style={{ width: size, height: h }} onError={() => setBad(true)} draggable={false} />
  );
}
export function WikiLogo({ title, size = 30, glyph = '·', emoji }: { title?: string; size?: number; glyph?: string; emoji?: string }) {
  const src = useWikiImage(title);
  const [bad, setBad] = useState(false);
  return src && !bad ? (
    <img className="ico logo2" src={src} alt="" style={{ width: size, height: size }} onError={() => setBad(true)} draggable={false} />
  ) : emoji ? (
    <span className="ico ph emo" style={{ width: size, height: size, fontSize: size * 0.56 }} aria-hidden>
      {emoji}
    </span>
  ) : (
    <span className="ico ph mono" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>
      {glyph}
    </span>
  );
}
/** the picture for a team, party, country or event: a flag, a logo, or a plain mark */
export function Emblem({ cc, wiki, badge, size = 30, glyph, emoji }: { cc?: string; wiki?: string; badge?: string; size?: number; glyph?: string; emoji?: string }) {
  const [bad, setBad] = useState(false);
  if (badge && !bad) return <img className="ico logo2" src={badge} alt="" style={{ width: size, height: size }} onError={() => setBad(true)} draggable={false} />;
  if (cc) return <Flag cc={cc} size={size} />;
  return <WikiLogo title={wiki} size={size} glyph={glyph} emoji={emoji} />;
}
