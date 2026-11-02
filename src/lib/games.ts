// The little games: a frog game and a knowledge game. Every level is different, and gets harder. Winning a level earns a block
// (one a day); five blocks make a freeze day. Everything here is made on the phone — nothing to fetch, nothing that can run out.
import * as db from './db';

export type GameKind = 'frog' | 'mind';
export type Levels = Record<GameKind, number>;

export async function getLevels(): Promise<Levels> {
  const l = await db.get<Levels>('kv', 'games').catch(() => undefined);
  return { frog: l?.frog ?? 1, mind: l?.mind ?? 1 };
}
export const setLevels = (l: Levels) => db.put('kv', 'games', l);

/** a small seeded random generator: the same level on the same day is the same game, a different level is a different one */
export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const shuffle = <T,>(r: () => number, a: T[]) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};

// ------------------------------------------------------------------------------------------------ the frog game
export interface FrogLevel {
  target: number; // flies to catch
  seconds: number;
  speed: number; // cells per second
  flies: number; // on screen at once
  bees: number; // 0–1: how often what appears is a bee (do not catch those)
  lives: number;
}
export const frogLevel = (n: number): FrogLevel => ({
  target: Math.min(26, 4 + n * 2),
  seconds: Math.min(40, 22 + n),
  speed: Math.min(9, 3.2 + n * 0.45),
  flies: Math.min(7, 2 + Math.floor(n / 2)),
  bees: n < 3 ? 0 : Math.min(0.4, 0.08 * (n - 2)),
  lives: 3,
});

