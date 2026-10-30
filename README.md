# Frogity

A calm, ad-free, paywall-free reader for Android (and the web) that opens almost anything: PDF, EPUB, DOCX, ODT, RTF, Markdown, HTML, TXT, PPTX, XLSX/CSV, images, audio, video and source code.

**Install:** download [`releases/Frogity-3.3.apk`](releases/Frogity-3.3.apk) on your phone and open it. Allow “Install unknown apps” for your browser or file manager when asked (on Xiaomi/HyperOS you may also have to confirm a security prompt).

## What it does

- **Liquid mode for PDFs.** Reflows fixed pages into one phone-sized column. It handles two-column papers, running headers, footnotes and hyphenation. Display equations, inline fractions, tables and figures are lifted from the page as crisp masks sized in `em`, so maths keeps its exact structure, scales with your font size and follows dark themes.
- **Listen.** Sentence-by-sentence read-aloud with highlight, speed ruler, voice picker, sleep timer and a focus mode. Uses Android's native TTS engine.
- **Look up.** Select a word and tap *Define* to get the definition, its origin (Greek and Latin roots shown as chips) and a Wikipedia card.
- **Ask.** Free AI Q&A about the open document (opt-in; sends only your question and a few short excerpts to an open service).
- **Save anything.** Files, web links (saved as clean readable pages with images), pasted text and scans; sort and filter the shelf.
- **Convert.** To PDF, TXT, Markdown, standalone HTML, PNG pages, CSV or JPEG. Photos get on-device OCR to text.
- **Scan.** Photograph pages to get cleaned images, on-device OCR (Tesseract, bundled) and a searchable PDF.
- **Reading kit.** Page / liquid views, pinch zoom, page thumbnails, search, contents, bookmarks, highlights, four reading themes, typography controls.
- **Reading globe.** A spinning ASCII globe lights one place for every day you read; tap the plant on the library for the bubble.
- **Fonts.** Twelve bundled typefaces; star four favourites for quick switching.
- **Open with Frogity.** Registered for “Open with…” and the Share sheet for every file type.

Everything is stored on the device (IndexedDB); files can be opened in place without copying. Only word lookups, saved links and the optional Ask feature use the network.

**Publishing:** see [`PUBLISHING.md`](PUBLISHING.md), [`PRIVACY.md`](PRIVACY.md) and [`store/`](store/) (listing text, screenshots, feature graphic).

## Develop

```bash
npm install
npm run dev               # web app at http://localhost:5173
npm run build             # production web build in dist/
npx cap sync android && cd android && ./gradlew assembleRelease   # APK
```

Release signing reads `android/keystore.properties` (git-ignored). Without it, release builds fall back to the debug key. Every push also builds an APK in GitHub Actions (artifact `Frogity-apk`).

Stack: Vite + React + TypeScript, Capacitor 8, pdf.js, mammoth, JSZip, marked + KaTeX, SheetJS, jsPDF, tesseract.js.
