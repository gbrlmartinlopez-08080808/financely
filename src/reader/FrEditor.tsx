import { useEffect, useRef, useState } from 'react';
import { getFile } from '../lib/library';
import { patchDoc } from '../lib/store';
import * as db from '../lib/db';
import { cleanPaste, makeFr, parseFr } from '../lib/fr';
import type { DocMeta } from '../lib/types';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/kit';

/** Writing in a Frogity note: a clean page, a small toolbar, saved as you type (and sent to the computer by sync). */
export function FrEditor({ doc, onClose }: { doc: DocMeta; onClose: (changed: boolean) => void }) {
  const ed = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState(doc.name);
  const [state, setState] = useState<'' | 'unsaved' | 'saved'>('');
  const changed = useRef(false);
  const timer = useRef(0);
  const titleRef = useRef(title);
  titleRef.current = title;

  useEffect(() => {
    let alive = true;
    (async () => {
      const f = await getFile(doc.id);
      const html = f ? parseFr(await f.text()).html : '';
      if (!alive || !ed.current) return;
      ed.current.innerHTML = html;
      if (!html.replace(/<[^>]+>/g, '').trim()) setTimeout(() => ed.current?.focus(), 150);
    })();
    return () => {
      alive = false;
    };
  }, [doc.id]);

  const save = async () => {
    if (!ed.current) return;
    clearTimeout(timer.current);
    const blob = makeFr(titleRef.current, ed.current.innerHTML);
    await db.put('files', doc.id, blob);
    await patchDoc(doc.id, { name: titleRef.current || 'Untitled note', size: blob.size, modified: Date.now() });
    changed.current = true;
    setState('saved');
  };
  const edit = () => {
    setState('unsaved');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 900);
  };
  const close = async () => {
    if (state === 'unsaved') await save();
    onClose(changed.current);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const cmd = (c: string, v?: string) => {
    ed.current?.focus();
    document.execCommand(c, false, v);
    edit();
  };
  const link = () => {
    const url = window.prompt('Link to', 'https://');
    if (url) cmd('createLink', url);
  };
  return (
    <div className="fr-ed" role="dialog" aria-label="Edit note">
      <div className="fr-top">
        <button className="r-ibtn" onClick={close} aria-label="Done">
          <Icon name="check" size={22} />
        </button>
        <input
          className="fr-title"
          value={title}
          placeholder="Title"
          onChange={(e) => {
            setTitle(e.target.value);
            edit();
          }}
        />
        <span className="mono fr-state">{state === 'unsaved' ? 'saving…' : state === 'saved' ? 'saved' : ''}</span>
      </div>
      <div
        ref={ed}
        className="fr-page flow"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={edit}
        onPaste={(e) => {
          const h = e.clipboardData.getData('text/html');
          if (!h) return;
          e.preventDefault();
          document.execCommand('insertHTML', false, cleanPaste(h));
          edit();
        }}
        onBlur={() => state === 'unsaved' && void save()}
      />
      <div className="fr-bar" onMouseDown={(e) => e.preventDefault()}>
        <button onClick={() => cmd('formatBlock', 'H2')} aria-label="Heading">
          <b>H</b>
        </button>
        <button onClick={() => cmd('formatBlock', 'P')} aria-label="Paragraph">
          ¶
        </button>
        <button onClick={() => cmd('bold')} aria-label="Bold">
          <b>B</b>
        </button>
        <button onClick={() => cmd('italic')} aria-label="Italic">
          <i>I</i>
        </button>
        <button onClick={() => cmd('underline')} aria-label="Underline">
          <u>U</u>
        </button>
        <button onClick={() => cmd('insertUnorderedList')} aria-label="List">
          <Icon name="list" size={18} />
        </button>
        <button onClick={() => cmd('formatBlock', 'BLOCKQUOTE')} aria-label="Quote">
          ❝
        </button>
        <button onClick={link} aria-label="Link">
          <Icon name="globe" size={18} />
        </button>
        <button onClick={() => cmd('undo')} aria-label="Undo">
          <Icon name="undo" size={18} />
        </button>
        <button onClick={() => cmd('redo')} aria-label="Redo" style={{ transform: 'scaleX(-1)' }}>
          <Icon name="undo" size={18} />
        </button>
      </div>
    </div>
  );
}
