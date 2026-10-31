import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Sheet, toast } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { ConfirmSheet } from '../ui/Confirm';
import { connectComputer, disconnectDevice, listDevices, onSyncStatus, syncStatus, turnOff, type PairState } from '../lib/sync/engine';
import { WEB_URL } from '../lib/sync/config';

type Dev = { id: string; kind: string; label: string; created_at: string; last_seen: string };
const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

/** Settings → Use Frogity on a computer: a four-digit code to type on the computer, and the computers connected. */
export function ComputerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = useSyncExternalStore(onSyncStatus, syncStatus);
  const [pair, setPair] = useState<PairState | null>(null);
  const [devs, setDevs] = useState<Dev[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [ask, setAsk] = useState(false);
  const alive = useRef(false);

  const refresh = () => void listDevices().then((r) => setDevs(r.devices.filter((d) => d.kind === 'web')), () => setDevs([]));
  const start = () => {
    alive.current = true;
    void connectComputer(
      (s) => {
        setPair(s);
        if (s.stage === 'done') {
          toast(`Connected to ${s.label}`);
          refresh();
        }
      },
      () => !alive.current,
    );
  };
  useEffect(() => {
    if (!open) {
      alive.current = false;
      setPair(null);
      return;
    }
    if (st.on) refresh();
    else start();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      alive.current = false;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const left = pair?.stage === 'code' ? Math.min(180, Math.max(0, Math.round((pair.expires - now) / 1000))) : 0;
  const showCode = pair && pair.stage !== 'done';
  return (
    <>
      <Sheet open={open} onClose={onClose} title="Use Frogity on a computer">
        <div className="sheet-body" style={{ paddingBottom: 20 }}>
          {showCode ? (
            <>
              <p style={{ marginTop: 0 }}>
                On your computer, open <b className="mono">{WEB_URL}</b> and type this code:
              </p>
              <div className="pc-code" aria-live="polite">
                {pair.stage === 'code' ? (
                  pair.code.split('').map((d, i) => <span key={i}>{d}</span>)
                ) : pair.stage === 'joining' ? (
                  <span className="pc-emoji">{pair.emoji}</span>
                ) : pair.stage === 'error' ? null : (
                  <i className="pc-wait" />
                )}
              </div>
              <p className="muted mono" style={{ fontSize: 12.5, textAlign: 'center', minHeight: 20 }}>
                {pair.stage === 'code' && `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · a new code comes by itself`}
                {pair.stage === 'joining' && `Connecting ${pair.label} — the computer shows the same two pictures`}
                {pair.stage === 'starting' && 'Getting a code…'}
                {pair.stage === 'error' && pair.message}
              </p>
              {pair.stage === 'error' && (
                <button className="pill" style={{ width: '100%' }} onClick={start}>
                  Try again
                </button>
              )}
              <p className="muted" style={{ fontSize: 13 }}>
                No account or password. Your documents are encrypted on this phone before they leave it — the server in between only ever sees scrambled bytes. Edits on the computer come back here within a second.
              </p>
            </>
          ) : (
            <>
              <div className="pc-status">
                <i className={st.error ? 'err' : st.queue || st.sending ? 'busy' : ''} />
                <div>
                  <b>{st.error === 'offline' ? 'Offline — will sync when back online' : st.error ? 'Sync problem' : st.sending ? `Sending “${st.sending.slice(0, 28)}”` : st.queue ? `${st.queue} documents still to send` : 'Up to date'}</b>
                  <small>{st.error && st.error !== 'offline' ? st.error : `Open ${WEB_URL} on your computer`}</small>
                </div>
              </div>
              <div className="section-label">connected computers</div>
              {devs === null && <p className="muted">…</p>}
              {devs?.length === 0 && <p className="muted">None right now.</p>}
              {devs?.map((d) => (
                <div className="row" key={d.id}>
                  <Icon name="grid" />
                  <div className="grow">
                    <div className="row-label">{d.label}</div>
                    <div className="row-sub">
                      connected {ago(d.created_at)} · seen {ago(d.last_seen)}
                    </div>
                  </div>
                  <button
                    className="pill sm ghost"
                    onClick={async () => {
                      await disconnectDevice(d.id).catch(() => {});
                      toast(`${d.label} disconnected`);
                      refresh();
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              ))}
              <button className="pill" style={{ width: '100%', marginTop: 14 }} onClick={start}>
                Connect another computer
              </button>
              <button className="pill ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => setAsk(true)}>
                Stop syncing
              </button>
            </>
          )}
        </div>
      </Sheet>
      <ConfirmSheet
        open={ask}
        onClose={() => setAsk(false)}
        title="Stop syncing with computers?"
        body="Every computer is disconnected and the encrypted copy kept on the server is deleted. Everything on this phone stays as it is."
        confirmLabel="Stop syncing"
        onConfirm={async () => {
          setAsk(false);
          await turnOff(true);
          toast('Syncing stopped');
          onClose();
        }}
      />
    </>
  );
}
