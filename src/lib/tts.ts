// Text-to-speech that works on Android (native engine) and in browsers (Web Speech).
// Text is spoken in chunks of whole sentences so playback survives short screen-offs and
// we can still highlight the sentence being read.
import { isNative } from './native';

export interface Voice {
  id: string; // stable key
  name: string;
  lang: string;
  index?: number; // native voice index
  score: number; // how natural it is likely to sound (higher is better)
  natural: boolean;
}

/** Android and browsers don't say which voices are the good (neural) ones, so read the clues in their names. */
export function scoreVoice(name: string, id: string, local?: boolean): number {
  const s = `${name} ${id}`.toLowerCase();
  let sc = 0;
  if (/neural|natural|premium|enhanced|studio|wavenet|journey|polyglot|siri|high.?quality|\bhq\b/.test(s)) sc += 60;
  if (/network|online/.test(s)) sc += 50; // Google's network voices are neural
  if (/-x-[a-z]{3}-local/.test(s)) sc += 20; // Google's downloadable high-quality offline voices
  if (local === false) sc += 15;
  if (/compact|lite|\blow\b|espeak|flite|pico|-language$/.test(s)) sc -= 40;
  return sc;
}

/** The most natural-sounding voice for a language (e.g. "en-US"), or undefined if none is clearly better. */
export function bestVoice(voices: Voice[], lang: string): Voice | undefined {
  const fam = lang.slice(0, 2).toLowerCase();
  const pool = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(fam));
  const exact = pool.filter((v) => v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase());
  return [...(exact.length ? exact : pool)].sort((a, b) => b.score - a.score)[0];
}

/** Opens Android's "install voice data" screen (where Google's natural voices live). */
export async function openVoiceInstall() {
  if (!isNative) return;
  try {
    const { TextToSpeech } = await loadNative();
    await TextToSpeech.openInstall();
  } catch {
    /* no such screen on this phone */
  }
}

const LIGATURES: Record<string, string> = { '\ufb00': 'ff', '\ufb01': 'fi', '\ufb02': 'fl', '\ufb03': 'ffi', '\ufb04': 'ffl', '\ufb05': 'st', '\ufb06': 'st', '\u0132': 'IJ', '\u0133': 'ij', '\u0152': 'OE', '\u0153': 'oe', '\u00c6': 'AE', '\u00e6': 'ae' };
const ABBR_EN: [RegExp, string][] = [
  [/\bDr\.(?=\s+[A-Z])/g, 'Doctor'],
  [/\bMr\.(?=\s+[A-Z])/g, 'Mister'],
  [/\bMrs\.(?=\s+[A-Z])/g, 'Missus'],
  [/\bMs\.(?=\s+[A-Z])/g, 'Miz'],
  [/\bProf\.(?=\s+[A-Z])/g, 'Professor'],
  [/\bSt\.(?=\s+[A-Z])/g, 'Saint'],
  [/\bJr\.(?=[\s,])/g, 'Junior'],
  [/\betc\./gi, 'et cetera'],
  [/\bapprox\./gi, 'approximately'],
  [/\bNo\.\s*(?=\d)/g, 'number '],
  [/\bvol\.\s*(?=\d)/gi, 'volume '],
  [/\bpp?\.\s*(?=\d)/g, 'page '],
  [/\bch\.\s*(?=\d)/gi, 'chapter '],
];

