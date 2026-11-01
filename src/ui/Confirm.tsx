import { Sheet } from './kit';
import { Icon } from './Icon';
import { PixelLoader } from './kit';
import { Art, type ArtName } from './Art';

/**
 * The selection mark: a softly rounded box with a stepped, pixel-cut tick. Sits between a plain vector tick and a
 * 9-pixel icon: round where it can be, pixel where it's the brand.
 */
export function Tick({ on, size = 26 }: { on: boolean; size?: number }) {
  // the tick is drawn from 3×3 squares stepping two units at a time
  const steps: [number, number][] = [
    [5, 11],
    [7, 13],
    [9, 15],
    [11, 13],
    [13, 11],
    [15, 9],
    [17, 7],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={`tickbox${on ? ' on' : ''}`}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="7" className="tb-box" />
      <g className="tb-mark" shapeRendering="crispEdges">
        {steps.map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="3" height="3" style={{ transitionDelay: `${i * 22}ms` }} />
        ))}
      </g>
    </svg>
  );
}

/** A confirmation that looks like the rest of the app: a little ASCII bin, plain words, two clear buttons. */
export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  names,
  total,
  confirmLabel,
  keepLabel = 'Keep',
  busy,
  art = 'bin',
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  names?: string[];
  total?: number;
  confirmLabel: string;
  keepLabel?: string;
  busy?: boolean;
  /** the picture on top: the bin for things that are deleted, something gentler for things that are only put away */
  art?: ArtName;
  onConfirm: () => void;
}) {
  const shown = (names ?? []).slice(0, 3);
  const more = (total ?? shown.length) - shown.length;
  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} className="over">
      <div className="sheet-body confirm">
        <Art name={art} className="confirm-art">
          {art === 'bin' && <span className="drop mono">[#]</span>}
        </Art>
        <h3>{title}</h3>
        <p>{body}</p>
        {!!shown.length && (
          <ul className="mono">
            {shown.map((n) => (
              <li key={n}>{n.length > 34 ? n.slice(0, 33) + '…' : n}</li>
            ))}
            {more > 0 && <li className="more">+ {more} more</li>}
          </ul>
        )}
        <div className="confirm-row">
          <button className="pill ghost" onClick={onClose} disabled={busy}>
            {keepLabel}
          </button>
          <button className="pill danger" onClick={onConfirm} disabled={busy}>
            {busy ? <PixelLoader size={3} gap={1.5} /> : <Icon name="trash" size={17} />} {confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
