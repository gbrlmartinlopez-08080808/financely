// Languages: English, Spanish and French. The interface text is translated by phrase: the English text in the code is the key, and the
// translations are looked up as the screens are drawn (and re-looked-up when they change). Anything not in the dictionary stays in
// English — never a blank or a key. Books, news and anything the reader or an outlet wrote are never touched.
import { useEffect, useState } from 'react';
import { EXTRA } from './i18n-extra';
import { ES } from './i18n-es';
import { FR } from './i18n-fr';

export type Lang = 'en' | 'es' | 'fr';
export type LangPref = 'auto' | Lang;
const KEY = 'ui:lang';
const bus = new EventTarget();

const systemLang = (): Lang => {
  const l = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return l === 'es' || l === 'fr' ? l : 'en';
};
export const getPref = (): LangPref => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'en' || v === 'es' || v === 'fr' ? v : 'auto';
  } catch {
    return 'auto';
  }
};
export const getLang = (): Lang => {
  const p = getPref();
  return p === 'auto' ? systemLang() : p;
};
export function setPref(p: LangPref) {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* private mode */
  }
  document.documentElement.lang = getLang();
  bus.dispatchEvent(new Event('lang'));
  retranslate();
}
export function useLang(): [Lang, LangPref, (p: LangPref) => void] {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    bus.addEventListener('lang', f);
    return () => bus.removeEventListener('lang', f);
  }, []);
  return [getLang(), getPref(), setPref];
}

const TABLES: Record<Lang, Map<string, string>> = {
  en: new Map(),
  es: new Map([...ES, ...EXTRA.map((e): [string, string] => [e[0], e[1]])]),
  fr: new Map([...FR, ...EXTRA.map((e): [string, string] => [e[0], e[2]])]),
};
/** phrases with a number or a name in them: "12 min left", "level 3" */
const PATTERNS: { re: RegExp; es: string; fr: string }[] = [
  { re: /^(\d+) min left$/, es: '$1 min restantes', fr: '$1 min restantes' },
  { re: /^(\d+)m left$/, es: '$1 min restantes', fr: '$1 min restantes' },
  { re: /^(\d+) of (\d+) free questions left today$/, es: '$1 de $2 preguntas gratis hoy', fr: '$1 questions gratuites sur $2 aujourd’hui' },
  { re: /^level (\d+)$/, es: 'nivel $1', fr: 'niveau $1' },
  { re: /^sling level (\d+) · deep cuts level (\d+)$/, es: 'honda nivel $1 · joyas ocultas nivel $2', fr: 'fronde niveau $1 · pépites niveau $2' },
  { re: /^(\d+) min to today’s goal$/, es: '$1 min para la meta de hoy', fr: '$1 min pour l’objectif du jour' },
  { re: /^from (\d+) days? ago · waiting for a fresh copy$/, es: 'de hace $1 d · esperando una copia nueva', fr: 'd’il y a $1 j · en attente d’une copie à jour' },
  { re: /^offline · from (\d+) days? ago · waiting for a fresh copy$/, es: 'sin conexión · de hace $1 d · esperando una copia nueva', fr: 'hors ligne · d’il y a $1 j · en attente d’une copie à jour' },
  { re: /^Preparing Liquid mode, (\d+)%$/, es: 'Preparando el modo Líquido, $1 %', fr: 'Préparation du mode Liquide, $1 %' },
  { re: /^Reading the pictures, (\d+)%$/, es: 'Leyendo las imágenes, $1 %', fr: 'Lecture des images, $1 %' },
  { re: /^Open (.+)$/, es: 'Abrir $1', fr: 'Ouvrir $1' },
  { re: /^Last (\d+) days$/, es: 'Últimos $1 días', fr: '$1 derniers jours' },
  { re: /^(\d+) days?$/, es: '$1 días', fr: '$1 jours' },
  { re: /^(\d+) of (\d+)$/, es: '$1 de $2', fr: '$1 sur $2' },
  { re: /^shelf · (\d+)$/, es: 'estantería · $1', fr: 'étagère · $1' },
  { re: /^(\d+) outlets?$/, es: '$1 medios', fr: '$1 médias' },
  { re: /^(\d+) stor(?:y|ies)$/, es: '$1 noticias', fr: '$1 articles' },
  { re: /^(\d+)\/5 · a block comes only when Froggy reaches the top$/, es: '$1/5 · solo hay bloque cuando Froggy llega arriba', fr: '$1/5 · un bloc seulement quand Froggy arrive en haut' },
  { re: /^updated today (.+)$/, es: 'actualizado hoy $1', fr: 'mis à jour aujourd’hui $1' },
  { re: /^(\d+) questions so far$/, es: '$1 preguntas hasta ahora', fr: '$1 questions jusqu’ici' },
  { re: /^in (\d+) days$/, es: 'en $1 días', fr: 'dans $1 jours' },
  { re: /^in (\d+) weeks$/, es: 'en $1 semanas', fr: 'dans $1 semaines' },
  { re: /^in (\d+) months$/, es: 'en $1 meses', fr: 'dans $1 mois' },
  { re: /^tomorrow$/, es: 'mañana', fr: 'demain' },
];