// ------------------------------------------------------------------------------------------------ the knowledge game
export interface Question {
  q: string;
  options: string[];
  a: number;
  kind: 'knowledge' | 'sequence' | 'sum' | 'odd';
  note?: string;
}
type Row = [string, string, string, string, string];
const EASY: Row[] = [
  ['Which planet is known as the Red Planet?', 'Mars', 'Venus', 'Jupiter', 'Mercury'],
  ['How many continents are there?', '7', '5', '6', '8'],
  ['Which gas do plants take in from the air?', 'Carbon dioxide', 'Oxygen', 'Nitrogen', 'Helium'],
  ['Which animal is the largest on Earth?', 'Blue whale', 'African elephant', 'Giraffe', 'Great white shark'],
  ['What is the capital of France?', 'Paris', 'Lyon', 'Marseille', 'Nice'],
  ['Which is the largest ocean?', 'Pacific', 'Atlantic', 'Indian', 'Arctic'],
  ['How many legs does a spider have?', '8', '6', '10', '12'],
  ['Which is the fastest land animal?', 'Cheetah', 'Lion', 'Horse', 'Greyhound'],
  ['At what temperature (°C) does water freeze?', '0', '10', '−10', '32'],
  ['Who painted the Mona Lisa?', 'Leonardo da Vinci', 'Michelangelo', 'Raphael', 'Van Gogh'],
  ['Which instrument has black and white keys?', 'Piano', 'Guitar', 'Violin', 'Drum'],
  ['Which country is home to the kangaroo?', 'Australia', 'Brazil', 'Kenya', 'India'],
  ['Which part of a plant takes in water from the soil?', 'Roots', 'Leaves', 'Flowers', 'Seeds'],
  ['What is the largest mammal on land?', 'African elephant', 'Rhinoceros', 'Hippopotamus', 'Bison'],
  ['Which language has the most native speakers?', 'Mandarin Chinese', 'English', 'Spanish', 'Hindi'],
  ['What do bees make?', 'Honey', 'Silk', 'Milk', 'Sugar'],
];
const MID: Row[] = [
  ['What is the chemical symbol for gold?', 'Au', 'Ag', 'Go', 'Gd'],
  ['Who wrote “Pride and Prejudice”?', 'Jane Austen', 'Charlotte Brontë', 'George Eliot', 'Mary Shelley'],
  ['What is the smallest prime number?', '2', '0', '1', '3'],
  ['In which year did humans first land on the Moon?', '1969', '1965', '1972', '1961'],
  ['What is the capital of Australia?', 'Canberra', 'Sydney', 'Melbourne', 'Perth'],
  ['Which blood cells carry oxygen?', 'Red blood cells', 'White blood cells', 'Platelets', 'Plasma'],
  ['Which river carries the most water in South America?', 'Amazon', 'Orinoco', 'Paraná', 'Magdalena'],
  ['Who developed the theory of general relativity?', 'Albert Einstein', 'Isaac Newton', 'Niels Bohr', 'Max Planck'],
  ['Which is the largest hot desert?', 'Sahara', 'Gobi', 'Kalahari', 'Arabian'],
  ['Which element has atomic number 1?', 'Hydrogen', 'Helium', 'Oxygen', 'Carbon'],
  ['How many strings does a standard violin have?', '4', '3', '5', '6'],
  ['What does DNA stand for?', 'Deoxyribonucleic acid', 'Dinitrogen acid', 'Double nucleic acid', 'Deoxyribose nitrate'],
  ['Which philosopher wrote “The Republic”?', 'Plato', 'Aristotle', 'Descartes', 'Kant'],
  ['Which civilisation built Machu Picchu?', 'Inca', 'Aztec', 'Maya', 'Olmec'],
  ['What is the currency of Japan?', 'Yen', 'Won', 'Yuan', 'Ringgit'],
  ['What is the capital of Canada?', 'Ottawa', 'Toronto', 'Vancouver', 'Montreal'],
];
const HARD: Row[] = [
  ['Roughly how fast does light travel?', '300,000 km/s', '30,000 km/s', '3,000,000 km/s', '150,000 km/s'],
  ['Who was the first woman to win a Nobel Prize?', 'Marie Curie', 'Rosalind Franklin', 'Dorothy Hodgkin', 'Lise Meitner'],
  ['Which battle ended Napoleon’s rule in 1815?', 'Waterloo', 'Austerlitz', 'Trafalgar', 'Borodino'],
  ['What is the powerhouse of the cell?', 'Mitochondrion', 'Nucleus', 'Ribosome', 'Golgi apparatus'],
  ['The Rosetta Stone helped scholars read which writing?', 'Egyptian hieroglyphs', 'Linear B', 'Cuneiform', 'Runes'],
  ['Which is the deepest known ocean trench?', 'Mariana Trench', 'Puerto Rico Trench', 'Java Trench', 'Tonga Trench'],
  ['Who composed “The Four Seasons”?', 'Vivaldi', 'Bach', 'Handel', 'Mozart'],
  ['Which gas is most abundant in Earth’s atmosphere?', 'Nitrogen', 'Oxygen', 'Carbon dioxide', 'Argon'],
  ['In which year did the Berlin Wall fall?', '1989', '1991', '1987', '1985'],
  ['Who is credited with discovering penicillin?', 'Alexander Fleming', 'Louis Pasteur', 'Joseph Lister', 'Robert Koch'],
  ['What is the SI unit of force?', 'Newton', 'Joule', 'Watt', 'Pascal'],
  ['“Cogito, ergo sum” is associated with which thinker?', 'Descartes', 'Spinoza', 'Hume', 'Nietzsche'],
  ['Which is the longest bone in the human body?', 'Femur', 'Tibia', 'Humerus', 'Fibula'],
  ['Which metal is liquid at room temperature?', 'Mercury', 'Lead', 'Tin', 'Zinc'],
  ['Which Greek letter stands for the ratio of a circle’s circumference to its diameter?', 'Pi', 'Phi', 'Sigma', 'Omega'],
  ['Which country has the most time zones, counting its overseas territories?', 'France', 'Russia', 'United States', 'China'],
];
const fromRow = (r: () => number, [q, a, ...w]: Row): Question => {
  const options = shuffle(r, [a, ...w]);
  return { q, options, a: options.indexOf(a), kind: 'knowledge' };
};

const near = (r: () => number, v: number, spread: number, n = 3) => {
  const s = new Set<number>();
  let guard = 0;
  while (s.size < n && guard++ < 60) {
    const d = Math.max(1, Math.round((r() * 2 - 1) * spread)) || 1;
    if (v + d !== v && v + d >= 0) s.add(v + d);
  }
  return [...s];
};
const withOptions = (r: () => number, q: string, v: number, spread: number, kind: Question['kind'], note?: string): Question => {
  const o = shuffle(r, [v, ...near(r, v, spread)]).map(String);
  return { q, options: o, a: o.indexOf(String(v)), kind, note };
};

