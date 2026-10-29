// Copies the OCR engine and language data into public/ so the app works fully offline.
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const out = 'public/ocr';
mkdirSync(out, { recursive: true });
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
];
for (const [from, to] of files) {
  if (!existsSync(`${out}/${to}`)) cpSync(from, `${out}/${to}`);
}
// Android's packager silently un-gzips *.gz assets, so ship the language model uncompressed.
rmSync(`${out}/eng.traineddata.gz`, { force: true });
if (!existsSync(`${out}/eng.traineddata`))
  writeFileSync(`${out}/eng.traineddata`, gunzipSync(readFileSync('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')));

// pdf.js resources (character maps, standard fonts, image decoders)
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  const to = `public/pdfjs/${dir}`;
  if (!existsSync(to)) cpSync(`node_modules/pdfjs-dist/${dir}`, to, { recursive: true });
}
