import { useEffect, useRef, useState } from 'react';
import { SOURCES, archivePdf, featuredNow, fetchFile, fetchThumb, peek, search, type Item, type SourceId } from '../lib/catalog';
import { importFile } from '../lib/library';
import { onBack, openExternal, tap } from '../lib/native';
import { Icon } from '../ui/Icon';
import { PixelLoader, toast } from '../ui/kit';

export function Discover({ onClose, onOpen, initial }: { onClose: () => void; onOpen: (id: string) => void; initial?: string }) {
  const [source, setSource] = useState<SourceId>('books');
  const [topic, setTopic] = useState(0);
  const [text, setText] = useState(initial ?? '');
  const [q, setQ] = useState(initial ?? '');
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<Set<string>>(new Set()); // several books can be on their way at once
  const [added, setAdded] = useState<Record<string, string>>({}); // item id → doc id
  const seq = useRef(0);
  const src = SOURCES.find((s) => s.id === source)!;
  const query = q || src.topics[topic]?.q || '';

  useEffect(() => onBack(() => (onClose(), true)), [onClose]);

  const load = async (page: number) => {
    const my = ++seq.current;
    setErr(null);
    // the featured shelf is built in: nothing to wait for
    if (source === 'books' && query === 'featured') {
      setItems(featuredNow().items);
      setNext(undefined);
      setLoading(false);
      return;
    }
    // 1. what we already know: shown at once
    const known = await peek(source, query, page);
    if (my !== seq.current) return;
    if (known) {
      setItems((old) => (page === 1 ? known.page.items : [...old, ...known.page.items]));
      setNext(known.page.next);
      setLoading(false);
      if (known.fresh) return;
    } else setLoading(true);
    // 2. ask the catalogue (quietly, if there was something to show)
    try {
      const r = await search(source, query, page);
      if (my !== seq.current) return;
      setItems((old) => (page === 1 ? r.items : [...old.slice(0, (page - 1) * (r.items.length || 20)), ...r.items]));
      setNext(r.next);
    } catch (e) {
      if (my !== seq.current) return;
      if (!known) {
        if (page === 1) setItems([]);
        setErr((e as Error).message || 'Couldn’t reach the catalogue. Are you online?');
      }
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };
  useEffect(() => {
    setItems([]);
    setNext(undefined);
    load(1);
  }, [source, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (it: Item) => {
    if (adding.has(it.id)) return;
    setAdding((a) => new Set(a).add(it.id));
    tap('medium');
    try {
      // the thumbnail is fetched while the file's address is being worked out and while it downloads
      const thumb = fetchThumb(it.cover);
      let g = it.get;
      if (!g && it.source === 'archive') g = await archivePdf(it.id.slice(1));
      if (!g) throw new Error('No free file for this one.');
      const [blob, cover] = await Promise.all([fetchFile(g), thumb]);
      const meta = await importFile(blob, g.name, { title: it.title, author: it.author, cover });
      setAdded((a) => ({ ...a, [it.id]: meta.id }));
      toast('Added to your shelf');
    } catch (e) {
      toast((e as Error).message || 'Couldn’t download that');
    } finally {
      setAdding((a) => {
        const n = new Set(a);
        n.delete(it.id);
        return n;
      });
    }
  };

  return (
    <div className="disc" role="dialog" aria-label="Find free books">
      <div className="disc-top">
        <button className="r-ibtn" onClick={onClose} aria-label="Back">
          <Icon name="back" size={24} />
        </button>
        <h2>Find free books</h2>
      </div>
      <form
        className="disc-search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(text.trim());
        }}
      >
        <Icon name="search" size={18} />
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value) setQ('');
          }}
          placeholder={source === 'papers' ? 'search research papers' : source === 'shop' ? 'a title or author' : 'a title, author or subject'}
          enterKeyHint="search"
        />
      </form>
      <div className="disc-src">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            className={s.id === source ? 'on' : ''}
            onClick={() => {
              setSource(s.id);
              setTopic(0);
              setQ('');
              setText('');
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      {src.topics.length > 0 && (
        <div className="disc-topics">
          {src.topics.map((t, i) => (
            <button
              key={t.label}
              className={!q && i === topic ? 'on' : ''}
              onClick={() => {
                setTopic(i);
                setQ('');
                setText('');
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <p className="disc-note mono">
        {src.sub}
        {source === 'shop' ? ' · only descriptions are shown here; buying or borrowing happens on their site' : ' · free to download'}
      </p>

      <div className="disc-list">
        {items.map((it) => {
          const have = added[it.id];
          const canGet = !!it.get || it.source === 'archive';
          return (
            <div className="disc-row" key={it.id}>
              <ItemCover item={it} />
              <div className="disc-info">
                <div className="name">{it.title}</div>
                {(it.author || it.year) && <div className="by">{[it.author, it.year && !it.author?.includes(String(it.year)) ? it.year : null].filter(Boolean).join(' · ')}</div>}
                {it.blurb && <div className="blurb">{it.blurb}</div>}
                <div className="acts">
                  {it.tag && <span className={`tag mono ${/sale|preview|info/.test(it.tag) ? 'web' : ''}`}>{it.tag}</span>}
                  {canGet ? (
                    have ? (
                      <button className="get done" onClick={() => (onClose(), onOpen(have))}>
                        Open
                      </button>
                    ) : (
                      <button className="get" disabled={adding.has(it.id)} onClick={() => add(it)}>
                        {adding.has(it.id) ? <PixelLoader size={3} gap={2} /> : 'Add'}
                      </button>
                    )
                  ) : null}
                  {it.web && (
                    <button className="web-link" onClick={() => openExternal(it.web!)} aria-label="Open on the web">
                      <Icon name="globe" size={17} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {loading &&
          !items.length &&
          Array.from({ length: 6 }, (_, k) => (
            <div className="disc-row skel" key={k} aria-hidden>
              <div className="disc-cover" />
              <div className="disc-info">
                <div className="bar w70" />
                <div className="bar w40" />
                <div className="bar w90" />
              </div>
            </div>
          ))}
        {loading && !!items.length && (
          <div className="disc-load">
            <PixelLoader grid={4} size={6} />
          </div>
        )}
        {err && (
          <div className="disc-err">
            {err}
            <button onClick={() => load(1)}>Try again</button>
          </div>
        )}
        {!loading && !err && !items.length && <div className="disc-load mono muted">{source === 'shop' && !q ? 'search for a title or an author' : 'nothing found — try another word'}</div>}
        {!loading && next && (
          <button className="pill ghost" style={{ margin: '14px auto 30px', display: 'flex' }} onClick={() => load(next)}>
            More
          </button>
        )}
        <p className="disc-fine mono">
          Frogity only fetches files these sites offer for free (public-domain and open-access works). Rights and licences are the sites’ own — check the page behind the globe icon if you plan to share anything.
        </p>
      </div>
    </div>
  );
}

const hue = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 360;
};

/** The cover from the catalogue when there is a real one; otherwise a clean cover made from the title. */
function ItemCover({ item }: { item: Item }) {
  const [bad, setBad] = useState(!item.cover);
  useEffect(() => setBad(!item.cover), [item.cover]);
  return (
    <div className={`disc-cover${bad ? ' gen' : ''}${item.source === 'papers' ? ' paper' : ''}`} style={bad ? ({ ['--h' as string]: hue(item.title) } as React.CSSProperties) : undefined}>
      {item.cover && !bad && (
        <img
          src={item.cover}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={(e) => {
            const i = e.currentTarget;
            // catalogues sometimes answer with a blank or tiny placeholder: that is not a cover
            if (i.naturalWidth < 60 || i.naturalHeight < 80 || i.naturalWidth / i.naturalHeight > 1.4) setBad(true);
          }}
          onError={() => setBad(true)}
        />
      )}
      {bad && (item.source === 'papers' ? (
        <div className="paper-page" aria-hidden>
          <b>{item.title.length > 70 ? item.title.slice(0, 68) + '…' : item.title}</b>
          <i>{item.author}</i>
          <u /><u /><u /><u /><u className="s" />
        </div>
      ) : (
        <div className="gen-book" aria-hidden>
          <b>{item.title.length > 44 ? item.title.slice(0, 42) + '…' : item.title}</b>
          {item.author && <i>{item.author}</i>}
        </div>
      ))}
    </div>
  );
}
