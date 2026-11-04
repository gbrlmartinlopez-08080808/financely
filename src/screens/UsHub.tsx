import { useEffect, useMemo, useState } from 'react';
import { US_SHAPES, US_VIEWBOX } from '../data/usShapes';
import { STATES, TILES, byCode, houseSeats, racePages, type Party, type State } from '../data/us';
import { coverage, outletOf, type Daily, type Story } from '../lib/interesting';
import { Clock, Seats } from './WorldDetail';
import { candidates, summary, type Cand, type Wp } from '../lib/wikirace';
import type { SeatsChart } from '../lib/world';
import { Emblem, Flag } from '../ui/WikiIcon';
import { PixelLoader } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { tap } from '../lib/native';

const COL: Record<Party, string> = { D: '#4b7fbf', R: '#d95a4f', I: '#8a8a86' };
const NAME: Record<Party, string> = { D: 'Democratic', R: 'Republican', I: 'Independent' };
const fmtM = (m: number) => (Math.abs(m) < 0.05 ? 'tie' : `${m > 0 ? 'D' : 'R'}+${Math.abs(m).toFixed(Math.abs(m) < 10 ? 1 : 0)}`);
const tint = (m: number, cap = 30) => {
  const k = 0.22 + Math.min(Math.abs(m), cap) / cap * 0.72;
  return `color-mix(in srgb, ${m > 0 ? COL.D : COL.R} ${Math.round(k * 100)}%, var(--surface))`;
};
const EVENT_DATE = '2026-11-03';

/** a state's own outline, centred in a square; the fill says how it voted or who holds the seat */
function StateShape({ code, size = 34, fill = 'currentColor' }: { code: string; size?: number; fill?: string }) {
  const sh = US_SHAPES[code];
  if (!sh) return <span style={{ width: size, height: size }} />;
  const [x, y, w, h] = sh.box;
  const m = Math.max(w, h, 14) * 1.12;
  return (
    <svg width={size} height={size} viewBox={`${x - (m - w) / 2} ${y - (m - h) / 2} ${m} ${m}`} aria-hidden style={{ flex: 'none' }}>
      <path d={sh.d} style={{ fill }} fillRule="evenodd" strokeLinejoin="round" stroke={fill} strokeWidth={m * 0.015} />
    </svg>
  );
}
const CHART: SeatsChart = {
  type: 'seats',
  note: 'As elected in 2024; vacancies and special elections not counted. Tap a seat to hand it to the next party and see what the majority would be.',
  chambers: [
    { name: 'House of Representatives', total: 435, majority: 218, parties: [{ n: 'Republican', c: COL.R, s: 220 }, { n: 'Democratic', c: COL.D, s: 215 }] },
    { name: 'Senate', total: 100, majority: 51, parties: [{ n: 'Republican', c: COL.R, s: 53 }, { n: 'Democratic (and allies)', c: COL.D, s: 47 }] },
  ],
};
const KEYS = ['midterm', 'congress', 'senate', 'house of representatives', 'republican', 'democrat', 'governor', 'ballot', 'voters'];

type Tab = 'overview' | 'map' | 'senate' | 'house' | 'governors' | 'media';
type Mode = 'p24' | 'p20' | 'sen' | 'gov' | 'shift';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['map', 'Map'], ['senate', 'Senate'], ['house', 'House'], ['governors', 'Governors'], ['media', 'Media']];

export function UsHub({ d, wiki, openStory }: { d?: Daily; wiki: (t: string) => void; openStory: (s: Story) => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [st, setSt] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('p24');
  const pick = (code: string) => (tap('select'), setSt(code));
  if (st) return <StateView s={byCode(st)} d={d} back={() => setSt(null)} wiki={wiki} openStory={openStory} />;
  return (
    <div className="wd ush">
      <header className="wd-head">
        <Flag cc="us" size={52} />
        <div>
          <h3>2026 US midterm elections</h3>
          <span className="mono">United States · 3 Nov 2026</span>
        </div>
      </header>
      <div className="wsec" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => (tap('select'), setTab(id))}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview go={setTab} />}
      {tab === 'map' && <MapTab mode={mode} setMode={setMode} pick={pick} />}
      {tab === 'senate' && <RaceList kind="sen" pick={pick} />}
      {tab === 'governors' && <RaceList kind="gov" pick={pick} />}
      {tab === 'house' && <HouseTab pick={pick} />}
      {tab === 'media' && <Media d={d} openStory={openStory} />}
    </div>
  );
}

