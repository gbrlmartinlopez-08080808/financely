import { useEffect, useRef, useState } from 'react';
import { ask, chunk, type Msg } from '../lib/ai';
import { Icon } from '../ui/Icon';
import { PixelLoader, Sheet } from '../ui/kit';
import { SUPPORT_EMAIL } from '../lib/config';
import { openExternal } from '../lib/native';
import { renderRich } from '../lib/formats/flow';

const QUICK = ['Summarise this', 'Key ideas', 'Explain it simply', 'Quiz me'];

export function AskSheet({
  open,
  onClose,
  title,
  getText,
  selection,
  aiOk,
  onConsent,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  getText: () => Promise<string>;
  selection?: string;
  aiOk: boolean;
  onConsent: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const passages = useRef<string[] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const sel = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (open) sel.current = selection;
  }, [open, selection]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);
  useEffect(() => () => abort.current?.abort(), []);

  const send = async (q: string, retry = false) => {
    const question = q.trim();
    if (!question || busy) return;
    setInput('');
    setErr(null);
    const history = retry ? msgs.slice(0, -1) : msgs;
    setMsgs([...history, { role: 'user', content: question }]);
    setBusy(true);
    abort.current = new AbortController();
    try {
      if (!passages.current) passages.current = chunk(await getText());
      const answer = await ask({ title, passages: passages.current, question, history, selection: sel.current, signal: abort.current.signal });
      setMsgs((m) => [...m, { role: 'assistant', content: answer }]);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message || 'Something went wrong.');
    } finally {
      setBusy(false);
      sel.current = undefined;
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Ask" className="ask">
      <div className="ask-body">
        {!aiOk ? (
          <div className="ask-consent">
            <div className="ask-orb mono" aria-hidden>
              ◐
            </div>
            <h4>Ask this document anything</h4>
            <p>
              Free, no account. When you ask, your question and a few short excerpts from this document are sent to an open AI service
              (Pollinations). Nothing else leaves your phone.
            </p>
            <p className="muted">Skip it for private documents. Everything else in Quire stays on the device.</p>
            <button className="pill" onClick={onConsent}>
              Turn on Ask
            </button>
          </div>
        ) : (
          <>
            <div className="ask-scroll">
              {!msgs.length && (
                <div className="ask-empty">
                  <p className="mono">{sel.current ? 'asking about your selection' : title.length > 38 ? title.slice(0, 38) + '…' : title}</p>
                  {sel.current && <blockquote>{sel.current.slice(0, 220)}</blockquote>}
                  <div className="ask-chips">
                    {QUICK.map((q) => (
                      <button key={q} onClick={() => send(sel.current && q === 'Summarise this' ? 'Explain this passage' : q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) =>
                m.role === 'assistant' ? (
                  <div key={i} className="ask-wrap">
                    <div className="ask-msg assistant rich" dangerouslySetInnerHTML={{ __html: renderRich(m.content, true) }} />
                    <button
                      className="ask-report"
                      onClick={() =>
                        openExternal(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Quire: problem with an AI answer')}&body=${encodeURIComponent(`Question: ${msgs[i - 1]?.content ?? ''}\n\nAnswer: ${m.content}\n\nWhat was wrong:\n`)}`)
                      }
                    >
                      Report this answer
                    </button>
                  </div>
                ) : (
                  <div key={i} className={`ask-msg ${m.role}`}>
                    {m.content}
                  </div>
                ),
              )}
              {busy && (
                <div className="ask-msg assistant">
                  <PixelLoader size={4} gap={2} label="thinking" />
                </div>
              )}
              {err && (
                <div className="ask-msg err">
                  {err}{' '}
                  <button onClick={() => send(msgs[msgs.length - 1]?.content ?? '', true)} style={{ fontWeight: 600, textDecoration: 'underline' }}>
                    Retry
                  </button>
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
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about this document" enterKeyHint="send" />
              <button className="pill round sm" disabled={!input.trim() || busy} aria-label="Send">
                <Icon name="up" size={18} stroke={2.4} />
              </button>
            </form>
          </>
        )}
      </div>
    </Sheet>
  );
}
