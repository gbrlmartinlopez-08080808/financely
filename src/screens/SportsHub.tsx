import { useEffect, useMemo, useState } from 'react';
import { leagueInfo, loadLive, type Live, type LeagueInfo } from '../lib/sports';
import type { WorldEvent } from '../lib/world';
import type { Daily, Story } from '../lib/interesting';
import { LivePanel, MatchRow } from './WorldDetail';
import { Emblem, Flag } from '../ui/WikiIcon';
import { PixelLoader, Sheet } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { tap } from '../lib/native';

type SportId = 'football' | 'basketball' | 'nfl' | 'f1' | 'baseball';
interface League {
  id: number;
  name: string;
  cc: string; // the country it belongs to ('eu' for Europe-wide)
  sport: 'football' | 'nba' | 'nfl' | 'f1';
  season: 'split' | 'year';
  top?: boolean;
}
const SPORTS: { id: SportId; label: string; glyph: string; leagues: League[] }[] = [
  {
    id: 'football',
    label: 'Football',
    glyph: '(o)',
    leagues: [
      { id: 4480, name: 'UEFA Champions League', cc: 'eu', sport: 'football', season: 'split', top: true },
      { id: 4328, name: 'Premier League', cc: 'gb', sport: 'football', season: 'split', top: true },
      { id: 4335, name: 'La Liga', cc: 'es', sport: 'football', season: 'split', top: true },
      { id: 4332, name: 'Serie A', cc: 'it', sport: 'football', season: 'split', top: true },
      { id: 4331, name: 'Bundesliga', cc: 'de', sport: 'football', season: 'split', top: true },
      { id: 4334, name: 'Ligue 1', cc: 'fr', sport: 'football', season: 'split', top: true },
      { id: 4481, name: 'UEFA Europa League', cc: 'eu', sport: 'football', season: 'split' },
      { id: 4347, name: 'Allsvenskan', cc: 'se', sport: 'football', season: 'year' },
      { id: 4346, name: 'Major League Soccer', cc: 'us', sport: 'football', season: 'year' },
      { id: 4359, name: 'Chinese Super League', cc: 'cn', sport: 'football', season: 'year' },
      { id: 4329, name: 'EFL Championship', cc: 'gb', sport: 'football', season: 'split' },
      { id: 4330, name: 'Scottish Premiership', cc: 'gb', sport: 'football', season: 'split' },
      { id: 4337, name: 'Eredivisie', cc: 'nl', sport: 'football', season: 'split' },
      { id: 4344, name: 'Primeira Liga', cc: 'pt', sport: 'football', season: 'split' },
      { id: 4338, name: 'Belgian Pro League', cc: 'be', sport: 'football', season: 'split' },
      { id: 4339, name: 'Süper Lig', cc: 'tr', sport: 'football', season: 'split' },
      { id: 4351, name: 'Brasileirão', cc: 'br', sport: 'football', season: 'year' },
      { id: 4350, name: 'Liga MX', cc: 'mx', sport: 'football', season: 'split' },
      { id: 4406, name: 'Primera División (Argentina)', cc: 'ar', sport: 'football', season: 'year' },
      { id: 4668, name: 'Saudi Pro League', cc: 'sa', sport: 'football', season: 'split' },
      { id: 4356, name: 'A-League', cc: 'au', sport: 'football', season: 'split' },
    ],
  },
  { id: 'basketball', label: 'Basketball', glyph: '( )', leagues: [
      { id: 4387, name: 'NBA', cc: 'us', sport: 'nba', season: 'split', top: true },
      { id: 4546, name: 'EuroLeague', cc: 'eu', sport: 'nba', season: 'split', top: true },
      { id: 4408, name: 'Liga ACB', cc: 'es', sport: 'nba', season: 'split' },
    ],
  },
  { id: 'nfl', label: 'American football', glyph: '<o>', leagues: [{ id: 4391, name: 'NFL', cc: 'us', sport: 'nfl', season: 'year', top: true }] },
  { id: 'f1', label: 'Formula 1', glyph: '=>', leagues: [{ id: 4370, name: 'Formula 1', cc: 'eu', sport: 'f1', season: 'year', top: true }] },
  { id: 'baseball', label: 'Baseball', glyph: '/o\\', leagues: [{ id: 4424, name: 'MLB', cc: 'us', sport: 'nfl', season: 'year', top: true }] },
];
const stub = (l: League): WorldEvent => ({ k: 'sport', t: l.name, w: '', a: '2000-01-01', live: { sport: l.sport, league: l.id, season: l.season } });