/** Tidies text for the ear: no citation numbers, URLs, or abbreviations read letter by letter. */
export function speechText(raw: string, lang = 'en'): string {
  let t = raw
    .replace(/[\ufb00-\ufb06\u0132\u0133\u0152\u0153\u00c6\u00e6]/g, (c) => LIGATURES[c] ?? c) // PDFs store "fi" and "fl" as one glyph the voice cannot read
    .replace(/\u00ad/g, '')
    .replace(/(\p{L})[-\u2010\u2011]\s*\n\s*(\p{Ll})/gu, '$1$2') // a word broken at the end of a line
    .replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, '')
    .replace(/\(\s*(?:[A-Z][\p{L}'’.\- ]+(?:,| and | & )[^()]{0,60}?\d{4}[a-z]?;?\s*)+\)/gu, '')
    .replace(/https?:\/\/\S+|www\.\S+/g, 'link')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, 'email address')
    .replace(/\bi\.e\./gi, 'that is')
    .replace(/\be\.g\./gi, 'for example')
    .replace(/\bet al\./g, 'et al')
    .replace(/\bvs\./gi, 'versus')
    .replace(/\bFig\./g, 'Figure')
    .replace(/\bEq\./g, 'Equation')
    .replace(/\bcf\./gi, 'compare')
    .replace(/^\s*\d+(?:\.\d+)*\.?\s+(?=\p{Lu}\p{Ll})/u, '') // "2.3 Method" is read as "Method"
    .replace(/\s*\((?:see\s+)?(?:Fig(?:ure)?|Table|Eq(?:uation)?|Section|Sec)\.?\s*[\dA-Z][\d.a-z]*\)/g, '') // "(Figure 3)"
    .replace(/[\u00b9\u00b2\u00b3\u2070-\u2079]+/g, '') // superscript footnote marks
    .replace(/[*†‡§¶•■□▪◦]+/g, ' ')
    .replace(/(\d)\s?%/g, lang === 'en' ? '$1 percent' : '$1 %')
    .replace(/\s&\s/g, lang === 'en' ? ' and ' : lang === 'es' || lang === 'it' ? ' y ' : lang === 'fr' ? ' et ' : lang === 'de' ? ' und ' : lang === 'pt' ? ' e ' : ' & ')
    .replace(/(\d)\s?°\s?([CF])\b/g, (_, n, u) => `${n} degrees ${u === 'C' ? 'Celsius' : 'Fahrenheit'}`)
    .replace(/[“”«»„]/g, '"')
    .replace(/\s[—–]\s/g, ', ')
    .replace(/(\p{L})\/(\p{L})/gu, '$1 $2');
  if (lang === 'en') for (const [re, to] of ABBR_EN) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

export interface SpeakOpts {
  rate: number;
  pitch: number;
  voice?: string;
  lang?: string;
}

type Native = typeof import('@capacitor-community/text-to-speech');
let native: Native | null = null;
const loadNative = async () => (native ??= await import('@capacitor-community/text-to-speech'));

let voicesCache: Voice[] | null = null;

export async function listVoices(): Promise<Voice[]> {
  if (voicesCache) return voicesCache;
  if (isNative) {
    try {
      const { TextToSpeech } = await loadNative();
      const { voices } = await TextToSpeech.getSupportedVoices();
      voicesCache = voices.map((v, i) => {
        const id = v.voiceURI || `${v.name}-${i}`;
        const score = scoreVoice(v.name, id, (v as { localService?: boolean }).localService);
        return { id, name: v.name, lang: v.lang, index: i, score, natural: score >= 50 };
      });
    } catch {
      voicesCache = [];
    }
    return voicesCache;
  }
  const synth = window.speechSynthesis;
  if (!synth) return [];
  let vs = synth.getVoices();
  if (!vs.length)
    vs = await new Promise((r) => {
      const t = setTimeout(() => r(synth.getVoices()), 1200);
      synth.onvoiceschanged = () => {
        clearTimeout(t);
        r(synth.getVoices());
      };
    });
  voicesCache = vs.map((v) => {
    const score = scoreVoice(v.name, v.voiceURI, v.localService);
    return { id: v.voiceURI, name: v.name, lang: v.lang, score, natural: score >= 50 };
  });
  return voicesCache;
}

export function ttsAvailable() {
  return isNative || 'speechSynthesis' in window;
}

/**
 * Speak `text`; resolves when finished or stopped. `onBoundary` reports the character offset of
 * the word currently being spoken (when the engine supports it).
 */
export async function speak(text: string, opts: SpeakOpts, onBoundary?: (charIndex: number) => void): Promise<'done' | 'stopped'> {
  const voices = await listVoices();
  const v = voices.find((x) => x.id === opts.voice);
  if (isNative) {
    const { TextToSpeech } = await loadNative();
    let handle: { remove: () => void } | undefined;
    if (onBoundary) {
      try {
        handle = await TextToSpeech.addListener('onRangeStart', (e: { start: number }) => onBoundary(e.start));
      } catch {
        /* older engines */
      }
    }
    try {
      stoppedFlag = false;
      await TextToSpeech.speak({
        text,
        lang: v?.lang ?? opts.lang ?? 'en-US',
        rate: opts.rate,
        pitch: opts.pitch,
        volume: 1,
        voice: v?.index,
        category: 'playback',
        queueStrategy: 0,
      });
      return stoppedFlag ? 'stopped' : 'done';
    } catch {
      return 'stopped';
    } finally {
      handle?.remove();
    }
  }
  const synth = window.speechSynthesis;
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate;
    u.pitch = opts.pitch;
    const wv = synth.getVoices().find((x) => x.voiceURI === opts.voice);
    if (wv) u.voice = wv;
    else if (opts.lang) u.lang = opts.lang;
    u.onboundary = (e) => onBoundary?.(e.charIndex);
    u.onend = () => resolve(stoppedFlag ? 'stopped' : 'done');
    u.onerror = () => resolve('stopped');
    stoppedFlag = false;
    synth.speak(u);
    // Chrome bug: long utterances stall; keep the engine awake.
    const keep = setInterval(() => {
      if (!synth.speaking) clearInterval(keep);
      else if (!synth.paused) {
        synth.pause();
        synth.resume();
      }
    }, 10000);
  });
}

let stoppedFlag = false;
export async function stopSpeaking() {
  stoppedFlag = true;
  if (isNative) {
    const { TextToSpeech } = await loadNative();
    await TextToSpeech.stop().catch(() => {});
  } else window.speechSynthesis?.cancel();
}

/** Split text into sentences (Intl.Segmenter where available). */
export function sentences(text: string, lang = 'en'): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    const seg = new Seg(lang, { granularity: 'sentence' });
    for (const s of seg.segment(text)) if (s.segment.trim()) out.push({ text: s.segment, start: s.index });
    return out;
  }
  const re = /[^.!?]+[.!?]+["'”’)\]]*\s*|[^.!?]+$/g;
  let m;
  while ((m = re.exec(text))) if (m[0].trim()) out.push({ text: m[0], start: m.index });
  return out;
}

