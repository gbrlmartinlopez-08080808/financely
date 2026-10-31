import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { useStore, toast, type LocalDoc } from '../lib/store';
import { saveFile, updateDoc } from '../sync/engine';
import { cleanHtml, htmlToDocx, htmlToMarkdown } from '../lib/convert';
import { registerCommands, dropCommands } from './commands';
import { getUi, setUi } from './state';
import { Icon } from './Icon';
import { download, prompt } from './bits';
import { renameDoc } from './actions';

/** Markdown, plain text, web pages, Word files and code: read and write in place; saved back by itself. */
export function TextWorkspace({ doc, blob, secondary }: { doc: LocalDoc; blob: Blob; secondary?: boolean }) {
  const id = doc.id;
  const kind = doc.meta.doc.kind;
  const plain = kind === 'text' || kind === 'code' || kind === 'rtf';
  const live = useStore((s) => s.docs.find((d) => d.id === id));
  const ed = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<'' | 'unsaved' | 'saving' | 'saved'>('');
  const [words, setWords] = useState(0);
  const [docxOk, setDocxOk] = useState(kind !== 'docx');
  const [, force] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      let html = '';
      if (plain) setText(await blob.text());
      else if (kind === 'markdown') html = await marked.parse(await blob.text(), { gfm: true, breaks: false });
      else if (kind === 'html') html = cleanHtml(await blob.text());
      else if (kind === 'docx') {
        const mammoth = await import('mammoth');
        html = (await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() })).value;
      }
      if (!alive) return;
      if (!plain && ed.current) ed.current.innerHTML = cleanHtml(html);
      setReady(true);
      count();
      const p = doc.meta.doc.progress;
      if (p > 0.02) requestAnimationFrame(() => scroller.current && (scroller.current.scrollTop = p * (scroller.current.scrollHeight - scroller.current.clientHeight)));
      if (!secondary) void updateDoc(id, { openedAt: Date.now() });
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
      else if (kind === 'markdown') out = new Blob([htmlToMarkdown(ed.current!)], { type: 'text/markdown' });
      else if (kind === 'html') out = new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>${doc.meta.doc.name}</title></head><body>${ed.current!.innerHTML}</body></html>`], { type: 'text/html' });
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
    const t = setTimeout(() => void save(), 1800);
    return () => clearTimeout(t);
  }, [state, text, words]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void (stateRef.current === 'unsaved' && save()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const stateRef = useRef(state);
  stateRef.current = state;

  // reading progress back to the phone
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
    const sel = getSelection()?.getRangeAt(0).cloneRange();
    const url = await prompt('Link to', 'https://', 'Add link');
    if (!url) return;
    if (sel) {
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(sel);
    }
    cmd('createLink', url);
  };

  useEffect(() => {
    const owner = secondary ? 'split:' + id : id;
    registerCommands(owner, [
      { id: 'save', label: 'Save now', hint: '⌘S', icon: 'check', run: () => void save() },
      { id: 'md', label: 'Download as Markdown', icon: 'download', run: () => !plain && download(new Blob([htmlToMarkdown(ed.current!)], { type: 'text/markdown' }), `${doc.meta.doc.name}.md`) },
      { id: 'docx', label: 'Download as Word (.docx)', icon: 'download', run: async () => !plain && download(await htmlToDocx(ed.current!), `${doc.meta.doc.name}.docx`) },
      { id: 'html', label: 'Download as a web page (.html)', icon: 'download', run: () => !plain && download(new Blob([`<!doctype html><meta charset="utf-8"><title>${doc.meta.doc.name}</title>${ed.current!.innerHTML}`], { type: 'text/html' }), `${doc.meta.doc.name}.html`) },
      { id: 'txt', label: 'Download as plain text', icon: 'text', run: () => download(new Blob([plain ? (area.current?.value ?? '') : (ed.current?.innerText ?? '')], { type: 'text/plain' }), `${doc.meta.doc.name}.txt`) },
      { id: 'print', label: 'Print or save as PDF', icon: 'page', run: () => printHtml(doc.meta.doc.name, plain ? `<pre>${escape(area.current?.value ?? '')}</pre>` : ed.current!.innerHTML) },
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

  const editable = docxOk;
  return (
    <div className="ws">
      <div className="toolbar">
        <button className="title" onClick={() => renameDoc(id)} title="Rename">
          {live?.meta.doc.name ?? doc.meta.doc.name}
        </button>
        <span className="dirty">{state === 'saving' ? 'saving…' : state === 'unsaved' ? 'unsaved' : state === 'saved' ? 'saved ✓' : ''}</span>
        {!plain && editable && (
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
            <button className="ib" data-tip="Line" onClick={() => cmd('insertHorizontalRule')}>
              <span style={{ font: '600 12px var(--mono)' }}>—</span>
            </button>
          </>
        )}
        <div className="grow" />
        <span className="dirty">{words.toLocaleString()} words · {Math.max(1, Math.round(words / 230))} min</span>
        {secondary && (
          <button className="ib" data-tip="Close this side" onClick={() => setUi({ split: null })}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {kind === 'docx' && !docxOk && (
        <div className="notice" style={{ margin: '12px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>Word files are shown here as text. Editing keeps headings, lists, bold, italic and links; tables and pictures are simplified when it saves.</span>
          <button className="btn sm" onClick={() => setDocxOk(true)}>
            Edit anyway
          </button>
        </div>
      )}
      <div className="reading" ref={scroller} style={{ background: 'var(--bg)' }}>
        {plain ? (
          <textarea
            ref={area}
            className="codeview"
            style={{ width: '100%', border: 0, background: 'transparent', resize: 'none', minHeight: '100%', fontSize: kind === 'code' ? 13 : 15, fontFamily: kind === 'code' ? 'var(--mono)' : 'var(--mono)' }}
            value={text}
            spellCheck={kind !== 'code'}
            onChange={(e) => {
              setText(e.target.value);
              changed();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault();
                document.execCommand('insertText', false, '  ');
              }
            }}
          />
        ) : (
          <div className="column">
            <div ref={ed} className="editor" contentEditable={editable} suppressContentEditableWarning spellCheck onInput={changed} />
          </div>
        )}
      </div>
    </div>
  );
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function printHtml(title: string, body: string) {
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:16px/1.6 Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px}img{max-width:100%}pre{white-space:pre-wrap}</style>${body}`);
  w.document.close();
  w.onload = () => w.print();
  setTimeout(() => w.print(), 500);
}
