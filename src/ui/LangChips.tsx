import { LANGS } from '../lib/voices';
import { tap } from '../lib/native';

/**
 * The reading language as a set of equal chips: every choice is visible at once, nothing opens on top, and picking one
 * changes only its colour (same size, same weight), so nothing around it shifts.
 */
export function LangChips({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <div className="lang-chips" role="radiogroup" aria-label="Reading language">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          role="radio"
          aria-checked={value === l.code}
          className={value === l.code ? 'on' : ''}
          onClick={() => {
            if (value === l.code) return;
            tap('select');
            onChange(l.code);
          }}
        >
          {l.code === 'other' ? 'Other' : l.label}
        </button>
      ))}
    </div>
  );
}