function Overview({ go }: { go: (t: Tab) => void }) {
  const open = STATES.filter((s) => s.sen?.open).length;
  const govOpen = STATES.filter((s) => s.gov?.open).length;
  return (
    <>
      <Clock e={{ k: 'election', t: 'US midterm elections', w: 'United States', a: EVENT_DATE }} />
      <p className="wd-note">The whole House, a third of the Senate and most governors are on the ballot. The party of the president usually loses seats in a midterm.</p>
      <div className="stat-row">
        <button onClick={() => go('house')}>
          <b className="mono">435</b>
          <small className="mono">House seats</small>
        </button>
        <button onClick={() => go('senate')}>
          <b className="mono">35</b>
          <small className="mono">Senate seats · {open} open</small>
        </button>
        <button onClick={() => go('governors')}>
          <b className="mono">36</b>
          <small className="mono">governors · {govOpen} open</small>
        </button>
      </div>
      <section className="wd-sec">
        <h5 className="mono">The parties</h5>
        <ul className="wd-sides">
          <li>
            <button aria-label="Democratic Party">
              <Emblem wiki="Democratic Party (United States)" size={40} glyph="D" />
              <span>Democratic Party</span>
            </button>
          </li>
          <li>
            <button aria-label="Republican Party">
              <Emblem wiki="Republican Party (United States)" size={40} glyph="R" />
              <span>Republican Party</span>
            </button>
          </li>
        </ul>
      </section>
      <Seats chart={CHART} />
      <button className="pill ghost" style={{ justifySelf: 'start' }} onClick={() => go('map')}>
        Open the map
      </button>
    </>
  );
}

function colorFor(s: State, mode: Mode): { bg: string; dashed?: boolean; dim?: boolean; star?: boolean } {
  if (mode === 'p24') return { bg: tint(s.m24) };
  if (mode === 'p20') return { bg: tint(s.m20) };
  if (mode === 'shift') {
    const sh = s.m24 - s.m20;
    return { bg: tint(sh, 12) };
  }
  const r = mode === 'sen' ? s.sen : s.gov;
  if (!r) return { bg: 'var(--line)', dim: true };
  return { bg: `color-mix(in srgb, ${COL[r.p]} ${r.open ? 40 : 85}%, var(--surface))`, dashed: !!r.open, star: !!r.special };
}

