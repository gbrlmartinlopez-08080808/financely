import { useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../lib/db';
import { ask, askQuota, chunk, type Msg } from '../lib/ai';
import { line, type Mood } from '../lib/froggy';
import { Icon } from '../ui/Icon';
import { Froggy } from '../ui/Froggy';
import { PixelLoader, Sheet, toast } from '../ui/kit';
import { SUPPORT_EMAIL } from '../lib/config';
import { openExternal, shareText } from '../lib/native';
import { renderRich } from '../lib/formats/flow';

/** What Froggy can do with a book, one tap each. The label is what is shown; the question is what is asked. */
const BOOK_CHIPS: { label: string; q: string }[] = [
  { label: 'Summarise this', q: 'Summarise this document.' },
  { label: 'Key ideas', q: 'What are the key ideas? Give them as a short list.' },
  { label: 'Explain it simply', q: 'Explain this document simply, as if to a curious twelve-year-old.' },
  { label: 'Quiz me', q: 'Quiz me: ask me three questions about what I have been reading, one at a time. Start with the first.' },
  { label: 'Flashcards', q: 'Make eight flashcards from the main ideas. Format each as "Q: … / A: …" on two lines.' },
  { label: 'The argument', q: 'What is the central argument or story, and how is it built, step by step?' },
  { label: 'Push back', q: 'What are the strongest objections or counter-arguments to what this document says?' },
  { label: 'Hard words', q: 'Which words or terms here are hard or technical? Define each in a few words.' },
  { label: 'Think about', q: 'Give me three questions worth thinking about after reading this.' },
];
const SELECTION_CHIPS: { label: string; q: string }[] = [
  { label: 'Explain this', q: 'Explain this passage.' },
  { label: 'Say it simply', q: 'Say this passage in simpler words.' },
  { label: 'Translate', q: 'Translate this passage into English (or, if it is already English, into Spanish).' },
  { label: 'Why it matters', q: 'Why does this passage matter in the context of the whole document?' },
  { label: 'Hard words', q: 'Define the hard or technical words in this passage.' },
];

interface Saved {
  msgs: Msg[];
  at: number;
}

/**
 * Froggy: the reading companion. It remembers the conversation for each book (on the phone), comes with one-tap things to
 * ask, and its face follows what it is doing — thinking while it works, pleased when it answers, worried when something
 * goes wrong, asleep when the day's free answers are used up.
 */
export function AskSheet({
  open,
  onClose,
  title,
  docId,
  lang,
  getText,
  selection,
  aiOk,
  onConsent,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  docId: string;
  lang?: string;
  getText: () => Promise<string>;
  selection?: string;
  aiOk: boolean;
  onConsent: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mood, setMood] = useState<Mood>('neutral');
  const [talk, setTalk] = useState(false);
  const passages = useRef<string[] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const sel = useRef<string | undefined>(undefined);
  const [left, setLeft] = useState<{ left: number; cap: number } | null>(null);
  const loaded = useRef(false);
  const seed = useRef(String(Date.now()));

  useEffect(() => {
    if (!open) return;
    sel.current = selection;
    askQuota().then((q) => {
      setLeft(q);
      if (q.left <= 0) setMood('sleepy');
    });
    if (!loaded.current) {
      loaded.current = true;
      db.get<Saved>('kv', `froggy:${docId}`).then((s) => s?.msgs?.length && Date.now() - s.at < 30 * 864e5 && setMsgs(s.msgs));
    }
  }, [open, selection, docId]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);
  useEffect(() => () => abort.current?.abort(), []);
  // the conversation is kept for the next visit (never more than the last twelve turns)
  useEffect(() => {
    if (!loaded.current) return;
    if (msgs.length) db.put('kv', `froggy:${docId}`, { msgs: msgs.slice(-12), at: Date.now() } satisfies Saved).catch(() => {});
    else db.del('kv', `froggy:${docId}`).catch(() => {});
  }, [msgs, docId]);

  const send = async (q: string, retry = false) => {
    const question = q.trim();
    if (!question || busy) return;
    setInput('');
    setErr(null);
    const history = retry ? msgs.slice(0, -1) : msgs;
    setMsgs([...history, { role: 'user', content: question }]);
    setBusy(true);
    setMood('dizzy');
    abort.current = new AbortController();
    try {
      if (!passages.current) passages.current = chunk(await getText());
      const r = await ask({ title, docId, passages: passages.current, question, history, selection: sel.current, lang, signal: abort.current.signal });
      setMsgs((m) => [...m, { role: 'assistant', content: r.text }]);
      setMood(r.text.length > 500 ? 'smug' : 'happy');
      setTalk(true);
      setTimeout(() => setTalk(false), Math.min(2600, 600 + r.text.length * 8));
      askQuota().then((q2) => {
        setLeft(q2);
        if (q2.left <= 0) setMood('sleepy');
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setErr((e as Error).message || 'Something went wrong.');
        setMood(/today/.test((e as Error).message) ? 'sleepy' : 'worried');
      }
    } finally {
      setBusy(false);
      sel.current = undefined;
    }
  };

  const chips = useMemo(() => (sel.current ? SELECTION_CHIPS : BOOK_CHIPS), [open, selection]); // eslint-disable-line react-hooks/exhaustive-deps
  const face: Mood = busy ? 'dizzy' : mood === 'neutral' && !msgs.length ? 'wink' : mood;

  return (
    <Sheet open={open} onClose={onClose} className="ask">
      <div className="ask-body">
        {!aiOk ? (
          <div className="ask-consent">
            <div className="ask-frog">
              <Froggy mood="happy" size="lg" />
            </div>
            <h4>Meet Froggy</h4>
            <p>
              Froggy reads along and answers questions about this document. It is free and needs no account. When you ask, your question and a few short
              excerpts from the document are sent to an open AI service (Pollinations). Nothing else leaves your phone.
            </p>
            <p className="muted">Skip it for private documents. Everything else in Frogity stays on the device.</p>
            <button className="pill" onClick={onConsent}>
              Say hello to Froggy
            </button>
          </div>
        ) : (
          <>
            <div className="ask-head">
              <Froggy mood={face} talk={talk} size="sm" />
              <div className="ask-who">
                <b>Froggy</b>
                <span className="mono">{busy ? line('thinking', seed.current + msgs.length) : sel.current ? 'about your selection' : title.length > 30 ? title.slice(0, 30) + '…' : title}</span>
              </div>
              {!!msgs.length && (
                <button
                  className="ask-new mono"
                  onClick={() => {
                    abort.current?.abort();
                    setMsgs([]);
                    setErr(null);
                    setMood('wink');
                    passages.current = null;
                  }}
                >
                  new chat
                </button>
              )}
            </div>
            <div className="ask-scroll">
              {!msgs.length && (
                <div className="ask-empty">
                  <p className="ask-hello">{line('hello', seed.current)}</p>
                  {sel.current && <blockquote>{sel.current.slice(0, 220)}</blockquote>}
                  <div className="ask-chips">
                    {chips.map((c) => (
                      <button key={c.label} onClick={() => send(c.q)}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) =>
                m.role === 'assistant' ? (
                  <div key={i} className="ask-wrap">
                    <div className="ask-msg assistant rich" dangerouslySetInnerHTML={{ __html: renderRich(m.content, true) }} />
                    <div className="ask-acts">
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(m.content);
                          toast('Copied');
                        }}
                      >
                        Copy
                      </button>
                      <button onClick={() => shareText(`${m.content}\n\n— Froggy, reading “${title}”`)}>Share</button>
                      <button
                        className="ask-report"
                        onClick={() =>
                          openExternal(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Frogity: problem with an AI answer')}&body=${encodeURIComponent(`Question: ${msgs[i - 1]?.content ?? ''}\n\nAnswer: ${m.content}\n\nWhat was wrong:\n`)}`)
                        }
                      >
                        Report
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={i} className={`ask-msg ${m.role}`}>
                    {m.content}
                  </div>
                ),
              )}
              {busy && (
                <div className="ask-msg assistant">
                  <PixelLoader size={4} gap={2} label="Froggy is thinking" />
                </div>
              )}
              {err && (
                <div className="ask-msg err">
                  {err}{' '}
                  {!/today/.test(err) && (
                    <button onClick={() => send(msgs[msgs.length - 1]?.content ?? '', true)} style={{ fontWeight: 600, textDecoration: 'underline' }}>
                      Retry
                    </button>
                  )}
                </div>
              )}
              {!!msgs.length && !busy && !err && (
                <div className="ask-chips follow">
                  {['Tell me more', 'Shorter', 'An example'].map((q) => (
                    <button key={q} onClick={() => send(q === 'Shorter' ? 'Say that in two sentences.' : q === 'An example' ? 'Give me a concrete example.' : 'Tell me more about that.')}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
              <div ref={end} />
            </div>
            <form
              className="ask-input"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Froggy about this document" enterKeyHint="send" />
              <button className="pill round sm" disabled={!input.trim() || busy} aria-label="Send">
                <Icon name="up" size={18} stroke={2.4} />
              </button>
            </form>
            {left && (
              <p className={`ask-quota mono${left.left <= 5 ? ' low' : ''}`}>
                {left.left <= 0 ? 'Froggy is asleep until midnight' : `${left.left} of ${left.cap} free questions left today`}
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