export function tr(s: string, lang: Lang = getLang()): string {
  if (lang === 'en') return s;
  const lead = s.match(/^\s*/)![0];
  const trail = s.match(/\s*$/)![0];
  const core = s.trim();
  if (!core) return s;
  const hit = TABLES[lang].get(core);
  if (hit) return lead + hit + trail;
  for (const p of PATTERNS) if (p.re.test(core)) return lead + core.replace(p.re, p[lang]) + trail;
  return s;
}
/** for code that builds a string itself */
export const t = (s: string) => tr(s);

// ------------------------------------------------------------------ the screen: every text node and label is translated in place
const SKIP = 'script, style, textarea, input, pre, code, .flow, .wk-body, .ask-msg, .lk-body, .no-i18n, [contenteditable], .reel-title, .reel-sum, .story-title';
const ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
/** what we last wrote into a node, and the English it came from (so a language switch can start from the English) */
const orig = new WeakMap<Node, { base: string; shown: string }>();
const origAttr = new WeakMap<Element, Record<string, { base: string; shown: string }>>();
let busy = false;

function textNode(n: Text, lang: Lang) {
  const el = n.parentElement;
  if (!el || el.closest(SKIP)) return;
  const cur = n.nodeValue ?? '';
  const rec = orig.get(n);
  // React may have put new English text in since we translated it: then what is there now is the English
  const base = rec && cur === rec.shown ? rec.base : cur;
  const out = tr(base, lang);
  if (out !== base || rec) orig.set(n, { base, shown: out });
  if (cur !== out) n.nodeValue = out;
}
function attrs(el: Element, lang: Lang) {
  if (el.closest(SKIP)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v === null) continue;
    const all = origAttr.get(el) ?? {};
    const rec = all[a];
    const base = rec && v === rec.shown ? rec.base : v;
    const out = tr(base, lang);
    if (out !== base || rec) {
      all[a] = { base, shown: out };
      origAttr.set(el, all);
    }
    if (v !== out) el.setAttribute(a, out);
  }
}
function walk(root: Node, lang: Lang) {
  if (root.nodeType === Node.TEXT_NODE) return textNode(root as Text, lang);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (el.closest(SKIP) && el !== document.body) return;
  attrs(el, lang);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) textNode(n as Text, lang);
    else attrs(n as Element, lang);
  }
}
export function retranslate() {
  if (busy || typeof document === 'undefined') return;
  busy = true;
  try {
    walk(document.body, getLang());
  } finally {
    busy = false;
  }
}

let started = false;
export function startI18n() {
  if (started || typeof document === 'undefined') return;
  started = true;
  document.documentElement.lang = getLang();
  let raf = 0;
  const pending = new Set<Node>();
  const flush = () => {
    raf = 0;
    const lang = getLang();
    busy = true;
    try {
      pending.forEach((n) => n.isConnected && walk(n, lang));
    } finally {
      pending.clear();
      busy = false;
    }
  };
  new MutationObserver((muts) => {
    if (busy) return;
    if (getLang() === 'en') return;
    for (const m of muts) pending.add(m.type === 'childList' ? (m.target as Node) : m.type === 'characterData' ? m.target.parentNode ?? m.target : m.target);
    if (!raf) raf = requestAnimationFrame(flush);
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  retranslate();
}