/** the games worth watching first: next fixtures involving the teams near the top of the table, then the soonest */
function featured(d: Live) {
  const rank = new Map(d.table.map((r) => [r.team, r.rank]));
  const score = (t: string) => ((rank.get(t) ?? 99) <= 6 ? 3 - Math.min(2, Math.floor(((rank.get(t) ?? 99) - 1) / 3)) : 0);
  return [...d.next]
    .map((m, i) => ({ m, s: score(m.home) + score(m.away) - i * 0.15 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.m)
    .sort((a, b) => a.at - b.at);
}

function LeagueCard({ l, startOpen, onOpen }: { l: League; startOpen: boolean; onOpen: (l: League) => void }) {
  const [open, setOpen] = useState(startOpen);
  const [info, setInfo] = useState<LeagueInfo | null>(null);
  const [d, setD] = useState<Live | null>(null);
  useEffect(() => {
    if (!open || d) return;
    let live = true;
    leagueInfo(l.id).then((i) => live && setInfo(i), () => {});
    loadLive(stub(l)).then((r) => live && setD(r), () => live && setD({ table: [], next: [], last: [], clasico: [] }));
    return () => {
      live = false;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const feat = useMemo(() => (d ? featured(d) : []), [d]);
  return (
    <section className={`lg${open ? ' open' : ''}`}>
      <button className="lg-h" onClick={() => (tap('select'), setOpen(!open))} aria-expanded={open}>
        {info?.badge ? <Emblem badge={info.badge} size={34} /> : l.cc === 'eu' ? <Emblem wiki="UEFA" size={34} glyph="EU" /> : <Flag cc={l.cc} size={34} />}
        <span>
          <b>{l.name}</b>
          <small className="mono">{l.cc === 'eu' ? 'Europe' : l.cc.toUpperCase()}</small>
        </span>
        <Icon name={open ? 'up' : 'down'} size={16} />
      </button>
      {open && (
        <div className="lg-b">
          {!d && <PixelLoader size={4} gap={2} label="live" />}
          {d && !!d.table.length && (
            <div className="mini-table mono">
              {d.table.slice(0, 4).map((r) => (
                <div key={r.team}>
                  <span>{r.rank}</span>
                  <Emblem badge={r.badge} size={18} glyph="•" />
                  <span className="tn">{r.team}</span>
                  <b>{r.pts}</b>
                </div>
              ))}
            </div>
          )}
          {d && !!feat.length && (
            <>
              <h6 className="mono">Games to watch</h6>
              <ul className="mlist">
                {feat.map((m) => (
                  <MatchRow key={m.id} m={m} />
                ))}
              </ul>
            </>
          )}
          {d && !feat.length && !d.table.length && <p className="wd-src mono">nothing scheduled or no connection</p>}
          {d && !!d.last.length && (
            <>
              <h6 className="mono">Latest</h6>
              <ul className="mlist">
                {d.last.slice(0, 2).map((m) => (
                  <MatchRow key={m.id} m={m} />
                ))}
              </ul>
            </>
          )}
          <button className="wd-more" onClick={() => onOpen(l)}>
            Everything: table, results, fixtures
          </button>
        </div>
      )}
    </section>
  );
}

export function SportsHub({ home }: { home: string; d?: Daily; wiki: (t: string) => void; openStory: (s: Story) => void }) {
  const [sport, setSport] = useState<SportId>('football');
  const [more, setMore] = useState(false);
  const [sel, setSel] = useState<League | null>(null);
  const cur = SPORTS.find((s) => s.id === sport)!;
  // the home country's leagues first, then the top ones
  const ordered = useMemo(() => [...cur.leagues].sort((a, b) => Number(b.cc === home) - Number(a.cc === home) || Number(!!b.top) - Number(!!a.top)), [cur, home]);
  const shown = more ? ordered : ordered.filter((l, i) => l.cc === home || l.top || i < 2).slice(0, 7);
  return (
    <>
      <div className="wsec" role="tablist">
        {SPORTS.map((s) => (
          <button key={s.id} role="tab" aria-selected={sport === s.id} className={sport === s.id ? 'on' : ''} onClick={() => (tap('select'), setSport(s.id), setMore(false))}>
            {s.label}
          </button>
        ))}
      </div>
      {shown.map((l, i) => (
        <LeagueCard key={sport + l.id} l={l} startOpen={i === 0} onOpen={setSel} />
      ))}
      {ordered.length > shown.length && (
        <button className="wd-more" onClick={() => setMore(true)}>
          More leagues
        </button>
      )}
      <p className="wd-src mono" style={{ padding: '0 6px' }}>logos and numbers: TheSportsDB · fixtures, results and tables are read live</p>
      <Sheet open={!!sel} onClose={() => setSel(null)} className="int-sheet">
        {sel && (
          <div className="wd">
            <header className="wd-head">
              <Emblem wiki={undefined} size={48} glyph={sel.name[0]} />
              <div>
                <h3>{sel.name}</h3>
                <span className="mono">{sel.cc === 'eu' ? 'Europe' : sel.cc.toUpperCase()}</span>
              </div>
            </header>
            <LivePanel e={stub(sel)} />
          </div>
        )}
      </Sheet>
    </>
  );
}
