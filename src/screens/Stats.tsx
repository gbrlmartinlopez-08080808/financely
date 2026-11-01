import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, streakInfo, dayKey, updateSettings, freezeStatus, COUNT_MS } from '../lib/store';
import { fmtMs, glyphFor, legendFor } from '../lib/glyphs';
import { plantStage } from '../lib/ascii';
import { lightsFor, renderGlobe } from '../lib/globe';
import { Icon } from '../ui/Icon';
import { Pixel, Ruler, Sheet, toast } from '../ui/kit';
import { Ring } from './Library';
import { cheer, displayName } from '../lib/cheer';
import { harvestRecent, type Harvest } from '../lib/harvest';
import { pickQuote, quoteArt } from '../lib/quotes';
import { appIconSet, onBack, tap } from '../lib/native';
import { FrogScene } from './FrogScene';

const MESSAGES: [number, string][] = [
  [0, 'Every shelf starts with a single page.'],
  [1, 'Day one. The first light is on.'],
  [2, 'Two days running. Something is starting.'],
  [3, 'Three days. A rhythm is forming.'],
  [5, 'Five days. Reading is becoming a place you return to.'],
  [7, 'A full week. Quietly impressive.'],
  [14, 'Two weeks. This is who you are now.'],
  [30, 'A month of pages. The world is lighting up.'],
  [60, 'Sixty days. Few people get here.'],
  [100, 'One hundred days. Legendary, honestly.'],
];

/** The reading globe: spins slowly; one light per day you've read, today’s light blinks. */
function Globe({ lights, view, onToggle, enter }: { lights: ReturnType<typeof lightsFor>; view: 'globe' | 'plant'; onToggle: () => void; enter?: boolean }) {
  const pre = useRef<HTMLPreElement>(null);
  const rot = useRef(-20);
  const drag = useRef<{ x: number; rot: number; moved: boolean } | null>(null);
  const cols = 42;
  const rows = 21;
  useEffect(() => {
    if (view !== 'globe') return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 110 || document.hidden) return;
      const dt = (now - last) / 1000;
      last = now;
      if (!drag.current) rot.current = (rot.current + 14 * Math.min(dt, 0.3)) % 360;
      if (pre.current) pre.current.innerHTML = renderGlobe({ cols, rows, rot: rot.current, lights, t: now / 1000 });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lights, view]);
  return (
    <div
      className={`ascii-card globe${enter ? " enter" : ""}`}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, rot: rot.current, moved: false };
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (Math.abs(e.clientX - d.x) > 4) d.moved = true;
        rot.current = d.rot - (e.clientX - d.x) * 0.6;
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) {
          tap('select');
          onToggle();
        }
      }}
      role="img"
      aria-label="A rotating globe. Each day you have read lights one place on it."
    >
      {view === 'globe' ? <pre ref={pre} /> : <pre className="plant">{plantStage(lights.length)}</pre>}
      <span className="sig mono">{view === 'globe' ? 'drag to spin · tap for seedling' : 'tap for the globe'}</span>
    </div>
  );
}


