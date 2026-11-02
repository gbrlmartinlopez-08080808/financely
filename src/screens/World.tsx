import { useEffect, useMemo, useState } from 'react';
import { countdown, dateLabel, daysTo, isOn, isOver, loadWorld, type World as WorldData, type WorldEvent, type WorldKind } from '../lib/world';
import { Froggy } from '../ui/Froggy';
import { PixelLoader } from '../ui/kit';
import { tap } from '../lib/native';

const KINDS: { id: 'all' | WorldKind; label: string; glyph: string }[] = [
  { id: 'all', label: 'All', glyph: '·' },
  { id: 'election', label: 'Votes', glyph: '[x]' },
  { id: 'summit', label: 'Summits', glyph: '/|\\' },
  { id: 'sport', label: 'Sport', glyph: '(o)' },
  { id: 'economy', label: 'Money', glyph: '$' },
  { id: 'sky', label: 'Sky', glyph: '*' },
  { id: 'culture', label: 'Culture', glyph: '~' },
];
const GLYPH = Object.fromEntries(KINDS.map((k) => [k.id, k.glyph]));

/**
 * World info: the tally of what the world is following — votes, summits, finals and tournaments, the sky, the year's festivals —
 * sorted by when: on now, then this week, this month, the months after.
 */
export function WorldInfo({ wiki }: { wiki: (title: string) => void }) {
  const [data, setData] = useState<WorldData | null>(null);
  const [err, setErr] = useState('');
  const [kind, setKind] = useState<'all' | WorldKind>('all');
  useEffect(() => {
    loadWorld().then(setData, (e) => setErr((e as Error).message));
  }, []);
  const groups = useMemo(() => {
    if (!data) return [];
    const list = data.events.filter((e) => !isOver(e) && (kind === 'all' || e.k === kind));
    const g: { title: string; items: WorldEvent[] }[] = [
      { title: 'On now', items: [] },
      { title: 'This week', items: [] },
      { title: 'This month', items: [] },
      { title: 'In the next months', items: [] },
      { title: 'Further ahead', items: [] },
      { title: 'Seasons under way', items: [] },
    ];
    const season = (e: WorldEvent) => isOn(e) && (new Date(e.b ?? e.a).getTime() - new Date(e.a).getTime()) / 864e5 > 60;
    for (const e of list.sort((x, y) => x.a.localeCompare(y.a))) {
      const n = daysTo(e);
      // a long season that is already on is listed once, under "on now"
      g[season(e) ? 5 : isOn(e) ? 0 : n <= 7 ? 1 : n <= 31 ? 2 : n <= 200 ? 3 : 4].items.push(e);
    }
    return g.filter((x) => x.items.length);
  }, [data, kind]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const soon = data ? data.events.filter((e) => !isOver(e) && !isOn(e) && daysTo(e) <= 31).length : 0;
  const now = data ? data.events.filter((e) => isOn(e) && (new Date(e.b ?? e.a).getTime() - new Date(e.a).getTime()) / 864e5 <= 60).length : 0;

  if (err)
    return (
      <div className="int-wait">
        <Froggy mood="worried" size="md" />
        <p>{err}</p>
      </div>
    );
  if (!data)
    return (
      <div className="int-wait">
        <Froggy mood="sleepy" size="md" />
        <PixelLoader size={4} gap={2} label="looking at the world" />
      </div>
    );
  return (
    <div className="int-scroll world">
      <div className="world-head">
        <b>World info</b>
        <span className="mono">
          {now} on now · {soon} in the next month
        </span>
      </div>
      <div className="topics" role="tablist">
        {KINDS.map((k) => (
          <button key={k.id} role="tab" aria-selected={kind === k.id} className={kind === k.id ? 'on' : ''} onClick={() => (tap('select'), setKind(k.id))}>
            {k.label}
          </button>
        ))}
      </div>
      {groups.map((g) => (
        <section key={g.title} className="world-grp">
          <h4 className="mono">{g.title}</h4>
          <ul>
            {g.items.map((e) => (
              <li key={e.t + e.a}>
                <button className="wev" onClick={() => e.wiki && wiki(e.wiki)} disabled={!e.wiki}>
                  <span className="wev-g mono" aria-hidden>
                    {GLYPH[e.k]}
                  </span>
                  <span className="wev-b">
                    <b>{e.t}</b>
                    <small className="mono">
                      {e.w} · {dateLabel(e)}
                    </small>
                    <span className={`wev-c mono${isOn(e) || daysTo(e) <= 7 ? ' hot' : ''}`}>{countdown(e)}</span>
                    {e.n && <em>{e.n}</em>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!total && <p className="int-foot mono">nothing in this list right now</p>}
      <p className="int-foot mono">· · ·{'\n'}{data.note}</p>
    </div>
  );
}