function sequence(r: () => number, level: number): Question {
  const t = Math.floor(r() * Math.min(5, 2 + level / 2));
  let terms: number[] = [];
  let note = '';
  if (t === 0) {
    const a = 1 + Math.floor(r() * 9), d = 2 + Math.floor(r() * (3 + level));
    terms = Array.from({ length: 6 }, (_, i) => a + d * i);
    note = `Each number is ${d} more than the one before.`;
  } else if (t === 1) {
    const a = 1 + Math.floor(r() * 4), m = 2 + Math.floor(r() * 2);
    terms = Array.from({ length: 6 }, (_, i) => a * m ** i);
    note = `Each number is ${m} times the one before.`;
  } else if (t === 2) {
    const s = 1 + Math.floor(r() * 4);
    terms = Array.from({ length: 6 }, (_, i) => (i + s) ** 2);
    note = 'These are square numbers.';
  } else if (t === 3) {
    const a = 1 + Math.floor(r() * 3), b = 2 + Math.floor(r() * 4);
    terms = [a, b];
    for (let i = 2; i < 6; i++) terms.push(terms[i - 1] + terms[i - 2]);
    note = 'Each number is the sum of the two before it.';
  } else {
    const a = 3 + Math.floor(r() * 8), d1 = 2 + Math.floor(r() * 4), d2 = 1 + Math.floor(r() * 3);
    terms = [a];
    for (let i = 1; i < 6; i++) terms.push(terms[i - 1] + (i % 2 ? d1 : -d2));
    note = `The steps alternate: +${d1}, −${d2}.`;
  }
  const hide = 4 + Math.floor(r() * 2);
  const v = terms[hide];
  const shown = terms.slice(0, hide + 1).map((x, i) => (i === hide ? '?' : String(x))).join(', ');
  return withOptions(r, `What comes next in the pattern?\n${shown}`, v, Math.max(3, Math.round(v * 0.25)), 'sequence', note);
}
function sum(r: () => number, level: number): Question {
  const big = Math.min(12, 2 + level);
  const a = 6 + Math.floor(r() * (8 * big)), b = 4 + Math.floor(r() * (6 * big));
  const k = Math.floor(r() * 3);
  if (k === 0) return withOptions(r, `${a} + ${b} = ?`, a + b, 6, 'sum');
  if (k === 1) return withOptions(r, `${a + b} − ${b} = ?`, a, 6, 'sum');
  const x = 3 + Math.floor(r() * (4 + level)), y = 3 + Math.floor(r() * 8);
  return withOptions(r, `${x} × ${y} = ?`, x * y, 8, 'sum');
}
const SETS: [string, string[], string[]][] = [
  ['mammals', ['Dog', 'Cat', 'Whale', 'Bat', 'Horse', 'Dolphin'], ['Eagle', 'Owl', 'Penguin', 'Sparrow']],
  ['fruit', ['Apple', 'Pear', 'Grape', 'Mango', 'Plum'], ['Carrot', 'Potato', 'Onion', 'Leek']],
  ['planets', ['Mars', 'Venus', 'Earth', 'Saturn', 'Neptune'], ['Sirius', 'Vega', 'Rigel', 'Polaris']],
  ['metals', ['Iron', 'Copper', 'Zinc', 'Tin', 'Gold'], ['Oxygen', 'Neon', 'Helium', 'Argon']],
  ['capital cities', ['Paris', 'Rome', 'Madrid', 'Berlin', 'Lisbon'], ['Sydney', 'Zurich', 'Milan', 'Toronto']],
  ['musical instruments', ['Flute', 'Cello', 'Oboe', 'Harp', 'Trumpet'], ['Easel', 'Chisel', 'Anvil', 'Loom']],
];
function odd(r: () => number): Question {
  const [name, a, b] = pick(r, SETS);
  const out = pick(r, b);
  const options = shuffle(r, [...shuffle(r, a).slice(0, 3), out]);
  return { q: 'Which one does not belong with the others?', options, a: options.indexOf(out), kind: 'odd', note: `The others are ${name}.` };
}

/** Five questions for a level: facts that get harder, and puzzles made fresh (patterns, sums, the odd one out). */
export function mindLevel(level: number, day: number): Question[] {
  const r = rng(level * 7919 + day * 31);
  const tier = level <= 3 ? [EASY, EASY, MID] : level <= 7 ? [EASY, MID, MID, HARD] : [MID, HARD, HARD];
  const bank = shuffle(r, pick(r, tier)).slice(0, 4);
  const facts = [...new Set([...bank, ...shuffle(r, pick(r, tier))])].slice(0, 2).map((row) => fromRow(r, row));
  return shuffle(r, [...facts, sequence(r, level), sum(r, level), r() < 0.5 ? odd(r) : fromRow(r, pick(r, level > 6 ? HARD : MID))]);
}
