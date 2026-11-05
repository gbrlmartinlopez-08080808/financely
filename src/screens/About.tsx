import { APP_VERSION, PRIVACY_URL, SUPPORT_EMAIL } from '../lib/config';
import { openExternal } from '../lib/native';
import { Sheet } from '../ui/kit';

const LIBS: [string, string][] = [
  ['PDF.js', 'Apache-2.0 · Mozilla'],
  ['Tesseract.js + Tesseract OCR', 'Apache-2.0'],
  ['Capacitor', 'MIT · Ionic'],
  ['React', 'MIT · Meta'],
  ['KaTeX', 'MIT'],
  ['marked', 'MIT'],
  ['mammoth.js', 'BSD-2-Clause'],
  ['docx-preview (Word page view)', 'Apache-2.0'],
  ['JSZip', 'MIT'],
  ['jsPDF', 'MIT'],
  ['SheetJS Community Edition', 'Apache-2.0'],
  ['ONNX Runtime Web, vits-web / piper-phonemize loader (studio voices)', 'MIT'],
  ['Piper voices (studio voices)', 'MIT · CC BY 4.0 (per voice)'],
  ['d3-geo, topojson (build time)', 'ISC · BSD-3-Clause'],
];
const FONTS: [string, string][] = [
  ['EB Garamond, Literata, Source Serif 4, Lora, Crimson Pro, Merriweather', 'SIL Open Font License 1.1'],
  ['Inter, JetBrains Mono, IBM Plex Mono, Atkinson Hyperlegible, Noto Serif/Mono', 'SIL Open Font License 1.1'],
  ['OpenDyslexic', 'SIL Open Font License 1.1'],
];

