import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, removeDoc, patchDoc, streakInfo, dayKey, COUNT_MS } from '../lib/store';
import { coverUrl, ago, formatSize, getFile } from '../lib/library';
import { KIND_LABEL } from '../lib/formats/detect';
import type { DocMeta } from '../lib/types';
import { Icon } from '../ui/Icon';
import { Pixel, Screws, Sheet, toast } from '../ui/kit';
import { ASCII } from '../lib/ascii';
import { shareFile, tap } from '../lib/native';

export function useCover(doc?: DocMeta) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (doc) coverUrl(doc).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [doc?.coverId]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

function Cover({ doc, className }: { doc: DocMeta; className?: string }) {
  const url = useCover(doc);
  return <div className={className}>{url && <img src={url} alt="" draggable={false} />}</div>;
}

export function Ring({ value, size = 24, stroke = 2.4 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, value))}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset .6s' }}
      />
    </svg>
  );
}

const FILTERS: { id: string; label: string; kinds?: string[] }[] = [
  { id: 'all', label: 'all' },
  { id: 'reading', label: 'reading' },
  { id: 'pdf', label: 'pdf', kinds: ['pdf'] },
  { id: 'books', label: 'books', kinds: ['epub'] },
  { id: 'docs', label: 'docs', kinds: ['docx', 'odt', 'rtf', 'markdown', 'text', 'html', 'slides', 'scan'] },
  { id: 'data', label: 'data', kinds: ['sheet', 'code'] },
  { id: 'media', label: 'media', kinds: ['image', 'audio', 'video'] },
  { id: 'done', label: 'finished' },
];

