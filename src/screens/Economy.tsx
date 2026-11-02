import { useEffect, useRef, useState } from 'react';
import { COUNTRIES, INDICATORS, economy, fx, type Country, type Fx, type Series } from '../lib/worldx';
import { PixelLoader } from '../ui/kit';
import { tap } from '../lib/native';

/** a line you can run a finger along: the value under the finger is read out */
export function Spark({ pts, fmt, height = 84, sub }: { pts: { label: string; v: number }[]; fmt: (v: number) => string; height?: number; sub?: string }) {
  const [i, setI] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 300;
  if (pts.length < 2) return null;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const span = hi - lo || 1;
  const xy = pts.map((p, k) => [8 + (k * (W - 16)) / (pts.length - 1), height - 10 - ((p.v - lo) / span) * (height - 24)] as const);
  const d = xy.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const cur = i ?? pts.length - 1;
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    setI(Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1)))));
  };
  return (
    <div className="spark">
      <div className="spark-r">
        <b className="mono">{fmt(pts[cur].v)}</b>
        <small className="mono">
          {pts[cur].label}
          {sub ? ` · ${sub}` : ''}
        </small>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        style={{ height, touchAction: 'pan-y' }}
        onPointerDown={at}
        onPointerMove={(e) => e.buttons || e.pointerType === 'touch' ? at(e) : undefined}
        onPointerLeave={() => setI(null)}
        onPointerUp={() => setI(null)}
        role="img"
        aria-label="Chart: run a finger along it to read values"
      >
        <path d={`${d} L${xy[xy.length - 1][0]},${height - 4} L${xy[0][0]},${height - 4} Z`} className="fill" />
        <path d={d} className="line" vectorEffect="non-scaling-stroke" />
        <line x1={xy[cur][0]} x2={xy[cur][0]} y1={4} y2={height - 4} className="cur" vectorEffect="non-scaling-stroke" />
        <circle cx={xy[cur][0]} cy={xy[cur][1]} r={3.6} className="dot" />
      </svg>
    </div>
  );
}

const ALL = COUNTRIES.map((c) => c.iso3);

/** a country's economy: five figures from the World Bank with their history, and the currency against a big one */
export function EconomyCard({ c }: { c: Country }) {
  const [data, setData] = useState<Record<string, Record<string, Series[]>> | null>(null);
  const [err, setErr] = useState(false);
  const [ind, setInd] = useState<string>(INDICATORS[1].id);
  const [rate, setRate] = useState<Fx | null>(null);
  useEffect(() => {
    let live = true;
    economy(ALL).then(
      (r) => live && setData(r),
      () => live && setErr(true),
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    // the currency against the dollar (the dollar itself is shown against the euro)
    fx(c.cur === 'USD' ? 'EUR' : c.cur, 'USD').then((r) => live && setRate(r), () => live && setRate(null));
    return () => {
      live = false;
    };
  }, [c.cur]);
  const mine = data?.[c.iso3];
  const meta = INDICATORS.find((x) => x.id === ind)!;
  const s = mine?.[ind];
  return (
    <div className="eco">
      <div className="eco-grid">
        {INDICATORS.map((m) => {
          const ser = mine?.[m.id];
          const last = ser?.[ser.length - 1];
          return (
            <button key={m.id} className={m.id === ind ? 'on' : ''} onClick={() => (tap('select'), setInd(m.id))}>
              <small className="mono">{m.label}</small>
              <b>{last ? m.short(last.v) : '–'}</b>
              <small className="mono">{last?.year ?? ''}</small>
            </button>
          );
        })}
      </div>
      {!data && !err && <PixelLoader size={4} gap={2} label="figures" />}
      {err && <p className="cg-note mono">the figures need a connection</p>}
      {s && s.length > 1 && <Spark pts={s.map((p) => ({ label: String(p.year), v: p.v }))} fmt={meta.fmt} sub={meta.label} />}
      {rate && rate.series.length > 1 && (
        <div className="eco-fx">
          <small className="mono">
            {rate.base} in {rate.quote} · last 90 days
          </small>
          <Spark pts={rate.series.map((p) => ({ label: p.date, v: p.v }))} fmt={(v) => `1 ${rate.base} = ${v.toFixed(v > 20 ? 1 : 3)} ${rate.quote}`} height={64} />
        </div>
      )}
      <p className="wd-src mono">World Bank (latest year reported) · exchange rates: European Central Bank via Frankfurter</p>
    </div>
  );
}
