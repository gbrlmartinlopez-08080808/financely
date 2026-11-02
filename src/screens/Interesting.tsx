import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readArticle, type Article } from '../lib/article';
import { wikiArticle, type WikiDoc } from '../lib/wikiarticle';
import {
  agoShort,
  articleOfWeek,
  coverage,
  factOfDay,
  KIND_WORD,
  leanWord,
  loadDaily,
  outletOf,
  wikiUrl,
  type Card,
  type Daily,
  type HistoryEvent,
  type Outlet,
  type Read,
  type Story,
  type Topic,
  type WeekPick,
} from '../lib/interesting';
import { moodFor, type Mood } from '../lib/froggy';
import { updateSettings, useStore } from '../lib/store';
import { isGuide } from '../lib/harvest';
import { onBack, openExternal, tap } from '../lib/native';
import type { DocMeta } from '../lib/types';
import { AskSheet } from '../reader/Ask';
import { Froggy } from '../ui/Froggy';
import { Play } from './Games';
import { Icon } from '../ui/Icon';
import { PixelLoader, Segmented, Sheet, toast } from '../ui/kit';

type Tab = 'today' | 'news' | 'you' | 'play';
type Chip = { label: string; q: string };

/** Library · Interesting: the two halves of the home screen, switched with the title. */
export function HomeTabs({ active, onPick }: { active: 'library' | 'interesting'; onPick: (t: 'library' | 'interesting') => void }) {
  return (
    <div className="home-tabs" role="tablist">
      <button role="tab" aria-selected={active === 'library'} className={active === 'library' ? 'on' : ''} onClick={() => active !== 'library' && (tap('select'), onPick('library'))}>
        library
      </button>
      <button role="tab" aria-selected={active === 'interesting'} className={active === 'interesting' ? 'on' : ''} onClick={() => active !== 'interesting' && (tap('select'), onPick('interesting'))}>
        <span className="frogmark mono" aria-hidden>
          (@)
        </span>
        interesting
      </button>
    </div>
  );
}

/**
 * A photograph shown whole: never cropped to a corner. It keeps its own shape (within reason) and, where the frame is
 * wider or taller than the picture, the same picture softly blurred fills the space, so the frame always looks finished.
 */
function Photo({ src, w, h, fill = false, className = '' }: { src?: string; w?: number; h?: number; fill?: boolean; className?: string }) {
  const [ratio, setRatio] = useState<number | undefined>(w && h ? w / h : undefined);
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div className={`photo empty ${fill ? 'fill' : ''} ${className}`} aria-hidden />;
  const ar = Math.max(0.7, Math.min(1.78, ratio ?? 1.5));
  return (
    <div className={`photo ${fill ? 'fill' : ''} ${className}`} style={fill ? undefined : { aspectRatio: String(ar) }}>
      <img className="bg" src={src} alt="" aria-hidden referrerPolicy="no-referrer" />
      <img className="fg" src={src} alt="" decoding="async" referrerPolicy="no-referrer" draggable={false} onLoad={(e) => !ratio && setRatio(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight))} onError={() => setBad(true)} />
    </div>
  );
}

/** an outlet's logo (from the feed), or its first letter when there is none */
function Logo({ o, size = 22 }: { o: Pick<Outlet, 'name' | 'logo'>; size?: number }) {
  const [bad, setBad] = useState(false);
  const st = { width: size, height: size, fontSize: size * 0.46 };
  return o.logo && !bad ? <img className="logo" src={o.logo} alt="" title={o.name} style={st} onError={() => setBad(true)} draggable={false} /> : <span className="logo ph mono" style={st} aria-hidden>{o.name[0]}</span>;
}

/** text in which the names that have a Wikipedia article can be tapped (the first time each appears) */
function Linked({ text, terms, onWiki }: { text: string; terms?: { t: string; w: string }[]; onWiki: (title: string) => void }) {
  const parts = useMemo(() => {
    const spans: { a: number; b: number; w: string }[] = [];
    for (const { t, w } of [...(terms ?? [])].sort((x, y) => y.t.length - x.t.length)) {
      const i = text.indexOf(t);
      if (i >= 0 && !spans.some((s) => i < s.b && i + t.length > s.a)) spans.push({ a: i, b: i + t.length, w });
    }
    spans.sort((x, y) => x.a - y.a);
    const out: (string | { t: string; w: string })[] = [];
    let at = 0;
    for (const s of spans) {
      out.push(text.slice(at, s.a), { t: text.slice(s.a, s.b), w: s.w });
      at = s.b;
    }
    out.push(text.slice(at));
    return out;
  }, [text, terms]);
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <button key={i} className="wlink" onClick={() => onWiki(p.w)}>
            {p.t}
          </button>
        ),
      )}
    </>
  );
}

/** the same, inside an article's HTML */
function linkHtml(html: string, terms?: { t: string; w: string }[]) {
  if (!terms?.length) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const todo = new Map(terms.map((x) => [x.t, x.w]));
  const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!(n.parentElement?.closest('a, h1, h2, h3, button'))) nodes.push(n as Text);
  for (const node of nodes) {
    for (const [t, w] of todo) {
      const i = node.data.indexOf(t);
      if (i < 0) continue;
      const mid = node.splitText(i);
      const after = mid.splitText(t.length);
      const a = doc.createElement('a');
      a.setAttribute('href', '#wiki:' + w);
      a.className = 'wl';
      a.textContent = t;
      mid.replaceWith(a);
      todo.delete(t);
      nodes.push(after);
      break;
    }
  }
  return doc.body.innerHTML;
}

