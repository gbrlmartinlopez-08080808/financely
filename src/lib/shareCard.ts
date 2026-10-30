import type { DocMeta } from './types';
import { coverInfo } from './library';
import { getState, streakInfo } from './store';
import { shareFile } from './native';
import { PLAY_URL } from './config';

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('image'));
    i.src = src;
  });

const rr = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
};

function screw(c: CanvasRenderingContext2D, x: number, y: number, a: number) {
  const g = c.createRadialGradient(x - 2, y - 2, 1, x, y, 11);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.45, '#d9d9d6');
  g.addColorStop(1, '#9d9c98');
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, 11, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(60,60,58,.65)';
  c.lineWidth = 2.4;
  c.beginPath();
  c.moveTo(x - 7 * Math.cos(a), y - 7 * Math.sin(a));
  c.lineTo(x + 7 * Math.cos(a), y + 7 * Math.sin(a));
  c.stroke();
}

/** A square-ish card: the book's cover sitting in the app's translucent, screwed-on acrylic holder. */
export async function bookCard(doc: DocMeta): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const sans = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";

  // backdrop: soft paper with a blue and a cream glow
  c.fillStyle = '#f3f3f2';
  c.fillRect(0, 0, W, H);
  for (const [x, y, r, col] of [
    [200, 120, 520, 'rgba(74,102,255,.38)'],
    [920, 220, 480, 'rgba(244,229,194,.9)'],
  ] as const) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  // cover (fit inside a box), pocket across its lower part
  const info = await coverInfo(doc).catch(() => undefined);
  const img = info ? await loadImg(info.url).catch(() => null) : null;
  const ar = info?.ar ?? 0.68;
  const maxW = 600;
  const maxH = 800;
  let cw = Math.min(maxW, maxH * ar);
  let ch = cw / ar;
  if (ch > maxH) {
    ch = maxH;
    cw = ch * ar;
  }
  const px = (W - cw / 0.86) / 2;
  const pw = cw / 0.86;
  const cx = (W - cw) / 2;
  const cy = 150;
  c.save();
  c.shadowColor = 'rgba(0,0,0,.22)';
  c.shadowBlur = 36;
  c.shadowOffsetY = 14;
  rr(c, cx, cy, cw, ch, 14);
  c.fillStyle = '#ddd';
  c.fill();
  c.restore();
  c.save();
  rr(c, cx, cy, cw, ch, 14);
  c.clip();
  if (img) c.drawImage(img, cx, cy, cw, ch);
  else {
    c.fillStyle = '#e8e6e1';
    c.fillRect(cx, cy, cw, ch);
    c.fillStyle = '#222';
    c.font = `700 44px ${sans}`;
    c.textAlign = 'center';
    c.fillText(doc.name.slice(0, 22), W / 2, cy + ch / 2);
  }
  c.restore();

  const ph = ch * 0.42;
  const py = cy + ch * 1.1 - ph;
  // frosted: a blurred copy of the cover behind a milky layer
  c.save();
  rr(c, px, py, pw, ph, 24);
  c.clip();
  if (img) {
    c.filter = 'blur(18px) saturate(1.1)';
    c.drawImage(img, cx - 40, cy - 40, cw + 80, ch + 80);
    c.filter = 'none';
  }
  const lg = c.createLinearGradient(0, py, 0, py + ph);
  lg.addColorStop(0, 'rgba(255,255,255,.55)');
  lg.addColorStop(1, 'rgba(255,255,255,.34)');
  c.fillStyle = lg;
  c.fillRect(px, py, pw, ph);
  const sh = c.createLinearGradient(px, py, px + pw, py + ph);
  sh.addColorStop(0, 'rgba(255,255,255,.55)');
  sh.addColorStop(0.32, 'rgba(255,255,255,0)');
  sh.addColorStop(0.7, 'rgba(255,255,255,0)');
  sh.addColorStop(1, 'rgba(255,255,255,.25)');
  c.fillStyle = sh;
  c.fillRect(px, py, pw, ph);
  c.restore();
  c.save();
  rr(c, px + 1, py + 1, pw - 2, ph - 2, 24);
  c.strokeStyle = 'rgba(255,255,255,.75)';
  c.lineWidth = 2;
  c.stroke();
  rr(c, px - 0.5, py - 0.5, pw + 1, ph + 1, 24);
  c.strokeStyle = 'rgba(0,0,0,.07)';
  c.lineWidth = 1;
  c.stroke();
  c.restore();
  screw(c, px + 22, py + 22, -0.6);
  screw(c, px + pw - 22, py + 22, 0.35);
  screw(c, px + 22, py + ph - 22, 1.2);
  screw(c, px + pw - 22, py + ph - 22, -0.2);

  // progress and label inside the pocket
  const pct = Math.round((doc.finished ? 1 : doc.progress) * 100);
  const bx = px + pw * 0.22;
  const bw = pw * 0.56;
  const by = py + ph - 74;
  rr(c, bx, by, bw, 6, 3);
  c.fillStyle = 'rgba(0,0,0,.1)';
  c.fill();
  if (pct > 0) {
    rr(c, bx, by, Math.max(6, (bw * pct) / 100), 6, 3);
    c.fillStyle = 'rgba(0,0,0,.6)';
    c.fill();
  }
  c.fillStyle = 'rgba(0,0,0,.5)';
  c.font = `500 22px ${mono}`;
  c.textAlign = 'center';
  c.fillText(doc.finished ? 'finished' : pct > 0 ? `${pct}% read` : 'on my shelf', W / 2, py + ph - 30);

  // title, author
  const title = doc.name.length > 44 ? doc.name.slice(0, 43) + '…' : doc.name;
  c.fillStyle = '#0e0e0e';
  c.font = `800 52px ${sans}`;
  const words = title.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (c.measureText(t).width > W - 160 && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  lines.push(cur);
  let ty = py + ph + 84;
  for (const l of lines.slice(0, 2)) {
    c.fillText(l, W / 2, ty);
    ty += 60;
  }
  if (doc.author) {
    c.fillStyle = '#8b8a87';
    c.font = `600 30px ${sans}`;
    c.fillText(doc.author.length > 50 ? doc.author.slice(0, 49) + '…' : doc.author, W / 2, ty + 4);
  }

  // footer: streak and the app
  const st = streakInfo(getState().days);
  c.fillStyle = '#0e0e0e';
  c.font = `700 26px ${mono}`;
  c.fillText(st.current > 0 ? `@ ${st.current}-day streak` : 'Frogity', W / 2, H - 78);
  c.fillStyle = '#8b8a87';
  c.font = `500 22px ${mono}`;
  c.fillText('Gamify reading, one jump at a time.', W / 2, H - 42);

  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('card'))), 'image/png'));
}

export async function shareBookCard(doc: DocMeta) {
  const blob = await bookCard(doc);
  const safe = doc.name.replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'book';
  await shareFile(blob, `${safe}.png`, `“${doc.name}”${doc.author ? ' — ' + doc.author : ''}\nReading it on Frogity: ${PLAY_URL}`);
}
