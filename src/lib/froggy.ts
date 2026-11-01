// Froggy: the little frog that is Frogity's face. It stands in where the logo cannot (a small sheet, an empty shelf, a
// thinking assistant) and its mood changes with what is going on. Faces are drawn on the same three-line grid, so a
// face can change into another without anything moving.
export type Mood = 'neutral' | 'happy' | 'bigSmile' | 'sad' | 'surprised' | 'angry' | 'worried' | 'smug' | 'wink' | 'silly' | 'dizzy' | 'sleepy';

const eyes = '(@) (@)';
const FACES: Record<Mood, [string, string, string]> = {
  neutral: ['  _   _  ', ` ${eyes} `, '(   -   )'],
  happy: ['  _   _  ', ` ${eyes} `, '(   v   )'],
  bigSmile: ['  _   _  ', ` ${eyes} `, '(  \\_/  )'],
  sad: ['  _   _  ', ` ${eyes} `, '(   ^   )'],
  surprised: ['  _   _  ', ` ${eyes} `, '(   O   )'],
  angry: ['  \\   /  ', ` ${eyes} `, '(   -   )'],
  worried: ['  /   \\  ', ` ${eyes} `, '(   ~   )'],
  smug: ['  _   _  ', ` ${eyes} `, '(   ~   )'],
  wink: ['  _   _  ', ' (@) (-) ', '(   -   )'],
  silly: ['  _   _  ', ` ${eyes} `, '(   P   )'],
  dizzy: ['  _   _  ', ` ${eyes} `, '(  ~~~  )'],
  sleepy: ['  _   _  ', ` ${eyes} zZ`, '(   -   )'],
};
export const MOODS = Object.keys(FACES) as Mood[];

/** The face as text. `blink` closes the eyes; `mouth` replaces the mouth character (used for talking). */
export function froggyFace(mood: Mood = 'neutral', opts: { blink?: boolean; mouth?: string } = {}): string {
  const f = [...FACES[mood]] as [string, string, string];
  if (opts.blink && mood !== 'sleepy') f[1] = f[1].replace(/\(@\)/g, '(-)');
  if (mood === 'sleepy') f[1] = ' (-) (-) zZ';
  if (opts.mouth) f[2] = f[2].replace(/^\(\s{3}.\s{3}\)$/, `(   ${opts.mouth}   )`);
  return f.join('\n');
}

/** A mood picked by a seed (a day, a book, a question), so the same thing always gets the same face but different things differ. */
export function moodFor(seed: string, among: Mood[] = ['happy', 'bigSmile', 'wink', 'smug', 'silly']): Mood {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return among[Math.abs(h) % among.length];
}

/** What Froggy says when it has nothing better to say: a few lines for each situation, picked by a seed. */
export const LINES = {
  hello: ['Ribbit. Ask me anything about what you are reading.', 'I read it too. What would you like to know?', 'Hop in — what shall we look at?'],
  thinking: ['hmm…', 'let me look…', 'one moment…', 'reading closely…'],
  sorry: ['That did not work. Try once more?', 'My pond lost signal. Again?'],
  tired: ['Froggy needs a nap until midnight.', 'That is all my free answers for today.'],
};
export const line = (set: keyof typeof LINES, seed = String(Date.now())) => LINES[set][Math.abs([...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % LINES[set].length];
