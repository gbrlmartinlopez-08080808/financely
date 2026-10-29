import { useEffect, useMemo, useState } from 'react';
import { useStore, streakInfo, dayKey, updateSettings } from '../lib/store';
import { plantStage } from '../lib/ascii';
import * as db from '../lib/db';
import { Icon } from '../ui/Icon';
import { Pixel, Ruler, Sheet } from '../ui/kit';
import { Ring } from './Library';
import { AsciiCover } from '../reader/OtherViews';
import { onBack } from '../lib/native';

const MESSAGES: [number, string][] = [
  [0, 'Every shelf starts with a single page.'],
  [1, 'Day one. The page remembers.'],
  [2, 'Two days in a row. Something is starting.'],
  [3, 'Three days. A rhythm is forming.'],
  [5, 'Five days. Reading is becoming a place you return to.'],
  [7, 'A full week. Quietly impressive.'],
  [14, 'Two weeks. This is who you are now.'],
  [30, 'A month of pages. The seedling is a tree.'],
  [60, 'Sixty days. Few people get here.'],
  [100, 'One hundred days. Legendary, honestly.'],
];

export function Stats({ open, onClose }: { open: boolean; onClose: () => void }) {
  const days = useStore((s) => s.days);
  const docs = useStore((s) => s.docs);
  const settings = useStore((s) => s.settings);
  const [goalOpen, setGoalOpen] = useState(false);
  const [coverBlob, setCoverBlob] = useState<Blob>();
  const info = streakInfo(days);
  const goal = settings.dailyGoal * 60_000;
  const today = new Date();
  const current = docs.find((d) => !d.finished && d.progress > 0) ?? docs[0];

  useEffect(() => {
    if (!open) return;
    return onBack(() => {
      onClose();
      return true;
    });
  }, [open, onClose]);

  useEffect(() => {
    if (current?.coverId) db.get<Blob>('blobs', current.coverId).then(setCoverBlob);
  }, [current?.coverId]);

  const msg = [...MESSAGES].reverse().find(([n]) => info.current >= n)?.[1] ?? MESSAGES[0][1];
  const todayLine = info.today >= goal ? 'Today’s page is turned.' : `${Math.max(1, Math.ceil((goal - info.today) / 60000))} more minutes keeps the streak warm.`;

  // 18 weeks of blocks, columns = weeks, rows = Mon..Sun
  const grid = useMemo(() => {
    const cells: { key: string; l: number; today: boolean; future: boolean }[] = [];
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 7 * 17 - ((end.getDay() + 6) % 7));
    for (let d = new Date(start); cells.length < 18 * 7; d.setDate(d.getDate() + 1)) {
      const k = dayKey(d);
      const ms = days[k] ?? 0;
      const l = ms <= 0 ? 0 : ms < 60_000 ? 1 : ms < goal ? 2 : ms < goal * 2 ? 3 : 4;
      cells.push({ key: k, l, today: k === dayKey(), future: d > end });
    }
    return cells;
  }, [days, goal]);

  const finished = docs.filter((d) => d.finished).length;
  if (!open) return null;

  return (
    <div className="lib" style={{ zIndex: 40, animation: 'rise .35s var(--spring)' }}>
      <div className="chips-row">
        <button className="chipround icon-only" onClick={() => setGoalOpen(true)} aria-label="Daily goal">
          <span style={{ color: 'var(--ink)' }}>
            <Ring value={info.today / goal} size={38} stroke={3.5} />
          </span>
        </button>
        <span className="chipround" aria-label="Current streak">
          <Pixel name="sprout" size={18} /> {info.current}
        </span>
        <span className="chipround" aria-label="Longest streak">
          <Pixel name="crown" size={18} /> {info.longest}
        </span>
        <span style={{ flex: 1 }} />
        <button className="chipround icon-only" onClick={onClose} aria-label="Close">
          <Icon name="close" size={20} />
        </button>
      </div>

      <div className="stats-date">
        <div className="dow">{today.toLocaleDateString(undefined, { weekday: 'long' })}</div>
        <div className="md">{today.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</div>
      </div>

      <div className="ascii-card">
        <pre aria-label="Your reading plant">{plantStage(info.current)}</pre>
        <div className="msg">
          {msg}
          <br />
          <span style={{ opacity: 0.6 }}>{todayLine}</span>
        </div>
        <span className="sig">streak · {info.current}d</span>
      </div>

      <div className="cal">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span className="mono" style={{ fontSize: 12 }}>
            {info.activeDays} reading days
          </span>
          <span className="mono muted" style={{ fontSize: 11 }}>
            18 weeks
          </span>
        </div>
        <div className="cal-grid">
          {grid.map((c) => (
            <i key={c.key} data-l={c.l} className={c.today ? 'today' : ''} style={{ opacity: c.future ? 0 : 1 }} title={c.key} />
          ))}
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="k">today</div>
          <div className="v">
            {Math.round(info.today / 60000)}
            <small>/ {settings.dailyGoal} min</small>
          </div>
        </div>
        <div className="tile">
          <div className="k">all time</div>
          <div className="v">
            {info.total >= 3_600_000 ? (info.total / 3_600_000).toFixed(1) : Math.round(info.total / 60000)}
            <small>{info.total >= 3_600_000 ? 'hours' : 'min'}</small>
          </div>
        </div>
        <div className="tile">
          <div className="k">longest streak</div>
          <div className="v">
            {info.longest}
            <small>days</small>
          </div>
        </div>
        <div className="tile">
          <div className="k">finished</div>
          <div className="v">
            {finished}
            <small>of {docs.length}</small>
          </div>
        </div>
      </div>

      {current && coverBlob && (
        <div className="ascii-card" style={{ marginTop: 10 }}>
          <AsciiCover blob={coverBlob} cols={44} />
          <div className="msg">
            now reading — {current.name.length > 40 ? current.name.slice(0, 40) + '…' : current.name}
            <br />
            <span style={{ opacity: 0.6 }}>{Math.round(current.progress * 100)}% · {Math.round((current.readMs ?? 0) / 60000)} min so far</span>
          </div>
        </div>
      )}
      <div className="lib-pad" style={{ height: 'calc(var(--safe-b) + 40px)' }} />

      <Sheet open={goalOpen} onClose={() => setGoalOpen(false)} title="Daily goal">
        <div className="sheet-body" style={{ paddingBottom: 16 }}>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            A day counts toward your streak after one minute of reading or listening. The goal fills the ring.
          </p>
          <Ruler value={settings.dailyGoal} min={5} max={120} step={5} onChange={(v) => updateSettings({ dailyGoal: v })} format={(v) => `${v} min`} label="Daily goal" />
        </div>
      </Sheet>
    </div>
  );
}
