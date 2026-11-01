/// <reference lib="webworker" />
// Studio-voice engine. Runs off the main thread and keeps the voice loaded between sentences, so each sentence
// costs only the synthesis itself. Everything it needs (voice, ONNX Runtime, phonemizer) is read from the phone's
// private file store; nothing is fetched here.
import * as ort from 'onnxruntime-web';
import { createPiperPhonemize, type PiperPhonemizer } from './vendor/piper-phonemize.js';

interface VoiceCfg {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  speaker_id_map: Record<string, number>;
}

let session: ort.InferenceSession | null = null;
let cfg: VoiceCfg | null = null;
let loadedId = '';
let urls = { phWasm: '', phData: '' };
let phon: PiperPhonemizer | null = null;
let onLine: ((l: string) => void) | null = null;

const file = async (dir: string, name: string) => (await (await (await navigator.storage.getDirectory()).getDirectoryHandle(dir)).getFileHandle(name)).getFile();

async function load(id: string) {
  if (loadedId === id && session) return;
  loadedId = '';
  session = null;
  phon = null;
  cfg = JSON.parse(await (await file('piper', `${id}.onnx.json`)).text());
  const ortWasm = URL.createObjectURL(await file('piper-rt', 'ort-wasm-simd.wasm'));
  urls = { phWasm: URL.createObjectURL(await file('piper-rt', 'piper_phonemize.wasm')), phData: URL.createObjectURL(await file('piper-rt', 'piper_phonemize.data')) };
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { 'ort-wasm-simd.wasm': ortWasm, 'ort-wasm-simd-threaded.wasm': ortWasm } as never;
  const bytes = new Uint8Array(await (await file('piper', `${id}.onnx`)).arrayBuffer());
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  loadedId = id;
  // the very first run of a model is several times slower than the rest (memory, compiled code): do it now, on a
  // word nobody hears, so the first sentence the reader asks for comes out at full speed
  try {
    phon ??= await newPhonemizer();
    await say('Ready.', 1);
  } catch {
    /* warming up is only a nicety */
  }
}

async function newPhonemizer() {
  return createPiperPhonemize({
    print: (l) => onLine?.(l),
    printErr: (l) => console.debug('[phonemizer]', l),
    locateFile: (n) => (n.endsWith('.wasm') ? urls.phWasm : n.endsWith('.data') ? urls.phData : n),
  });
}

/** text → phoneme ids. The phonemizer is reused; if the runtime has exited it is started again. */
async function phonemize(text: string): Promise<number[]> {
  const args = ['-l', cfg!.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data'];
  const once = (m: PiperPhonemizer) =>
    new Promise<number[]>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('phonemizer timed out')), 15000);
      onLine = (l) => {
        clearTimeout(t);
        try {
          resolve(JSON.parse(l).phoneme_ids);
        } catch (e) {
          reject(e as Error);
        }
      };
      try {
        m.callMain(args);
      } catch (e) {
        clearTimeout(t);
        reject(e as Error);
      }
    });
  try {
    phon ??= await newPhonemizer();
    return await once(phon);
  } catch {
    phon = await newPhonemizer();
    return once(phon);
  }
}

async function say(text: string, rate: number): Promise<{ samples: Float32Array; rate: number }> {
  if (!session || !cfg) throw new Error('voice not loaded');
  const ids = await phonemize(text);
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map((n) => BigInt(n))), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    // length_scale is the voice's own speed control: a faster voice keeps its natural pitch
    // a touch more variation than the voice's defaults: livelier, less monotone reading
    scales: new ort.Tensor('float32', Float32Array.from([Math.min(0.9, cfg.inference.noise_scale * 1.15), cfg.inference.length_scale / rate, Math.min(1.1, cfg.inference.noise_w * 1.12)]), [3]),
  };
  if (Object.keys(cfg.speaker_id_map ?? {}).length) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const out = await session.run(feeds);
  const data = (out.output ?? Object.values(out)[0]).data as Float32Array;
  return { samples: new Float32Array(data), rate: cfg.audio.sample_rate };
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let queue: Promise<void> = Promise.resolve();
ctx.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: 'init'; id: string; voice: string } | { type: 'say'; id: number; text: string; rate: number } | { type: 'bye' };
  if (m.type === 'bye') return ctx.close();
  queue = queue.then(async () => {
    try {
      if (m.type === 'init') {
        await load(m.voice);
        ctx.postMessage({ type: 'ready', id: m.id });
      } else {
        const r = await say(m.text, m.rate);
        ctx.postMessage({ type: 'audio', id: m.id, samples: r.samples, rate: r.rate }, [r.samples.buffer]);
      }
    } catch (err) {
      ctx.postMessage({ type: 'error', id: (m as { id: number | string }).id, message: String((err as Error)?.message ?? err) });
    }
  });
};
