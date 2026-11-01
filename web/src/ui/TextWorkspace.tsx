import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { useStore, toast, type LocalDoc } from '../lib/store';
import { saveFile, updateDoc } from '../sync/engine';
import { cleanHtml, htmlToDocx, htmlToMarkdown } from '../lib/convert';
import { cleanPaste, makeFr, parseFr } from '../lib/fr';
import { registerCommands, dropCommands } from './commands';
import { getUi, openDoc, setUi } from './state';
import { Icon } from './Icon';
import { Pixel } from './px';
import { WebListen } from './WebListen';
import { download, prompt, showMenu } from './bits';
import { convertToFr, renameDoc } from './actions';

/** Frogity notes, Markdown, web pages, Word files and code: read them, or switch to editing; saved back by itself. */
export function TextWorkspace({ doc, blob, secondary }: { doc: LocalDoc; blob: Blob; secondary?: boolean }) {
  const id = doc.id;
  const kind = doc.meta.doc.kind;
  const plain = kind === 'text' || kind === 'code' || kind === 'rtf';
  const live = useStore((s) => s.docs.find((d) => d.id === id));
  const name = live?.meta.doc.name ?? doc.meta.doc.name;
  const ed = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<'' | 'unsaved' | 'saving' | 'saved'>('');
  const [words, setWords] = useState(0);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [listening, setListening] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('frogity-read-theme') ?? 'paper');
  const [, force] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      let html = '';
      let empty = false;
      if (plain) {
        const t = await blob.text();
        setText(t);
        empty = !t.trim();
      } else if (kind === 'fr') {
        html = parseFr(await blob.text()).html;
        empty = !html.replace(/<[^>]+>/g, '').trim();
      } else if (kind === 'markdown') html = await marked.parse(await blob.text(), { gfm: true, breaks: false });
      else if (kind === 'html') html = cleanHtml(await blob.text());
      else if (kind === 'docx') {
        const mammoth = await import('mammoth');
        html = (await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() })).value;
      }
      if (!alive) return;
      if (!plain && ed.current) ed.current.innerHTML = cleanHtml(html);
      if (empty) setMode('edit'); // a new, empty note opens ready to write in
      setReady(true);
      count();
      const p = doc.meta.doc.progress;
      if (p > 0.02 && !empty) requestAnimationFrame(() => scroller.current && (scroller.current.scrollTop = p * (scroller.current.scrollHeight - scroller.current.clientHeight)));
      if (!secondary) void updateDoc(id, { openedAt: Date.now() });
      if (empty) setTimeout(() => (plain ? area.current : ed.current)?.focus(), 80);
    })();
    return () => {
      alive = false;
    };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = () => setWords(((plain ? area.current?.value : ed.current?.innerText) ?? '').split(/\s+/).filter(Boolean).length);

  const save = async () => {
    setState('saving');
    try {
      let out: Blob;
      if (plain) out = new Blob([area.current?.value ?? text], { type: doc.meta.doc.mime || 'text/plain' });
      else if (kind === 'fr') out = makeFr(name, ed.current!.innerHTML);
      else if (kind === 'markdown') out = new Blob([htmlToMarkdown(ed.current!)], { type: 'text/markdown' });
      else if (kind === 'html') out = new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body>${ed.current!.innerHTML}</body></html>`], { type: 'text/html' });
      else out = await htmlToDocx(ed.current!);
      await saveFile(id, out);
      setState('saved');
    } catch (e) {
      setState('unsaved');
      toast('Could not save: ' + (e as Error).message);
    }
  };
  const changed = () => {
    setState('unsaved');
    count();
  };
  useEffect(() => {
    if (state !== 'unsaved') return;
    const t = setTimeout(() => void save(), 1500);
    return () => clearTimeout(t);
  }, [state, text, words]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void (stateRef.current === 'unsaved' && save()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const stateRef = useRef(state);
  stateRef.current = state;

  // reading progress goes back to the phone
  useEffect(() => {
    const el = scroller.current;
    if (!el || secondary) return;
    let t = 0;
    const on = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        const p = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 1;
        void updateDoc(id, { progress: Math.min(1, Math.max(0, p)), position: { mode: 'liquid', value: p } });
      }, 1500);
    };
    el.addEventListener('scroll', on);
    return () => el.removeEventListener('scroll', on);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const cmd = (c: string, v?: string) => {
    ed.current?.focus();
    document.execCommand(c, false, v);
    changed();
    force((n) => n + 1);
  };
  const block = (tag: string) => cmd('formatBlock', tag);
  const link = async () => {
    const sel = getSelection()?.rangeCount ? getSelection()!.getRangeAt(0).cloneRange() : null;
    const url = await prompt('Link to', 'https://', 'Add link');
    if (!url) return;
    if (sel) {
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(sel);
    }
    cmd('createLink', url);
  };
  const html = () => ed.current?.innerHTML ?? '';
  const exportMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const base = name.replace(/[\\/:*?"<>|]/g, '');
    showMenu({ clientX: r.right - 210, clientY: r.bottom + 6 }, [
      { label: 'Word (.docx)', icon: <Icon name="download" size={15} />, run: async () => download(await htmlToDocx(ed.current!), `${base}.docx`), hidden: plain },
      { label: 'Markdown (.md)', icon: <Icon name="download" size={15} />, run: () => download(new Blob([htmlToMarkdown(ed.current!)], { type: 'text/markdown' }), `${base}.md`), hidden: plain },
      { label: 'Web page (.html)', icon: <Icon name="download" size={15} />, run: () => download(new Blob([`<!doctype html><meta charset="utf-8"><title>${base}</title>${html()}`], { type: 'text/html' }), `${base}.html`), hidden: plain },
      { label: 'Plain text (.txt)', icon: <Icon name="text" size={15} />, run: () => download(new Blob([plain ? (area.current?.value ?? '') : (ed.current?.innerText ?? '')], { type: 'text/plain' }), `${base}.txt`) },
      { label: 'Print or save as PDF', icon: <Icon name="page" size={15} />, run: () => printHtml(base, plain ? `<pre>${esc(area.current?.value ?? '')}</pre>` : html()) },
      { sep: true, hidden: kind === 'fr' || plain },
      { label: 'Make an editable Frogity copy (.fr)', icon: <Icon name="edit" size={15} />, run: () => void convertToFr(id).then((n) => n && openDoc(n)), hidden: kind === 'fr' || plain },
    ]);
  };

  useEffect(() => {
    const owner = secondary ? 'split:' + id : id;
    registerCommands(owner, [
      { id: 'save', label: 'Save now', hint: '⌘S', icon: 'check', run: () => void save() },
      { id: 'mode', label: mode === 'edit' ? 'Switch to reading view' : 'Edit this document', icon: 'edit', run: () => setMode((m) => (m === 'edit' ? 'view' : 'edit')) },
      { id: 'listen', label: 'Listen to this document', icon: 'ear', run: () => setListening(true) },
      { id: 'fr', label: 'Make an editable Frogity copy (.fr)', icon: 'edit', run: () => void convertToFr(id).then((n) => n && openDoc(n)) },
      { id: 'docx', label: 'Download as Word (.docx)', icon: 'download', run: async () => !plain && download(await htmlToDocx(ed.current!), `${name}.docx`) },
      { id: 'md', label: 'Download as Markdown', icon: 'download', run: () => !plain && download(new Blob([htmlToMarkdown(ed.current!)], { type: 'text/markdown' }), `${name}.md`) },
      { id: 'print', label: 'Print or save as PDF', icon: 'page', run: () => printHtml(name, plain ? `<pre>${esc(area.current?.value ?? '')}</pre>` : html()) },
      { id: 'rename', label: 'Rename', icon: 'edit', run: () => void renameDoc(id) },
    ]);
    return () => dropCommands(owner);
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const u = getUi();
      if (u.palette || u.dialog || (!secondary && u.active !== id)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save().then(() => toast('Saved — on its way to your phone'));
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const editing = mode === 'edit';
  const note = kind === 'docx' && editing;
  return (
    <div className="ws">
      <div className="toolbar">
        <button className="title" onClick={() => renameDoc(id)} title="Rename">
          {name}
        </button>
        <span className="dirty">{state === 'saving' ? 'saving…' : state === 'unsaved' ? 'unsaved' : state === 'saved' ? 'saved ✓' : ''}</span>
        <div className="modes" role="group" aria-label="View or edit">
          <button className={!editing ? 'on' : ''} onClick={() => setMode('view')}>
            Read
          </button>
          <button className={editing ? 'on' : ''} onClick={() => setMode('edit')}>
            Edit
          </button>
        </div>
        {editing && !plain && (
          <>
            <div className="sep" />
            <button className="ib" data-tip="Heading" onClick={() => block('H2')}>
              <Icon name="h" size={16} />
            </button>
            <button className="ib" data-tip="Small heading" onClick={() => block('H3')}>
              <span style={{ font: '600 12px var(--mono)' }}>H3</span>
            </button>
            <button className="ib" data-tip="Paragraph" onClick={() => block('P')}>
              <span style={{ font: '600 12px var(--mono)' }}>¶</span>
            </button>
            <div className="sep" />
            <button className="ib" data-tip="Bold  ⌘B" onClick={() => cmd('bold')}>
              <Icon name="bold" size={16} />
            </button>
            <button className="ib" data-tip="Italic  ⌘I" onClick={() => cmd('italic')}>
              <Icon name="italic" size={16} />
            </button>
            <button className="ib" data-tip="Underline  ⌘U" onClick={() => cmd('underline')}>
              <Icon name="under" size={16} />
            </button>
            <button className="ib" data-tip="Link" onClick={link}>
              <Icon name="link" size={16} />
            </button>
            <div className="sep" />
            <button className="ib" data-tip="List" onClick={() => cmd('insertUnorderedList')}>
              <Icon name="ul" size={16} />
            </button>
            <button className="ib" data-tip="Numbered list" onClick={() => cmd('insertOrderedList')}>
              <Icon name="ol" size={16} />
            </button>
            <button className="ib" data-tip="Quote" onClick={() => block('BLOCKQUOTE')}>
              <Icon name="quote" size={16} />
            </button>
            <button className="ib" data-tip="Code block" onClick={() => block('PRE')}>
              <Icon name="code2" size={16} />
            </button>
            <div className="sep" />
            <button className="ib" data-tip="Undo  ⌘Z" onClick={() => cmd('undo')}>
              <Icon name="undo2" size={16} />
            </button>
            <button className="ib" data-tip="Redo" onClick={() => cmd('redo')}>
              <Icon name="redo" size={16} />
            </button>
          </>
        )}
        <div className="grow" />
        <span className="dirty">
          {words.toLocaleString()} words · {Math.max(1, Math.round(words / 230))} min
        </span>
        {!editing &&
          (['paper', 'white', 'night'] as const).map((t) => (
            <button
              key={t}
              className={`chip${theme === t ? ' on' : ''}`}
              style={{ height: 26, padding: '0 9px', fontSize: 11.5 }}
              onClick={() => (setTheme(t), localStorage.setItem('frogity-read-theme', t))}
            >
              {t}
            </button>
          ))}
        {!plain && (
          <button className={`ib${listening ? ' on' : ''}`} data-tip="Listen" onClick={() => setListening((l) => !l)}>
            <Pixel name="ear" size={17} />
          </button>
        )}
        <button className="ib" data-tip="Export and convert" onClick={exportMenu}>
          <Icon name="download" size={16} />
        </button>
        {secondary && (
          <button className="ib" data-tip="Close this side" onClick={() => setUi({ split: null })}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {note && <div className="fr-edit-banner">Word files keep headings, lists, bold, italic and links when edited; tables and pictures are simplified when it saves. For full freedom, make a Frogity copy (⤓ → Make an editable Frogity copy).</div>}
      <div className="reading" ref={scroller} data-t={editing ? undefined : theme} style={editing ? { background: 'var(--bg)' } : undefined}>
        {plain ? (
          <textarea
            ref={area}
            className="codeview"
            readOnly={!editing}
            style={{ width: '100%', border: 0, background: 'transparent', resize: 'none', minHeight: '100%', fontSize: kind === 'code' ? 13 : 15, fontFamily: 'var(--mono)' }}
            value={text}
            spellCheck={kind !== 'code'}
            onChange={(e) => {
              setText(e.target.value);
              changed();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && editing) {
                e.preventDefault();
                document.execCommand('insertText', false, '  ');
              }
            }}
          />
        ) : (
          <div className="column">
            <div
              ref={ed}
              className="editor"
              contentEditable={editing}
              suppressContentEditableWarning
              spellCheck
              onInput={changed}
              onPaste={(e) => {
                // what comes from Google Docs or Word keeps its structure and loses its mess
                const h = e.clipboardData.getData('text/html');
                if (!h) return;
                e.preventDefault();
                document.execCommand('insertHTML', false, cleanPaste(h));
                changed();
              }}
            />
          </div>
        )}
      </div>
      {listening && !plain && <WebListen getRoot={() => ed.current} onClose={() => setListening(false)} />}
    </div>
  );
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function printHtml(title: string, body: string) {
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:16px/1.6 Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px}img{max-width:100%}pre{white-space:pre-wrap}</style>${body}`);
  w.document.close();
  w.onload = () => w.print();
  setTimeout(() => w.print(), 500);
}
