// Image → ASCII art, in the spirit of terminal portraits.

const RAMP = " .'`,:;-~=+i!lc7tfjrxvzunYJCL0OQdbkhao*#%@";

export function imageToAscii(img: CanvasImageSource & { width: number; height: number }, cols = 48, invert: boolean | 'auto' = 'auto'): string {
  const w = cols;
  const aspect = (img.height as number) / (img.width as number);
  const h = Math.max(1, Math.round(w * aspect * 0.5)); // glyphs are ~2x taller than wide
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  // normalise contrast
  let lo = 255;
  let hi = 0;
  const lum: number[] = [];
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    lum.push(l);
    lo = Math.min(lo, l);
    hi = Math.max(hi, l);
  }
  const span = Math.max(1, hi - lo);
  // On a dark card, the subject should be drawn with glyphs: for light images that's the dark ink.
  if (invert === 'auto') {
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
    invert = (mean - lo) / span < 0.55;
  }
  let out = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = (lum[y * w + x] - lo) / span; // 0 dark .. 1 light
      if (!invert) v = 1 - v; // dense glyphs for dark pixels
      const idx = Math.min(RAMP.length - 1, Math.max(0, Math.round(v * (RAMP.length - 1))));
      out += RAMP[idx];
    }
    out += '\n';
  }
  return out;
}

export async function blobToAscii(blob: Blob, cols = 48, invert: boolean | 'auto' = 'auto') {
  const bmp = await createImageBitmap(blob);
  try {
    return imageToAscii(bmp, cols, invert);
  } finally {
    bmp.close();
  }
}

/** Hand-made pieces used across the app (empty states, streak milestones). */
export const ASCII = {
  shelf: String.raw`
     _______     _______
    |       |   |  ___  |
    |  ...  |   | |   | |
    |  ...  |   | |___| |
    |_______|   |_______|
  ==========================`,
  book: String.raw`
       __...--~~~~~-._   _.-~~~~~--...__
     //               \`V'               \\
    //                 |                 \\
   //__...--~~~~~~-._  |  _.-~~~~~~--...__\\
  //__.....----~~~~._\ | /_.~~~~----.....__\\
 ====================\\|//====================
                     \`---\``,
};

/** Seedling that grows with the streak (0..6 stages). */
export function plantStage(streak: number): string {
  const stages = [
    String.raw`


        .
   _____|_____`,
    String.raw`

        ,
        |
   _____|_____`,
    String.raw`

       \,/
        |
   _____|_____`,
    String.raw`
       \ /
      \_|_/
        |
   _____|_____`,
    String.raw`
      .\|/.
     \_\|/_/
      \_|_/
        |
   _____|_____`,
    String.raw`
     .\\|//.
    \\_\|/_//
   \_\_\|/_/_/
       \|/
        |
   _____|_____`,
    String.raw`
    * .\\|//. *
   \\\_\\|//_///
  \_\_\_\|/_/_/_/
     \_\_|_/_/
        |||
   _____|||_____`,
  ];
  const i = streak <= 0 ? 0 : streak < 2 ? 1 : streak < 4 ? 2 : streak < 7 ? 3 : streak < 14 ? 4 : streak < 30 ? 5 : 6;
  return stages[i];
}