const TOPIC_LABEL: Record<Topic, string> = { world: 'World', science: 'Science', tech: 'Technology', health: 'Health', culture: 'Culture', environment: 'Environment', sport: 'Sport', business: 'Business', good: 'Good news' };
const NEWS_CHIPS: Chip[] = [
  { label: 'The context', q: 'Give me the background I need to understand this story.' },
  { label: 'Both sides', q: 'What are the main perspectives on this, and what does each side say?' },
  { label: 'Why it matters', q: 'Why does this matter, and to whom?' },
  { label: 'Explain simply', q: 'Explain this simply, as if to a curious twelve-year-old.' },
  { label: 'What next', q: 'What could happen next?' },
];
const READ_CHIPS: Chip[] = [
  { label: 'Summarise', q: 'Summarise this in a few sentences.' },
  { label: 'Explain simply', q: 'Explain this simply, as if to a curious twelve-year-old.' },
  { label: 'Why it matters', q: 'Why does this matter?' },
  { label: 'Quiz me', q: 'Quiz me on this: ask me three questions, one at a time. Start with the first.' },
  { label: 'Read next', q: 'What should I read next to understand this better, and why?' },
];

type Detail =
  | { kind: 'wiki'; stack: string[]; note?: string }
  | { kind: 'story'; story: Story; open?: number }
  | { kind: 'event'; ev: HistoryEvent }
  | { kind: 'read'; read: Read }
  | { kind: 'picture'; card: Card }
  | { kind: 'method' };
type AskCtx = { id: string; title: string; text: string; chips?: Chip[] };

export function Interesting({ docs, onSwitch, onFindBooks }: { docs: DocMeta[]; onSwitch: () => void; onFindBooks: (q: string) => void }) {
  const aiOk = useStore((s) => s.settings.aiOk);
  const [tab, setTab] = useState<Tab>('today');
  const [daily, setDaily] = useState<{ data: Daily; offline: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [ask, setAsk] = useState<AskCtx | null>(null);
  const [out, setOut] = useState(false);

  const load = useCallback((force = false) => {
    setErr(null);
    loadDaily((r) => setDaily({ data: r.data, offline: r.offline }), force).then(
      (r) => setDaily((old) => old ?? { data: r.data, offline: r.offline }),
      (e) => setErr((e as Error).message),
    );
  }, []);
  useEffect(() => load(), [load]);
  useEffect(
    () =>
      onBack(() => {
        setOut(true);
        setTimeout(onSwitch, 180);
        return true;
      }),
    [onSwitch],
  );

  const mood: Mood = useMemo(() => moodFor(new Date().toDateString()), []);
  const book = docs.find((d) => !isGuide(d) && !d.finished && !['image', 'audio', 'video'].includes(d.kind)) ?? docs.find((d) => !isGuide(d));
  const askAbout = (a: AskCtx) => {
    setDetail(null);
    setTimeout(() => setAsk(a), 120);
  };
  const wiki = (title: string, note?: string) => setDetail({ kind: 'wiki', stack: [title], note });

  return (
    <div className={`int${out ? ' out' : ''}`}>
      <header className="int-head">
        <HomeTabs
          active="interesting"
          onPick={(t) => {
            if (t === 'library') {
              setOut(true);
              setTimeout(onSwitch, 180);
            }
          }}
        />
        <Segmented
          className="int-seg"
          light
          value={tab}
          onChange={setTab}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'news', label: 'News' },
            { value: 'you', label: 'For you' },
            { value: 'play', label: 'Play' },
          ]}
        />
      </header>

      {tab !== 'play' && !daily && !err && (
        <div className="int-wait">
          <Froggy mood="sleepy" size="md" />
          <PixelLoader size={4} gap={2} label="fetching today" />
        </div>
      )}
      {tab !== 'play' && err && (
        <div className="int-wait">
          <Froggy mood="worried" size="md" />
          <p>{err}</p>
          <button className="pill" onClick={() => load(true)}>
            Try again
          </button>
        </div>
      )}

      {daily && tab === 'today' && <Today d={daily.data} offline={daily.offline} mood={mood} setDetail={setDetail} wiki={wiki} onRefresh={() => load(true)} />}
      {daily && tab === 'news' && <News d={daily.data} setDetail={setDetail} />}
      {tab === 'play' && <Play />}
      {tab === 'you' && <ForYou book={book} d={daily?.data} setDetail={setDetail} wiki={wiki} />}

      <Sheet open={!!detail} onClose={() => setDetail(null)} className="int-sheet">
        {detail && <DetailBody det={detail} d={daily?.data} setDetail={setDetail} onAsk={askAbout} onFindBooks={(q) => (setDetail(null), onFindBooks(q))} />}
      </Sheet>
      <AskSheet open={!!ask} onClose={() => setAsk(null)} title={ask?.title ?? ''} docId={ask?.id ?? 'x'} chips={ask?.chips} getText={async () => ask?.text ?? ''} aiOk={aiOk} onConsent={() => updateSettings({ aiOk: true })} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------- today