// ---------------------------------------------------------------------------------------------------- language
/** The most common little words of each language: enough to tell them apart in a few hundred characters. */
const STOP: Record<string, string> = {
  'en-US': 'the and of to is that it was for with as his he she they her this from but not are be have had by on at which or an were their been has would there what all when who will more if no out so said up about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three'.replace(/\s+/g, ' '),
  'es-ES': 'el la de que y a en un ser se no haber por con su para como estar tener le lo todo pero más hacer o poder decir este ir otro ese si me ya ver porque dar cuando él muy sin vez mucho saber qué sobre mi alguno mismo yo también hasta año dos querer entre así primero desde grande eso ni nos llegar pasar tiempo ella sí día uno bien poco deber entonces poner cosa tanto hombre parecer nuestro tan donde ahora parte después vida quedar siempre creer hablar llevar dejar nada cada seguir menos nuevo encontrar algo solo decir los las del al una es era son fue está'.replace(/\s+/g, ' '),
  'fr-FR': 'me ma mes si suis as ai avais était l d j qu c s m t y à è ù le la les de des du un une et est en que qui dans pour pas sur au aux ce cette ces il elle ils elles nous vous je tu on se sa son ses leur leurs mais ou où donc car ne plus par avec sans sous comme être avoir fait faire dit tout tous très bien aussi autre même encore alors déjà puis après avant entre depuis chez vers jamais toujours rien peu trop moins deux trois cela ça été était sont ont'.replace(/\s+/g, ' '),
  'de-DE': 'der die das und ist nicht ein eine einen einem einer eines zu den dem des mit sich auf für von im auch es an werden aus er hat dass sie nach wird bei noch wie einem über so zum war haben nur oder aber vor zur bis mehr durch man sein wurde sei kann gegen vom können schon wenn habe seine ihre dann unter wir soll ich eben sind ihr jahr diese ihm ohne seit weil hier immer da noch viel ganz'.replace(/\s+/g, ' '),
  'it-IT': 'il lo la i gli le di a da in con su per tra fra un uno una e è che non si ma come più anche se sono ha hanno del della dei delle al alla ai alle nel nella nei nelle sul sulla questo questa questi queste quello quella io tu lui lei noi voi loro mi ti ci vi suo sua suoi sue mio mia essere avere fare tutto tutti molto ancora già quando dove perché così solo poi prima dopo senza sempre ogni era erano stato stata'.replace(/\s+/g, ' '),
  'pt-PT': 'o a os as de do da dos das em no na nos nas um uma uns umas e é que não se com por para como mais mas ao aos à às seu sua seus suas ele ela eles elas eu tu nós você vocês me te lhe nos lhes isso isto este esta estes estas esse essa já também muito ser estar ter haver fazer foi são era tem têm há quando onde porque então só ainda depois antes sem sempre cada tudo todo todos toda todas'.replace(/\s+/g, ' '),
  'nl-NL': 'de het een en van in is dat op te zijn voor met niet aan er ook als maar om bij uit nog naar door over ze zich dan wel of dit hij zij wij je ik hun was worden heeft hebben kan meer geen tot veel onder tegen werd haar hem toch al zo nu wat wie waar'.replace(/\s+/g, ' '),
  'pl-PL': 'i w nie na z się do to że jest o jak ale po co tak za od czy już tylko ze dla by przez być są był było ten ta te tym tego jego jej ich nas was ich nawet jeszcze bardzo też gdy kiedy gdzie który która które'.replace(/\s+/g, ' '),
  'sv-SE': 'och i att det som en på är av för med till den har de inte om ett men var jag sig från så vi kan ska han hon man ut när nu där här också bara eller mycket efter sedan vid under över alla blev vara varit'.replace(/\s+/g, ' '),
  'tr-TR': 've bir bu da de için ile ne o çok daha gibi ama en var olarak ben sen biz siz onlar mi mı mu mü ki ya hem değil kadar sonra önce ise her şey bütün yok olan'.replace(/\s+/g, ' '),
};
const SETS = Object.entries(STOP).map(([l, w]) => [l, new Set(w.split(' '))] as const);
const SCRIPTS: [string, RegExp][] = [
  ['ru-RU', /[\u0400-\u04ff]/g],
  ['el-GR', /[\u0370-\u03ff]/g],
  ['ar-SA', /[\u0600-\u06ff]/g],
  ['he-IL', /[\u0590-\u05ff]/g],
  ['hi-IN', /[\u0900-\u097f]/g],
  ['th-TH', /[\u0e00-\u0e7f]/g],
  ['ko-KR', /[\uac00-\ud7af]/g],
  ['ja-JP', /[\u3040-\u30ff]/g],
  ['zh-CN', /[\u4e00-\u9fff]/g],
];

