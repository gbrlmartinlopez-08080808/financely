import { Froggy } from './Froggy';
import type { Mood } from '../lib/froggy';

/**
 * The little picture at the top of a small sheet. Every kind of action has its own, so a sheet that deletes something
 * never looks like one that only takes it off the shelf, or one that says thank you.
 */
export type ArtName = 'bin' | 'shelf' | 'scan' | 'convert' | 'star' | 'book' | 'voice' | `froggy:${Mood}`;

const SCENES: Record<Exclude<ArtName, `froggy:${string}`>, string[]> = {
  bin: ['       ___       ', '   ___/___\\___   ', '   \\_________/   ', '    | | | | |    ', '    | | | | |    ', "    '-------'    "],
  // taken off the shelf, but the file stays where it is
  shelf: ['  _____  _____   ', ' |  _  ||     |  ', ' | | | || ... |→ ', ' | |_| ||_____|  ', ' |_____|         ', ' ===============  '],
  scan: ['   .---------.   ', '   | [  _  ] |   ', '   | [ /_\\ ] |   ', '   |  -----  |   ', '   |_________|   ', '   ~ ~ ~ ~ ~ ~   '],
  convert: ['  ┌──────┐       ', '  │ .pdf │ ──┐   ', '  └──────┘   │   ', '       ┌─────▼─┐ ', '       │ .txt  │ ', '       └───────┘ '],
  star: ['        *        ', '   .   /|\\   .   ', '  ----<   >----  ', '   ´  \\|/  `    ', '       ´ `       ', '                 '],
  book: ['    _________    ', '   /  ___  /|   ', '  /_ /___/_/ |   ', '  |  Frogity| |  ', '  |_________|/   ', '                 '],
  voice: ['     .-"""-.     ', '    (  ) ) )     ', '   ( ( ( (  )    ', '    `-.....-´    ', '    ~  ~  ~  ~   ', '                 '],
};

export function Art({ name, className = '', children }: { name: ArtName; className?: string; children?: React.ReactNode }) {
  return (
    <div className={`art-card ${className}`}>
      {children}
      {name.startsWith('froggy:') ? (
        <Froggy mood={name.slice(7) as Mood} size="md" />
      ) : (
        <pre className="art-scene" aria-hidden>
          {SCENES[name as keyof typeof SCENES].join('\n')}
        </pre>
      )}
    </div>
  );
}
