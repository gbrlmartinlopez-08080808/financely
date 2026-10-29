import { useEffect, useRef, useState } from 'react';
import { SOURCES, archivePdf, fetchFile, search, type Item, type SourceId } from '../lib/catalog';
import { importFile } from '../lib/library';
import { patchDoc } from '../lib/store';
import { onBack, openExternal, tap } from '../lib/native';
import { Icon } from '../ui/Icon';
import { PixelLoader, toast } from '../ui/kit';

export function Discover({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const [source, setSource] = useState<SourceId>('books');
  const [topic, setTopic] = useState(0);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, string>>({}); // item id → doc id
  const seq = useRef(0);
  const src = SOURCES.find((s) => s.id === source)!;
  const query = q || src.topics[topic]?.q || '';

  useEffect(() => onBack(() => (onClose(), true)), [onClose]);

  const load = async (page: number) => {
    const my = ++seq.current;
    setLoading(true);
    setErr(null);
    try {
      const r = await search(source, query, page);
      if (my !== seq.current) return;
      setItems((old) => (page === 1 ? r.items : [...old, ...r.items]));
      setNext(r.next);
    } catch (e) {
      if (my !== seq.current) return;
      if (page === 1) setItems([]);
      setErr((e as Error).message || 'Couldn’t reach the catalogue. Are you online?');
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
    if (adding) return;
    setAdding(it.id);
    tap('medium');
    try {
      let g = it.get;
      if (!g && it.source === 'archive') g = await archivePdf(it.id.slice(1));
      if (!g) throw new Error('No free file for this one.');
      const blob = await fetchFile(g.url);
      const meta = await importFile(blob, g.name, { title: it.title });
      if (it.author && !meta.author) await patchDoc(meta.id, { author: it.author });
      setAdded((a) => ({ ...a, [it.id]: meta.id }));
      toast('Added to your shelf');
    } catch (e) {
      toast((e as Error).message || 'Couldn’t download that');
    } finally {
      setAdding(null);
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
              <div className="disc-cover">{it.cover ? <img src={it.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} /> : null}<span aria-hidden>{it.title.slice(0, 1)}</span></div>
              <div className="disc-info">
                <div className="name">{it.title}</div>
                {it.author && <div className="by">{it.author}</div>}
                {it.blurb && <div className="blurb">{it.blurb}</div>}
                <div className="acts">
                  {it.tag && <span className={`tag mono ${/sale|preview|info/.test(it.tag) ? 'web' : ''}`}>{it.tag}</span>}
                  {canGet ? (
                    have ? (
                      <button className="get done" onClick={() => (onClose(), onOpen(have))}>
                        Open
                      </button>
                    ) : (
                      <button className="get" disabled={!!adding} onClick={() => add(it)}>
                        {adding === it.id ? <PixelLoader size={3} gap={2} /> : 'Add'}
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
        {loading && (
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
          Quire only fetches files these sites offer for free (public-domain and open-access works). Rights and licences are the sites’ own — check the page behind the globe icon if you plan to share anything.
        </p>
      </div>
    </div>
  );
}
