// A gentle evening notification, made on the phone itself (no server, no account).
// Android can't make a repeating notification depend on what you've read, so the next one is planned again every
// time the app opens or you read: if today's goal is already met, the next one is tomorrow's.
import { isNative } from './native';
import { dayKey, getState, streakInfo } from './store';
import { displayName } from './cheer';

type LN = typeof import('@capacitor/local-notifications');
let mod: LN | null = null;
const lib = async () => (mod ??= await import('@capacitor/local-notifications'));
const ID = 7101;

export async function notifyPermission(ask: boolean): Promise<boolean> {
  if (!isNative) return false;
  try {
    const { LocalNotifications } = await lib();
    let p = await LocalNotifications.checkPermissions();
    if (p.display === 'prompt' && ask) p = await LocalNotifications.requestPermissions();
    return p.display === 'granted';
  } catch {
    return false;
  }
}

function words(): { title: string; body: string } {
  const s = getState();
  const name = displayName(s.settings.name);
  const hi = name ? `${name}, ` : '';
  const goal = s.settings.dailyGoal;
  const info = streakInfo(s.days);
  const left = Math.max(1, Math.ceil((goal * 60_000 - (s.days[dayKey()] ?? 0)) / 60_000));
  const soon = (s.days[dayKey()] ?? 0) >= goal * 60_000 || new Date().getHours() >= 21; // planned for tomorrow
  if (info.current >= 2 && !soon) return { title: 'Frogity', body: `${hi}your ${info.current}-day streak is waiting — ${left} min to today’s light.` };
  if (info.current >= 2) return { title: 'Frogity', body: `${hi}${info.current} days in a row. Keep the light on today?` };
  if (!info.total) return { title: 'Frogity', body: `${hi}a few pages tonight? ${goal} minutes lights your first place on the globe.` };
  return { title: 'Frogity', body: `${hi}a quiet ${goal} minutes with a book, maybe?` };
}

/** Plan (or cancel) the next reminder from the current settings and what you've read today. */
export async function refreshReminder() {
  if (!isNative) return;
  try {
    const { LocalNotifications } = await lib();
    const s = getState().settings;
    await LocalNotifications.cancel({ notifications: [{ id: ID }] }).catch(() => {});
    if (!s.reminders || !(await notifyPermission(false))) return;
    const [h, m] = s.reminderTime.split(':').map(Number);
    const at = new Date();
    at.setHours(h, m || 0, 0, 0);
    const metToday = (getState().days[dayKey()] ?? 0) >= s.dailyGoal * 60_000;
    if (at.getTime() <= Date.now() + 30_000 || metToday) at.setDate(at.getDate() + 1);
    const w = words();
    await LocalNotifications.schedule({ notifications: [{ id: ID, title: w.title, body: w.body, schedule: { at, allowWhileIdle: true }, smallIcon: 'ic_stat_frogity', iconColor: '#111111' }] });
  } catch (e) {
    console.warn('reminder not planned', e);
  }
}