/** Hours of the day along the bottom, minutes read in each hour as thin bars. */
function DayChart({ date, ms, hours, ice }: { date: Date; ms: number; hours?: number[]; ice?: boolean }) {
  const max = Math.max(1, ...(hours ?? [0]));
  const peak = hours ? hours.indexOf(Math.max(...hours)) : -1;
  const W = 300;
  const H = 70;
  const bw = W / 24;
  const hr = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
  return (
    <div className="daychart" aria-live="polite">
      <div className="daychart-head">
        <b className="mono">{date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</b>
        <span className="mono">{ms >= 1000 ? fmtMs(ms) : ice ? '~ freeze day' : 'rest day'}</span>
      </div>
      {hours && ms >= 1000 ? (
        <>
          <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label={`Reading time by hour. Busiest around ${hr(peak)}.`}>
            <line x1="0" x2={W} y1={H} y2={H} stroke="currentColor" strokeOpacity=".25" />
            {hours.map((v, h) => {
              const bh = v > 0 ? Math.max(3, (v / max) * (H - 14)) : 0;
              return v > 0 ? <rect key={h} x={h * bw + 2} y={H - bh} width={bw - 4} height={bh} rx="2" fill="currentColor" opacity={h === peak ? 1 : 0.45} /> : <circle key={h} cx={h * bw + bw / 2} cy={H - 1.5} r="1" fill="currentColor" opacity=".3" />;
            })}
            {[0, 6, 12, 18, 24].map((h) => (
              <text key={h} x={h === 24 ? W : h * bw} y={H + 13} textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'} fontSize="9" fill="currentColor" opacity=".55" fontFamily="var(--mono)">
                {h === 24 ? '12a' : hr(h)}
              </text>
            ))}
          </svg>
          <p className="mono daychart-note">mostly around {hr(peak)} · {Math.round(hours[peak] / 60000)} min</p>
        </>
      ) : (
        <p className="mono daychart-note">{ms >= 1000 ? 'no hour-by-hour detail was kept for this day.' : ice ? 'a freeze day kept your streak going.' : 'nothing read — the shelf waited.'}</p>
      )}
    </div>
  );
}

export function StatsBubble({ open, onClose, reward, onRewardDone }: { open: boolean; onClose: () => void; reward?: string | null; onRewardDone?: () => void }) {
  const days = useStore((s) => s.days);
  const hours = useStore((s) => s.hours);
  const frozen = useStore((s) => s.freeze);
  const fz = freezeStatus(frozen);
  const [pick, setPick] = useState<string | null>(null);
  const [scene, setScene] = useState(false);
  useEffect(() => {
    setScene(!!(open && reward));
  }, [open, reward]);
  const docs = useStore((s) => s.docs);
  const settings = useStore((s) => s.settings);
  const [full, setFull] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const view = settings.streakView ?? 'globe';
  const setView = (f: (v: 'globe' | 'plant') => 'globe' | 'plant') => updateSettings({ streakView: f(view) });
  const [harvest, setHarvest] = useState<Record<string, Harvest>>({});
  const [nameDraft, setNameDraft] = useState('');
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const info = streakInfo(days);
  const goal = settings.dailyGoal * 60_000;

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => {
        setMounted(false);
        setClosing(false);
        setFull(false);
      }, 240);
      return () => clearTimeout(t);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    return onBack(() => {
      if (full) setFull(false);
      else onClose();
      return true;
    });
  }, [open, full, onClose]);

  // quotes & favourite words from your own documents (computed once, cached)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => harvestRecent(docs).then((h) => alive && setHarvest(h)), 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, docs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // a light per day you reached your goal; today's blinks until midnight, then it stays
  const readingDays = useMemo(
    () =>
      Object.keys(days)
        .filter((k) => days[k] >= goal)
        .sort(),
    [days, goal],
  );
  const lights = useMemo(() => lightsFor(readingDays, reward ?? dayKey()), [readingDays, reward]);
  const msg = [...MESSAGES].reverse().find(([n]) => info.current >= n)?.[1] ?? MESSAGES[0][1];
  const todayDone = info.today >= COUNT_MS;
  const met = info.today >= goal;
  const words = cheer({ name: settings.name, todayMs: info.today, goalMs: goal, days, streak: info.current, docs, harvest });
  const quote = useMemo(() => pickQuote(docs, harvest), [docs, harvest]);
  const art = useMemo(() => quoteArt(quote), [quote]);
  const needsName = !displayName(settings.name);

  const grid = useMemo(() => {
    const cells: { key: string; ms: number; date: Date; today: boolean; future: boolean }[] = [];
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 7 * 17 - ((end.getDay() + 6) % 7));
    for (let d = new Date(start); cells.length < 18 * 7; d.setDate(d.getDate() + 1)) {
      const k = dayKey(d);
      const ms = days[k] ?? 0;
      cells.push({ key: k, ms, date: new Date(d), today: k === dayKey(), future: d > end });
    }
    return cells;
  }, [days]);
  const sel = grid.find((c) => c.key === (pick ?? dayKey())) ?? grid[grid.length - 1];

  if (!mounted) return null;
  const finished = docs.filter((d) => d.finished).length;
  const today = new Date();

  const onDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.dy = e.clientY - drag.current.y;
    if (box.current && !full && drag.current.dy > 0) box.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (box.current) box.current.style.transform = '';
    if (!d) return;
    if (d.dy < -40) setFull(true);
    else if (d.dy > 70) (full ? setFull(false) : onClose());
    else if (Math.abs(d.dy) < 6) setFull((f) => !f);
  };

  return (
    <>
      <div className={`scrim${closing ? ' out' : ''}`} style={{ background: full ? 'rgba(0,0,0,.28)' : 'rgba(0,0,0,.12)' }} onClick={onClose} />
      <div ref={box} className={`bubble${full ? ' full' : ''}${closing ? ' out' : ''}${met ? ' met' : ''}`} role="dialog" aria-label="Reading streak">
        <div className="bubble-drag" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="sheet-grip" />
          <div className="bubble-head">
            <span className="bubble-date">{today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            <div className="mini-icons" onPointerDown={(e) => e.stopPropagation()}>
              <button onClick={() => setGoalOpen(true)} aria-label={`Daily goal: ${Math.round(info.today / 60000)} of ${settings.dailyGoal} minutes`}>
                <Ring value={info.today / goal} size={20} stroke={2.4} />
              </button>
              <span aria-label="Current streak">
                <Pixel name="sprout" size={14} />
                {info.current}
              </span>
              <span aria-label="Longest streak">
                <Pixel name="crown" size={14} />
                {info.longest}
              </span>
              <button onClick={onClose} aria-label="Close">
                <Icon name="close" size={16} stroke={2.2} />
              </button>
            </div>
          </div>
        </div>

        <div className="bubble-body">
          <div className="bubble-hello" aria-live="polite">
            <p className="main">{words.main}</p>
            {words.fun && <p className="fun">{words.fun}</p>}
            {needsName && (
              <form
                className="namefield"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (nameDraft.trim()) updateSettings({ name: nameDraft.trim() });
                }}
              >
                <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value.slice(0, 24))} placeholder="what should I call you?" maxLength={24} aria-label="Your name" />
                {nameDraft.trim() && <button>Save</button>}
              </form>
            )}
          </div>
          {scene && reward ? (
            <FrogScene
              key={reward}
              count={lights.length}
              minutes={Math.round((days[reward] ?? 0) / 60000)}
              goal={settings.dailyGoal}
              name={settings.name}
              onEnd={() => {
                setScene(false);
                onRewardDone?.();
                tap('medium');
              }}
            />
          ) : (
            <Globe enter={!!reward} lights={lights} view={reward ? 'globe' : view} onToggle={() => setView((v) => (v === 'globe' ? 'plant' : 'globe'))} />
          )}
          <div className="bubble-cap">
            <b className="mono">
              {lights.length} light{lights.length === 1 ? '' : 's'} on your map
            </b>
            <span>{lights.length ? 'One for every day you reached your goal.' : 'Reach your daily goal to light the first place.'}</span>
            <span className="muted">{info.today >= goal ? 'Today’s light is blinking — it joins the map at midnight.' : `${Math.max(1, Math.ceil((goal - info.today) / 60000))} min to today’s light.`}</span>
          </div>
          <div className="bubble-line mono">
            <span>
              <b>{info.current}</b> day streak
            </span>
            <span>
              <b>{Math.round(info.today / 60000)}</b>/{settings.dailyGoal} min today
            </span>
            <span>
              <b>{info.total >= 3_600_000 ? (info.total / 3_600_000).toFixed(1) + 'h' : Math.round(info.total / 60000) + 'm'}</b> total
            </span>
          </div>
          {!full && (
            <button className="bubble-more" onClick={() => setFull(true)}>
              <Icon name="up" size={16} /> more
            </button>
          )}

          {full && (
            <>
              <p className="bubble-msg">{msg}</p>
              <div className="cal">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {info.activeDays} reading days
                  </span>
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    18 weeks
                  </span>
                </div>
                <div className="cal-grid" role="grid" aria-label="Reading days">
                  {grid.map((c) => {
                    const ice = c.ms < COUNT_MS && frozen.used.includes(c.key);
                    const g = ice ? { ch: '~', level: 0, met: false } : glyphFor(c.ms, goal);
                    return (
                      <button
                        key={c.key}
                        data-ice={ice || undefined}
                        data-l={g.level}
                        data-met={g.met || undefined}
                        className={`${c.today ? 'today' : ''}${c.key === sel.key ? ' sel' : ''}`}
                        style={{ visibility: c.future ? 'hidden' : 'visible' }}
                        aria-label={`${c.date.toDateString()}: ${ice ? 'freeze day' : fmtMs(c.ms)}`}
                        onClick={() => {
                          tap('select');
                          setPick(c.key === pick ? null : c.key);
                        }}
                      >
                        {g.ch}
                      </button>
                    );
                  })}
                </div>
                <div className="cal-legend mono" aria-hidden>
                  <span>·&nbsp;0</span>
                  {legendFor(settings.dailyGoal).map((g) => (
                    <span key={g.ch} data-met={g.ch === '@' || undefined}>
                      {g.ch}&nbsp;{g.from}
                    </span>
                  ))}
                  <span>min</span>
                  <span data-ice>~&nbsp;freeze</span>
                </div>
                <DayChart date={sel.date} ms={sel.ms} hours={hours[sel.key]} ice={sel.ms < COUNT_MS && frozen.used.includes(sel.key)} />
              </div>
              <div className="tiles">
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
                <div className="tile freeze" data-ready={fz.available > 0 || undefined}>
                  <div className="k">freeze day</div>
                  <div className="v mono">
                    {fz.available > 0 ? 'ready' : 'used'}
                    <small>{fz.bonus > 0 ? `+${fz.bonus} earned` : fz.weekly ? 'resets Monday' : 'back Monday'}</small>
                  </div>
                </div>
              </div>
              <IconCards longest={info.longest} />
              <div className="ascii-card quote" style={{ marginTop: 10 }}>
                <pre aria-label={`${quote.text} — ${quote.from}`}>{art}</pre>
                <div className="msg" style={{ textAlign: 'center' }}>
                  {quote.own ? 'a line from your own shelf' : 'for the days you’d rather not read'}
                </div>
              </div>
              <div style={{ height: 26 }} />
            </>
          )}
        </div>
      </div>
      <Sheet open={goalOpen} onClose={() => setGoalOpen(false)} title="Daily goal" className="over">
        <div className="sheet-body" style={{ paddingBottom: 16 }}>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            A day counts toward your streak after one minute of reading or listening. The goal fills the ring.
          </p>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, textAlign: 'center', margin: '14px 0 6px' }}>{settings.dailyGoal} min</div>
          <p className="muted" style={{ textAlign: 'center', fontSize: 13, margin: 0 }}>You can change it in Settings → advanced.</p>
        </div>
      </Sheet>
    </>
  );
}