function MapTab({ mode, setMode, pick }: { mode: Mode; setMode: (m: Mode) => void; pick: (c: string) => void }) {
  const MODES: [Mode, string][] = [['p24', '2024 president'], ['p20', '2020 president'], ['shift', 'Shift 2020→24'], ['sen', 'Senate 2026'], ['gov', 'Governors 2026']];
  const [peek, setPeek] = useState<string | null>(null);
  const [shapes, setShapes] = useState(false);
  const cells = STATES.filter((s) => TILES[s.code]);
  const ps = peek ? byCode(peek) : null;
  return (
    <section className="wd-sec">
      <div className="topics" role="tablist">
        {MODES.map(([m, l]) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => (tap('select'), setMode(m))}>
            {l}
          </button>
        ))}
      </div>
      <div className="maptoggle mono" role="tablist">
        <button role="tab" aria-selected={!shapes} className={!shapes ? 'on' : ''} onClick={() => setShapes(false)}>
          tiles
        </button>
        <button role="tab" aria-selected={shapes} className={shapes ? 'on' : ''} onClick={() => setShapes(true)}>
          real shapes
        </button>
      </div>
      {shapes ? (
        <svg className="shapemap" viewBox={US_VIEWBOX} role="group" aria-label="Map of the states">
          {cells.map((s) => (
            <path
              key={s.code}
              d={US_SHAPES[s.code]?.d}
              fillRule="evenodd"
              className={peek === s.code ? 'sel' : ''}
              style={{ fill: colorFor(s, mode).bg }}
              onClick={() => (peek === s.code ? pick(s.code) : (tap('select'), setPeek(s.code)))}
              aria-label={s.name}
            />
          ))}
        </svg>
      ) : (
      <div className="tilemap" role="group" aria-label="Map of the states">
        {cells.map((s) => {
          const [r, c] = TILES[s.code];
          const col = colorFor(s, mode);
          return (
            <button
              key={s.code}
              className={`utile${col.dashed ? ' open' : ''}${col.dim ? ' dim' : ''}${peek === s.code ? ' sel' : ''}`}
              style={{ gridRow: r + 1, gridColumn: c + 1, background: col.bg }}
              onClick={() => (peek === s.code ? pick(s.code) : (tap('select'), setPeek(s.code)))}
              aria-label={s.name}
            >
              <b className="mono">{s.code}</b>
              {col.star && <i>★</i>}
            </button>
          );
        })}
      </div>
      )}
      <div className="peek">
        {ps ? (
          <button onClick={() => pick(ps.code)}>
            <b>{ps.name}</b>
            <span className="mono">
              {ps.ev} electoral votes · 2024 {fmtM(ps.m24)} · 2020 {fmtM(ps.m20)}
              {ps.sen ? ` · Senate: ${ps.sen.inc} (${ps.sen.p})${ps.sen.open ? ', open' : ''}` : ''}
              {ps.gov ? ` · Governor: ${ps.gov.inc} (${ps.gov.p})${ps.gov.open ? ', open' : ''}` : ''}
            </span>
            <small className="mono">tap again, or here, for the full page →</small>
          </button>
        ) : (
          <p className="wd-src mono">tap a state to see it; tap it again to open it</p>
        )}
      </div>
      <div className="wd-legend">
        {mode === 'sen' || mode === 'gov' ? (
          <>
            <span>
              <i style={{ background: COL.D }} /> Democratic-held
            </span>
            <span>
              <i style={{ background: COL.R }} /> Republican-held
            </span>
            <span>
              <i className="dashed" /> open seat
            </span>
            <span>★ special election</span>
            <span>
              <i style={{ background: 'var(--line)' }} /> no race
            </span>
          </>
        ) : (
          <>
            <span>
              <i style={{ background: COL.D }} /> {mode === 'shift' ? 'moved toward the Democrats' : 'Democratic'}
            </span>
            <span>
              <i style={{ background: COL.R }} /> {mode === 'shift' ? 'moved toward the Republicans' : 'Republican'}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

function RaceList({ kind, pick }: { kind: 'sen' | 'gov'; pick: (c: string) => void }) {
  const [f, setF] = useState<'all' | 'open' | 'D' | 'R'>('all');
  const rows = STATES.filter((s) => s[kind]).filter((s) => f === 'all' || (f === 'open' ? s[kind]!.open : s[kind]!.p === f));
  const total = STATES.filter((s) => s[kind]).length;
  return (
    <section className="wd-sec">
      <p className="wd-note">
        {kind === 'sen' ? 'Thirty-three regular seats and two special elections' : 'Thirty-six governorships'} are up. Incumbents as compiled in early 2026; the candidates are on each state’s page.
      </p>
      <div className="topics" role="tablist">
        {(['all', 'open', 'D', 'R'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={f === k} className={f === k ? 'on' : ''} onClick={() => (tap('select'), setF(k))}>
            {k === 'all' ? `All ${total}` : k === 'open' ? 'Open seats' : k === 'D' ? 'Democratic-held' : 'Republican-held'}
          </button>
        ))}
      </div>
      <ul className="race-list">
        {rows.map((s) => {
          const r = s[kind]!;
          return (
            <li key={s.code}>
              <button onClick={() => pick(s.code)}>
                <span className="rl-t" style={{ background: COL[r.p] }}>
                  <StateShape code={s.code} size={26} fill="#fff" />
                </span>
                <span className="rl-b">
                  <b>{s.name}</b>
                  <small className="mono">
                    {r.open ? 'open seat · held by ' : ''}
                    {r.inc} ({r.p}){r.special ? ' · special election' : ''}
                  </small>
                </span>
                <span className="rl-m mono">{fmtM(s.m24)}</span>
                <Icon name="right" size={15} />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="wd-src mono">the last column is the state’s 2024 presidential margin</p>
    </section>
  );
}

function HouseTab({ pick }: { pick: (c: string) => void }) {
  const rows = [...STATES].filter((s) => s.code !== 'DC').sort((a, b) => houseSeats(b) - houseSeats(a));
  const max = houseSeats(rows[0]);
  return (
    <section className="wd-sec">
      <p className="wd-note">All 435 seats are up, two years after the last vote. The bars show each state’s seats; the colour is how the state voted for president in 2024.</p>
      <ul className="race-list">
        {rows.map((s) => (
          <li key={s.code}>
            <button onClick={() => pick(s.code)}>
              <span className="rl-t" style={{ background: tint(s.m24) }}>
                <StateShape code={s.code} size={26} fill="var(--ink-2)" />
              </span>
              <span className="rl-b">
                <b>{s.name}</b>
                <span className="hbar">
                  <i style={{ width: `${(houseSeats(s) / max) * 100}%`, background: tint(s.m24) }} />
                </span>
              </span>
              <span className="rl-m mono">{houseSeats(s)}</span>
              <Icon name="right" size={15} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** how the outlets cover the election: how many stories, how they split left to right, and the same news in each side's own headline */
function Media({ d, openStory }: { d?: Daily; openStory: (s: Story) => void }) {
  const hits = useMemo(() => (d ? d.news.filter((s) => KEYS.some((k) => `${s.title} ${s.summary}`.toLowerCase().includes(k)) && /midterm|congress|senate|election|governor|republican|democrat/i.test(`${s.title} ${s.summary}`)) : []), [d]);
  if (!d) return <p className="wd-empty mono">the news needs a connection</p>;
  if (!hits.length) return <p className="wd-note">No story about the election in today’s news yet. Check again later.</p>;
  const tot = hits.reduce((a, s) => {
    const c = coverage(d, s);
    return { left: a.left + c.left, right: a.right + c.right, centre: a.centre + c.centre, total: a.total + c.total };
  }, { left: 0, right: 0, centre: 0, total: 0 });
  const lead = [...hits].sort((a, b) => b.sources.length - a.sources.length)[0];
  const cols = { left: [] as { o: ReturnType<typeof outletOf>; t: string }[], centre: [] as { o: ReturnType<typeof outletOf>; t: string }[], right: [] as { o: ReturnType<typeof outletOf>; t: string }[] };
  for (const x of lead.sources) {
    const o = outletOf(d, x);
    if (o.lean === null) continue;
    (o.lean < -0.4 ? cols.left : o.lean > 0.4 ? cols.right : cols.centre).push({ o, t: x.title });
  }
  const pct = (n: number) => `${tot.total ? (n / tot.total) * 100 : 0}%`;
  return (
    <>
      <section className="wd-sec">
        <h5 className="mono">
          {hits.length} stor{hits.length === 1 ? 'y' : 'ies'} today · {tot.total} reports
        </h5>
        <div className="lean-bar" aria-label="Where the reporting outlets sit">
          <span style={{ width: pct(tot.left), background: '#4b7fbf' }} />
          <span style={{ width: pct(tot.centre), background: 'var(--line-2)' }} />
          <span style={{ width: pct(tot.right), background: '#d95a4f' }} />
        </div>
        <div className="lean-l mono">
          <span>left {tot.left}</span>
          <span>centre {tot.centre}</span>
          <span>right {tot.right}</span>
        </div>
      </section>
      <section className="wd-sec">
        <h5 className="mono">One story, three framings</h5>
        <b className="media-lead">{lead.title}</b>
        {(['left', 'centre', 'right'] as const).map((k) => (
          <div key={k} className="frame">
            <h6 className="mono">{k === 'centre' ? 'Centre' : `On the ${k}`}</h6>
            {cols[k].length ? (
              cols[k].slice(0, 3).map((x) => (
                <p key={x.o.id}>
                  <span className="fn">{x.o.logo ? <img src={x.o.logo} alt="" /> : null}{x.o.name}</span>
                  “{x.t}”
                </p>
              ))
            ) : (
              <p className="wd-src mono">no outlet on this side reported it</p>
            )}
          </div>
        ))}
        <button className="pill ghost" style={{ justifySelf: 'start' }} onClick={() => openStory(lead)}>
          Open the story
        </button>
      </section>
      <section className="wd-sec">
        <h5 className="mono">All the stories</h5>
        <ul className="wd-news">
          {hits.slice(0, 8).map((s) => (
            <li key={s.id}>
              <button onClick={() => openStory(s)}>
                <b>{s.title}</b>
                <small className="mono">{new Set(s.sources.map((x) => x.id ?? x.name)).size} outlets</small>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// ------------------------------------------------------------------------------------------------------- one state
function RaceBlock({ title, label, r, wikiTitle, wiki }: { title: string; label: string; r?: { inc: string; p: Party; open?: boolean; special?: boolean }; wikiTitle: string; wiki: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [sum, setSum] = useState<Wp | null | undefined>(undefined);
  const [cands, setCands] = useState<Cand[] | null>(null);
  useEffect(() => {
    if (!open || sum !== undefined) return;
    summary(wikiTitle).then(setSum);
    candidates(wikiTitle).then(setCands);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="raceblk">
      <button className="rb-h" onClick={() => (tap('select'), setOpen(!open))} aria-expanded={open}>
        <span className="rl-t mono" style={{ background: r ? COL[r.p] : 'var(--line-2)' }}>
          {label[0]}
        </span>
        <span className="rl-b">
          <b>{title}</b>
          <small className="mono">{r ? `${r.open ? 'open seat · was held by ' : ''}${r.inc} (${NAME[r.p]})${r.special ? ' · special election' : ''}` : 'all seats up'}</small>
        </span>
        <Icon name={open ? 'up' : 'down'} size={16} />
      </button>
      {open && (
        <div className="rb-b">
          {sum === undefined && <PixelLoader size={4} gap={2} label="loading" />}
          {sum?.extract && <p className="wd-note">{sum.extract}</p>}
          {sum === null && <p className="wd-src mono">the race page needs a connection</p>}
          {cands === null && sum !== undefined && sum !== null && <PixelLoader size={4} gap={2} label="candidates" />}
          {cands?.map((g) => (
            <div key={g.group} className="cand">
              <h6 className="mono">{g.group}</h6>
              <ul>
                {g.items.map((c, ci) => (
                  <li key={c.text}>
                    <button disabled={!c.wiki} onClick={() => c.wiki && wiki(c.wiki)}>
                      {c.wiki && ci < 4 && <Emblem wiki={c.wiki} size={26} glyph={c.text[0]} />}
                      <span>{c.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {cands && !cands.length && sum && <p className="wd-src mono">no candidate list on the page yet</p>}
          <button className="wd-more" onClick={() => wiki(wikiTitle)}>
            Read the whole page
          </button>
        </div>
      )}
    </div>
  );
}

function StateView({ s, d, back, wiki, openStory }: { s: State; d?: Daily; back: () => void; wiki: (t: string) => void; openStory: (s: Story) => void }) {
  const pages = racePages(s);
  const news = useMemo(() => (d ? d.news.filter((x) => `${x.title} ${x.summary}`.includes(s.name) && /election|senate|governor|vote|campaign|republican|democrat|congress/i.test(`${x.title} ${x.summary}`)) : []), [d, s]);
  const bar = (m: number, year: string) => (
    <div className="hist-row">
      <span className="mono">{year}</span>
      <div className="hist-bar">
        <i className="mid" />
        <span style={{ [m > 0 ? 'left' : 'right']: '50%', width: `${Math.min(50, Math.abs(m) / 40 * 50)}%`, background: m > 0 ? COL.D : COL.R }} />
      </div>
      <b className="mono" style={{ color: m > 0 ? COL.D : COL.R }}>{fmtM(m)}</b>
    </div>
  );
  const sh = s.m24 - s.m20;
  return (
    <div className="wd ush">
      <button className="wd-back mono" onClick={back}>
        ← all states
      </button>
      <header className="wd-head">
        <span className="bigtile" style={{ background: tint(s.m24) }}>
          <StateShape code={s.code} size={46} fill="var(--ink-2)" />
        </span>
        <div>
          <h3>{s.name}</h3>
          <span className="mono">
            {s.ev} electoral votes · {houseSeats(s)} House seat{houseSeats(s) === 1 ? '' : 's'}
          </span>
        </div>
      </header>
      <section className="wd-sec">
        <h5 className="mono">How it voted for president</h5>
        {bar(s.m20, '2020')}
        {bar(s.m24, '2024')}
        <p className="wd-src mono">
          {Math.abs(sh) < 0.5 ? 'about the same as in 2020' : `moved ${Math.abs(sh).toFixed(1)} points toward the ${sh > 0 ? 'Democrats' : 'Republicans'} since 2020`}
        </p>
      </section>
      <section className="wd-sec">
        <h5 className="mono">On the ballot on 3 November</h5>
        {s.sen && <RaceBlock title="U.S. Senate" label="Senate" r={s.sen} wikiTitle={pages.senate} wiki={wiki} />}
        {s.gov && <RaceBlock title="Governor" label="Governor" r={s.gov} wikiTitle={pages.gov} wiki={wiki} />}
        {s.code !== 'DC' && <RaceBlock title={`U.S. House · ${houseSeats(s)} seat${houseSeats(s) === 1 ? '' : 's'}`} label="House" wikiTitle={pages.house} wiki={wiki} />}
        {!s.sen && !s.gov && <p className="wd-src mono">no Senate or governor race here this year</p>}
      </section>
      {!!news.length && (
        <section className="wd-sec">
          <h5 className="mono">In the news · {news.length}</h5>
          <ul className="wd-news">
            {news.slice(0, 5).map((x) => (
              <li key={x.id}>
                <button onClick={() => openStory(x)}>
                  <b>{x.title}</b>
                  <small className="mono">{new Set(x.sources.map((y) => y.id ?? y.name)).size} outlets</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
