// One game, two ways up. Froggy sits on a lily pad in the water and has to climb to the blossom at the top:
//   • sling — pull the thumb back and let go: the big tongue flies the other way, sticks to a passing fly, and Froggy swings
//     from fly to fly (a missed grab means falling — into the water, if nothing catches it);
//   • deep cuts — name something rare: the tongue soars as high as the answer is rare, Froggy follows it and lands on a lily
//     that floats there for a while (a slip drops it back down).
// Only reaching the top counts: that is the block. Two tries a day. Everything is made on the phone.
import * as db from './db';
import { dayKey } from './store';

export type Variant = 'sling' | 'deep';
export type Levels = Record<Variant, number>;

export async function getLevels(): Promise<Levels> {
  const l = await db.get<Partial<Levels>>('kv', 'games2').catch(() => undefined);
  return { sling: l?.sling ?? 1, deep: l?.deep ?? 1 };
}
export const setLevels = (l: Levels) => db.put('kv', 'games2', l);

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

export interface SlingCfg {
  goal: number; // height of the blossom, in pixels of the playing field
  hold: number; // seconds a fly stays caught before it wriggles free
  bees: number; // 0–1: how many of the flies are bees (a bee is a fall)
  drift: number; // how far the flies wander
  gap: number; // the usual distance between flies
}
export const slingLevel = (n: number): SlingCfg => ({
  goal: Math.min(5000, 1500 + (n - 1) * 200),
  hold: Math.max(2.2, 3.4 - n * 0.12),
  bees: n < 4 ? 0 : Math.min(0.3, 0.07 * (n - 3)),
  drift: 16 + n * 3,
  gap: Math.min(190, 130 + n * 5),
});

export interface DeepCfg {
  goal: number; // metres to the top
  seconds: number; // per prompt
  slack: number; // answers Froggy cannot place that are forgiven
}
export const deepLevel = (n: number): DeepCfg => ({ goal: 230 + (n - 1) * 60, seconds: Math.max(18, 34 - n), slack: 3 });
