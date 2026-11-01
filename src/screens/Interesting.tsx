import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { agoShort, articleOfWeek, factOfDay, loadDaily, wikiUrl, type Card, type Daily, type Story, type WeekPick } from '../lib/interesting';
import { moodFor, type Mood } from '../lib/froggy';
import { useStore } from '../lib/store';
import { isGuide } from '../lib/harvest';
import { onBack, openExternal, tap } from '../lib/native';
import type { DocMeta } from '../lib/types';
import { AskSheet } from '../reader/Ask';
import { Froggy } from '../ui/Froggy';
import { Icon } from '../ui/Icon';
import { PixelLoader, Segmented, Sheet } from '../ui/kit';
import { updateSettings } from '../lib/store';

type Tab = 'today' | 'news' | 'you';

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

const Img = ({ src, alt = '', className = '' }: { src?: string; alt?: string; className?: string }) => {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div className={`img-ph ${className}`} aria-hidden />;
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setBad(true)} />;
};

type Detail = { kind: 'card'; label: string; card: Card; note?: string } | { kind: 'story'; story: Story } | { kind: 'method' };

export function Interesting({ docs, onSwitch, onFindBooks }: { docs: DocMeta[]; onSwitch: () => void; onFindBooks: (q: string) => void }) {
  const aiOk = useStore((s) => s.settings.aiOk);
  const [tab, setTab] = useState<Tab>('today');
  const [daily, setDaily] = useState<{ data: Daily; offline: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [ask, setAsk] = useState<{ id: string; title: string; text: string } | null>(null);
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
  const book = docs.find((d) => !isGuide(d) && !d.finished && d.kind !== 'image' && d.kind !== 'audio' && d.kind !== 'video') ?? docs.find((d) => !isGuide(d));

  const askAbout = (id: string, title: string, text: string) => {
    setDetail(null);
    setTimeout(() => setAsk({ id, title, text }), 120);
  };

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
          value={tab}
          onChange={setTab}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'news', label: 'News' },
            { value: 'you', label: 'For you' },
          ]}
        />
      </header>

      {!daily && !err && (
        <div className="int-wait">
          <Froggy mood="sleepy" size="md" />
          <PixelLoader size={4} gap={2} label="fetching today" />
        </div>
      )}
      {err && (
        <div className="int-wait">
          <Froggy mood="worried" size="md" />
          <p>{err}</p>
          <button className="pill" onClick={() => load(true)}>
            Try again
          </button>
        </div>
      )}

      {daily && tab === 'today' && <Today data={daily.data} offline={daily.offline} mood={mood} onDetail={setDetail} onRefresh={() => load(true)} />}
      {daily && tab === 'news' && <Reels stories={daily.data.news} onDetail={(s) => setDetail({ kind: 'story', story: s })} onMethod={() => setDetail({ kind: 'method' })} onAsk={(s) => askAbout('news:' + s.id, s.title, `${s.title}\n\n${s.summary}\n\nReported by: ${s.sources.map((x) => x.name).join(', ')}`)} />}
      {tab === 'you' && <ForYou book={book} fallback={daily?.data.featured} onDetail={setDetail} />}

      <Sheet open={!!detail} onClose={() => setDetail(null)} className="int-sheet">
        {detail && (
          <DetailBody
            d={detail}
            onAsk={askAbout}
            onFindBooks={(q) => {
              setDetail(null);
              onFindBooks(q);
            }}
          />
        )}
      </Sheet>
      <AskSheet
        open={!!ask}
        onClose={() => setAsk(null)}
        title={ask?.title ?? ''}
        docId={ask?.id ?? 'x'}
        getText={async () => ask?.text ?? ''}
        aiOk={aiOk}
        onConsent={() => updateSettings({ aiOk: true })}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------- today