export function Library({
  onOpen,
  onAdd,
  onScan,
  onStats,
  onSettings,
  onConvert,
  onSample,
}: {
  onOpen: (id: string) => void;
  onAdd: () => void;
  onScan: () => void;
  onStats: () => void;
  onSettings: () => void;
  onConvert: (doc: DocMeta) => void;
  onSample: () => void;
}) {
  const docs = useStore((s) => s.docs);
  const settings = useStore((s) => s.settings);
  const days = useStore((s) => s.days);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState<string | null>(null);
  const [menu, setMenu] = useState<DocMeta | null>(null);
  const [active, setActive] = useState(0);
  const car = useRef<HTMLDivElement>(null);

  const recent = useMemo(() => docs.filter((d) => !d.finished).slice(0, 8), [docs]);
  const hero = recent[active] ?? recent[0];
  const streak = streakInfo(days);
  const todayMs = days[dayKey()] ?? 0;
  const goal = settings.dailyGoal * 60_000;

  const list = useMemo(() => {
    let l = docs;
    const f = FILTERS.find((x) => x.id === filter);
    if (f?.kinds) l = l.filter((d) => f.kinds!.includes(d.kind));
    if (filter === 'reading') l = l.filter((d) => d.progress > 0.01 && !d.finished);
    if (filter === 'done') l = l.filter((d) => d.finished);
    if (query) {
      const q = query.toLowerCase();
      l = l.filter((d) => d.name.toLowerCase().includes(q) || d.fileName.toLowerCase().includes(q) || (d.author ?? '').toLowerCase().includes(q));
    }
    return l;
  }, [docs, filter, query]);

  // New arrivals: bring the carousel back to the front.
  useEffect(() => {
    car.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }, [recent[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carousel: scale cards by distance from centre.
  useEffect(() => {
    const el = car.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best = 0;
      let bestD = Infinity;
      el.querySelectorAll<HTMLElement>('.slot').forEach((s, i) => {
        const c = s.offsetLeft + s.offsetWidth / 2;
        const d = (c - mid) / s.offsetWidth;
        const ad = Math.min(1.4, Math.abs(d));
        const w = s.firstElementChild as HTMLElement;
        w.style.transform = `translateX(${-d * 14}%) scale(${1 - ad * 0.16}) rotateY(${-d * 10}deg)`;
        w.style.opacity = String(1 - ad * 0.25);
        w.style.filter = ad > 0.5 ? `blur(${(ad - 0.5) * 2}px)` : '';
        if (Math.abs(d) < bestD) {
          bestD = Math.abs(d);
          best = i;
        }
      });
      setActive((a) => {
        if (a !== best) tap('select');
        return best;
      });
    };
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      el.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, [recent.length]);

  const last14 = useMemo(() => {
    const out: boolean[] = [];
    const d = new Date();
    d.setDate(d.getDate() - 13);
    for (let i = 0; i < 14; i++) {
      out.push((days[dayKey(d)] ?? 0) >= COUNT_MS);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [days]);

  const empty = docs.length === 0;

  return (
    <div className="lib">
      <div className="lib-card">
        <div className="lib-top">
          <h1>library</h1>
          <div className="lib-meta">
            <span>@{settings.name}</span>
            <span>
              <span className="hash">#</span> {docs.length}
            </span>
            <span className="sep" />
            <button className="ring-btn" onClick={onStats} aria-label="Reading goal and streak">
              <Ring value={todayMs / goal} size={22} stroke={2} />
            </button>
          </div>
        </div>

        {empty ? (
          <div className="empty">
            <pre>{ASCII.shelf}</pre>
            <h2>A place to read</h2>
            <p>PDFs, books, documents, sheets, scans — opened beautifully, read comfortably, no paywalls.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="pill" onClick={onAdd}>
                <Icon name="plus" size={18} /> Add a file
              </button>
              <button className="pill ghost" onClick={onSample}>
                Try a sample
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="carousel" ref={car}>
              {recent.map((d) => (
                <div className="slot" key={d.id}>
                  <button
                    className="pocket-wrap"
                    onClick={() => {
                      const i = recent.indexOf(d);
                      if (i === active) onOpen(d.id);
                      else car.current?.querySelectorAll('.slot')[i]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                    }}
                    aria-label={`Open ${d.name}`}
                  >
                    <Cover doc={d} className="cover" />
                    <div className="pocket">
                      <Screws />
                      {d.progress > 0.005 && (
                        <div className="pocket-progress">
                          <i style={{ width: `${Math.round(d.progress * 100)}%` }} />
                        </div>
                      )}
                      <div className="pocket-label">{KIND_LABEL[d.kind]}{d.pages ? ` · ${d.pages}p` : ''}</div>
                    </div>
                  </button>
                </div>
              ))}
            </div>
            {hero && (
              <div className="hero-text" key={hero.id} style={{ animation: 'fade .35s' }}>
                <div className="q">
                  <b>“{hero.name}”</b>
                  {hero.author ? ` — ${hero.author}` : ''}
                </div>
                <div className="hint">{hero.progress > 0.01 ? `(${Math.round(hero.progress * 100)}% in, keep going!)` : '(tap 2 read!)'}</div>
              </div>
            )}
            <div className="hero-cta">
              <button className="pill ghost" onClick={() => hero && onOpen(hero.id)} style={{ padding: '0 22px', height: 46, fontSize: 16 }}>
                {hero && hero.progress > 0.01 ? 'Continue' : 'Open Now'}
              </button>
            </div>
          </>
        )}
      </div>

      {!empty && (
        <button className="streak-strip" onClick={onStats}>
          <Pixel name="flame" size={22} />
          <div className="t">
            <b>{streak.current} day{streak.current === 1 ? '' : 's'}</b>
            <span>{todayMs >= goal ? 'today’s page is turned.' : `${Math.max(1, Math.ceil((goal - todayMs) / 60000))} min to today’s goal`}</span>
          </div>
          <div className="blocks" aria-label="Last 14 days">
            {last14.slice(-10).map((on, i) => (
              <i key={i} style={{ opacity: on ? 1 : 0.12 }} />
            ))}
          </div>
        </button>
      )}

      {!empty && (
        <>
          <div className="shelf-head">
            <span className="mono">shelf · {list.length}</span>
            <button className="chip" onClick={() => setQuery((q) => (q === null ? '' : null))} aria-label="Search">
              <Icon name="search" size={18} />
            </button>
          </div>
          <div className="filters">
            {FILTERS.map((f) => (
              <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="shelf">
            {list.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="mono muted">nothing here yet</div>}
            {list.map((d) => (
              <ShelfRow key={d.id} doc={d} onOpen={() => onOpen(d.id)} onMenu={() => setMenu(d)} />
            ))}
          </div>
          <div className="lib-foot">{'· · ·\nquire'}</div>
        </>
      )}
      <div className="lib-pad" />

      {query !== null && (
        <div className="search-bar">
          <Icon name="search" size={18} />
          <input autoFocus placeholder="search your shelf" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="pill sm round ghost" onClick={() => setQuery(null)} aria-label="Close search">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <div className="dock">
        <button className="pill" onClick={onAdd} style={{ paddingLeft: 16 }}>
          <Icon name="plus" size={18} /> Add
        </button>
        <button className="pill round" onClick={onScan} aria-label="Scan a document">
          <Pixel name="scan" size={18} />
        </button>
        <button className="pill round" onClick={onStats} aria-label="Streak and stats">
          <Pixel name="sprout" size={18} />
        </button>
        <button className="pill round" onClick={onSettings} aria-label="Settings">
          <Pixel name="sun" size={18} />
        </button>
      </div>

      <DocMenu doc={menu} onClose={() => setMenu(null)} onOpen={onOpen} onConvert={onConvert} />
    </div>
  );
}

function ShelfRow({ doc, onOpen, onMenu }: { doc: DocMeta; onOpen: () => void; onMenu: () => void }) {
  const press = useRef<number>(0);
  return (
    <button
      className="shelf-row"
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu();
      }}
      onTouchStart={() => {
        press.current = window.setTimeout(() => {
          tap('medium');
          onMenu();
        }, 520);
      }}
      onTouchEnd={() => clearTimeout(press.current)}
      onTouchMove={() => clearTimeout(press.current)}
    >
      <Cover doc={doc} className="thumb" />
      <div className="info">
        <div className="name">{doc.name}</div>
        <div className="sub">
          {KIND_LABEL[doc.kind]}
          {doc.finished ? ' · finished' : doc.progress > 0.01 ? ` · ${Math.round(doc.progress * 100)}%` : ''} · {ago(doc.openedAt)}
        </div>
        {doc.progress > 0.01 && !doc.finished && (
          <div className="minibar">
            <i style={{ width: `${doc.progress * 100}%` }} />
          </div>
        )}
      </div>
      <span
        className="dots"
        role="button"
        aria-label="More"
        onClick={(e) => {
          e.stopPropagation();
          onMenu();
        }}
      >
        <Icon name="more" size={20} stroke={2.6} />
      </span>
    </button>
  );
}

function DocMenu({ doc, onClose, onOpen, onConvert }: { doc: DocMeta | null; onClose: () => void; onOpen: (id: string) => void; onConvert: (d: DocMeta) => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setRenaming(false);
    setConfirm(false);
    setName(doc?.name ?? '');
  }, [doc]);
  const d = doc;
  return (
    <Sheet open={!!doc} onClose={onClose} title={d ? <span className="mono" style={{ fontSize: 15 }}>{d.name.length > 26 ? d.name.slice(0, 26) + '…' : d.name}</span> : ''}>
      {d && (
        <div className="sheet-body">
          <div className="mono muted" style={{ fontSize: 12, textAlign: 'center', marginTop: -6, marginBottom: 10 }}>
            {d.fileName} · {formatSize(d.size)}
          </div>
          {renaming ? (
            <form
              style={{ display: 'flex', gap: 8, padding: '8px 0 16px' }}
              onSubmit={async (e) => {
                e.preventDefault();
                await patchDoc(d.id, { name: name.trim() || d.name });
                toast('Renamed');
                onClose();
              }}
            >
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, height: 46, borderRadius: 14, border: '1px solid var(--line-2)', padding: '0 14px', background: 'var(--surface-2)' }} />
              <button className="pill">Save</button>
            </form>
          ) : (
            <div className="actions">
              <button className="action" onClick={() => (onClose(), onOpen(d.id))}>
                <span className="ic">
                  <Icon name="book" />
                </span>
                Open
              </button>
              <button className="action" onClick={() => (onClose(), onConvert(d))}>
                <span className="ic">
                  <Pixel name="convert" size={16} />
                </span>
                Convert…
              </button>
              <button className="action" onClick={() => setRenaming(true)}>
                <span className="ic">
                  <Icon name="edit" />
                </span>
                Rename
              </button>
              <button
                className="action"
                onClick={async () => {
                  const f = await getFile(d.id);
                  if (f) await shareFile(f, d.fileName).catch(() => {});
                }}
              >
                <span className="ic">
                  <Icon name="share" />
                </span>
                Share original
              </button>
              <button
                className="action"
                onClick={async () => {
                  await patchDoc(d.id, { finished: !d.finished, progress: d.finished ? d.progress : 1 });
                  toast(d.finished ? 'Back on the reading pile' : 'Finished. Nicely done.');
                  onClose();
                }}
              >
                <span className="ic">
                  <Pixel name="check" size={16} />
                </span>
                {d.finished ? 'Mark as unread' : 'Mark as finished'}
              </button>
              <button
                className="action danger"
                onClick={async () => {
                  if (!confirm) return setConfirm(true);
                  await removeDoc(d.id);
                  toast('Removed from shelf');
                  onClose();
                }}
              >
                <span className="ic">
                  <Icon name="trash" />
                </span>
                {confirm ? 'Tap again to remove' : 'Remove'}
              </button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
