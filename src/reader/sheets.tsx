import { useEffect, useState } from 'react';
import { updateSettings, useStore } from '../lib/store';
import type { Bookmark, Highlight, ReaderTheme, TocEntry } from '../lib/types';
import { Icon } from '../ui/Icon';
import { Pixel, Ruler, Segmented, Sheet, Toggle } from '../ui/kit';
import type { PixelName } from '../lib/pixels';

export const THEMES: { id: ReaderTheme; bg: string; ink: string; name: string }[] = [
  { id: 'paper', bg: '#eeedea', ink: '#141414', name: 'paper' },
  { id: 'white', bg: '#ffffff', ink: '#111', name: 'white' },
  { id: 'dusk', bg: '#1d1d1c', ink: '#d8d6d0', name: 'dusk' },
  { id: 'night', bg: '#000000', ink: '#bdbbb5', name: 'night' },
];

export function TypeSheet({ open, onClose, isPdf, mode, onMode }: { open: boolean; onClose: () => void; isPdf: boolean; mode: 'page' | 'liquid'; onMode: (m: 'page' | 'liquid') => void }) {
  const s = useStore((x) => x.settings);
  return (
    <Sheet open={open} onClose={onClose} title="Reading">
      <div className="sheet-body" style={{ paddingBottom: 12 }}>
        {isPdf && (
          <>
            <div className="section-label" style={{ marginTop: 4 }}>view</div>
            <Segmented
              light
              className="w100"
              value={mode}
              onChange={onMode}
              options={[
                { value: 'page', label: <><Icon name="page" size={16} /> Page</> },
                { value: 'liquid', label: <><Icon name="liquid" size={16} /> Liquid</> },
              ]}
            />
            {mode === 'page' && <p className="muted" style={{ fontSize: 12.5, margin: '10px 4px 0' }}>Liquid reflows the PDF to fit your screen — equations and figures are kept intact.</p>}
          </>
        )}
        {(!isPdf || mode === 'liquid') && (
          <>
            <div className="section-label">typeface</div>
            <div className="fontpick">
              {(
                [
                  ['serif', 'Garamond', 'var(--serif)'],
                  ['sans', 'Inter', 'var(--sans)'],
                  ['mono', 'Mono', 'var(--mono)'],
                ] as const
              ).map(([id, name, fam]) => (
                <button key={id} className={s.font === id ? 'on' : ''} onClick={() => updateSettings({ font: id })}>
                  <b style={{ fontFamily: fam }}>Aa</b>
                  <span>{name}</span>
                </button>
              ))}
            </div>
            <div className="section-label">size</div>
            <Ruler value={s.fontSize} min={13} max={32} step={1} onChange={(v) => updateSettings({ fontSize: v })} format={(v) => `${v}px`} label="Font size" />
            <div className="section-label">line spacing</div>
            <Ruler value={s.lineHeight} min={1.2} max={2.2} step={0.05} onChange={(v) => updateSettings({ lineHeight: v })} format={(v) => v.toFixed(2)} label="Line spacing" />
            <div className="section-label">margins</div>
            <Ruler value={s.margin} min={8} max={56} step={2} onChange={(v) => updateSettings({ margin: v })} format={(v) => `${v}`} label="Margins" />
            <div className="row" style={{ marginTop: 8 }}>
              <div className="grow">
                <div className="row-label">Justify text</div>
                <div className="row-sub">Even edges with hyphenation</div>
              </div>
              <Toggle on={s.justify} onChange={(v) => updateSettings({ justify: v })} label="Justify" />
            </div>
          </>
        )}
        <div className="section-label">theme</div>
        <div className="themes">
          {THEMES.map((t) => (
            <button key={t.id} className={s.readerTheme === t.id ? 'on' : ''} style={{ background: t.bg, color: t.ink }} onClick={() => updateSettings({ readerTheme: t.id })} aria-label={t.name}>
              Aa
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

export function ContentsSheet({
  open,
  onClose,
  toc,
  marks,
  highlights,
  onGo,
  onGoMark,
  onGoHighlight,
  onDeleteMark,
  onDeleteHighlight,
  onAddMark,
}: {
  open: boolean;
  onClose: () => void;
  toc: TocEntry[];
  marks: Bookmark[];
  highlights: Highlight[];
  onGo: (t: TocEntry) => void;
  onGoMark: (b: Bookmark) => void;
  onGoHighlight: (h: Highlight) => void;
  onDeleteMark: (b: Bookmark) => void;
  onDeleteHighlight: (h: Highlight) => void;
  onAddMark: () => void;
}) {
  const [tab, setTab] = useState<'toc' | 'marks'>(toc.length ? 'toc' : 'marks');
  useEffect(() => {
    if (open) setTab(toc.length ? 'toc' : 'marks');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={open} onClose={onClose}>
      <div style={{ padding: '6px 22px 12px', display: 'flex', justifyContent: 'center' }}>
        <Segmented
          light
          value={tab}
          onChange={setTab}
          options={[
            { value: 'toc', label: 'Contents' },
            { value: 'marks', label: `Marks · ${marks.length + highlights.length}` },
          ]}
        />
      </div>
      <div className="sheet-body" style={{ minHeight: '40vh' }}>
        {tab === 'toc' ? (
          toc.length ? (
            toc.map((t, i) => (
              <button key={i} className="toc-item" style={{ paddingLeft: (t.level - 1) * 14 }} onClick={() => onGo(t)}>
                <span style={{ fontWeight: t.level === 1 ? 600 : 400 }}>{t.title}</span>
                {t.page && <span className="pg">{t.page}</span>}
              </button>
            ))
          ) : (
            <p className="muted mono" style={{ fontSize: 12, textAlign: 'center', padding: 30 }}>
              no table of contents
            </p>
          )
        ) : (
          <>
            <button className="pill ghost sm" style={{ margin: '4px 0 10px' }} onClick={onAddMark}>
              <Icon name="bookmark" size={16} /> Bookmark this spot
            </button>
            {marks.map((b) => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center' }}>
                <button className="mark-item" onClick={() => onGoMark(b)}>
                  <span style={{ fontSize: 15 }}>{b.label}</span>
                  <small>bookmark · {Math.round(b.progress * 100)}%</small>
                </button>
                <button className="chip" onClick={() => onDeleteMark(b)} aria-label="Delete bookmark">
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
            {highlights.map((h) => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center' }}>
                <button className="mark-item" onClick={() => onGoHighlight(h)}>
                  <q>{h.text.length > 220 ? h.text.slice(0, 220) + '…' : h.text}</q>
                  <small>highlight · {new Date(h.at).toLocaleDateString()}</small>
                </button>
                <button className="chip" onClick={() => onDeleteHighlight(h)} aria-label="Delete highlight">
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
            {!marks.length && !highlights.length && (
              <p className="muted" style={{ fontSize: 13.5, textAlign: 'center', padding: '24px 10px' }}>
                Select text to highlight it. Your bookmarks and highlights collect here.
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

export interface MoreAction {
  id: string;
  label: string;
  icon?: string;
  pixel?: PixelName;
  right?: string;
  hidden?: boolean;
}

export function MoreSheet({ open, onClose, actions, onAction, title }: { open: boolean; onClose: () => void; actions: MoreAction[]; onAction: (id: string) => void; title: string }) {
  return (
    <Sheet open={open} onClose={onClose} title={<span className="mono" style={{ fontSize: 14 }}>{title.length > 28 ? title.slice(0, 28) + '…' : title}</span>}>
      <div className="sheet-body">
        <div className="actions">
          {actions
            .filter((a) => !a.hidden)
            .map((a) => (
              <button
                key={a.id}
                className="action"
                onClick={() => {
                  onClose();
                  setTimeout(() => onAction(a.id), 120);
                }}
              >
                <span className="ic">{a.pixel ? <Pixel name={a.pixel} size={16} /> : <Icon name={a.icon ?? 'more'} />}</span>
                {a.label}
                {a.right && <span className="r">{a.right}</span>}
              </button>
            ))}
        </div>
      </div>
    </Sheet>
  );
}
