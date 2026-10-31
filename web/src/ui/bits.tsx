import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useToasts } from '../lib/store';

export function Frog({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="currentColor" opacity="0" />
      <circle cx="10.5" cy="12" r="4" fill="#c8f169" />
      <circle cx="21.5" cy="12" r="4" fill="#c8f169" />
      <circle cx="10.5" cy="12" r="1.6" fill="#111" />
      <circle cx="21.5" cy="12" r="1.6" fill="#111" />
      <path d="M7 19.5q9 7 18 0" stroke="#c8f169" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Toasts() {
  const ts = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {ts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
          {t.action && <button onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

export const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`);
export function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: s > 86400 * 300 ? 'numeric' : undefined });
}

export function Dialog({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog">
        {children}
      </div>
    </div>
  );
}

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  run?: () => void;
  danger?: boolean;
  sep?: boolean;
  hidden?: boolean;
}
/** A right-click menu at the pointer. */
export function showMenu(e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) {
  e.preventDefault?.();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(<Menu x={e.clientX} y={e.clientY} items={items.filter((i) => !i.hidden)} close={close} />);
}
function Menu({ x, y, items, close }: { x: number; y: number; items: MenuItem[]; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ x: Math.min(x, innerWidth - r.width - 8), y: Math.min(y, innerHeight - r.height - 8) });
    const off = (ev: Event) => !ref.current?.contains(ev.target as Node) && close();
    const k = (ev: KeyboardEvent) => ev.key === 'Escape' && close();
    setTimeout(() => {
      window.addEventListener('mousedown', off);
      window.addEventListener('keydown', k);
      window.addEventListener('blur', close);
    });
    return () => {
      window.removeEventListener('mousedown', off);
      window.removeEventListener('keydown', k);
      window.removeEventListener('blur', close);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) =>
        it.sep ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            className={it.danger ? 'danger' : ''}
            onClick={() => {
              close();
              it.run?.();
            }}
          >
            {it.icon}
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}

/** Asks, in a small dialog, and resolves with the answer. */
export function ask(title: string, body: string, ok = 'OK', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: boolean) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(
      <Dialog onClose={() => done(false)}>
        <h3>{title}</h3>
        <p className="muted" style={{ marginTop: 6 }}>
          {body}
        </p>
        <div className="actions">
          <button className="btn ghost" onClick={() => done(false)}>
            Cancel
          </button>
          <button className="btn" style={danger ? { background: '#c4351f', color: '#fff' } : undefined} onClick={() => done(true)} autoFocus>
            {ok}
          </button>
        </div>
      </Dialog>,
    );
  });
}
/** Asks for a line of text. */
export function prompt(title: string, value = '', ok = 'Save'): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: string | null) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    function P() {
      const [v, setV] = useState(value);
      return (
        <Dialog onClose={() => done(null)}>
          <h3>{title}</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              done(v.trim() || null);
            }}
          >
            <input className="field" style={{ width: '100%', marginTop: 12 }} value={v} onChange={(e) => setV(e.target.value)} autoFocus onFocus={(e) => e.target.select()} />
            <div className="actions">
              <button type="button" className="btn ghost" onClick={() => done(null)}>
                Cancel
              </button>
              <button className="btn">{ok}</button>
            </div>
          </form>
        </Dialog>
      );
    }
    root.render(<P />);
  });
}

/** Lets the browser save a file. */
export function download(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
/** Opens the file picker. */
export function pickFiles(accept = '', multiple = true): Promise<File[]> {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
    i.onchange = () => res([...(i.files ?? [])]);
    i.click();
  });
}
