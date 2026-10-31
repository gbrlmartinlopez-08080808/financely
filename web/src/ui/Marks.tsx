import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { updateMarks } from '../sync/engine';
import { openDoc } from './state';
import { Icon } from './Icon';
import { ago } from './bits';
import { exportMarks } from './actions';

/** Every highlight and note in the library, in one place. */
export function Marks() {
  const docs = useStore((s) => s.docs);
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const n = q.trim().toLowerCase();
    return docs
      .map((d) => ({ d, hs: d.meta.marks.h.filter((h) => !n || `${h.text} ${h.note ?? ''}`.toLowerCase().includes(n)).sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.at - b.at), bs: d.meta.marks.b.filter((b) => !b.auto) }))
      .filter((g) => g.hs.length || (!n && g.bs.length))
      .sort((a, b) => Math.max(...b.hs.map((h) => h.at), 0) - Math.max(...a.hs.map((h) => h.at), 0));
  }, [docs, q]);
  const total = groups.reduce((a, g) => a + g.hs.length, 0);
  return (
    <div className="marks-page">
      <div className="lib-head" style={{ maxWidth: 820 }}>
        <h1>
          Highlights<small>{total} across {groups.length} documents</small>
        </h1>
        <button className="btn ghost" onClick={() => exportMarks(groups.map((g) => g.d.id))}>
          <Icon name="download" size={15} /> Export as Markdown
        </button>
      </div>
      <input className="field" style={{ width: 'min(820px, 100%)', marginBottom: 24, background: 'var(--surface)', height: 38 }} placeholder="Search your highlights and notes" value={q} onChange={(e) => setQ(e.target.value)} />
      {groups.length === 0 && (
        <div className="empty" style={{ maxWidth: 820 }}>
          <h2>No highlights yet</h2>
          <p>Highlight on your phone or here (select text in a PDF and press H); they gather on this page.</p>
        </div>
      )}
      {groups.map(({ d, hs, bs }) => (
        <div key={d.id} className="doc-g">
          <h3>
            <button onClick={() => openDoc(d.id)}>{d.meta.doc.name}</button>
          </h3>
          {hs.map((h) => (
            <blockquote key={h.id}>
              <button style={{ textAlign: 'left', font: 'inherit' }} onClick={() => openDoc(d.id, h.page)}>
                {h.text}
              </button>
              {h.note && <p style={{ font: '14px var(--sans)', margin: '6px 0 0' }}>{h.note}</p>}
              <small>
                {h.page ? `page ${h.page} · ` : ''}
                {ago(h.at)} ·{' '}
                <button style={{ textDecoration: 'underline', font: 'inherit' }} onClick={() => updateMarks(d.id, (m, gone) => ((m.h = m.h.filter((x) => x.id !== h.id)), gone.push(h.id)))}>
                  remove
                </button>
              </small>
            </blockquote>
          ))}
          {bs.length > 0 && (
            <p className="mono muted" style={{ fontSize: 12 }}>
              Bookmarks:{' '}
              {bs.map((b) => (
                <button key={b.id} style={{ textDecoration: 'underline', marginRight: 10, font: 'inherit' }} onClick={() => openDoc(d.id, b.page)}>
                  {b.label || (b.page ? `page ${b.page}` : `${Math.round(b.progress * 100)}%`)}
                </button>
              ))}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
