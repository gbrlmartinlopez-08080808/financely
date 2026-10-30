// Two free, openly licensed samples that are on the shelf from the very first launch (next to the welcome guide):
// a famous modern novel and an economics paper. They ship inside the app, so they open instantly and offline.
import * as db from './db';
import { importFile } from './library';
import { patchDoc } from './store';

interface Sample {
  file: string;
  name: string;
  title: string;
  author: string;
}

export const SAMPLES: Sample[] = [
  { file: 'samples/little-brother.epub', name: 'Little Brother.epub', title: 'Little Brother', author: 'Cory Doctorow' },
  { file: 'samples/roodman-fertility.pdf', name: 'The impact of life-saving interventions on fertility.pdf', title: 'The impact of life-saving interventions on fertility', author: 'David Roodman' },
];

/** Adds the samples once, in the background, placing them just behind the guide on the shelf. */
export async function addSamples(behind: number) {
  if (await db.get('kv', 'samples')) return;
  await db.put('kv', 'samples', Date.now()); // set first: a failed download is not retried on every launch
  let k = 0;
  for (const s of SAMPLES) {
    try {
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