function Today({ d, offline, mood, setDetail, wiki, onRefresh }: { d: Daily; offline: boolean; mood: Mood; setDetail: (x: Detail) => void; wiki: (t: string, note?: string) => void; onRefresh: () => void }) {
  const fact = factOfDay();
  const date = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const kinds = ['long', 'curious', 'article'] as const;
  const worth = kinds.map((k) => d.reads?.find((r) => r.kind === k)).filter((x): x is Read => !!x);
  return (
    <div className="int-scroll">
      <div className="int-hello">
        <Froggy mood={mood} size="sm" />
        <div>
          <b>{date}</b>
          <span className="mono">{offline ? 'offline · showing the last copy' : 'fresh today · free for everyone'}</span>
        </div>
        <button className="int-refresh" aria-label="Refresh" onClick={onRefresh}>
          <Icon name="undo" size={17} />
        </button>
      </div>

      {d.figure && (
        <button className="tcard bio" onClick={() => wiki(d.figure!.title, `Born ${d.figure!.year}`)}>
          <div className="bio-top">
            <Photo src={d.figure.image} w={d.figure.iw} h={d.figure.ih} className="bio-photo" />
            <div className="bio-head">
              <span className="tag mono">figure of the day · {d.figure.year}</span>
              <h3>{d.figure.title}</h3>
              <p className="sub">{d.figure.description}</p>
            </div>
          </div>
          <p className="ext long">{d.figure.extract}</p>
          <span className="more mono">read the full biography →</span>
        </button>
      )}

      <div className="tcard fact">
        <Froggy mood="bigSmile" size="sm" />
        <span className="tag mono">fact of the day</span>
        <p>{fact.text}</p>
        <button className="srcline mono" onClick={() => wiki(fact.wiki)}>
          read more · {fact.wiki} →
        </button>
      </div>

      {!!d.history?.length && (
        <div className="tcard history">
          <span className="tag mono">on this day in history · tap one to explore it</span>
          <ul>
            {d.history.map((h, i) => (
              <li key={i}>
                <button onClick={() => setDetail({ kind: 'event', ev: h })}>
                  <b className="mono">{h.year}</b>
                  <span>{h.text}</span>
                  <Icon name="right" size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.picture?.image && (
        <button className="tcard picture" onClick={() => setDetail({ kind: 'picture', card: { ...d.picture!, extract: d.picture!.description } })}>
          <Photo src={d.picture.image} />
          <div className="pcap">
            <span className="tag mono">picture of the day</span>
            <p>{(d.picture.description || d.picture.title).slice(0, 160)}</p>
          </div>
        </button>
      )}

      {d.featured && (
        <button className="tcard featured" onClick={() => wiki(d.featured!.title)}>
          <Photo src={d.featured.image} w={d.featured.iw} h={d.featured.ih} />
          <div className="tcard-body">
            <span className="tag mono">wikipedia’s article of the day</span>
            <h3>{d.featured.title}</h3>
            <p className="sub">{d.featured.description}</p>
            <p className="ext long">{d.featured.extract}</p>
            <span className="more mono">read the full article →</span>
          </div>
        </button>
      )}

      {!!worth.length && (
        <div className="tcard readlist">
          <span className="tag mono">worth your time</span>
          <ul>
            {worth.map((r) => (
              <li key={r.id}>
                <ReadRow r={r} d={d} onOpen={() => setDetail({ kind: 'read', read: r })} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!d.mostread?.length && (
        <div className="tcard more">
          <span className="tag mono">what the world is reading on wikipedia today</span>
          <ul>
            {d.mostread.slice(0, 5).map((m) => (
              <li key={m.title}>
                <button onClick={() => wiki(m.title)}>
                  <span>
                    <b>{m.title}</b>
                    <small>{m.description}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="int-foot mono">· · ·{'\n'}everything here is free, public and the same for everyone</p>
    </div>
  );
}

function ReadRow({ r, d, onOpen }: { r: Read; d: Daily; onOpen: () => void }) {
  const o = d.sources?.[r.source];
  return (
    <button className="rrow" onClick={onOpen}>
      <Photo src={r.image} w={r.iw} h={r.ih} className="rphoto" />
      <span className="rtext">
        <span className="rmeta mono">
          {o && <Logo o={o} size={16} />}
          {o?.name ?? ''} · {r.kind === 'long' ? 'long read' : r.kind === 'curious' ? 'curious' : 'article'}
        </span>
        <b>{r.title}</b>
        <small>{r.summary}</small>
      </span>
    </button>
  );
}

// ------------------------------------------------------------------------------------------------------- news reels
function News({ d, setDetail }: { d: Daily; setDetail: (x: Detail) => void }) {
  const [topic, setTopic] = useState<'all' | Topic>('all');
  const topics = useMemo(() => [...new Set(d.news.map((s) => s.topic).filter((x): x is Topic => !!x))], [d]);
  const list = topic === 'all' ? d.news : d.news.filter((s) => s.topic === topic);
  return (
    <div className="news">
      {topics.length > 1 && (
        <div className="topics" role="tablist">
          {(['all', ...topics] as const).map((t) => (
            <button key={t} role="tab" aria-selected={topic === t} className={topic === t ? 'on' : ''} onClick={() => (tap('select'), setTopic(t))}>
              {t === 'all' ? 'All' : TOPIC_LABEL[t]}
            </button>
          ))}
        </div>
      )}
      <Reels key={topic} d={d} stories={list} setDetail={setDetail} />
    </div>
  );
}

function Reels({ d, stories, setDetail }: { d: Daily; stories: Story[]; setDetail: (x: Detail) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es)
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            const i = Number((e.target as HTMLElement).dataset.i);
            setAt((a) => {
              if (a !== i) tap('select');
              return i;
            });
          }
      },
      { root: el, threshold: [0.6] },
    );
    el.querySelectorAll('.reel').forEach((r) => io.observe(r));
    return () => io.disconnect();
  }, [stories]);
  const go = (i: number) => box.current?.querySelectorAll('.reel')[Math.max(0, Math.min(stories.length - 1, i))]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="reels-wrap">
      <div className="reels" ref={box}>
        {stories.map((s, i) => {
          const outs = s.sources.map((x) => outletOf(d, x));
          return (
            <article className={`reel${at === i ? ' act' : ''}`} key={s.id} data-i={i}>
              <div className="reel-img">
                <Photo src={s.image} w={s.iw} h={s.ih} fill />
                <span className="reel-count mono">
                  {i + 1} / {stories.length}
                </span>
                <span className="reel-credit mono">photo · {s.imageFrom}</span>
              </div>
              <div className="reel-body">
                <div className="reel-meta mono">
                  <span className="logos">
                    {outs.slice(0, 5).map((o) => (
                      <Logo key={o.id} o={o} size={20} />
                    ))}
                  </span>
                  {s.topic && <b>{TOPIC_LABEL[s.topic]}</b>}
                  <span>
                    {agoShort(s.time)} · {outs.length > 1 ? `${outs.length} outlets` : outs[0].name}
                  </span>
                </div>
                <h2>{s.title}</h2>
                <p>{s.summary}</p>
                <div className="reel-act">
                  <button className="pill" onClick={() => setDetail({ kind: 'story', story: s })}>
                    Read more
                  </button>
                  <button className="pill ghost" onClick={() => setDetail({ kind: 'story', story: s, open: 0 })}>
                    Full story
                  </button>
                </div>
                {i === 0 && <p className="reel-hint mono">swipe up for the next ↑</p>}
              </div>
            </article>
          );
        })}
        <div className="reel-end">
          <Froggy mood="sleepy" size="md" />
          <p>That is the news for now. Froggy will have more later.</p>
          <button className="pill ghost" onClick={() => go(0)}>
            Back to the first
          </button>
          <button className="srcline mono" onClick={() => setDetail({ kind: 'method' })}>
            how stories are chosen
          </button>
        </div>
      </div>
      {stories.length <= 24 && (
        <div className="reel-dots" aria-hidden>
          {stories.map((_, i) => (
            <i key={i} className={i === at ? 'on' : ''} />
          ))}
        </div>
      )}
      <button className="reel-info" onClick={() => setDetail({ kind: 'method' })} aria-label="How stories are chosen">
        <Icon name="info" size={18} />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------- for you
type Sub = 'week' | 'articles' | 'curious' | 'long';
function ForYou({ book, d, setDetail, wiki }: { book?: DocMeta; d?: Daily; setDetail: (x: Detail) => void; wiki: (t: string, note?: string) => void }) {
  const [sub, setSub] = useState<Sub>('week');
  const [pick, setPick] = useState<WeekPick | null | undefined>();
  useEffect(() => {
    let alive = true;
    setPick(undefined);
    articleOfWeek(book).then(
      (p) => alive && setPick(p),
      () => alive && setPick(null),
    );
    return () => {
      alive = false;
    };
  }, [book?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const reads = (k: Read['kind']) => d?.reads?.filter((r) => r.kind === k) ?? [];
  return (
    <div className="int-scroll">
      <div className="topics inline" role="tablist">
        {(
          [
            ['week', 'Article of the week'],
            ['articles', 'Articles'],
            ['curious', 'Curious things'],
            ['long', 'Long reads'],
          ] as const
        ).map(([v, l]) => (
          <button key={v} role="tab" aria-selected={sub === v} className={sub === v ? 'on' : ''} onClick={() => (tap('select'), setSub(v))}>
            {l}
          </button>
        ))}
      </div>

      {sub === 'week' && (
        <>
          {pick === undefined && (
            <div className="int-wait inline">
              <Froggy mood="dizzy" size="sm" />
              <PixelLoader size={4} gap={2} label="looking for something you will like" />
            </div>
          )}
          {pick === null && (
            <>
              <div className="int-wait inline">
                <Froggy mood={book ? 'worried' : 'wink'} size="md" />
                <p>{book ? 'Froggy could not find a good match this week — it will look again soon.' : 'Open a book and Froggy will pick an article that goes with it, a new one each week. Until then, here is Wikipedia’s article of the day.'}</p>
              </div>
              {d?.featured && (
                <button className="tcard figure big" onClick={() => wiki(d.featured!.title)}>
                  <Photo src={d.featured.image} w={d.featured.iw} h={d.featured.ih} />
                  <div className="tcard-body">
                    <h3>{d.featured.title}</h3>
                    <p className="sub">{d.featured.description}</p>
                    <p className="ext long">{d.featured.extract}</p>
                    <span className="more mono">read the full article →</span>
                  </div>
                </button>
              )}
            </>
          )}
          {pick && (
            <>
              <p className="int-because mono">article of the week · because you are reading “{pick.because.length > 34 ? pick.because.slice(0, 34) + '…' : pick.because}”</p>
              <button className="tcard figure big" onClick={() => wiki(pick.article.title, `Because you are reading “${pick.because}”`)}>
                <Photo src={pick.article.image} w={pick.article.iw} h={pick.article.ih} />
                <div className="tcard-body">
                  <h3>{pick.article.title}</h3>
                  <p className="sub">{pick.article.description}</p>
                  <p className="ext long">{pick.article.extract}</p>
                  <span className="more mono">read the full article →</span>
                </div>
              </button>
              {!!pick.more.length && (
                <div className="tcard more">
                  <span className="tag mono">more along these lines</span>
                  <ul>
                    {pick.more.map((m) => (
                      <li key={m.title}>
                        <button onClick={() => wiki(m.title)}>
                          <span>
                            <b>{m.title}</b>
                            <small>{m.description}</small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </>
      )}

      {sub !== 'week' && d && (
        <>
          {sub === 'curious' && !!d.mostread?.length && (
            <div className="tcard more">
              <span className="tag mono">what the world is reading on wikipedia today</span>
              <ul>
                {d.mostread.map((m) => (
                  <li key={m.title}>
                    <button onClick={() => wiki(m.title)}>
                      <span>
                        <b>{m.title}</b>
                        <small>{m.description}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {reads(sub === 'articles' ? 'article' : sub).map((r) => (
            <div className="tcard readcard" key={r.id}>
              <ReadRow r={r} d={d} onOpen={() => setDetail({ kind: 'read', read: r })} />
            </div>
          ))}
          {!reads(sub === 'articles' ? 'article' : sub).length && sub !== 'curious' && (
            <div className="int-wait inline">
              <Froggy mood="sleepy" size="md" />
              <p>Nothing new here yet. Froggy checks again a few times a day.</p>
            </div>
          )}
        </>
      )}
      <p className="int-foot mono">· · ·{'\n'}articles, curiosities and long reads from around the web, always credited</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------- the sheet
function DetailBody({ det, d, setDetail, onAsk, onFindBooks }: { det: Detail; d?: Daily; setDetail: (x: Detail | null) => void; onAsk: (a: AskCtx) => void; onFindBooks: (q: string) => void }) {
  if (det.kind === 'wiki') return <WikiReader det={det} setDetail={setDetail} onAsk={onAsk} onFindBooks={onFindBooks} />;
  if (det.kind === 'story' && d) return <StoryDetail s={det.story} start={det.open} d={d} setDetail={setDetail} onAsk={onAsk} />;
  if (det.kind === 'event') return <EventDetail ev={det.ev} setDetail={setDetail} onAsk={onAsk} />;
  if (det.kind === 'read' && d) return <ReadDetail r={det.read} d={d} setDetail={setDetail} onAsk={onAsk} />;
  if (det.kind === 'picture') {
    const c = det.card;
    return (
      <div className="sheet-body int-detail">
        <Photo src={c.image} className="dimg" />
        <span className="tag mono">picture of the day</span>
        <h3>{c.title}</h3>
        <p>{c.extract}</p>
        {c.credit && <p className="credit mono">credit · {c.credit}</p>}
        <div className="det-act">
          <button className="pill ghost" onClick={() => onAsk({ id: 'pic:' + c.title, title: c.title, text: `${c.title}. ${c.extract ?? ''}`, chips: READ_CHIPS })}>
            Ask Froggy
          </button>
          {c.url && (
            <button className="pill ghost" onClick={() => openExternal(c.url!)}>
              Source: Wikimedia Commons ↗
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="sheet-body int-detail">
      <Froggy mood="smug" size="md" className="inline" />
      <h3>How the news is chosen</h3>
      <p>Froggy has no editors and does not pick sides. A few times a day, one shared list is built from the public feeds of more than twenty outlets on every continent: public broadcasters, independent papers, and commercial outlets from the left, the centre and the right, plus science, technology and good-news sources.</p>
      <p>The same story in several outlets becomes one card that names each of them. Stories that more outlets reported, in more parts of the world and across the political spectrum, come first. A mix of topics is kept on purpose, so the day is not only bad news: no more than about a third of the cards are heavy.</p>
      <p>Each outlet has a rough position (left, centre, right) taken from public media-bias ratings. They are approximations, often disputed — a prompt to compare how different outlets tell a story, never a verdict.</p>
      <p>Only a headline, a short summary and a credited picture are shown. The full story is fetched from the outlet when you ask for it, and every card links back to its source.</p>
    </div>
  );
}

/** the whole of a Wikipedia article, in the app; its links lead to other articles, and back */
function WikiReader({ det, setDetail, onAsk, onFindBooks }: { det: Extract<Detail, { kind: 'wiki' }>; setDetail: (x: Detail | null) => void; onAsk: (a: AskCtx) => void; onFindBooks: (q: string) => void }) {
  const title = det.stack[det.stack.length - 1];
  const [doc, setDoc] = useState<WikiDoc | null>(null);
  const [err, setErr] = useState('');
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    setDoc(null);
    setErr('');
    top.current?.scrollIntoView({ block: 'start' });
    wikiArticle(title).then(
      (x) => alive && setDoc(x),
      (e) => alive && setErr((e as Error).message || 'Could not open that article.'),
    );
    return () => {
      alive = false;
    };
  }, [title]);
  const go = (t: string) => setDetail({ ...det, stack: [...det.stack, t] });
  const back = () => setDetail({ ...det, stack: det.stack.slice(0, -1) });
  const plain = () => (doc ? new DOMParser().parseFromString(doc.html, 'text/html').body.textContent ?? '' : '');
  return (
    <div className="sheet-body int-detail story wk" ref={top}>
      <div className="story-bar">
        {det.stack.length > 1 ? (
          <button className="mono" onClick={back}>
            ← {det.stack[det.stack.length - 2]}
          </button>
        ) : (
          <span className="mono muted">{det.note ?? 'wikipedia · free encyclopedia'}</span>
        )}
      </div>
      <h3>{doc?.title ?? title}</h3>
      {doc?.description && <p className="sub">{doc.description}</p>}
      {!doc && !err && (
        <div className="int-wait inline">
          <Froggy mood="dizzy" size="sm" />
          <PixelLoader size={4} gap={2} label="opening the article" />
        </div>
      )}
      {err && (
        <div className="int-wait inline">
          <Froggy mood="worried" size="md" />
          <p>{err}</p>
          <button className="pill ghost" onClick={() => openExternal(wikiUrl(title))}>
            Open in the browser
          </button>
        </div>
      )}
      {doc && (
        <>
          {doc.image && <Photo src={doc.image} w={doc.iw} h={doc.ih} className="wk-lead" />}
          <p className="byline mono">
            Wikipedia · {Math.max(1, Math.round(doc.words / 220))} min read
          </p>
          <div
            className="article wk-body"
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a[href^="#wiki:"]');
              if (!a) return;
              e.preventDefault();
              go(decodeURIComponent((a.getAttribute('href') ?? '').slice(6)));
            }}
            dangerouslySetInnerHTML={{ __html: doc.html }}
          />
          {!!doc.next.length && (
            <>
              <div className="tag mono" style={{ marginTop: 18 }}>
                keep exploring
              </div>
              <div className="chips-row">
                {doc.next.map((n) => (
                  <button key={n} className="chip-link" onClick={() => go(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="det-act">
            <button className="pill" onClick={() => onAsk({ id: 'wiki:' + doc.title, title: doc.title, text: `${doc.title}. ${doc.description}\n\n${plain().slice(0, 9000)}`, chips: READ_CHIPS })}>
              Ask Froggy
            </button>
            {det.stack.length === 1 && (
              <button className="pill ghost" onClick={() => onFindBooks(doc.title)}>
                Find free books
              </button>
            )}
          </div>
          <span className="srcline mono static">source · Wikipedia — text free to share under CC BY-SA</span>
          <button className="srcline mono" onClick={() => openExternal(doc.url)}>
            open the original page ↗
          </button>
        </>
      )}
    </div>
  );
}

/** a day in history: what happened, who and what it touched, and a way into each */
function EventDetail({ ev, setDetail, onAsk }: { ev: HistoryEvent; setDetail: (x: Detail | null) => void; onAsk: (a: AskCtx) => void }) {
  const ago = new Date().getFullYear() - ev.year;
  return (
    <div className="sheet-body int-detail">
      <span className="tag mono">
        on this day · {ev.year} · {ago} years ago
      </span>
      <p className="ev-text">{ev.text}</p>
      {ev.pages?.map((p) => (
        <button key={p.title} className="evpage" onClick={() => setDetail({ kind: 'wiki', stack: [p.title], note: `On this day, ${ev.year}` })}>
          <Photo src={p.image} w={p.iw} h={p.ih} className="evphoto" />
          <span>
            <b>{p.title}</b>
            <small>{p.description}</small>
            <em>{p.extract}</em>
            <span className="more mono">read the full article →</span>
          </span>
        </button>
      ))}
      <button className="pill ghost wide" onClick={() => onAsk({ id: 'day:' + ev.year + ev.text.slice(0, 20), title: `${ev.year}: ${ev.text.slice(0, 60)}`, text: `${ev.year}. ${ev.text}\n\n${(ev.pages ?? []).map((p) => `${p.title}: ${p.extract}`).join('\n\n')}`, chips: [{ label: 'What led to it', q: 'What led up to this event?' }, { label: 'What changed', q: 'What changed afterwards because of it?' }, { label: 'Explain simply', q: 'Explain this simply.' }, { label: 'Who was involved', q: 'Who were the main people involved, and what did they do?' }] })}>
        Ask Froggy about this
      </button>
      <span className="srcline mono static">source · Wikipedia — On this day</span>
    </div>
  );
}

/** an article, curiosity or long read: the overview, then the whole text in the app */
function ReadDetail({ r, d, setDetail, onAsk }: { r: Read; d: Daily; setDetail: (x: Detail | null) => void; onAsk: (a: AskCtx) => void }) {
  const o = d.sources?.[r.source];
  const [art, setArt] = useState<Article | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState('');
  const top = useRef<HTMLDivElement>(null);
  const open = async () => {
    setState('loading');
    top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    try {
      setArt(await readArticle(r.url));
      setState('idle');
    } catch (e) {
      const m = (e as Error).message || '';
      setErr(/Failed to fetch|NetworkError|Load failed|^$/i.test(m) ? 'Froggy could not reach that site. Check your connection, or open it in the browser.' : m);
      setState('error');
    }
  };
  return (
    <div className="sheet-body int-detail story" ref={top}>
      {!art && <Photo src={r.image} w={r.iw} h={r.ih} className="dimg" />}
      <div className="rmeta mono big">
        {o && <Logo o={o} size={22} />}
        <span>
          {o?.name} · {r.kind === 'long' ? 'long read' : r.kind === 'curious' ? 'something curious' : 'article'}
        </span>
      </div>
      <h3>{r.title}</h3>
      {!art && state !== 'loading' && <p>{r.summary}</p>}
      {!art && state === 'idle' && (
        <button className="pill wide" onClick={open}>
          Read it here
        </button>
      )}
      {state === 'loading' && (
        <div className="int-wait inline">
          <Froggy mood="dizzy" size="sm" />
          <PixelLoader size={4} gap={2} label={`fetching from ${o?.name ?? 'the site'}`} />
        </div>
      )}
      {state === 'error' && (
        <div className="int-wait inline">
          <Froggy mood="worried" size="md" />
          <p>{err}</p>
          <button className="pill" onClick={() => openExternal(r.url)}>
            Open in the browser
          </button>
        </div>
      )}
      {art && (
        <>
          <p className="byline mono">
            {art.site} · {Math.max(1, Math.round(art.words / 220))} min read
          </p>
          <div className="article" dangerouslySetInnerHTML={{ __html: art.html }} />
          <span className="srcline mono static">source · {art.site} — all rights belong to the publisher</span>
        </>
      )}
      <div className="det-act">
        <button className="pill ghost" onClick={() => onAsk({ id: 'read:' + r.id, title: r.title, text: `${r.title}\n\n${art ? new DOMParser().parseFromString(art.html, 'text/html').body.textContent?.slice(0, 9000) : r.summary}`, chips: READ_CHIPS })}>
          Ask Froggy
        </button>
        <button className="pill ghost" onClick={() => openExternal(r.url)}>
          Open at {o?.name ?? 'the source'} ↗
        </button>
      </div>
      <button className="srcline mono" onClick={() => setDetail(null)}>
        close
      </button>
    </div>
  );
}

/** where the outlets that covered a story stand, on a bar from left to right, with a note on who is missing */
function Spectrum({ d, s }: { d: Daily; s: Story }) {
  const [focus, setFocus] = useState<string | null>(null);
  const outs = s.sources.map((x) => outletOf(d, x));
  const placed = outs.filter((o) => o.lean !== null).sort((a, b) => a.lean! - b.lean!);
  const rows: number[] = [];
  const pos = placed.map((o) => {
    const x = ((o.lean! + 2.3) / 4.6) * 100;
    let r = 0;
    while (rows[r] !== undefined && x - rows[r] < 11) r++;
    rows[r] = x;
    return { o, x, r };
  });
  const c = coverage(d, s);
  const missing = [c.left === 0 ? 'the left' : '', c.right === 0 ? 'the right' : ''].filter(Boolean);
  const f = outs.find((o) => o.id === focus) ?? null;
  if (!placed.length) return null;
  return (
    <div className="spectrum">
      <div className="tag mono">who covers this</div>
      <div className="sp-bar" style={{ height: 34 + Math.max(0, rows.length - 1) * 26 }}>
        <i className="sp-line" />
        {pos.map(({ o, x, r }) => (
          <button key={o.id} className={`sp-dot${focus === o.id ? ' on' : ''}`} style={{ left: `${x}%`, top: 4 + r * 26 }} onClick={() => setFocus(focus === o.id ? null : o.id)} aria-label={`${o.name}, ${leanWord(o.lean)}`}>
            <Logo o={o} size={24} />
          </button>
        ))}
      </div>
      <div className="sp-axis mono">
        <span>left</span>
        <span>centre</span>
        <span>right</span>
      </div>
      <p className="sp-note">
        {c.total} outlet{c.total === 1 ? '' : 's'}: {c.left} on the left, {c.centre} in the centre, {c.right} on the right.
        {missing.length ? ` None from ${missing.join(' or ')} among the outlets Froggy follows reported it yet.` : ' It crosses the spectrum.'}
      </p>
      {f && (
        <div className="sp-info">
          <Logo o={f} size={30} />
          <span>
            <b>{f.name}</b>
            <small className="mono">
              {f.region} · {KIND_WORD[f.kind] ?? f.kind} · {leanWord(f.lean)}
            </small>
            <em>{f.about}</em>
          </span>
        </div>
      )}
      <p className="sp-fine mono">rough positions from public media-bias ratings — approximate and disputed</p>
    </div>
  );
}

/**
 * One story in three steps the reader chooses: the card (a headline and a few lines), this overview — the whole summary, who
 * covers it and how each tells it, names to explore — and the full story, read here from any of the outlets.
 */
function StoryDetail({ s, start, d, setDetail, onAsk }: { s: Story; start?: number; d: Daily; setDetail: (x: Detail | null) => void; onAsk: (a: AskCtx) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const [art, setArt] = useState<Article | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState('');
  const top = useRef<HTMLDivElement>(null);
  const outs = s.sources.map((x) => outletOf(d, x));
  const wiki = (t: string) => setDetail({ kind: 'wiki', stack: [t], note: `From the story “${s.title.slice(0, 40)}…”` });
  const read = async (i: number) => {
    setOpen(i);
    setArt(null);
    setState('loading');
    top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    try {
      setArt(await readArticle(s.sources[i].url));
      setState('idle');
    } catch (e) {
      const m = (e as Error).message || '';
      setErr(/Failed to fetch|NetworkError|Load failed|^$/i.test(m) ? 'Froggy could not reach that site. Check your connection, or open it in the browser.' : m);
      setState('error');
    }
  };
  useEffect(() => {
    if (start !== undefined) void read(start);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const src = open !== null ? s.sources[open] : null;
  const o = open !== null ? outs[open] : null;
  const more = d.news.filter((x) => x.id !== s.id && x.topic === s.topic).slice(0, 3);
  const html = useMemo(() => (art ? linkHtml(art.html, s.terms) : ''), [art, s.terms]);
  return (
    <div className="sheet-body int-detail story" ref={top}>
      {!src && <Photo src={s.image} w={s.iw} h={s.ih} className="dimg" />}
      <div className="rmeta mono big">
        <span className="logos">
          {outs.slice(0, 6).map((x) => (
            <Logo key={x.id} o={x} size={22} />
          ))}
        </span>
        <span>
          {s.topic ? `${TOPIC_LABEL[s.topic]} · ` : ''}
          {agoShort(s.time)}
        </span>
      </div>
      <h3>{s.title}</h3>
      {!src && (
        <>
          <p>
            <Linked text={s.summary} terms={s.terms} onWiki={wiki} />
          </p>
          <button className="pill wide" onClick={() => read(0)}>
            Read the full story
          </button>
          <Spectrum d={d} s={s} />
          {s.sources.length > 1 && <div className="tag mono">how each outlet tells it — tap to read that version</div>}
          <ul className="src-list">
            {s.sources.map((x, i) => (
              <li key={x.url}>
                <button onClick={() => read(i)}>
                  <span>
                    <Logo o={outs[i]} size={20} />
                    <b>{outs[i].name}</b>
                    <small className="mono">{outs[i].region}</small>
                  </span>
                  <em>{x.title}</em>
                  <Icon name="right" size={16} />
                </button>
              </li>
            ))}
          </ul>
          {!!s.terms?.length && (
            <>
              <div className="tag mono">explore the names in this story</div>
              <div className="chips-row">
                {s.terms.map((t) => (
                  <button key={t.w} className="chip-link" onClick={() => wiki(t.w)}>
                    {t.t}
                  </button>
                ))}
              </div>
            </>
          )}
          <button className="pill ghost wide" onClick={() => onAsk({ id: 'news:' + s.id, title: s.title, text: `${s.title}\n\n${s.summary}\n\nReported by: ${outs.map((x) => `${x.name} (${leanWord(x.lean)})`).join(', ')}`, chips: NEWS_CHIPS })}>
            Ask Froggy about this
          </button>
          {!!more.length && (
            <>
              <div className="tag mono">more in {s.topic ? TOPIC_LABEL[s.topic].toLowerCase() : 'the news'}</div>
              <ul className="src-list plain">
                {more.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => setDetail({ kind: 'story', story: m })}>
                      <em>{m.title}</em>
                      <Icon name="right" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {src && o && (
        <>
          <div className="story-bar">
            <button className="mono" onClick={() => (setOpen(null), setArt(null), setState('idle'))}>
              ← overview
            </button>
            {s.sources.length > 1 && (
              <div className="story-src">
                {s.sources.map((x, i) => (
                  <button key={x.url} className={`mono${i === open ? ' on' : ''}`} onClick={() => i !== open && read(i)}>
                    <Logo o={outs[i]} size={16} />
                    {outs[i].name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {state === 'loading' && (
            <div className="int-wait inline">
              <Froggy mood="dizzy" size="sm" />
              <PixelLoader size={4} gap={2} label={`fetching the story from ${o.name}`} />
            </div>
          )}
          {state === 'error' && (
            <div className="int-wait inline">
              <Froggy mood="worried" size="md" />
              <p>{err}</p>
              <div className="det-act">
                <button className="pill" onClick={() => openExternal(src.url)}>
                  Open at {o.name}
                </button>
                {s.sources.length > 1 && (
                  <button className="pill ghost" onClick={() => read(((open ?? 0) + 1) % s.sources.length)}>
                    Try another outlet
                  </button>
                )}
              </div>
            </div>
          )}
          {art && (
            <>
              <p className="byline mono">
                {leanWord(o.lean) !== 'not a political outlet' ? `${o.name} · ${leanWord(o.lean)} · ` : `${o.name} · `}
                {Math.max(1, Math.round(art.words / 220))} min read
              </p>
              <div
                className="article"
                onClick={(e) => {
                  const a = (e.target as HTMLElement).closest('a[href^="#wiki:"]');
                  if (!a) return;
                  e.preventDefault();
                  wiki(decodeURIComponent((a.getAttribute('href') ?? '').slice(6)));
                }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
              <div className="det-act">
                <button className="pill ghost" onClick={() => onAsk({ id: 'news:' + s.id, title: s.title, text: `${s.title}\n\n${new DOMParser().parseFromString(art.html, 'text/html').body.textContent?.slice(0, 9000)}`, chips: NEWS_CHIPS })}>
                  Ask Froggy
                </button>
                <button className="pill ghost" onClick={() => openExternal(art.url)}>
                  Open at {o.name} ↗
                </button>
                <button
                  className="pill ghost"
                  onClick={() => {
                    navigator.clipboard?.writeText(art.url);
                    toast('Link copied');
                  }}
                >
                  Copy link
                </button>
              </div>
              <span className="srcline mono static">source · {art.site} — all rights belong to the publisher</span>
            </>
          )}
        </>
      )}
    </div>
  );
}
