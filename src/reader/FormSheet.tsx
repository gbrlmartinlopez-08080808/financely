import { useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_PROFILE, autoFill, exportFilled, forgetSignature, loadProfile, loadSignature, saveProfile, saveSignature, today, type FormField, type FormModel, type Profile } from '../lib/forms';
import { onBack, saveFile, shareFile, tap } from '../lib/native';
import { Icon } from '../ui/Icon';
import { Pixel, PixelLoader, Sheet, Toggle, toast } from '../ui/kit';

// ------------------------------------------------------------------ signature pad
function SignaturePad({ saved, onDone, onCancel }: { saved?: string; onDone: (png: string, keep: boolean) => void; onCancel: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [empty, setEmpty] = useState(true);
  const [keep, setKeep] = useState(true);
  const pts = useRef<{ x: number; y: number; t: number }[]>([]);
  const box = useRef({ x0: 1e9, y0: 1e9, x1: -1, y1: -1 });

  useEffect(() => {
    const c = cv.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0c2a86';
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
  };
  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pts.current = [pos(e)];
    setEmpty(false);
  };
  const move = (e: React.PointerEvent) => {
    if (!pts.current.length) return;
    const ctx = cv.current!.getContext('2d')!;
    const p = pos(e);
    const a = pts.current[pts.current.length - 1];
    const prev = pts.current[pts.current.length - 2] ?? a;
    pts.current.push(p);
    // ink gets thinner the faster you move: looks like a pen
    const speed = Math.hypot(p.x - a.x, p.y - a.y) / Math.max(1, p.t - a.t);
    ctx.lineWidth = Math.max(1.4, 3.4 - speed * 1.6);
    ctx.beginPath();
    ctx.moveTo((prev.x + a.x) / 2, (prev.y + a.y) / 2);
    ctx.quadraticCurveTo(a.x, a.y, (a.x + p.x) / 2, (a.y + p.y) / 2);
    ctx.stroke();
    const b = box.current;
    b.x0 = Math.min(b.x0, p.x);
    b.y0 = Math.min(b.y0, p.y);
    b.x1 = Math.max(b.x1, p.x);
    b.y1 = Math.max(b.y1, p.y);
  };
  const up = () => {
    pts.current = [];
  };
  const clear = () => {
    const c = cv.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    box.current = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
    setEmpty(true);
  };
  const finish = () => {
    const c = cv.current!;
    const dpr = c.width / c.getBoundingClientRect().width;
    const b = box.current;
    const pad = 8;
    const sx = Math.max(0, Math.floor((b.x0 - pad) * dpr));
    const sy = Math.max(0, Math.floor((b.y0 - pad) * dpr));
    const sw = Math.min(c.width - sx, Math.ceil((b.x1 - b.x0 + pad * 2) * dpr));
    const sh = Math.min(c.height - sy, Math.ceil((b.y1 - b.y0 + pad * 2) * dpr));
    const out = document.createElement('canvas');
    out.width = Math.max(1, sw);
    out.height = Math.max(1, sh);
    out.getContext('2d')!.drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height);
    onDone(out.toDataURL('image/png'), keep);
  };

  return (
    <div className="sigpad">
      <canvas ref={cv} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Draw your signature here" />
      {empty && <span className="hint mono">sign here with your finger</span>}
      <div className="sigbar">
        <button className="pill sm ghost" onClick={clear} disabled={empty}>
          Clear
        </button>
        {saved && (
          <button className="pill sm ghost" onClick={() => onDone(saved, false)}>
            Use my saved one
          </button>
        )}
        <span className="grow" />
        <label className="keep mono">
          <Toggle on={keep} onChange={setKeep} label="Remember my signature" /> keep
        </label>
        <button className="pill sm" onClick={finish} disabled={empty}>
          Done
        </button>
        <button className="pill sm round ghost" onClick={onCancel} aria-label="Cancel">
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the sheet
export function FormSheet({
  open,
  onClose,
  model,
  docName,
  getData,
  onAddToLibrary,
}: {
  open: boolean;
  onClose: () => void;
  model: FormModel;
  docName: string;
  getData: () => Promise<ArrayBuffer>;
  onAddToLibrary: (blob: Blob, name: string) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sigs, setSigs] = useState<Record<string, string>>({});
  const [signing, setSigning] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | undefined>();
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [details, setDetails] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flatten, setFlatten] = useState(true);
  const started = useRef(false);

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    const init: Record<string, string> = {};
    model.fields.forEach((f) => f.value && (init[f.id] = f.value));
    Promise.all([loadProfile(), loadSignature()]).then(([p, s]) => {
      setProfile(p);
      setSaved(s);
      // fill what we already know
      setValues(autoFill(model.fields, p, init));
    });
  }, [open, model]);
  useEffect(() => {
    if (!open) return;
    return onBack(() => {
      if (signing) setSigning(null);
      else if (exporting) setExporting(false);
      else if (details) setDetails(false);
      else onClose();
      return true;
    });
  }, [open, signing, exporting, details, onClose]);

  const set = (id: string, v: string) => setValues((x) => ({ ...x, [id]: v }));
  const isDone = (f: FormField) => (f.kind === 'sign' ? !!sigs[f.id] : f.kind === 'check' ? values[f.id] === 'true' : !!values[f.id]);
  const done = model.fields.filter(isDone).length;
  const groups = useMemo(() => {
    const m = new Map<number, FormField[]>();
    model.fields.forEach((f) => m.set(f.page, [...(m.get(f.page) ?? []), f]));
    return [...m.entries()];
  }, [model]);

  const build = async () => {
    const data = await getData();
    return exportFilled(data, model, values, sigs, flatten);
  };
  const outName = `${docName.replace(/\.pdf$/i, '')} (filled).pdf`;
  const run = async (what: 'save' | 'share' | 'library') => {
    setBusy(what);
    try {
      const bytes = await build();
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      if (what === 'save') toast(await saveFile(blob, outName));
      else if (what === 'share') await shareFile(blob, outName);
      else {
        await onAddToLibrary(blob, outName);
        toast('Added to your shelf');
      }
      setExporting(false);
    } catch (e) {
      console.warn(e);
      toast('Couldn’t write the PDF — ' + ((e as Error).message || 'unknown error'));
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;
  return (
    <div className="formfill" role="dialog" aria-label="Fill this form">
      <div className="ff-top">
        <button className="r-ibtn" onClick={onClose} aria-label="Back">
          <Icon name="back" size={24} />
        </button>
        <div className="grow">
          <h2>Fill this form</h2>
          <span className="mono">
            {done} of {model.fields.length} filled
          </span>
        </div>
      </div>
      <div className="ff-bar" aria-hidden>
        <i style={{ width: `${model.fields.length ? (done / model.fields.length) * 100 : 0}%` }} />
      </div>
      <div className="ff-actions">
        <button className="pill sm ghost" onClick={() => (tap('medium'), setValues((v) => autoFill(model.fields, profile, v)), toast('Filled in what I know'))}>
          <Pixel name="spark" size={14} /> Fill from my details
        </button>
        <button className="pill sm ghost" onClick={() => setDetails(true)}>
          My details
        </button>
      </div>

      <div className="ff-list">
        {groups.map(([page, fs]) => (
          <section key={page}>
            {groups.length > 1 && <h3 className="mono">page {page}</h3>}
            {fs.map((f) => (
              <div className={`ff-card${isDone(f) ? ' done' : ''}${signing === f.id ? ' signing' : ''}`} key={f.id}>
                <label className="ff-label mono" htmlFor={f.id}>
                  {f.label}
                </label>
                {f.kind === 'text' && <input id={f.id} value={values[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)} autoCapitalize="words" enterKeyHint="next" />}
                {f.kind === 'multiline' && <textarea id={f.id} rows={3} value={values[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)} />}
                {f.kind === 'date' && (
                  <div className="ff-date">
                    <input id={f.id} type="date" value={values[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)} />
                    <button className="pill sm ghost" onClick={() => set(f.id, today())}>
                      Today
                    </button>
                  </div>
                )}
                {f.kind === 'check' && (
                  <button className="ff-check" onClick={() => (tap('select'), set(f.id, values[f.id] === 'true' ? 'false' : 'true'))} aria-pressed={values[f.id] === 'true'}>
                    <Pixel name={values[f.id] === 'true' ? 'boxon' : 'box'} size={28} />
                    <span>{values[f.id] === 'true' ? 'Yes' : 'No'}</span>
                  </button>
                )}
                {f.kind === 'choice' &&
                  (f.options && f.options.length <= 4 ? (
                    <div className="ff-choices">
                      {f.options.map((o) => (
                        <button key={o} className={values[f.id] === o ? 'on' : ''} onClick={() => (tap('select'), set(f.id, o))}>
                          {o}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <select id={f.id} value={values[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)}>
                      <option value="">Choose…</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ))}
                {f.kind === 'sign' &&
                  (signing === f.id ? (
                    <SignaturePad
                      saved={saved}
                      onCancel={() => setSigning(null)}
                      onDone={async (png, keep) => {
                        setSigs((s) => ({ ...s, [f.id]: png }));
                        setSigning(null);
                        if (keep) {
                          await saveSignature(png);
                          setSaved(png);
                        }
                        tap('medium');
                      }}
                    />
                  ) : (
                    <button className={`ff-sign${sigs[f.id] ? ' has' : ''}`} onClick={() => setSigning(f.id)}>
                      {sigs[f.id] ? <img src={sigs[f.id]} alt="Your signature" /> : <span className="mono">tap to sign</span>}
                    </button>
                  ))}
              </div>
            ))}
          </section>
        ))}
        <div style={{ height: 110 }} />
      </div>

      <div className="ff-foot">
        <button className="pill" onClick={() => setExporting(true)}>
          Export PDF <Icon name="right" size={16} stroke={2.4} />
        </button>
      </div>

      <Sheet open={details} onClose={() => setDetails(false)} title="My details">
        <div className="sheet-body">
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
            Kept only on this phone. Used to fill the obvious boxes (name, email, address…) — you can always change what it puts in.
          </p>
          {(
            [
              ['name', 'Full name'],
              ['email', 'Email'],
              ['phone', 'Phone'],
              ['address', 'Street address'],
              ['city', 'City'],
              ['zip', 'Postcode'],
              ['country', 'Country'],
              ['dob', 'Date of birth'],
            ] as [keyof Profile, string][]
          ).map(([k, label]) => (
            <input key={k} className="field" style={{ marginBottom: 8 }} placeholder={label} type={k === 'dob' ? 'date' : k === 'email' ? 'email' : 'text'} value={profile[k]} onChange={(e) => setProfile((p) => ({ ...p, [k]: e.target.value }))} aria-label={label} />
          ))}
          <div className="ff-actions" style={{ padding: '6px 0 0' }}>
            <button
              className="pill"
              onClick={async () => {
                await saveProfile(profile);
                setValues((v) => autoFill(model.fields, profile, v));
                setDetails(false);
                toast('Saved on this phone');
              }}
            >
              Save and fill
            </button>
            {saved && (
              <button
                className="pill ghost"
                onClick={async () => {
                  await forgetSignature();
                  setSaved(undefined);
                  toast('Saved signature removed');
                }}
              >
                Forget my signature
              </button>
            )}
          </div>
        </div>
      </Sheet>

      <Sheet open={exporting} onClose={() => (busy ? undefined : setExporting(false))} title="Export">
        <div className="sheet-body">
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
            {done} of {model.fields.length} fields filled{done < model.fields.length ? ' — you can still go back and finish.' : '.'}
          </p>
          {model.kind === 'acro' && (
            <div className="row" style={{ padding: '4px 0' }}>
              <div className="grow">
                <div className="row-label">Lock the answers in</div>
                <div className="row-sub">Looks the same in every PDF app and can’t be edited by accident.</div>
              </div>
              <Toggle on={flatten} onChange={setFlatten} label="Lock the answers in" />
            </div>
          )}
          <div className="actions">
            <button className="action" disabled={!!busy} onClick={() => run('save')}>
              <span className="ic">
                <Pixel name="down" size={16} />
              </span>
              Save PDF to Documents/Frogity
              {busy === 'save' && <PixelLoader size={3} gap={1.5} />}
            </button>
            <button className="action" disabled={!!busy} onClick={() => run('share')}>
              <span className="ic">
                <Icon name="share" />
              </span>
              Share or email…
              {busy === 'share' && <PixelLoader size={3} gap={1.5} />}
            </button>
            <button className="action" disabled={!!busy} onClick={() => run('library')}>
              <span className="ic">
                <Pixel name="book" size={16} />
              </span>
              Add to my library
              {busy === 'library' && <PixelLoader size={3} gap={1.5} />}
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
