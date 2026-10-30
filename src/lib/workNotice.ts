// A notification for the reading that happens in the background (scans, Liquid mode, pictures in documents): you
// can see from the notification shade how far it has got and what is still waiting, and it says when it is ready.
import { registerPlugin } from '@capacitor/core';
import { isNative } from './native';
import { notifyPermission } from './reminders';
import { runningJobs, subscribeJobs, type ScanJob } from './scan';

interface WorkPlugin {
  show(o: { title: string; text: string; progress: number; max: number }): Promise<void>;
  done(o: { title: string; text: string }): Promise<void>;
  clear(): Promise<void>;
}
const Work = registerPlugin<WorkPlugin>('Work');

export const kindLabel = (k: ScanJob['kind']) => (k === 'scan' ? 'Reading the scan' : k === 'liquid' ? 'Preparing Liquid mode' : k === 'voice' ? 'Downloading your voice' : 'Reading the pictures');
export const left = (j: ScanJob) => (j.total ? `${Math.max(0, j.total - j.done)} left` : '…');

let started = false;
/** Starts watching the background work. Call once. */
export function initWorkNotice() {
  if (started || !isNative) return;
  started = true;
  let t = 0;
  let had = false;
  let asked = false;
  const finished: string[] = [];
  window.addEventListener('frogity:scan', (e) => {
    const title = (e as CustomEvent<{ title: string }>).detail.title;
    if (!finished.includes(title)) finished.push(title);
  });
  const sync = async () => {
    const r = runningJobs();
    if (r.length) {
      if (!asked) {
        asked = true;
        if (!(await notifyPermission(true))) return;
      }
      had = true;
      const j = r[0];
      const more = r.length - 1;
      const title = j.title.length > 30 ? j.title.slice(0, 30) + '…' : j.title;
      Work.show({
        title: `${kindLabel(j.kind)} · ${title}`,
        text: `${j.total ? `${j.done} of ${j.total}` : 'working'} · ${left(j)}${more ? ` · ${more} more waiting` : ''}`,
        progress: Math.round(j.progress * 100),
        max: 100,
      }).catch(() => {});
    } else if (had) {
      had = false;
      const names = finished.splice(0);
      if (names.length) Work.done({ title: names.length === 1 ? `“${names[0]}” is ready to read` : `${names.length} books are ready to read`, text: 'Liquid mode, Listen and search are ready.' }).catch(() => {});
      else Work.clear().catch(() => {});
    }
  };
  subscribeJobs(() => {
    clearTimeout(t);
    t = window.setTimeout(sync, 900);
  });
}
