// "Ask this document": free, no account. Only the question and a few relevant excerpts are sent
// (never the whole file) to Pollinations' open text API, and only after the user opts in.
import * as db from './db';
import { dayKey } from './store';

const ENDPOINT = 'https://text.pollinations.ai/openai';

/**
 * The free service is shared by everyone, so it rate-limits. To stay inside it (and keep Ask free for
 * you) Frogity allows this many questions a day on this phone; the counter resets at midnight.
 */
export const DAILY_ASK_CAP = 30;
export async function askQuota(): Promise<{ used: number; left: number; cap: number }> {
  const u = await db.get<{ day: string; n: number }>('kv', 'ask-usage');
  const used = u && u.day === dayKey() ? u.n : 0;
  return { used, left: Math.max(0, DAILY_ASK_CAP - used), cap: DAILY_ASK_CAP };
}
async function countAsk() {
  const q = await askQuota();
  await db.put('kv', 'ask-usage', { day: dayKey(), n: q.used + 1 });
}

export interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const STOP = new Set('the a an and or of to in on for with is are was were be been it this that these those as at by from into about what which who whom how why when where does do did can could should would you your i we they he she his her their its not no yes but if then than so such there here also any all some more most very'.split(' '));
const tokens = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w));

/** Split text into overlapping ~900 character passages. */
export function chunk(text: string, size = 900): string[] {
  const paras = text.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + ' ' + p).length > size && cur) {
      out.push(cur);
      cur = cur.slice(-160) + ' ' + p; // overlap so facts that straddle a boundary survive
    } else cur = cur ? cur + ' ' + p : p;
  }
  if (cur) out.push(cur);
  return out;
}

/** Best passages for a question (BM25-style keyword scoring). */
export function retrieve(passages: string[], question: string, k = 5): string[] {
  const q = tokens(question);
  if (!q.length) return passages.slice(0, k);
  const docs = passages.map((p) => tokens(p));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = docs.reduce((a, d) => a + d.length, 0) / Math.max(1, docs.length);
  const scored = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of new Set(q)) {
      const f = tf.get(t) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (passages.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += (idf * (f * 2.2)) / (f + 1.2 * (0.25 + (0.75 * d.length) / Math.max(1, avg)));
    }
    return { i, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .sort((a, b) => a.i - b.i)
    .map((s) => passages[s.i]);
}

/** Evenly spaced passages for "summarise" style questions. */
export function sample(passages: string[], k = 7): string[] {
  if (passages.length <= k) return passages;
  return Array.from({ length: k }, (_, i) => passages[Math.floor((i * (passages.length - 1)) / (k - 1))]);
}

const SUMMARY = /\b(summar|overview|tl;?dr|main (idea|point)|key (idea|point|takeaway)|what is (this|it) about|gist)/i;

export async function ask(opts: { title: string; passages: string[]; question: string; history: Msg[]; selection?: string; signal?: AbortSignal }): Promise<string> {
  const { title, passages, question, history, selection, signal } = opts;
  if ((await askQuota()).left <= 0) throw new Error(`That’s today’s ${DAILY_ASK_CAP} free questions. Ask resets at midnight — everything else in Frogity stays free and unlimited.`);
  const excerpts = selection ? [selection] : SUMMARY.test(question) ? sample(passages) : retrieve(passages, question + ' ' + history.slice(-2).map((m) => m.content).join(' '));
  const context = excerpts.join('\n---\n').slice(0, 6500);
  const system =
    `You are a careful reading companion inside a reading app. The reader is looking at the document “${title}”. ` +
    `Answer using the excerpts below. If the excerpts do not contain the answer, say so briefly and offer what you do know, clearly marked as general knowledge. ` +
    `Be concise (usually under 120 words), plain language, no preamble. Use short lists only when they help. Write every formula in LaTeX: inline between single dollar signs like $x^2$, and displayed equations between double dollar signs on their own line. Never write maths as plain text or in code blocks.\n\nEXCERPTS:\n${context}`;
  const body = {
    model: 'openai',
    messages: [{ role: 'system', content: system }, ...history.slice(-6), { role: 'user', content: question }],
    max_tokens: 700,
    temperature: 0.3,
  };
  const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (r.status === 429) throw new Error('The free AI service is busy — try again in a moment.');
  if (!r.ok) throw new Error(`The AI service answered ${r.status}.`);
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  const text = j.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('The AI service sent an empty answer.');
  await countAsk();
  return text;
}