function Today({ data, offline, mood, onDetail, onRefresh }: { data: Daily; offline: boolean; mood: Mood; onDetail: (d: Detail) => void; onRefresh: () => void }) {
  const fact = factOfDay();
  const date = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
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

      {data.figure && (
        <button className="tcard figure" onClick={() => onDetail({ kind: 'card', label: 'Figure of the day', card: data.figure!, note: `Born ${data.figure!.year}` })}>
          <Img src={data.figure.image} className="timg" />
          <div className="tcard-body">
            <span className="tag mono">figure of the day · {data.figure.year}</span>
            <h3>{data.figure.title}</h3>
            <p className="sub">{data.figure.description}</p>
            <p className="ext">{data.figure.extract}</p>
          </div>
        </button>
      )}

      <div className="tcard fact">
        <Froggy mood="bigSmile" size="sm" />
        <span className="tag mono">fact of the day</span>
        <p>{fact.text}</p>
        <button className="srcline mono" onClick={() => openExternal(wikiUrl(fact.wiki))}>
          source · Wikipedia — {fact.wiki} ↗
        </button>
      </div>

      {data.picture?.image && (
        <button className="tcard picture" onClick={() => onDetail({ kind: 'card', label: 'Picture of the day', card: { ...data.picture!, extract: data.picture!.description } })}>
          <Img src={data.picture.image} className="pimg" />
          <div className="pcap">
            <span className="tag mono">picture of the day</span>
            <p>{(data.picture.description || data.picture.title).slice(0, 140)}</p>
          </div>
        </button>
      )}

      {!!data.history?.length && (
        <div className="tcard history">
          <span className="tag mono">on this day in history</span>
          <ul>
            {data.history.slice(0, 5).map((h, i) => (
              <li key={i}>
                <b className="mono">{h.year}</b>
                <span>{h.text}</span>
              </li>
            ))}
          </ul>
          <button className="srcline mono" onClick={() => openExternal('https://en.wikipedia.org/wiki/Wikipedia:Selected_anniversaries')}>
            source · Wikipedia — Selected anniversaries ↗
          </button>
        </div>
      )}

      {data.featured && (
        <button className="tcard featured" onClick={() => onDetail({ kind: 'card', label: 'Article of the day', card: data.featured! })}>
          <Img src={data.featured.image} className="timg sm" />
          <div className="tcard-body">
            <span className="tag mono">wikipedia’s article of the day</span>
            <h3>{data.featured.title}</h3>
            <p className="sub">{data.featured.description}</p>
          </div>
        </button>
      )}
      <p className="int-foot mono">· · ·{'\n'}everything here is free, public and the same for everyone</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------- news reels
function Reels({ stories, onDetail, onMethod, onAsk }: { stories: Story[]; onDetail: (s: Story) => void; onMethod: () => void; onAsk: (s: Story) => void }) {
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
      {stories.map((s, i) => (
        <article className={`reel${at === i ? ' act' : ''}`} key={s.id} data-i={i}>
          <div className="reel-img">
            <Img src={s.image} />
            <div className="reel-shade" />
            <span className="reel-count mono">
              {i + 1} / {stories.length}
            </span>
            <span className="reel-credit mono">photo · {s.imageFrom}</span>
          </div>
          <div className="reel-body">
            <div className="reel-meta mono">
              {agoShort(s.time)} · {s.sources.length > 1 ? `${s.sources.length} outlets` : s.sources[0].name}
            </div>
            <h2>{s.title}</h2>
            <p>{s.summary}</p>
            <div className="reel-src">
              {s.sources.map((x) => (
                <button key={x.name + x.url} className="mono" onClick={() => openExternal(x.url)} aria-label={`Read at ${x.name}`}>
                  {x.name} ↗
                </button>
              ))}
            </div>
            <div className="reel-act">
              <button className="pill" onClick={() => onDetail(s)}>
                Read more
              </button>
              <button className="pill ghost" onClick={() => onAsk(s)}>
                Ask Froggy
              </button>
            </div>
            {i === 0 && <p className="reel-hint mono">swipe up for the next ↑</p>}
          </div>
        </article>
      ))}
      <div className="reel-end">
        <Froggy mood="sleepy" size="md" />
        <p>That is the news for now. Froggy will have more later.</p>
        <button className="pill ghost" onClick={() => go(0)}>
          Back to the first
        </button>
        <button className="srcline mono" onClick={onMethod}>
          how stories are chosen
        </button>
      </div>
    </div>
      <div className="reel-dots" aria-hidden>
        {stories.map((_, i) => (
          <i key={i} className={i === at ? 'on' : ''} />
        ))}
      </div>
      <button className="reel-info" onClick={onMethod} aria-label="How stories are chosen">
        <Icon name="info" size={18} />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------- for you
function ForYou({ book, fallback, onDetail }: { book?: DocMeta; fallback?: Card; onDetail: (d: Detail) => void }) {
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
  return (
    <div className="int-scroll">
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
          {fallback && (
            <button className="tcard figure big" onClick={() => onDetail({ kind: 'card', label: 'Article of the day', card: fallback })}>
              <Img src={fallback.image} className="timg" />
              <div className="tcard-body">
                <h3>{fallback.title}</h3>
                <p className="sub">{fallback.description}</p>
                <p className="ext">{fallback.extract}</p>
              </div>
            </button>
          )}
        </>
      )}
      {pick && (
        <>
          <p className="int-because mono">article of the week · because you are reading “{pick.because.length > 34 ? pick.because.slice(0, 34) + '…' : pick.because}”</p>
          <button className="tcard figure big" onClick={() => onDetail({ kind: 'card', label: 'Article of the week', card: pick.article, note: `Because you are reading “${pick.because}”` })}>
            <Img src={pick.article.image} className="timg" />
            <div className="tcard-body">
              <h3>{pick.article.title}</h3>
              <p className="sub">{pick.article.description}</p>
              <p className="ext">{pick.article.extract}</p>
            </div>
          </button>
          {!!pick.more.length && (
            <div className="tcard more">
              <span className="tag mono">more along these lines</span>
              <ul>
                {pick.more.map((m) => (
                  <li key={m.title}>
                    <button onClick={() => openExternal(m.url ?? wikiUrl(m.title))}>
                      <Img src={m.image} className="mini" />
                      <span>
                        <b>{m.title}</b>
                        <small>{m.description}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <span className="srcline mono static">source · Wikipedia</span>
            </div>
          )}
        </>
      )}
      <p className="int-foot mono">· · ·{'\n'}a new article every week, picked from what you read</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------- the sheet
function DetailBody({ d, onAsk, onFindBooks }: { d: Detail; onAsk: (id: string, title: string, text: string) => void; onFindBooks: (q: string) => void }) {
  if (d.kind === 'method')
    return (
      <div className="sheet-body int-detail">
        <Froggy mood="smug" size="md" className="inline" />
        <h3>How the news is chosen</h3>
        <p>Froggy does not pick sides and has no editors. Once a few hours, one shared list is built from the public feeds of independent and public broadcasters on every continent (BBC, Al Jazeera, DW, NPR, The Guardian, France 24, ABC Australia, Africanews, Euronews, The Hindu, The Straits Times).</p>
        <p>The same story in several outlets becomes one card that names every outlet and links to each. Stories reported by more outlets, in more parts of the world, come first — so the order comes from who reported it, not from what one newsroom thinks matters.</p>
        <p>Only a headline, a short summary and the picture are shown, each credited, and every card links to the full article at its source.</p>
      </div>
    );
  if (d.kind === 'story') {
    const s = d.story;
    return (
      <div className="sheet-body int-detail">
        <Img src={s.image} className="dimg" />
        <span className="tag mono">
          {agoShort(s.time)} · photo {s.imageFrom}
        </span>
        <h3>{s.title}</h3>
        <p>{s.summary}</p>
        <div className="tag mono" style={{ marginTop: 14 }}>
          {s.sources.length > 1 ? `reported by ${s.sources.length} outlets` : 'reported by'}
        </div>
        <ul className="src-list">
          {s.sources.map((x) => (
            <li key={x.url}>
              <button onClick={() => openExternal(x.url)}>
                <span>
                  <b>{x.name}</b>
                  <small className="mono">{x.region}</small>
                </span>
                <em>{x.title}</em>
                <Icon name="right" size={16} />
              </button>
            </li>
          ))}
        </ul>
        <button className="pill ghost wide" onClick={() => onAsk('news:' + s.id, s.title, `${s.title}\n\n${s.summary}`)}>
          Ask Froggy about this
        </button>
      </div>
    );
  }
  const c = d.card;
  return (
    <div className="sheet-body int-detail">
      <Img src={c.image} className="dimg" />
      <span className="tag mono">{d.label.toLowerCase()}</span>
      <h3>{c.title}</h3>
      {(d.note || c.description) && <p className="sub">{[d.note, c.description].filter(Boolean).join(' · ')}</p>}
      <p>{c.extract}</p>
      {c.credit && <p className="credit mono">credit · {c.credit}</p>}
      <div className="det-act">
        {c.url && (
          <button className="pill" onClick={() => openExternal(c.url!)}>
            Read on Wikipedia
          </button>
        )}
        {d.label === 'Figure of the day' && (
          <button className="pill ghost" onClick={() => onFindBooks(c.title)}>
            Find their books
          </button>
        )}
        <button className="pill ghost" onClick={() => onAsk('card:' + c.title, c.title, `${c.title}. ${c.description ?? ''}\n\n${c.extract ?? ''}`)}>
          Ask Froggy
        </button>
      </div>
      <span className="srcline mono static">source · Wikipedia / Wikimedia</span>
    </div>
  );
}
