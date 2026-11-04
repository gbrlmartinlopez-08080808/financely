import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { countdown, daysTo, dateLabel, isOn, isOver, loadWorld, type World as WorldData, type WorldEvent } from '../lib/world';
import { COUNTRIES, SECTIONS, TOP, concerns, country, countryOrder, holidays, isRecent, relevant, sectionOf, useHome, emojiFor, type Holiday, type Section } from '../lib/worldx';
import { Froggy } from '../ui/Froggy';
import { PixelLoader, Sheet } from '../ui/kit';
import { Emblem, Flag } from '../ui/WikiIcon';
import { WorldDetail } from './WorldDetail';
import { UsHub } from './UsHub';
import { SportsHub } from './SportsHub';
import { EconomyCard } from './Economy';
import type { Daily, Story } from '../lib/interesting';
import { tap } from '../lib/native';
import { Icon } from '../ui/Icon';

const GLYPH: Record<string, string> = { election: '[x]', summit: '/|\\', sport: '(o)', economy: '$', sky: '*', culture: '~' };
const isMidterms = (e: WorldEvent) => e.t === 'US midterm elections';

function EventRow({ e, onOpen, flag }: { e: WorldEvent; onOpen: (e: WorldEvent) => void; flag?: string }) {
  const over = isOver(e) && !isOn(e);
  return (
    <button className={`wev${over ? ' past' : ''}`} onClick={() => (tap('select'), onOpen(e))}>
      <span className="wev-g" aria-hidden>
        <Emblem cc={e.icon?.cc} wiki={e.icon?.wiki} size={38} glyph={GLYPH[e.k]} emoji={emojiFor(e.t, e.k)} />
      </span>
      <span className="wev-b">
        <b>{e.t}</b>
        <small className="mono">
          {flag && <Flag cc={flag} size={14} />} {e.w} · {dateLabel(e)}
        </small>
        <span className="wev-tags">
          <span className={`wev-c mono${!over && (isOn(e) || daysTo(e) <= 7) ? ' hot' : ''}`}>{over ? `ended ${Math.abs(daysTo(e))} days ago` : countdown(e)}</span>
          {e.level && <span className="wtag mono">{e.level}</span>}
          {isMidterms(e) && <span className="wtag mono live">interactive</span>}
        </span>
      </span>
      <Icon name="right" size={16} />
    </button>
  );
}

/** one country's block: a flag header that folds open and shut */
function CountryGroup({ cc, count, open: init, children, note }: { cc: string; count: number; open: boolean; children: ReactNode; note?: string }) {
  const [open, setOpen] = useState(init);
  const c = country(cc);
  return (
    <section className={`cg${open ? ' open' : ''}`}>
      <button className="cg-h" onClick={() => (tap('select'), setOpen(!open))} aria-expanded={open}>
        {cc === 'world' ? <span className="ico ph mono" style={{ width: 28, height: 20 }}>●</span> : <Flag cc={cc} size={28} />}
        <b>{cc === 'world' ? 'Elsewhere and everywhere' : c?.name ?? cc.toUpperCase()}</b>
        <small className="mono">{count}</small>
        <Icon name={open ? 'up' : 'down'} size={16} />
      </button>
      {open && <div className="cg-b">{note && <p className="cg-note mono">{note}</p>}{children}</div>}
    </section>
  );
}

