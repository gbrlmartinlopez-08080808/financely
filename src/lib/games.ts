// The game: a frog on a lily pad that has to climb up out of the water, one way or the other — flicking its tongue at passing
// flies (quick, but a miss can end in a fall), or answering "deep cut" prompts (name something rare, the rarer the higher it goes).
// A level is won at the top; a win earns a block (one a day). Only two tries a day. Everything is made on the phone.
import * as db from './db';
import { dayKey } from './store';

export type Levels = { climb: number };

export async function getLevels(): Promise<Levels> {
  const l = await db.get<Partial<Levels>>('kv', 'games').catch(() => undefined);
  return { climb: l?.climb ?? 1 };
}
export const setLevels = (l: Levels) => db.put('kv', 'games', l);

/** two tries a day, whether they were won or lost */
export const TRIES_PER_DAY = 2;
export async function triesLeft(): Promise<number> {
  const u = await db.get<{ day: string; n: number }>('kv', 'gtries').catch(() => undefined);
  return Math.max(0, TRIES_PER_DAY - (u && u.day === dayKey() ? u.n : 0));
}
export async function spendTry(): Promise<number> {
  const u = await db.get<{ day: string; n: number }>('kv', 'gtries').catch(() => undefined);
  const n = (u && u.day === dayKey() ? u.n : 0) + 1;
  await db.put('kv', 'gtries', { day: dayKey(), n });
  return Math.max(0, TRIES_PER_DAY - n);
}

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

export interface Climb {
  goal: number; // rows to climb
  grip: number; // misses it can take before falling
  window: number; // seconds a fly is in reach
  bees: number; // 0–1: the chance a bee comes with the fly (a bee costs grip)
  slack: number; // answers the list does not know that are forgiven
}
export const climbLevel = (n: number): Climb => ({
  goal: Math.min(96, 14 + n * 4),
  grip: 3,
  window: Math.max(1.15, 2.7 - n * 0.13),
  bees: n < 3 ? 0 : Math.min(0.5, 0.1 * (n - 2)),
  slack: 3,
});
/** how far a prompt answer lifts the frog */
export const liftFor = (points: number) => Math.max(1, Math.min(5, 1 + Math.floor(points / 22)));
export const SLING_LIFT = 3;
