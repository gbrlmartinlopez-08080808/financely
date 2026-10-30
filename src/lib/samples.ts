// Two free, openly licensed samples that are on the shelf from the very first launch (next to the welcome guide):
// a famous novel (James Joyce's Ulysses, public domain) and an economics paper. They ship inside the app, so they open instantly and offline.
import * as db from './db';
import { importFile } from './library';
import { getState, patchDoc, removeDoc } from './store';

interface Sample {
  file: string;
  name: string;
  title: string;
  author: string;
}

export const SAMPLES: Sample[] = [
  { file: 'samples/ulysses.epub', name: 'Ulysses.epub', title: 'Ulysses', author: 'James Joyce' },
  { file: 'samples/roodman-fertility.pdf', name: 'The impact of life-saving interventions on fertility.pdf', title: 'The impact of life-saving interventions on fertility', author: 'David Roodman' },
];

/** Adds the samples once (a new set gets a new key), in the background, placing them just behind the guide on the shelf. */
export async function addSamples(behind: number) {
  const KEY = 'samples:v2';
  if (await db.get('kv', KEY)) return;
  await db.put('kv', KEY, Date.now()); // set first: a failed download is not retried on every launch
  // the first set had Little Brother here: swap it out if it was never opened
  for (const d of getState().docs)
    if (d.name === 'Little Brother' && d.author === 'Cory Doctorow' && !d.readMs && d.progress < 0.01) await removeDoc(d.id);
  let k = 0;
  for (const s of SAMPLES) {
    try {
      if (getState().docs.some((d) => d.name === s.title)) continue; // already on the shelf
      const res = await fetch(new URL(s.file, document.baseURI).href);
      if (!res.ok) continue;
      const blob = await res.blob();
      const meta = await importFile(blob, s.name, { title: s.title, author: s.author });
      await patchDoc(meta.id, { name: s.title, author: s.author, openedAt: behind - 1000 * ++k }, true);
    } catch (e) {
      console.warn('sample failed', s.title, e);
    }
  }
}