export function WorldInfo({ wiki, d, openStory, mode }: { wiki: (title: string) => void; d?: Daily; openStory: (s: Story) => void; mode?: ReactNode }) {
  const [home, setHome] = useHome();
  const [section, setSection] = useState<Section>('general');
  const [picker, setPicker] = useState(false);
  const [sel, setSel] = useState<WorldEvent | null>(null);
  const [us, setUs] = useState(false);
  const [data, setData] = useState<WorldData | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    loadWorld().then(setData, (e) => setErr((e as Error).message));
  }, []);
  const hc = country(home) ?? TOP[0];
  const order = useMemo(() => countryOrder(home), [home]);
  const open = (e: WorldEvent) => (isMidterms(e) ? setUs(true) : setSel(e));

  const events = useMemo(() => (data?.events ?? []).filter(relevant).sort((a, b) => a.a.localeCompare(b.a)), [data]);
  const forCountry = (cc: string, sec: Section) => events.filter((e) => sectionOf(e) === sec && e.cc?.includes(cc));
  // events with no country, or in a country that is not listed here, go in the last group
  const global = (sec: Section) => events.filter((e) => sectionOf(e) === sec && !e.cc?.length);

  if (err || !data)
    return (
      <div className="int-scroll world">
        {mode}
        <div className="int-wait">
          <Froggy mood={err ? 'worried' : 'sleepy'} size="md" />
          {err ? <p>{err}</p> : <PixelLoader size={4} gap={2} label="looking at the world" />}
        </div>
      </div>
    );

  const list = (items: WorldEvent[], flag?: boolean) => items.map((e) => <EventRow key={e.t + e.a} e={e} onOpen={open} flag={flag && !e.icon?.cc ? e.cc?.[0] : undefined} />);
  const groups = (sec: Section, skip: string[] = [], emptyNote?: (cc: string) => string | undefined) => {
    const listed = new Set(order.map((c) => c.cc));
    // every other country that has something, soonest first, each folded
    const others = new Map<string, WorldEvent[]>();
    for (const e of events) if (sectionOf(e) === sec && e.cc?.length && !e.cc.some((c) => listed.has(c))) (others.get(e.cc[0]) ?? others.set(e.cc[0], []).get(e.cc[0])!).push(e);
    const rest = [...others.entries()].sort((a, b) => a[1][0].a.localeCompare(b[1][0].a));
    const globalList = events.filter((e) => sectionOf(e) === sec && !e.cc?.length);
    return (
      <>
        {order
          .filter((c) => !skip.includes(c.cc))
          .map((c, i) => {
            const items = forCountry(c.cc, sec);
            if (!items.length && c.cc !== home) return null;
            return (
              <CountryGroup key={c.cc} cc={c.cc} count={items.length} open={i === 0} note={emptyNote?.(c.cc)}>
                {items.length ? list(items) : <p className="cg-note mono">nothing listed for {c.name} yet</p>}
              </CountryGroup>
            );
          })}
        {!!globalList.length && (
          <CountryGroup cc="world" count={globalList.length} open={false}>
            {list(globalList)}
          </CountryGroup>
        )}
        {!!rest.length && <h4 className="mono wsub">Other countries · {rest.length}</h4>}
        {rest.map(([cc, items]) => (
          <CountryGroup key={cc} cc={cc} count={items.length} open={false}>
            {list(items)}
          </CountryGroup>
        ))}
      </>
    );
  };

  // "coming closest": the next things for the home country, then for the other big ones
  const soon = (cc: string, n: number) =>
    events
      .filter((e) => sectionOf(e) !== 'sports' && !isRecent(e) && concerns(e, cc) && (e.cc?.includes(cc) || !e.cc?.length))
      .slice(0, n);

  return (
    <div className="int-scroll world">
      {mode}
      <div className="world-top">
        <button className="home-chip" onClick={() => (tap('select'), setPicker(true))} aria-label="Choose your country">
          <Flag cc={hc.cc} size={26} />
          <span>
            <small className="mono">your country</small>
            <b>{hc.name}</b>
          </span>
          <Icon name="down" size={15} />
        </button>
      </div>
      <div className="wsec" role="tablist">
        {SECTIONS.map((s) => (
          <button key={s.id} role="tab" aria-selected={section === s.id} className={section === s.id ? 'on' : ''} onClick={() => (tap('select'), setSection(s.id))}>
            {s.label}
          </button>
        ))}
      </div>

      {section === 'general' && (
        <>
          <section className="wblock">
            <h4 className="mono">Closest for {hc.name}</h4>
            <div className="wlist">
              <NextHolidays cc={hc.cc} n={2} />
              {list(soon(hc.cc, 6))}
            </div>
          </section>
          {order.slice(1, 5).map((c) => {
            const items = soon(c.cc, 3).filter((e) => e.cc?.includes(c.cc));
            return items.length ? (
              <CountryGroup key={c.cc} cc={c.cc} count={items.length} open={false}>
                {list(items)}
              </CountryGroup>
            ) : null;
          })}
          <p className="int-foot mono">· · ·{'\n'}use the tabs for politics, the economy, sports, events and holidays</p>
        </>
      )}
      {section === 'politics' && (
        <section className="wblock">
          <h4 className="mono">Next votes anywhere</h4>
          <div className="wlist">
            {list(events.filter((e) => e.k === 'election' && !isOver(e) && e.level !== 'regional').slice(0, 5), true)}
          </div>
        </section>
      )}
      {section === 'politics' && groups('politics', [], (cc) => (cc === 'cn' ? 'No national elections in China: these are the political dates that matter.' : undefined))}
      {section === 'economy' && (
        <>
          {order.map((c, i) => (
            <CountryGroup key={c.cc} cc={c.cc} count={forCountry(c.cc, 'economy').length} open={i === 0}>
              <EconomyCard c={c} />
              {list(forCountry(c.cc, 'economy'))}
            </CountryGroup>
          ))}
          {!!global('economy').length && (
            <CountryGroup cc="world" count={global('economy').length} open={false}>
              {list(global('economy'))}
            </CountryGroup>
          )}
        </>
      )}
      {section === 'sports' && (
        <>
          <SportsHub home={hc.cc} d={d} wiki={wiki} openStory={openStory} />
          <section className="wblock">
            <h4 className="mono">On the calendar</h4>
            <div className="wlist">
              {list([...events.filter((e) => sectionOf(e) === 'sports' && e.cc?.includes(hc.cc)), ...events.filter((e) => sectionOf(e) === 'sports' && !e.cc?.includes(hc.cc))].slice(0, 12), true)}
            </div>
          </section>
        </>
      )}
      {section === 'events' && groups('events')}
      {section === 'holidays' && (
        <>
          {order.map((c, i) => (
            <CountryGroup key={c.cc} cc={c.cc} count={0} open={i === 0}>
              <NextHolidays cc={c.cc} n={12} />
            </CountryGroup>
          ))}
          {!!(forCountry('', 'holidays').length + global('holidays').length) && (
            <CountryGroup cc="world" count={global('holidays').length} open={false}>
              {list(global('holidays'))}
            </CountryGroup>
          )}
        </>
      )}

      <p className="int-foot mono">· · ·{'\n'}{data.note}</p>

      <Sheet open={picker} onClose={() => setPicker(false)} title="Your country">
        <div className="cpick">
          {COUNTRIES.map((c) => (
            <button key={c.cc} className={c.cc === home ? 'on' : ''} onClick={() => (tap('select'), setHome(c.cc), setPicker(false))}>
              <Flag cc={c.cc} size={26} />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet open={!!sel} onClose={() => setSel(null)} className="int-sheet">
        {sel && (
          <WorldDetail
            e={sel}
            d={d}
            wiki={(t) => (setSel(null), setTimeout(() => wiki(t), 160))}
            openStory={(st) => (setSel(null), setTimeout(() => openStory(st), 160))}
          />
        )}
      </Sheet>
      <Sheet open={us} onClose={() => setUs(false)} className="int-sheet tall">
        {us && <UsHub d={d} wiki={(t) => (setUs(false), setTimeout(() => wiki(t), 160))} openStory={(st) => (setUs(false), setTimeout(() => openStory(st), 160))} />}
      </Sheet>
    </div>
  );
}

/** the public holidays of a country, read live */
function NextHolidays({ cc, n }: { cc: string; n: number }) {
  const [h, setH] = useState<Holiday[] | null>(null);
  useEffect(() => {
    let live = true;
    holidays(cc).then((r) => live && setH(r), () => live && setH([]));
    return () => {
      live = false;
    };
  }, [cc]);
  if (!h) return <p className="cg-note mono">loading holidays…</p>;
  if (!h.length) return <p className="cg-note mono">holidays need a connection</p>;
  return (
    <>
      {h.slice(0, n).map((x) => {
        const days = Math.round((new Date(`${x.date}T12:00:00`).getTime() - Date.now()) / 864e5);
        const dt = new Date(`${x.date}T12:00:00`);
        return (
          <div key={x.date + x.name} className="hol">
            <span className="hol-d mono">
              <b>{dt.getDate()}</b>
              {dt.toLocaleDateString(undefined, { month: 'short' })}
            </span>
            <span className="hol-n">
              <b>{emojiFor(x.name)} {x.local !== x.name ? x.local : x.name}</b>
              <small className="mono">
                {x.local !== x.name ? `${x.name} · ` : ''}
                {dt.toLocaleDateString(undefined, { weekday: 'long' })}
                {!x.global ? ' · some regions' : ''}
              </small>
            </span>
            <span className={`wev-c mono${days <= 7 ? ' hot' : ''}`}>{days <= 0 ? 'today' : days === 1 ? 'tomorrow' : days < 14 ? `in ${days} days` : `in ${Math.round(days / 7)} weeks`}</span>
          </div>
        );
      })}
    </>
  );
}