export function About({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="About Frogity" onBackBtn={onClose}>
      <div className="sheet-body about" style={{ paddingBottom: 18 }}>
        <p className="mono muted" style={{ textAlign: 'center', margin: '-4px 0 14px', fontSize: 12 }}>
          version {APP_VERSION} · free · no ads · no accounts · no tracking
        </p>

        <div className="section-label">your data</div>
        <p>Your library, notes, highlights and reading history live only on this phone. Frogity has no account system and no analytics.</p>
        <p>
          The internet is used only when you ask for it: opening the <b>Interesting</b> tab (one small shared file with the day’s news, a figure, a picture and an article is downloaded — it holds nothing about you), looking up a word (the word is sent to Wikipedia / Wiktionary / dictionaryapi.dev), saving a web link (the page is fetched), the optional <b>Froggy</b> feature (your question and a few short excerpts go to Pollinations’ open AI service, only after you opt in), <b>Find free books</b> (your search goes to Project Gutenberg, the Internet Archive, arXiv, Google Books or Open Library, and the file you choose is downloaded), the <b>World</b> and <b>Sports</b> sheets (the country, league or team you open is looked up at Wikipedia/Wikidata, the World Bank, TheSportsDB, Nager.Date and Frankfurter; flags come from flagcdn), and the one-time download of a <b>studio voice</b> (from Hugging Face, with its speech engine from jsDelivr and cdnjs; after that it runs offline on the phone).
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="pill sm ghost" onClick={() => openExternal(PRIVACY_URL)}>
            Privacy policy
          </button>
          <button className="pill sm ghost" onClick={() => openExternal(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Frogity feedback')}`)}>
            Contact
          </button>
        </div>

        <div className="section-label">how Frogity works</div>
        <p>Frogity is a reader. You bring PDFs, Word files, e-books, web links, notes or photos; it keeps them on this phone, lets you read them as pages or as reflowing “Liquid” text, reads them aloud with a voice that runs on the phone, and finds the text in scans with on-device OCR. Streaks, goals, the games and the free “freeze” days are only there to make daily reading a habit — nothing is sold and nothing is tracked.</p>
        <p>The <b>Interesting</b> tab shows a daily selection (news headlines, a figure, an article, sports, country facts). It is gathered once a day by a script that reads public feeds and open data (RSS from the outlets named on each story, Wikipedia, Wikidata, the World Bank, TheSportsDB, Nager.Date and Frankfurter) and published as one shared file. Headlines belong to their publishers and link back to them; Frogity does not write or edit them.</p>

        <div className="section-label">the AI, honestly</div>
        <p><b>Froggy</b> is optional and off until you turn it on. When you ask a question, the question and a few short excerpts of the page you are reading are sent over the internet to <b>Pollinations</b>, a free public AI service that runs an open-weight language model. Frogity does not run its own AI server, has no account for you and never sends your whole library.</p>
        <p>Language models can be wrong. They can state false things confidently, invent quotes, dates, numbers or sources, and misread a passage. <b>Never rely on Froggy for medical, legal, financial or safety decisions, or for facts you need to be right.</b> Check anything important in the document itself or a trustworthy source. Answers are labelled as AI-written; do not share them as if a person had verified them. The service may be slow, busy or unavailable — Frogity will say so rather than wait forever.</p>
        <p>Do not put passwords, health details or other secrets in a question: it leaves the phone. Because the service is run by a third party, its own terms and privacy practices apply to what you send.</p>

        <div className="section-label">ethics &amp; limits</div>
        <p>Frogity does not use your documents to train anything, shows no ads, sells nothing and has no hidden data collection. The games never ask for money and reward at most a free streak “freeze”. Reading aloud uses synthetic voices that are clearly machine-made. Translated screens are a convenience; the text of your books and the news is never altered. If something looks wrong or unfair, tell us from “Contact” below.</p>
        <p>Frogity is a tool, not a news agency or an advisor. Sports results, country figures and exchange rates come from third-party sources and may be late or inaccurate.</p>

        <div className="section-label">fair use</div>
        <p>Everything in Frogity is free. The shared free AI service is rate-limited, so Froggy is capped at 30 questions a day on this phone (it resets at midnight). Everything else — reading, listening, OCR, lookups, books, voices — has no limit set by Frogity.</p>

        <div className="section-label">sources</div>
        <p>
          Definitions, word origins and article summaries come from <b>Wiktionary</b> and <b>Wikipedia</b>, licensed{' '}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" onClick={(e) => (e.preventDefault(), openExternal('https://creativecommons.org/licenses/by-sa/4.0/'))}>
            CC BY-SA 4.0
          </a>
          . Pictures belong to their authors (see the linked article). The reading globe uses Natural Earth data (public domain). Free books come from Project Gutenberg, the Internet Archive and arXiv; each work’s licence is its source’s own.
        </p>
        <p>
          The two samples on your first shelf: <i>Ulysses</i> by James Joyce (1922, public domain, from Project Gutenberg) and <i>The impact of life-saving interventions on fertility</i> by David Roodman (CC BY-NC-SA 4.0, arXiv:2007.11388, for non-commercial sharing with credit). You can delete them like any other file.
        </p>

        <div className="section-label">open source</div>
        {LIBS.map(([n, l]) => (
          <div className="row" key={n} style={{ minHeight: 40 }}>
            <span className="grow" style={{ fontSize: 14 }}>
              {n}
            </span>
            <span className="mono muted" style={{ fontSize: 11 }}>
              {l}
            </span>
          </div>
        ))}
        <div className="section-label">fonts</div>
        {FONTS.map(([n, l]) => (
          <div className="row" key={n} style={{ minHeight: 40, alignItems: 'flex-start', padding: '8px 0' }}>
            <span className="grow" style={{ fontSize: 13.5 }}>
              {n}
            </span>
            <span className="mono muted" style={{ fontSize: 10.5, maxWidth: 120, textAlign: 'right' }}>
              {l}
            </span>
          </div>
        ))}
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          Full licence texts are available from each project. All trademarks belong to their owners.
        </p>
      </div>
    </Sheet>
  );
}