/**
 * The app's two icons as two cards that overlap: tap to bring one to the front. The gradient one is earned with the first full
 * week (seven days in a row); after that either can be chosen at any time.
 */
function IconCards({ longest }: { longest: number }) {
  const settings = useStore((st) => st.settings);
  const unlocked = !!settings.iconUnlocked || longest >= 7;
  const using = settings.appIcon ?? 'classic';
  const [front, setFront] = useState<'classic' | 'gradient'>(using);
  useEffect(() => setFront(using), [using]);
  const pick = async (icon: 'classic' | 'gradient') => {
    tap('select');
    if (front !== icon) return setFront(icon);
    if (icon === using) return;
    if (icon === 'gradient' && !unlocked) return toast(`${7 - Math.min(7, longest)} more day${7 - longest === 1 ? '' : 's'} in a row to unlock it`);
    await updateSettings({ appIcon: icon });
    const ok = await appIconSet(icon);
    toast(ok ? 'App icon changed — the launcher may take a moment to show it' : 'Saved — the icon changes on the phone itself');
  };
  const card = (icon: 'classic' | 'gradient') => {
    const locked = icon === 'gradient' && !unlocked;
    return (
      <button key={icon} className={`icard ${icon}${front === icon ? ' front' : ''}${using === icon ? ' using' : ''}`} onClick={() => pick(icon)} aria-label={`${icon} icon${locked ? ', locked' : using === icon ? ', in use' : ''}`}>
        <img src={icon === 'classic' ? './icon-classic-512.png' : './icon-squircle-512.png'} alt="" draggable={false} />
        <b>{icon}</b>
        <small className="mono">{locked ? `locked · ${Math.min(7, longest)}/7 days` : using === icon ? 'in use' : front === icon ? 'tap to use' : icon === 'gradient' ? 'unlocked' : 'original'}</small>
        {locked && (
          <span className="lock" aria-hidden>
            <Icon name="timer" size={14} />
          </span>
        )}
      </button>
    );
  };
  return (
    <div className="icon-cards">
      <div className="section-label">app icon</div>
      <div className="icard-stack">{[card('classic'), card('gradient')]}</div>
      <p className="muted">
        {unlocked
          ? 'You reached a full week in a row, so the new gradient icon is yours. Tap a card to bring it forward, tap it again to use it.'
          : 'Read seven days in a row — your first full week — and the app icon turns from the classic one into the new gradient one. Tap the cards to see them side by side.'}
      </p>
    </div>
  );
}
