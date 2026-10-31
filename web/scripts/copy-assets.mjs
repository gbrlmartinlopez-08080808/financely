// pdf.js needs its character maps, standard fonts and decoders next to the page.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
const from = 'node_modules/pdfjs-dist/';
for (const d of ['cmaps', 'standard_fonts', 'wasm']) {
  if (!existsSync(from + d)) continue;
  mkdirSync('public/pdfjs/' + d, { recursive: true });
  cpSync(from + d, 'public/pdfjs/' + d, { recursive: true });
}
