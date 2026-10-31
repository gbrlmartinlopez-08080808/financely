import { useEffect, useMemo, useRef, useState } from 'react';
import { docById, getState, useStore } from '../lib/store';
import { KIND_LABEL } from '../lib/kinds';
import { importFiles } from '../sync/engine';
import { getUi, openDoc, setUi } from './state';
import { commandsOf, type Command } from './commands';
import { Icon } from './Icon';
import { pickFiles } from './bits';
import { exportMarks, newDocument } from './actions';

interface Row {
  key: string;
  group: string;
  label: string;
  hint?: string;
  icon: string;
  run: () => void;
}
const theme = () => {
  const cur = document.documentElement.dataset.theme;
  const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('frogity-theme', next);
};

/** ⌘K: every document and every action, one keystroke away. */
export function Palette() {
  const docs = useStore((s) => s.docs);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const close = () => setUi({ palette: false });
  const active = getUi().active;

  const rows = useMemo<Row[]>(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const ok = (s: string) => words.every((w) => s.toLowerCase().includes(w));
    const here: Command[] = docById(active) ? commandsOf(active) : [];
    const global: Row[] = [
      { key: 'g-new', group: 'Actions', label: 'New document', hint: '⌘⌥N', icon: 'edit', run: () => void newDocument() },
      { key: 'g-add', group: 'Actions', label: 'Add files from this computer', hint: '⌘O', icon: 'plus', run: () => void pickFiles().then((f) => (f.length ? importFiles(f) : [])) },
      { key: 'g-lib', group: 'Actions', label: 'Go to the library', hint: '⌘1', icon: 'grid', run: () => setUi({ active: 'library' }) },
      { key: 'g-marks', group: 'Actions', label: 'All highlights and notes', icon: 'hl', run: () => setUi({ active: 'marks' }) },
      { key: 'g-export', group: 'Actions', label: 'Export every highlight as Markdown', icon: 'download', run: () => void exportMarks(getState().docs.map((d) => d.id)) },
      { key: 'g-split-off', group: 'Actions', label: 'Close the side-by-side view', icon: 'split', run: () => setUi({ split: null }) },
      { key: 'g-theme', group: 'Actions', label: 'Switch light / dark', icon: 'moon', run: theme },
      { key: 'g-dev', group: 'Actions', label: 'Devices and sync', icon: 'phone', run: () => setUi({ dialog: 'devices' }) },
      { key: 'g-keys', group: 'Actions', label: 'Keyboard shortcuts', hint: '?', icon: 'keyboard', run: () => setUi({ dialog: 'keys' }) },
    ];
    const cmdRows: Row[] = here.map((c) => ({ key: 'c-' + c.id, group: 'This document', label: c.label, hint: c.hint, icon: c.icon ?? 'right', run: c.run }));
    const docRows: Row[] = docs.map((d) => ({ key: 'd-' + d.id, group: 'Documents', label: d.meta.doc.name, hint: KIND_LABEL[d.meta.doc.kind], icon: 'book', run: () => openDoc(d.id) }));
    const splitRows: Row[] =
      words[0] === 'beside' || words[0] === 'split'
        ? docs.map((d) => ({ key: 's-' + d.id, group: 'Open beside', label: `Beside: ${d.meta.doc.name}`, icon: 'split', run: () => setUi((u) => ({ split: d.id, tabs: u.tabs.includes(d.id) ? u.tabs : [...u.tabs, d.id] })) }))
        : [];
    const all = [...cmdRows, ...global, ...splitRows, ...docRows];
    if (!words.length) return [...cmdRows, ...docRows.slice(0, 6), ...global];
    const rest = words[0] === 'beside' || words[0] === 'split' ? words.slice(1) : words;
    return all.filter((r) => rest.every((w) => r.label.toLowerCase().includes(w)) || ok(r.label)).slice(0, 60);
  }, [q, docs, active]);

  useEffect(() => setI(0), [q]);
  useEffect(() => {
    list.current?.querySelector('.item.on')?.scrollIntoView({ block: 'nearest' });
  }, [i]);
  const run = (r?: Row) => {
    if (!r) return;
    close();
    setTimeout(r.run, 0);
  };
  let lastGroup = '';
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Search and commands">
        <input
          autoFocus
          placeholder="Search documents and actions…  (try “beside”)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') (e.preventDefault(), setI((n) => Math.min(rows.length - 1, n + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setI((n) => Math.max(0, n - 1)));
            else if (e.key === 'Enter') run(rows[i]);
          }}
        />
        <div className="list" ref={list}>
          {rows.length === 0 && <div className="grp">Nothing found</div>}
          {rows.map((r, k) => {
            const head = r.group !== lastGroup ? ((lastGroup = r.group), <div className="grp">{r.group}</div>) : null;
            return (
              <div key={r.key}>
                {head}
                <button className={`item${k === i ? ' on' : ''}`} onMouseMove={() => setI(k)} onClick={() => run(r)}>
                  <Icon name={r.icon} size={16} />
                  <span>{r.label}</span>
                  {r.hint && <small>{r.hint}</small>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
