import { useEffect, useMemo, useRef, useState } from 'react';
import type { SheetData } from '../lib/formats/flow';
import { blobToAscii } from '../lib/ascii';
import { escapeHtml } from '../lib/sanitize';
import { Segmented } from '../ui/kit';

export function SheetView({ sheets }: { sheets: SheetData[] }) {
  const [si, setSi] = useState(0);
  const [mode, setMode] = useState<'cards' | 'grid'>(() => (window.innerWidth < 600 ? 'cards' : 'grid'));
  const s = sheets[si] ?? { name: '', rows: [] };
  const [limit, setLimit] = useState(200);
  const header = s.rows[0] ?? [];
  const body = s.rows.slice(1, limit + 1);
  return (
    <div className="sheet-table-wrap">
      <div style={{ display: 'flex', gap: 8, padding: '0 var(--r-margin) 14px', alignItems: 'center', flexWrap: 'wrap' }}>
        <Segmented
          light
          value={mode}
          onChange={setMode}
          options={[
            { value: 'cards', label: 'Cards' },
            { value: 'grid', label: 'Grid' },
          ]}
        />
        {sheets.length > 1 && (
          <div className="filters" style={{ padding: 0 }}>
            {sheets.map((x, i) => (
              <button key={x.name} className={i === si ? 'on' : ''} onClick={() => setSi(i)}>
                {x.name}
              </button>
            ))}
          </div>
        )}
        <span className="mono" style={{ fontSize: 11, color: 'var(--r-muted)', marginLeft: 'auto' }}>
          {Math.max(0, s.rows.length - 1)} rows · {header.length} cols
        </span>
      </div>
      {mode === 'grid' ? (
        <div style={{ overflowX: 'auto', padding: '0 0 0 0' }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th>#</th>
                {header.map((h, i) => (
                  <th key={i}>{h || colName(i)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  <td className="n">{ri + 1}</td>
                  {header.map((_, ci) => (
                    <td key={ci}>{r[ci]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cards">
          {body.map((r, ri) => (
            <div className="card-row" key={ri}>
              <div className="n">row {ri + 1}</div>
              <dl>
                {header.map((h, ci) =>
                  r[ci] ? (
                    <div key={ci} style={{ display: 'contents' }}>
                      <dt>{h || colName(ci)}</dt>
                      <dd>{r[ci]}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            </div>
          ))}
        </div>
      )}
      {s.rows.length - 1 > limit && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <button className="pill ghost sm" onClick={() => setLimit((l) => l + 500)}>
            Show more rows
          </button>
        </div>
      )}
    </div>
  );
}

const colName = (i: number) => {
  let s = '';
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
};

export function ImageView({ url, onTap }: { url: string; onTap: () => void }) {
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ d: number; s: number; x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  return (
    <div
      className="imgview"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const p = [...pts.current.values()];
        start.current = { d: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0, s: t.s, x: t.x, y: t.y, px: e.clientX, py: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        if (!pts.current.has(e.pointerId) || !start.current) return;
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const p = [...pts.current.values()];
        const st = start.current;
        if (Math.abs(e.clientX - st.px) + Math.abs(e.clientY - st.py) > 6) st.moved = true;
        if (p.length > 1 && st.d) setT((v) => ({ ...v, s: Math.max(1, Math.min(8, (st.s * Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)) / st.d)) }));
        else if (t.s > 1) setT((v) => ({ ...v, x: st.x + e.clientX - st.px, y: st.y + e.clientY - st.py }));
      }}
      onPointerUp={(e) => {
        pts.current.delete(e.pointerId);
        if (start.current && !start.current.moved && pts.current.size === 0) onTap();
        start.current = null;
      }}
      onDoubleClick={() => setT((v) => (v.s > 1 ? { s: 1, x: 0, y: 0 } : { ...v, s: 2.5 }))}
    >
      <img src={url} alt="" draggable={false} style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }} />
    </div>
  );
}

export function MediaView({ url, kind, name }: { url: string; kind: 'audio' | 'video'; name: string }) {
  const art = useMemo(
    () => String.raw`
   .-------------------.
   |  .-----.  .-----. |
   | ( o   o )( o   o )|
   |  '-----'  '-----' |
   |   ${'~'.repeat(13)}   |
   '-------------------'`,
    [],
  );
  return (
    <div className="media">
      {kind === 'video' ? (
        <video src={url} controls playsInline preload="metadata" />
      ) : (
        <>
          <pre aria-hidden>{art}</pre>
          <div className="mono" style={{ fontSize: 13, textAlign: 'center' }}>
            {name}
          </div>
          <audio src={url} controls preload="metadata" />
        </>
      )}
    </div>
  );
}

export function CodeView({ text, onTap }: { text: string; onTap: () => void }) {
  const lines = useMemo(() => text.replace(/\r\n?/g, '\n').split('\n').slice(0, 20000), [text]);
  const html = useMemo(() => lines.map((l, i) => `<div class="ln" data-n="${i + 1}">${escapeHtml(l) || ' '}</div>`).join(''), [lines]);
  return <div className="code-view" onClick={onTap} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function BinaryView({ hex, size, onAsText }: { hex: string; size: number; onAsText: () => void }) {
  return (
    <div className="binary">
      <p style={{ fontFamily: 'var(--sans)', fontSize: 15 }}>This file type can’t be previewed yet. Here are its first bytes ({size.toLocaleString()} bytes total).</p>
      <p style={{ opacity: 0.7, lineHeight: 1.7 }}>{hex}</p>
      <button className="pill ghost" onClick={onAsText}>
        Try opening as text
      </button>
    </div>
  );
}

export function AsciiCover({ blob, cols = 46 }: { blob?: Blob; cols?: number }) {
  const [art, setArt] = useState('');
  useEffect(() => {
    if (!blob) return;
    blobToAscii(blob, cols).then(setArt, () => setArt(''));
  }, [blob, cols]);
  return <pre>{art}</pre>;
}
