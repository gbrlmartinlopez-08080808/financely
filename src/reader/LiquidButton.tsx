import { useEffect, useId } from 'react';
import { tap } from '../lib/native';

const DROP = 'M12 2.6s6.9 7.4 6.9 12.5a6.9 6.9 0 0 1-13.8 0C5.1 10 12 2.6 12 2.6z';

/**
 * The Liquid-mode button is a drop that fills up as the Liquid view is prepared in the background. Until it is full
 * the pages keep working and tapping it just says how far it is; when it is full it is simply there, ready to open.
 */
export function LiquidButton({
  ready,
  progress,
  active,
  tip,
  onTip,
  onClick,
}: {
  ready: boolean;
  progress: number;
  active: boolean;
  tip: boolean;
  onTip: (v: boolean) => void;
  onClick: () => void;
}) {
  const id = useId().replace(/:/g, '');
  const level = ready ? 1 : Math.max(0.06, Math.min(0.96, progress));
  const y = 22 - level * 19.4; // top of the water, in the drop's own units
  useEffect(() => {
    if (!tip) return;
    const t = setTimeout(() => onTip(false), 3200);
    return () => clearTimeout(t);
  }, [tip]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = Math.round(progress * 100);
  return (
    <span className="liq-wrap">
      <button
        className={`liqbtn${ready ? ' ready' : ''}${active ? ' on' : ''}`}
        onClick={() => {
          tap(ready ? 'select' : 'light');
          onClick();
        }}
        aria-label={ready ? (active ? 'Back to the pages' : 'Open Liquid mode') : `Liquid mode is being prepared, ${pct}%`}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden>
          <defs>
            <clipPath id={`c${id}`}>
              <path d={DROP} />
            </clipPath>
          </defs>
          <g clipPath={`url(#c${id})`}>
            <g className="water" style={{ transform: `translateY(${y}px)` }}>
              <path className="wave" d="M-12 0 q3 -1.6 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 V30 H-12z" />
              <path className="wave b" d="M-12 0.6 q3 -1.4 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 V30 H-12z" />
            </g>
          </g>
          <path className="rim" d={DROP} />
        </svg>
      </button>
      {tip && (
        <span className="liq-tip" role="status">
          {ready ? 'Liquid mode is ready' : <>Liquid mode is being prepared · <b>{pct}%</b><small>Keep reading the pages. It opens here as soon as it is full.</small></>}
        </span>
      )}
    </span>
  );
}
