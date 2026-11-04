import { useEffect, useMemo, useState } from 'react';
import { countdown, dateLabel, daysTo, isOn, isOver, type CurveChart, type SeatsChart, type WorldEvent } from '../lib/world';
import { loadLive, type Live, type Match } from '../lib/sports';
import type { Daily, Story } from '../lib/interesting';
import { Emblem } from '../ui/WikiIcon';
import { emojiFor } from '../lib/worldx';
import { candidates, summary, type Cand, type Wp } from '../lib/wikirace';
import { PixelLoader } from '../ui/kit';
import { tap } from '../lib/native';

const DAY = 864e5;
const at = (s: string) => new Date(`${s}T12:00:00`).getTime();

/** the clock: days, hours, minutes and seconds to the start (or to the end, once it is on) */
export function Clock({ e }: { e: WorldEvent }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const start = new Date(`${e.a}T00:00:00`).getTime();
  const end = new Date(`${e.b ?? e.a}T23:59:59`).getTime();
  const on = now >= start && now <= end;
  const over = now > end;
  const ms = Math.max(0, (on ? end : start) - now);
  const parts: [number, string][] = [
    [Math.floor(ms / DAY), 'days'],
    [Math.floor(ms / 36e5) % 24, 'hours'],
    [Math.floor(ms / 6e4) % 60, 'min'],
    [Math.floor(ms / 1e3) % 60, 'sec'],
  ];
  return (
    <div className="wd-clock">
      <span className="mono wd-clock-l">{over ? 'it is over' : on ? 'on now · ends in' : 'starts in'}</span>
      {!over && (
        <div className="wd-clock-n">
          {parts.map(([n, l]) => (
            <span key={l}>
              <b className="mono">{String(n).padStart(2, '0')}</b>
              <small className="mono">{l}</small>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** the span of the event as a bar with today marked; the stages can be tapped */
function Timeline({ e }: { e: WorldEvent }) {
  const a = at(e.a);
  const b = at(e.b ?? e.a);
  const span = Math.max(1, b - a);
  const [sel, setSel] = useState<number | null>(null);
  const now = Date.now();
  const pos = Math.max(0, Math.min(1, (now - a) / span));
  if (!e.b || e.b === e.a) return null;
  const left = Math.max(0, Math.ceil((b - now) / DAY));
  const done = Math.round(pos * 100);
  const ph = e.phases ?? [];
  const cur = ph.findIndex((p) => now >= at(p.a) - DAY / 2 && now <= at(p.b) + DAY / 2);
  const show = sel ?? (cur >= 0 ? cur : null);
  return (
    <section className="wd-sec">
      <h5 className="mono">The calendar</h5>
      <div className="wd-bar" role="img" aria-label={`${done}% of the way through`}>
        {ph.length
          ? ph.map((p, i) => {
              const w = Math.max(2, ((at(p.b) - at(p.a) + DAY) / (span + DAY)) * 100);
              return (
                <button key={p.n} className={`seg${show === i ? ' on' : ''}${i === cur ? ' now' : ''}`} style={{ flexBasis: `${w}%` }} onClick={() => (tap('select'), setSel(i === sel ? null : i))} aria-label={p.n} />
              );
            })
          : <i className="solid" />}
        {now >= a && now <= b && <span className="today" style={{ left: `${pos * 100}%` }} />}
      </div>
      <div className="wd-bar-l mono">
        <span>{new Date(a).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        <span>{now > b ? 'over' : now < a ? `${daysTo(e)} days to go` : `${done}% · ${left} days left`}</span>
        <span>{new Date(b).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })}</span>
      </div>
      {show !== null && ph[show] && (
        <div className="wd-phase">
          <b>{ph[show].n}</b>
          <span className="mono">
            {new Date(at(ph[show].a)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            {ph[show].b !== ph[show].a ? ` – ${new Date(at(ph[show].b)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
            {ph[show].t ? ` · ${ph[show].t}` : ''}
          </span>
        </div>
      )}
    </section>
  );
}

const fmtTime = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function MatchRow({ m }: { m: Match }) {
  const played = m.hs !== null && m.as !== null;
  if (!m.home && !m.away)
    return (
      <li className="mrow solo">
        <b className="mt">{m.name}</b>
        <small className="mono md">{fmtTime(m.at)}</small>
      </li>
    );
  return (
    <li className="mrow">
      <span className="mt home">
        {m.home}
        <Emblem badge={m.hb} size={22} glyph="•" />
      </span>
      <b className="mono sc">{played ? `${m.hs} – ${m.as}` : new Date(m.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</b>
      <span className="mt">
        <Emblem badge={m.ab} size={22} glyph="•" />
        {m.away}
      </span>
      <small className="mono md">{played ? new Date(m.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : fmtTime(m.at)}</small>
    </li>
  );
}

/** standings and fixtures that are read live from an open sports database */
export function LivePanel({ e }: { e: WorldEvent }) {
  const [d, setD] = useState<Live | null>(null);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);
  const [all, setAll] = useState(false);
  const [updated, setUpdated] = useState(0);
  useEffect(() => {
    let live = true;
    loadLive(e).then(
      (r) => live && (setD(r), setErr(false), setUpdated(Date.now())),
      () => live && setErr(true),
    );
    return () => {
      live = false;
    };
  }, [e, tick]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 90_000);
    return () => clearInterval(t);
  }, []);
  if (err && !d) return <p className="wd-empty mono">live numbers need a connection</p>;
  if (!d) return <PixelLoader size={4} gap={2} label="live" />;
  const today = d.next.filter((m) => new Date(m.at).toDateString() === new Date().toDateString());
  return (
    <section className="wd-sec">
      <h5 className="mono">
        <span className="livedot" /> Live · {today.length ? `${today.length} on today` : `updated ${new Date(updated).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}
      </h5>
      {!!d.clasico.length && (
        <>
          <h6 className="mono">El Clásico this season</h6>
          <ul className="mlist">
            {d.clasico.map((m) => (
              <MatchRow key={m.id} m={m} />
            ))}
          </ul>
        </>
      )}
      {!!d.table.length && (
        <>
          <h6 className="mono">Table</h6>
          <div className="wd-table mono" role="table">
            <div className="tr th" role="row">
              <span>#</span>
              <span />
              <span>team</span>
              <span>P</span>
              <span>W</span>
              <span>D</span>
              <span>L</span>
              <span>GD</span>
              <span>Pts</span>
            </div>
            {d.table.slice(0, all ? 40 : 8).map((r) => (
              <div key={r.team} className="tr" role="row">
                <span>{r.rank}</span>
                <Emblem badge={r.badge} size={20} glyph="•" />
                <span className="tn">{r.team}</span>
                <span>{r.played}</span>
                <span>{r.win}</span>
                <span>{r.draw}</span>
                <span>{r.loss}</span>
                <span>{r.gf - r.ga > 0 ? '+' : ''}
                  {r.gf - r.ga}</span>
                <b>{r.pts}</b>
              </div>
            ))}
          </div>
          {d.table.length > 8 && (
            <button className="wd-more" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${d.table.length}`}
            </button>
          )}
        </>
      )}
      {!!d.last.length && (
        <>
          <h6 className="mono">Latest results</h6>
          <ul className="mlist">
            {d.last.map((m) => (
              <MatchRow key={m.id} m={m} />
            ))}
          </ul>
        </>
      )}
      {!!d.next.length && (
        <>
          <h6 className="mono">Next</h6>
          <ul className="mlist">
            {d.next.map((m) => (
              <MatchRow key={m.id} m={m} />
            ))}
          </ul>
        </>
      )}
      <p className="wd-src mono">data: TheSportsDB · refreshes every 90 seconds while this is open</p>
    </section>
  );
}

/** a half-circle of seats; tap a seat to hand it to the next party and watch the majority line */
export function Seats({ chart }: { chart: SeatsChart }) {
  const [ci, setCi] = useState(0);
  const ch = chart.chambers[ci];
  const base = useMemo(() => {
    const own: number[] = [];
    ch.parties.forEach((p, i) => {
      for (let k = 0; k < p.s; k++) own.push(i);
    });
    while (own.length < ch.total) own.push(-1);
    return own;
  }, [ch]);
  const [own, setOwn] = useState(base);
  useEffect(() => setOwn(base), [base]);
  // seats on rows of a semicircle, filled from the left so each party sits in a block
  const dots = useMemo(() => {
    const n = ch.total;
    const rows = Math.max(3, Math.round(Math.sqrt(n / 2.6)));
    const R = 100;
    const r0 = 38;
    const radii = Array.from({ length: rows }, (_, i) => r0 + ((R - r0) * i) / (rows - 1));
    const sum = radii.reduce((a, b) => a + b, 0);
    const per = radii.map((r) => Math.max(1, Math.round((n * r) / sum)));
    let diff = n - per.reduce((a, b) => a + b, 0);
    for (let i = rows - 1; diff !== 0; i = (i - 1 + rows) % rows) (per[i] += Math.sign(diff)), (diff -= Math.sign(diff));
    const pts: { x: number; y: number; ang: number }[] = [];
    radii.forEach((r, i) => {
      for (let k = 0; k < per[i]; k++) {
        const ang = Math.PI - (Math.PI * (k + 0.5)) / per[i];
        pts.push({ x: 110 + r * Math.cos(ang), y: 108 - r * Math.sin(ang), ang });
      }
    });
    pts.sort((a, b) => b.ang - a.ang);
    return pts;
  }, [ch.total]);
  const counts = ch.parties.map((_, i) => own.filter((o) => o === i).length);
  const none = own.filter((o) => o < 0).length;
  const rad = Math.max(1.6, Math.min(4.2, 230 / Math.sqrt(ch.total) / 5.2));
  const lead = counts.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c)[0];
  const win = lead.c >= ch.majority;
  return (
    <section className="wd-sec">
      <h5 className="mono">The seats</h5>
      {chart.chambers.length > 1 && (
        <div className="topics" role="tablist">
          {chart.chambers.map((c, i) => (
            <button key={c.name} role="tab" aria-selected={ci === i} className={ci === i ? 'on' : ''} onClick={() => (tap('select'), setCi(i))}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      <svg viewBox="0 0 220 116" className="wd-seats" role="img" aria-label={`${ch.name}: ${ch.parties.map((p, i) => `${p.n} ${counts[i]}`).join(', ')}`}>
        {dots.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={rad}
            fill={own[i] >= 0 ? ch.parties[own[i]].c : 'var(--line-2)'}
            onClick={() => {
              tap('select');
              setOwn((o) => o.map((v, k) => (k === i ? (v + 2 > ch.parties.length ? -1 : v + 1) : v)));
            }}
          />
        ))}
        <text x="110" y="92" textAnchor="middle" className="seat-n">
          {win ? ch.parties[lead.i].n : none ? `${none} open` : 'no majority'}
        </text>
        <text x="110" y="106" textAnchor="middle" className="seat-s">
          {ch.majority} needed of {ch.total}
        </text>
      </svg>
      <div className="wd-legend">
        {ch.parties.map((p, i) => (
          <span key={p.n} className={counts[i] >= ch.majority ? 'win' : ''}>
            <i style={{ background: p.c }} />
            {p.n} <b className="mono">{counts[i]}</b>
          </span>
        ))}
      </div>
      <div className="wd-meter" aria-hidden>
        {ch.parties.map((p, i) => (
          <span key={p.n} style={{ width: `${(counts[i] / ch.total) * 100}%`, background: p.c }} />
        ))}
        <em style={{ left: `${(ch.majority / ch.total) * 100}%` }} />
      </div>
      <button className="wd-more" onClick={() => setOwn(base)}>
        Reset
      </button>
      {chart.note && <p className="wd-src mono">{chart.note}</p>}
    </section>
  );
}

/** how many meteors an hour, night by night, with a finger on the date */
function Curve({ chart }: { chart: CurveChart }) {
  const peak = at(chart.peak);
  const days = 11;
  const [i, setI] = useState(Math.min(days - 1, Math.max(0, Math.round((Date.now() - peak) / DAY) + 5)));
  const rate = (k: number) => chart.max * Math.exp(-Math.pow((k - 5) / chart.width, 2));
  const W = 220;
  const H = 70;
  const pts = Array.from({ length: days }, (_, k) => [10 + (k * (W - 20)) / (days - 1), H - 8 - (rate(k) / chart.max) * (H - 18)] as const);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const date = new Date(peak + (i - 5) * DAY);
  return (
    <section className="wd-sec">
      <h5 className="mono">Night by night</h5>
      <svg viewBox={`0 0 ${W} ${H}`} className="wd-curve" role="img" aria-label="Expected meteors per hour across the nights around the peak">
        <path d={`${d} L${pts[days - 1][0]},${H - 8} L${pts[0][0]},${H - 8} Z`} className="fill" />
        <path d={d} className="line" />
        {pts.map((p, k) => (
          <circle key={k} cx={p[0]} cy={p[1]} r={k === i ? 4 : 2} className={k === i ? 'sel' : ''} onClick={() => (tap('select'), setI(k))} />
        ))}
      </svg>
      <input type="range" min={0} max={days - 1} value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Night" className="wd-range" />
      <p className="wd-read">
        <b className="mono">{Math.round(rate(i))}</b> {chart.unit}
        <span className="mono"> · night of {date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}{i === 5 ? ' · the peak' : ''}</span>
      </p>
      {chart.note && <p className="wd-src mono">{chart.note}</p>}
    </section>
  );
}

/** how many of today's stories are about it, and which */
export function InTheNews({ e, d, open }: { e: WorldEvent; d?: Daily; open: (s: Story) => void }) {
  const hits = useMemo(() => {
    if (!d || !e.keys?.length) return [];
    return d.news.filter((s) => {
      const t = `${s.title} ${s.summary}`.toLowerCase();
      return e.keys!.some((k) => t.includes(k));
    });
  }, [d, e]);
  const outlets = new Set(hits.flatMap((s) => s.sources.map((x) => x.id ?? x.name))).size;
  if (!hits.length) return null;
  return (
    <section className="wd-sec">
      <h5 className="mono">
        In the news · {hits.length} stor{hits.length === 1 ? 'y' : 'ies'} · {outlets} outlet{outlets === 1 ? '' : 's'}
      </h5>
      <ul className="wd-news">
        {hits.slice(0, 5).map((s) => (
          <li key={s.id}>
            <button onClick={() => open(s)}>
              <b>{s.title}</b>
              <small className="mono">
                {new Set(s.sources.map((x) => x.id ?? x.name)).size} outlets · {(s.sources[0]?.id && d?.sources?.[s.sources[0].id!]?.name) || s.sources[0]?.name || ''}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** what Wikipedia says about the event, and for a vote: the candidates and parties listed on its page */
function About({ e, wiki }: { e: WorldEvent; wiki: (t: string) => void }) {
  const [sum, setSum] = useState<Wp | null | undefined>(undefined);
  const [cands, setCands] = useState<Cand[] | null>(null);
  useEffect(() => {
    let live = true;
    summary(e.wiki!).then((r) => live && setSum(r));
    if (e.k === 'election') candidates(e.wiki!).then((r) => live && setCands(r));
    return () => {
      live = false;
    };
  }, [e.wiki, e.k]);
  if (sum === undefined) return <PixelLoader size={4} gap={2} label="loading" />;
  return (
    <>
      {sum?.extract && (
        <section className="wd-sec">
          <h5 className="mono">About</h5>
          <p className="wd-note">{sum.extract}</p>
        </section>
      )}
      {!!cands?.length && (
        <section className="wd-sec">
          <h5 className="mono">Candidates and parties</h5>
          {cands.slice(0, 5).map((g) => (
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
        </section>
      )}
    </>
  );
}

export function WorldDetail({ e, d, wiki, openStory }: { e: WorldEvent; d?: Daily; wiki: (t: string) => void; openStory: (s: Story) => void }) {
  return (
    <div className="wd">
      <header className="wd-head">
        <Emblem cc={e.icon?.cc} wiki={e.icon?.wiki} size={56} emoji={emojiFor(e.t, e.k)} />
        <div>
          <h3>{e.t}</h3>
          <span className="mono">
            {e.w} · {dateLabel(e)}
          </span>
          <span className={`wd-when mono${isOn(e) || (!isOver(e) && daysTo(e) <= 7) ? ' hot' : ''}`}>{countdown(e)}</span>
        </div>
      </header>
      {e.n && <p className="wd-note">{e.n}</p>}
      <Clock e={e} />
      {e.wiki && (e.k === 'election' || e.auto) && <About e={e} wiki={wiki} />}
      <Timeline e={e} />
      {!!e.sides?.length && (
        <section className="wd-sec">
          <h5 className="mono">Taking part</h5>
          <ul className="wd-sides">
            {e.sides.map((s) => (
              <li key={s.n}>
                <button onClick={() => s.wiki && wiki(s.wiki)} disabled={!s.wiki} aria-label={s.n}>
                  <Emblem cc={s.cc} wiki={s.wiki} size={40} glyph={s.n[0]} />
                  <span>{s.n}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {e.live && <LivePanel e={e} />}
      {e.chart?.type === 'seats' && <Seats chart={e.chart} />}
      {e.chart?.type === 'curve' && <Curve chart={e.chart} />}
      <InTheNews e={e} d={d} open={openStory} />
      {e.wiki && (
        <button className="pill ghost wd-wiki" onClick={() => wiki(e.wiki!)}>
          Read about it
        </button>
      )}
    </div>
  );
}
