import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, updateSettings } from '../lib/store';
import { displayName } from '../lib/cheer';
import { lightsFor, renderGlobe } from '../lib/globe';
import { plantStage } from '../lib/ascii';
import { GLYPHS, glyphFor } from '../lib/glyphs';
import { Icon } from '../ui/Icon';
import { Pixel, Ruler } from '../ui/kit';
import { tap } from '../lib/native';
import type { PixelName } from '../lib/pixels';

export type Finish = 'add' | 'guide' | 'none';

/** Seconds since mount, ticking ~every `ms` (for ASCII animations). */
function useClock(ms = 100) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const id = setInterval(() => !document.hidden && setT((performance.now() - t0) / 1000), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

const Card = ({ children }: { children: React.ReactNode; tall?: boolean }) => (
  <div className="ob-card">
    {children}
  </div>
);

// ------------------------------------------------------------------ stages
function GlobeStage({ n = 9, blinkToday }: { n?: number; blinkToday?: boolean }) {
  const t = useClock(110);
  const lights = useMemo(() => lightsFor(Array.from({ length: n }, (_, i) => `ob-${i}-day`), blinkToday ? 'ob-today' : ''), [n, blinkToday]);
  const all = useMemo(() => (blinkToday ? [...lights, ...lightsFor(['ob-today'], 'ob-today')] : lights), [lights, blinkToday]);
  const html = renderGlobe({ cols: 40, rows: 20, rot: -20 + t * 16, lights: all, t });
  return (
    <Card>
      <pre dangerouslySetInnerHTML={{ __html: html }} aria-hidden />
    </Card>
  );
}

function HelloStage({ name }: { name: string }) {
  const t = useClock(90);
  const full = `hello, ${name || '…'}`;
  const shown = full.slice(0, Math.min(full.length, Math.floor(t * 9)));
  const caret = Math.floor(t * 2.2) % 2 === 0 ? '█' : ' ';
  return (
    <Card>
      <pre className="ob-big" aria-hidden>
        {`\n\n${shown}${caret}\n\n`}
      </pre>
    </Card>
  );
}

const WHY = [
  { px: 'moon', text: 'Phones are loud. Pages are quiet.' },
  { px: 'clock', text: 'Ten minutes of reading is ten minutes that are only yours.' },
  { px: 'sprout', text: 'Attention grows back, the way a plant does — a little each day.' },
] as const;

function WhyStage() {
  const t = useClock(120);
  const stage = Math.floor(t / 2.4) % 4;
  const art = plantStage([1, 3, 7, 14][stage]);
  const lines = Math.min(3, 1 + Math.floor(t / 2.4)) ;
  return (
    <>
      <Card>
        <pre aria-hidden>{art}</pre>
      </Card>
      <ul className="ob-why">
        {WHY.slice(0, lines).map((w) => (
          <li key={w.text}>
            <Pixel name={w.px as PixelName} size={16} />
            <span>{w.text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

const EXTS = ['PDF', 'EPUB', 'DOCX', 'ODT', 'RTF', 'MD', 'HTML', 'TXT', 'PPTX', 'XLSX', 'CSV', 'JPG', 'PNG', 'MP3', 'MP4', 'JS', 'PY', 'URL'];
function AnythingStage() {
  return (
    <Card>
      {[0, 1, 2].map((row) => (
        <div className={`ob-belt r${row}`} key={row} aria-hidden>
          <div>
            {[...EXTS.slice(row * 3), ...EXTS.slice(0, row * 3), ...EXTS.slice(row * 3), ...EXTS.slice(0, row * 3)].map((e, i) => (
              <span key={i}>{e}</span>
            ))}
          </div>
        </div>
      ))}
      <pre aria-hidden>{`\n   \\   \\   |   /   /\n    \\   \\  |  /   /\n     '-._\\ | /_.-'\n         \\|/\n     .----'----.\n     |  quire  |\n     '---------'`}</pre>
      <p className="ob-cap mono">opens in place · nothing is copied</p>
    </Card>
  );
}

const PARA = 'Selective state space models let a network filter what it remembers, so long sequences cost far less than attention while keeping accuracy.';
function wrap(text: string, w: number) {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if ((cur + ' ' + word).trim().length > w) {
      out.push(cur);
      cur = word;
    } else cur = (cur + ' ' + word).trim();
  }
  if (cur) out.push(cur);
  return out;
}
function LiquidStage() {
  const t = useClock(90);
  const w = Math.round(34 + 12 * Math.sin(t * 0.9));
  const lines = wrap(PARA, w);
  const pad = (s: string) => s.padEnd(46, ' ');
  const eq = 'h′(t) = A h(t) + B x(t)';
  const body = lines.map((l) => pad(l)).join('\n');
  const col = (s: string) => s.split('\n').map((l) => l.slice(0, 46)).join('\n');
  return (
    <Card tall>
      <pre className="ob-left" aria-hidden>
        {col(body)}
        {'\n\n'}
        {eq.padStart(Math.round((w + eq.length) / 2), ' ')}
        {'\n\n'}
        {col(wrap('Each step carries a hidden state forward — nothing in the formula is lost on the way.', w).join('\n'))}
      </pre>
      <p className="ob-cap mono">
        {w >= 40 ? 'the page, as printed' : w >= 30 ? 'reflowing…' : 'liquid: one calm column'} · {w} cols
      </p>
    </Card>
  );
}

function ListenStage() {
  const t = useClock(80);
  const words = 'Quire reads every page aloud while the sentence stays lit.'.split(' ');
  const cur = Math.floor(t * 2.6) % (words.length + 3);
  const BL = '▁▂▃▄▅▆▇█';
  const bars = Array.from({ length: 34 }, (_, i) => BL[Math.floor((Math.sin(t * 5 + i * 0.7) * 0.5 + 0.5) * (Math.sin(t * 1.7 + i * 0.25) * 0.4 + 0.6) * 7.99)]).join('');
  return (
    <Card>
      <pre aria-hidden>{`\n${bars}\n${bars.split('').reverse().join('').replace(/./g, (c) => (c === '█' ? '▀' : c === '▇' ? '▀' : ' '))}\n`}</pre>
      <p className="ob-karaoke">
        {words.map((w, i) => (
          <span key={i} className={i === cur ? 'on' : i < cur ? 'done' : ''}>
            {w}{' '}
          </span>
        ))}
      </p>
    </Card>
  );
}

function LookupStage() {
  return (
    <Card tall>
      <p className="ob-sentence">
        A chance meeting, pure <span className="ob-word">serendipity</span>, changed everything.
        <i className="ob-press" aria-hidden />
      </p>
      <div className="ob-lookup mono" aria-hidden>
        <b>serendipity</b> <em>noun</em>
        <p>luck that finds you while you were looking for something else.</p>
        <p className="muted">origin: Serendip (Sri Lanka) · Horace Walpole, 1754</p>
        <p className="muted">+ wikipedia · pictures · maths</p>
      </div>
    </Card>
  );
}

function AskStage() {
  const t = useClock(70);
  const q = 'what is the main idea?';
  const a = 'Slow reading is a different kind of attention, not a lack of speed.';
  const loop = t % 9;
  const qs = loop > 8.4 ? '' : q.slice(0, Math.floor(loop * 14));
  const as = loop > 2.2 && loop < 8.4 ? a.slice(0, Math.floor((loop - 2.2) * 22)) : '';
  return (
    <Card tall>
      <div className="ob-chat">
        <div className="u mono" style={{ opacity: qs ? 1 : 0 }}>{qs || q}</div>
        {as && <div className="a mono">{as}▍</div>}
      </div>
      <div className="ob-icons" aria-hidden>
        <span><Pixel name="spark" size={20} />ask</span>
        <span><Pixel name="scan" size={20} />scan</span>
        <span><Pixel name="convert" size={20} />convert</span>
      </div>
    </Card>
  );
}

function StreakStage({ name }: { name: string }) {
  const t = useClock(60);
  const cells = 7 * 12;
  const upto = Math.min(cells, Math.floor(t * 18));
  const rows = Array.from({ length: 7 }, (_, r) =>
    Array.from({ length: 12 }, (_, c) => {
      const i = c * 7 + r;
      if (i >= upto) return '·';
      const h = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      const ms = h < 0.14 ? 0 : [2, 8, 20, 40, 75][Math.floor(h * 5.5) % 5] * 60000;
      return glyphFor(ms).ch;
    }).join(' '),
  );
  const streak = Math.min(12, Math.floor(upto / 7) + 1);
  return (
    <Card>
      <p className="ob-cap mono top">{displayName(name) || 'you'} · day {Math.min(streak, 12)} <Pixel name="flame" size={12} style={{ verticalAlign: -1 }} /></p>
      <pre aria-hidden>{rows.join('\n')}</pre>
      <p className="ob-cap mono">{GLYPHS.slice().reverse().map((g) => `${g.ch} ${g.label}`).join('  ')} min</p>
    </Card>
  );
}

function ReadyStage() {
  return (
    <>
      <GlobeStage n={0} blinkToday />
      <div className="ob-burst" aria-hidden>
        {Array.from({ length: 36 }, (_, i) => (
          <i key={i} style={{ ['--a' as string]: `${(i * 37) % 360}deg`, ['--d' as string]: `${70 + ((i * 53) % 90)}px`, animationDelay: `${(i % 6) * 70}ms` }} />
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ steps
interface StepDef {
  id: string;
  title: (n: string) => string;
  body: (n: string, goal: number) => React.ReactNode;
  cta: string;
}

const STEPS: StepDef[] = [
  { id: 'hello', title: () => 'Read anything. Beautifully.', body: () => 'Quire is a quiet place for everything you read. Free, private, and yours — no account, no ads.', cta: 'Begin' },
  { id: 'name', title: () => 'What should I call you?', body: () => 'Only for little hellos. It never leaves this phone.', cta: 'Continue' },
  { id: 'why', title: (n) => (n ? `${n}, why read at all?` : 'Why read at all?'), body: () => 'Because the best part of your day might be the part where nothing is asking for you.', cta: 'I’m in' },
  { id: 'anything', title: () => 'Open absolutely anything.', body: () => 'PDFs, books, Word, slides, spreadsheets, web links, scans, even code. Files open where they live — no copies, no clutter.', cta: 'Next' },
  { id: 'liquid', title: () => 'Liquid mode keeps the maths.', body: () => 'Two-column papers become one calm column that fits your phone. Equations stay crisp. Flip back to the original page any time.', cta: 'Next' },
  { id: 'listen', title: () => 'Let it read to you.', body: () => 'Tap Listen and the page is read aloud in your phone’s voices, at your pace, sentence by sentence.', cta: 'Next' },
  { id: 'lookup', title: () => 'Press a word. Know it.', body: () => 'Hold any word for its meaning, origin, Wikipedia entry and pictures — in a card, without leaving the page.', cta: 'Next' },
  { id: 'ask', title: () => 'Questions, scans, conversions.', body: () => 'Ask your document anything (free, optional, only with your OK). Scan paper with OCR. Convert to other formats.', cta: 'Next' },
  { id: 'streak', title: (n) => (n ? `${n}, let’s keep a quiet streak.` : 'Let’s keep a quiet streak.'), body: () => 'One minute a day lights a place on your globe, and a mark in your calendar — heavier the longer you read. Miss a day and nothing shouts. The light just waits.', cta: 'Sounds good' },
  {
    id: 'goal',
    title: () => 'How much, each day?',
    body: (_n, goal) => `${goal} minutes a day is about ${Math.round((goal * 365) / 60)} hours a year — a few very good books.`,
    cta: 'Set my goal',
  },
  { id: 'ready', title: (n) => (n ? `${n}, day one starts now.` : 'Day one starts now.'), body: () => 'Your first light is blinking. Pick a book, or begin with the short guide. Everything stays on your phone.', cta: '' },
];

export function Onboarding({ onDone }: { onDone: (f: Finish) => void }) {
  const settings = useStore((s) => s.settings);
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [draft, setDraft] = useState(displayName(settings.name));
  const step = STEPS[i];
  const name = displayName(draft || settings.name);
  const scroller = useRef<HTMLDivElement>(null);

  const go = (d: number) => {
    const n = Math.max(0, Math.min(STEPS.length - 1, i + d));
    if (n === i) return;
    tap('select');
    if (step.id === 'name') updateSettings({ name: draft.trim() || 'reader' });
    setDir(d);
    setI(n);
    scroller.current?.scrollTo(0, 0);
  };

  const stage = (() => {
    switch (step.id) {
      case 'hello':
        return <GlobeStage n={14} />;
      case 'name':
        return <HelloStage name={name} />;
      case 'why':
        return <WhyStage />;
      case 'anything':
        return <AnythingStage />;
      case 'liquid':
        return <LiquidStage />;
      case 'listen':
        return <ListenStage />;
      case 'lookup':
        return <LookupStage />;
      case 'ask':
        return <AskStage />;
      case 'streak':
        return <StreakStage name={name} />;
      case 'goal':
        return <GlobeStage n={Math.max(3, Math.round(settings.dailyGoal / 5))} />;
      default:
        return <ReadyStage />;
    }
  })();

  return (
    <div className="ob" role="dialog" aria-label={`Welcome, step ${i + 1} of ${STEPS.length}`}>
      <div className="ob-top">
        <button className="ob-back" onClick={() => go(-1)} aria-label="Back" style={{ visibility: i === 0 ? 'hidden' : 'visible' }}>
          <Icon name="back" size={22} />
        </button>
        <div className="ob-steps" aria-hidden>
          {STEPS.map((s, k) => (
            <i key={s.id} className={k < i ? 'done' : k === i ? 'now' : ''} />
          ))}
        </div>
        <span className="ob-count mono">
          {String(i + 1).padStart(2, '0')}/{STEPS.length}
        </span>
      </div>

      <div className="ob-scroll" ref={scroller}>
        <div className="ob-page" key={step.id} data-dir={dir}>
          <div className="ob-stage">{stage}</div>
          {step.id === 'hello' && <img className="ob-mark" src="./mark.png" alt="" width={56} height={56} />}
          <h1>{step.title(name)}</h1>
          <p className="ob-body">{step.body(name, settings.dailyGoal)}</p>

          {step.id === 'name' && (
            <form
              className="ob-name"
              onSubmit={(e) => {
                e.preventDefault();
                go(1);
              }}
            >
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 24))} placeholder="your first name" maxLength={24} aria-label="Your name" enterKeyHint="next" />
            </form>
          )}
          {step.id === 'goal' && (
            <div className="ob-ruler">
              <Ruler value={settings.dailyGoal} min={5} max={120} step={5} onChange={(v) => updateSettings({ dailyGoal: v })} format={(v) => `${v} min`} label="Daily goal" />
            </div>
          )}
        </div>
      </div>

      <div className="ob-foot">
        {step.id === 'ready' ? (
          <>
            <button className="ob-cta" onClick={() => onDone('add')}>
              <Pixel name="plus" size={16} /> Add my first file
            </button>
            <button className="ob-ghost" onClick={() => onDone('guide')}>
              Open the short guide
            </button>
            <button className="ob-link mono" onClick={() => onDone('none')}>
              explore on my own
            </button>
          </>
        ) : (
          <>
            <button className="ob-cta" onClick={() => go(1)}>
              {step.cta} <Icon name="right" size={18} stroke={2.4} />
            </button>
            {step.id === 'name' ? (
              <button className="ob-link mono" onClick={() => { setDraft(''); go(1); }}>
                skip — just “reader”
              </button>
            ) : (
              <button className="ob-link mono" onClick={() => onDone('guide')} style={{ visibility: i < 2 ? 'visible' : 'hidden' }}>
                skip intro
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
