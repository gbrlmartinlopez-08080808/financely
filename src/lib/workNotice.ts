// A notification for the reading that happens in the background (scans, Liquid mode, pictures in documents): you
// can see from the notification shade how far it has got and what is still waiting, and it says when it is ready.
import { registerPlugin } from '@capacitor/core';
import { isNative } from './native';
import { notifyPermission } from './reminders';
import { runningJobs, subscribeJobs, type ScanJob } from './scan';

interface WorkPlugin {
  show(o: { title: string; text: string; progress: number; max: number; idle?: boolean }): Promise<void>;
  done(o: { title: string; text: string }): Promise<void>;
  clear(): Promise<void>;
  battery(): Promise<{ free: boolean }>;
  askBattery(): Promise<void>;
}
const Work = registerPlugin<WorkPlugin>('Work');

/** Is Frogity left out of the phone's battery saving (so it can keep reading with the app closed)? */
export const workFree = async () => (isNative ? (await Work.battery().catch(() => ({ free: true }))).free : true);
/** Opens the phone's own question: may Frogity keep working in the background? */
export const askWorkFree = () => (isNative ? Work.askBattery().catch(() => {}) : Promise.resolve());

export const kindLabel = (k: ScanJob['kind']) => (k === 'scan' ? 'Reading the scan' : k === 'liquid' ? 'Preparing Liquid mode' : k === 'voice' ? 'Downloading your voice' : k === 'sync' ? 'Sending to your computer' : 'Reading the pictures');
export const left = (j: ScanJob) => (j.total ? `${Math.max(0, j.total - j.done)} left` : '…');

/** A computer is connected: the phone stays reachable in the background (a quiet notification) so it can hand files over. */
let connected = false;
let nudge: () => void = () => {};
export function setConnected(on: boolean) {
  connected = on;
  nudge();
}

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
        // the notification is asked for once; the work goes on in the background either way (the service runs
        // even when its notification may not be shown)
        await notifyPermission(true);
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
      if (connected) setTimeout(idleOn, 1500);
    } else if (connected) idleOn();
    else if (idleShown) {
      idleShown = false;
      Work.clear().catch(() => {});
    }
  };
  let idleShown = false;
  const idleOn = () => {
    if (!connected || runningJobs().length) return;
    idleShown = true;
    Work.show({ title: 'Frogity is connected to your computer', text: 'Staying reachable so your documents open there at once', progress: 0, max: 0, idle: true }).catch(() => {});
  };
  nudge = () => {
    clearTimeout(t);
    t = window.setTimeout(sync, 300);
  };
  subscribeJobs(() => {
    clearTimeout(t);
    t = window.setTimeout(sync, 900);
  });
}
