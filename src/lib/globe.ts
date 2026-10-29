// An ASCII globe that turns reading into something you can see: every day you read lights one place.
import { LAND, LAND_H, LAND_W } from './landmask';

const D2R = Math.PI / 180;

const isLand = (lonDeg: number, latDeg: number) => {
  const x = Math.floor((((lonDeg + 180) % 360) + 360) % 360 / 360 * LAND_W) % LAND_W;
  const y = Math.min(LAND_H - 1, Math.max(0, Math.floor(((90 - latDeg) / 180) * LAND_H)));
  return LAND[y][x] === '#';
};

// land cells where lights can appear (skip Antarctica so the lights stay in lived-in places)
let cells: { lon: number; lat: number }[] | null = null;
function landCells() {
  if (cells) return cells;
  cells = [];
  for (let y = 4; y < LAND_H - 10; y++)
    for (let x = 0; x < LAND_W; x++)
      if (LAND[y][x] === '#') cells.push({ lon: -180 + ((x + 0.5) * 360) / LAND_W, lat: 90 - ((y + 0.5) * 180) / LAND_H });
  return cells;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
};

export interface Light {
  lon: number;
  lat: number;
  today: boolean;
}

/** One stable place per reading day. */
export function lightsFor(dayKeys: string[], today: string): Light[] {
  const c = landCells();
  const used = new Set<number>();
  return dayKeys.map((k) => {
    let i = hash(k) % c.length;
    for (let tries = 0; used.has(i) && tries < 8; tries++) i = (i + 97) % c.length;
    used.add(i);
    return { lon: c[i].lon, lat: c[i].lat, today: k === today };
  });
}

const LAND_RAMP = ['░', '▒', '▓'];

export interface GlobeOpts {
  cols?: number;
  rows?: number;
  rot: number; // degrees of rotation (longitude shown at the centre)
  tilt?: number; // degrees
  lights: Light[];
  t: number; // seconds, for twinkling
}

/**
 * Renders to HTML so lit cells can be styled. Land is dotted, sea is blank, lights are bold.
 * Uses plain ASCII only (works with any monospace font).
 */
export function renderGlobe({ cols = 44, rows = 22, rot, tilt = 18, lights, t }: GlobeOpts): string {
  const rx = cols / 2 - 1;
  const ry = rows / 2 - 0.5;
  const tr = tilt * D2R;
  const sinT = Math.sin(tr);
  const cosT = Math.cos(tr);
  // light positions → screen cells
  const lit = new Map<number, { today: boolean }>();
  for (const L of lights) {
    const lon = (L.lon - rot) * D2R;
    const lat = L.lat * D2R;
    // sphere point (x right, y up, z toward viewer), then tilt about x axis
    const x = Math.cos(lat) * Math.sin(lon);
    const y0 = Math.sin(lat);
    const z0 = Math.cos(lat) * Math.cos(lon);
    const y = y0 * cosT - z0 * sinT;
    const z = y0 * sinT + z0 * cosT;
    if (z <= 0.08) continue;
    const cx = Math.round(rx + 0.5 + x * rx);
    const cy = Math.round(ry + 0.5 - y * ry);
    const key = cy * cols + cx;
    const prev = lit.get(key);
    lit.set(key, { today: (prev?.today ?? false) || L.today });
  }
  let out = '';
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const nx = (i + 0.5 - cols / 2) / rx;
      const ny = -(j + 0.5 - rows / 2) / ry;
      const r2 = nx * nx + ny * ny;
      const key = j * cols + i;
      const L = lit.get(key);
      if (r2 > 1) {
        out += L ? '' : ' ';
        if (!L) continue;
      }
      if (L) {
        const pulse = L.today ? (Math.floor(t * 2.2) % 2 ? 'O' : '@') : Math.floor(t * 1.3 + i) % 5 === 0 ? '*' : '@';
        out += `<b${L.today ? ' class="td"' : ''}>${pulse}</b>`;
        continue;
      }
      const z = Math.sqrt(Math.max(0, 1 - r2));
      // un-tilt to get the sphere coordinates of this screen point
      const y = ny * cosT + z * sinT;
      const z1 = -ny * sinT + z * cosT;
      const lat = Math.asin(Math.max(-1, Math.min(1, y))) / D2R;
      const lon = Math.atan2(nx, z1) / D2R + rot;
      const land = isLand(lon, lat);
      const shade = Math.max(0, Math.min(1, 0.55 + 0.5 * (-nx * 0.5 + ny * 0.45 + z * 0.75))); // light from the upper left
      if (r2 > 0.9) {
        out += land ? '+' : '.';
      } else if (land) {
        out += shade > 0.82 ? '#' : shade > 0.62 ? '%' : shade > 0.42 ? '*' : ':';
      } else {
        out += shade > 0.7 && (i + j) % 3 === 0 ? '.' : ' ';
      }
    }
    out += '\n';
  }
  void LAND_RAMP;
  return out;
}
