// The numbers behind each economy (World Bank open data), saved next to the daily feed so the app can show them offline and
// quickly: docs/feed/economy.json. Run by the same workflow as the feed.
import { writeFileSync, mkdirSync } from 'node:fs';
const ISO = 'USA;FRA;ESP;ITA;CHN;DEU;SWE;GBR;IRL;PRT;NLD;BEL;CHE;AUT;POL;NOR;DNK;FIN;GRC;TUR;UKR;RUS;CAN;MEX;BRA;ARG;CHL;COL;PER;IND;JPN;KOR;AUS;NZL;ZAF;NGA;EGY;KEN;SAU;ARE;ISR;IDN';
const IND = ['NY.GDP.MKTP.CD', 'NY.GDP.MKTP.KD.ZG', 'FP.CPI.TOTL.ZG', 'SL.UEM.TOTL.ZS', 'SP.POP.TOTL'];
const y = new Date().getUTCFullYear();
const out = { built: Date.now(), data: {} };
for (const id of IND) {
  const r = await fetch(`https://api.worldbank.org/v2/country/${ISO}/indicator/${id}?format=json&per_page=2000&date=${y - 12}:${y}`);
  if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
  const j = await r.json();
  for (const row of j[1] ?? []) {
    if (row.value === null) continue;
    ((out.data[row.countryiso3code] ??= {})[id] ??= []).push([Number(row.date), Math.round(row.value * 1000) / 1000]);
  }
}
for (const c of Object.values(out.data)) for (const k of Object.keys(c)) c[k].sort((a, b) => a[0] - b[0]);
mkdirSync('docs/feed', { recursive: true });
writeFileSync('docs/feed/economy.json', JSON.stringify(out));
console.log(`economy: ${Object.keys(out.data).length} countries`);