/** Takes a few slices from across the text (a book starts with a title page and often a quote in another language). */
export function sampleText(text: string, each = 1400): string {
  if (text.length <= each * 3) return text;
  const at = [0.04, 0.4, 0.75].map((f) => Math.floor(text.length * f));
  return at.map((i) => text.slice(i, i + each)).join('\n');
}

/** Which language is this text in? `conf` is 0–1 (how clearly one language stands out). */
export function detectLanguage(text: string): { lang: string; conf: number } {
  const s = sampleText(text).toLowerCase();
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  if (letters < 20) return { lang: 'en-US', conf: 0 };
  if ((s.match(/[\u3040-\u30ff]/g) ?? []).length / letters > 0.05) return { lang: 'ja-JP', conf: 0.9 };
  for (const [l, re] of SCRIPTS) {
    const n = (s.match(re) ?? []).length;
    if (n / letters > 0.3) return { lang: l, conf: Math.min(1, n / letters) };
  }
  const words = s.match(/\p{L}+/gu) ?? [];
  if (words.length < 8) return { lang: 'en-US', conf: 0 };
  const score: [string, number][] = SETS.map(([l, set]) => {
    let hits = 0;
    for (const w of words) if (set.has(w)) hits++;
    return [l, hits / words.length];
  });
  // the letters only some languages use are strong hints
  const bonus = (l: string, re: RegExp, k: number) => {
    const n = (s.match(re) ?? []).length / Math.max(1, letters);
    const e = score.find((x) => x[0] === l);
    if (e) e[1] += n * k;
  };
  bonus('es-ES', /[ñ¿¡]/g, 6);
  bonus('de-DE', /[ßäöü]/g, 3);
  bonus('fr-FR', /[çœèêâîôûà]|\bqu'|\b[ldjmtsn]['’]/g, 3);
  bonus('pt-PT', /[ãõç]/g, 3);
  bonus('pl-PL', /[ąęłńśźż]/g, 6);
  bonus('tr-TR', /[ğışİ]/g, 5);
  bonus('sv-SE', /[åäö]/g, 2);
  score.sort((a, b) => b[1] - a[1]);
  const [best, second] = score;
  if (best[1] < 0.06) return { lang: 'en-US', conf: 0 };
  return { lang: best[0], conf: Math.max(0, Math.min(1, (best[1] - second[1]) / Math.max(0.01, best[1]) + 0.2)) };
}

/** Guess the document language from a text sample (for TTS voice choice). */
export function guessLang(sample: string): string {
  return detectLanguage(sample).lang;
}

export const LANG_NAME: Record<string, string> = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', tr: 'Turkish', ru: 'Russian', el: 'Greek', ar: 'Arabic', he: 'Hebrew', hi: 'Hindi', th: 'Thai', ko: 'Korean', ja: 'Japanese', zh: 'Chinese' };
