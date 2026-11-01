import { useEffect, useState } from 'react';
import { Pixel, PixelLoader, Sheet } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { looksLikeUrl } from '../lib/links';

type Mode = 'menu' | 'link' | 'paste';

export function AddSheet({
  open,
  onClose,
  onFiles,
  onFolder,
  onScan,
  onDiscover,
  onLink,
  onPaste,
  onNote,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onFiles: () => void;
  onFolder?: () => void;
  onScan: () => void;
  onDiscover: () => void;
  onLink: (url: string) => void;
  onPaste: (text: string, title: string) => void;
  onNote: () => void;
  busy: string | null;
  error: string | null;
}) {
  const [mode, setMode] = useState<Mode>('menu');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  useEffect(() => {
    if (open) {
      setMode('menu');
      setUrl('');
      setText('');
      setTitle('');
      // peek at the clipboard: a copied link is the most likely thing to add
      navigator.clipboard
        ?.readText?.()
        .then((c) => {
          if (c && looksLikeUrl(c.trim())) setUrl(c.trim());
        })
        .catch(() => {});
    }
  }, [open]);

  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title={mode === 'menu' ? 'Add' : mode === 'link' ? 'Save a link' : 'Paste text'} onBackBtn={mode !== 'menu' && !busy ? () => setMode('menu') : undefined}>
      <div className="sheet-body" style={{ paddingBottom: 16 }}>
        {mode === 'menu' && (
          <div className="actions">
            <button className="action" onClick={() => (onClose(), onFiles())}>
              <span className="ic">
                <Pixel name="page" size={16} />
              </span>
              Files from your phone
              <span className="r">opened in place</span>
            </button>
            {onFolder && (
              <button className="action" onClick={() => (onClose(), onFolder())}>
                <span className="ic">
                  <Pixel name="stack" size={16} />
                </span>
                Link a folder
                <span className="r">stays up to date</span>
              </button>
            )}
            <button className="action" onClick={() => (onClose(), onDiscover())}>
              <span className="ic">
                <Pixel name="book" size={16} />
              </span>
              Find free books
              <span className="r">classics · papers · pdfs</span>
            </button>
            <button className="action" onClick={() => setMode('link')}>
              <span className="ic">
                <Icon name="globe" size={20} />
              </span>
              Web page or link
              <span className="r">{url ? 'link copied' : ''}</span>
            </button>
            <button className="action" onClick={() => (onClose(), onScan())}>
              <span className="ic">
                <Pixel name="scan" size={16} />
              </span>
              Scan paper
              <span className="r">camera · ocr</span>
            </button>
            <button className="action" onClick={() => (onClose(), onNote())}>
              <span className="ic">
                <Pixel name="note" size={16} />
              </span>
              New note
              <span className="r">write · edit anywhere</span>
            </button>
            <button className="action" onClick={() => setMode('paste')}>
              <span className="ic">
                <Pixel name="type" size={16} />
              </span>
              Paste text or notes
            </button>
          </div>
        )}
        {mode === 'link' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim() && !busy) onLink(url.trim());
            }}
          >
            <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
              Articles are saved as clean, readable pages with their images. Links to PDFs, books or images are saved as the file itself.
            </p>
            <input className="field" autoFocus placeholder="https://…" inputMode="url" autoCapitalize="none" autoCorrect="off" value={url} onChange={(e) => setUrl(e.target.value)} />
            {error && <p className="field-err">{error}</p>}
            <button className="pill" style={{ width: '100%', marginTop: 10 }} disabled={!url.trim() || !!busy}>
              {busy ? <PixelLoader size={4} gap={2} label={busy} /> : 'Save to library'}
            </button>
          </form>
        )}
        {mode === 'paste' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) onPaste(text, title);
            }}
          >
            <input className="field" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className="field" style={{ marginTop: 8, height: 180, padding: 12, resize: 'none' }} placeholder="Paste anything — Markdown and $maths$ work" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="pill" style={{ width: '100%', marginTop: 10 }} disabled={!text.trim()}>
              Save to library
            </button>
          </form>
        )}
      </div>
    </Sheet>
  );
}
