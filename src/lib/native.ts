import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { getState } from './store';

export const isNative = Capacitor.isNativePlatform();

// ------------------------------------------------------------------ haptics
let hapticsMod: typeof import('@capacitor/haptics') | null = null;
export async function tap(style: 'light' | 'medium' | 'select' = 'light') {
  if (!getState().settings.haptics) return;
  try {
    if (isNative) {
      hapticsMod ??= await import('@capacitor/haptics');
      if (style === 'select') await hapticsMod.Haptics.selectionChanged();
      else await hapticsMod.Haptics.impact({ style: style === 'medium' ? hapticsMod.ImpactStyle.Medium : hapticsMod.ImpactStyle.Light });
    } else navigator.vibrate?.(style === 'medium' ? 12 : 6);
  } catch {
    /* no haptics */
  }
}

// ------------------------------------------------------------------ files coming from other apps ("Open with…")
export interface IncomingFile {
  path: string;
  name: string;
  mime: string;
}
interface IncomingPlugin {
  getPending(): Promise<{ files: IncomingFile[] }>;
  addListener(event: 'file', cb: (f: { files: IncomingFile[] }) => void): Promise<PluginListenerHandle>;
}
const Incoming = registerPlugin<IncomingPlugin>('Incoming');

export async function readIncoming(f: IncomingFile): Promise<Blob> {
  const res = await fetch(Capacitor.convertFileSrc(f.path));
  const b = await res.blob();
  return new Blob([b], { type: f.mime || b.type });
}

export async function listenIncoming(cb: (files: IncomingFile[]) => void) {
  if (!isNative) return () => {};
  try {
    const pending = await Incoming.getPending();
    if (pending.files?.length) cb(pending.files);
    const h = await Incoming.addListener('file', (e) => e.files?.length && cb(e.files));
    return () => h.remove();
  } catch (e) {
    console.warn('incoming plugin unavailable', e);
    return () => {};
  }
}

// ------------------------------------------------------------------ save / share
const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Saves into Documents/Quire on Android (falls back to the share sheet), or downloads on the web. */
export async function saveFile(blob: Blob, name: string): Promise<string> {
  if (!isNative) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'Downloaded';
  }
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const data = await toBase64(blob);
  try {
    await Filesystem.writeFile({ path: `Quire/${name}`, data, directory: Directory.Documents, recursive: true });
    return 'Saved to Documents/Quire';
  } catch {
    await shareFile(blob, name);
    return 'Shared';
  }
}

export async function shareFile(blob: Blob, name: string) {
  if (!isNative) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name });
    else await saveFile(blob, name);
    return;
  }
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const data = await toBase64(blob);
  const res = await Filesystem.writeFile({ path: `share/${name}`, data, directory: Directory.Cache, recursive: true });
  await Share.share({ title: name, files: [res.uri] });
}

export async function shareText(text: string, title?: string) {
  if (isNative) {
    const { Share } = await import('@capacitor/share');
    await Share.share({ text, title });
  } else if (navigator.share) await navigator.share({ text, title });
  else await navigator.clipboard?.writeText(text);
}

// ------------------------------------------------------------------ system chrome
export async function setStatusBar(dark: boolean, color: string) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  if (!isNative) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor?.({ color }).catch(() => {});
  } catch {
    /* ignore */
  }
}

type BackHandler = () => boolean; // return true if handled
const backStack: BackHandler[] = [];
export function onBack(h: BackHandler) {
  backStack.push(h);
  return () => {
    const i = backStack.lastIndexOf(h);
    if (i >= 0) backStack.splice(i, 1);
  };
}
export async function initBackButton() {
  const handle = () => {
    for (let i = backStack.length - 1; i >= 0; i--) if (backStack[i]()) return true;
    return false;
  };
  if (isNative) {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', () => {
      if (!handle()) App.minimizeApp();
    });
  } else {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') handle();
    });
  }
}

export async function openExternal(url: string) {
  window.open(url, '_blank', 'noopener');
}
