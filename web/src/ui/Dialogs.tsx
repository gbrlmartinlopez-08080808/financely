import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { devices, disconnect, pull } from '../sync/engine';
import { setUi } from './state';
import { Dialog, ago, ask } from './bits';
import { Icon } from './Icon';

type Dev = { id: string; kind: string; label: string; created_at: string; last_seen: string };

export function Devices() {
  const close = () => setUi({ dialog: null });
  const sync = useStore((s) => s.sync);
  const count = useStore((s) => s.docs.length);
  const [list, setList] = useState<{ devices: Dev[]; me: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    devices().then(setList, (e) => setErr((e as Error).message));
  }, []);
  return (
    <Dialog onClose={close}>
      <h3>Devices and sync</h3>
      <p className="muted" style={{ margin: '4px 0 14px', fontSize: 13 }}>
        {count} documents · {sync.error === 'offline' ? 'offline — changes are kept here and sent when back online' : sync.last ? `last synced ${ago(sync.last)}` : 'syncing'} · {sync.live ? 'live' : 'checking every 30 s'}
      </p>
      {err && <p className="muted">{err}</p>}
      {!list && !err && <i className="spin" />}
      {list?.devices.map((d) => (
        <div key={d.id} className="dev">
          <Icon name={d.kind === 'phone' ? 'phone' : 'laptop'} size={20} />
          <div className="g">
            {d.label}
            {d.id === list.me && <span className="mono muted" style={{ fontSize: 11 }}> · this computer</span>}
            <small>
              connected {ago(Date.parse(d.created_at))} · seen {ago(Date.parse(d.last_seen))}
            </small>
          </div>
        </div>
      ))}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
        Everything is end-to-end encrypted: the server only stores scrambled bytes. To disconnect another computer, use your phone (Settings → Use Frogity on a computer).
      </p>
      <div className="actions">
        <button className="btn ghost" onClick={() => void pull()}>
          <Icon name="sync" size={15} /> Sync now
        </button>
        <button
          className="btn ghost"
          style={{ color: '#c4351f' }}
          onClick={async () => {
            if (await ask('Disconnect this computer?', 'Its copy of your library is wiped from this browser. Your phone keeps everything. You can connect again with a new code.', 'Disconnect', true)) {
              close();
              await disconnect();
            }
          }}
        >
          <Icon name="logout" size={15} /> Disconnect this computer
        </button>
        <button className="btn" onClick={close}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

const KEYS: [string, string][] = [
  ['⌘K', 'Search documents and actions'],
  ['⌘O', 'Add files'],
  ['⌘⌥N', 'New document'],
  ['⌘1 … ⌘9', 'Library, then open tabs'],
  ['⌘W', 'Close the tab'],
  ['/', 'Search the library'],
  ['⌘F', 'Find in the document'],
  ['⌘S', 'Save changes (they also save by themselves)'],
  ['⌘Z / ⇧⌘Z', 'Undo / redo'],
  ['V T H D R N', 'PDF tools: select, text, highlight, draw, box, note'],
  ['G', 'Pages at a glance'],
  ['+ / −', 'Zoom'],
  ['Delete', 'Remove what is selected'],
  ['?', 'This list'],
];
export function Keys() {
  const close = () => setUi({ dialog: null });
  return (
    <Dialog onClose={close}>
      <h3>Keyboard shortcuts</h3>
      <p className="muted" style={{ margin: '4px 0 12px', fontSize: 13 }}>
        On Windows and Linux, ⌘ is Ctrl.
      </p>
      {KEYS.map(([k, v]) => (
        <div key={k} className="dev" style={{ padding: '7px 0' }}>
          <div className="g">{v}</div>
          <kbd>{k}</kbd>
        </div>
      ))}
      <div className="actions">
        <button className="btn" onClick={close}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
