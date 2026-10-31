# Frogity for the computer — plan

A desktop web workspace for the documents on your phone. No account, no password: you enter the four-digit code your
phone shows and every document is there. The phone app stays the reader you carry; the computer is where you look
closer, change things and do the heavy work.

## 1. What already exists (the Android app)

- Everything lives on the phone in IndexedDB (`quire`): `docs` (DocMeta), `files` (the original file), `blobs`
  (covers, scan pages), `marks` (`<doc>:h:<id>` highlights, `<doc>:b:<id>` bookmarks), `kv`, `cache` (Liquid views,
  OCR pages), `days` (reading time).
- Kinds: pdf, epub, docx, markdown, html, text, code, sheet, slides, odt, rtf, image, audio, video, scan.
- Some docs are *linked* (`uri`): the file stays in a phone folder and is read on demand.
- Privacy promise: nothing is uploaded. The web must not break it — hence end-to-end encryption.

## 2. Sync — "the perfect system"

**End-to-end encrypted.** The phone makes a library key (AES-256-GCM). Every document, cover and note is encrypted
on the device before it leaves; the server (Supabase, tables prefixed `frogity_`) only ever stores ciphertext and
can't read a single word. The web decrypts in the browser.

**Pairing with four digits.**
1. Phone → Settings → *Use Frogity on a computer* → shows a code like `4 8 1 7` (valid 3 minutes, one use).
2. The web page makes a key pair (ECDH P-256) and sends the code with its public key.
3. The phone, still showing the code, sees the computer join, wraps the library key for that computer's public key
   and hands it over — no tap needed. Both screens show the same two-emoji fingerprint.
4. The computer gets its own device token. Done: the library streams in.

Why four digits are safe: the code only routes a join; it is useless after 3 minutes or one use, joins are rate
limited per address, and the library key never travels unencrypted — it is wrapped for the joining browser's key.

**Almost instant.** Every write bumps a revision number and sends a "changed" ping on a private realtime channel;
the other side pulls just what changed. Big files go up in 20 MB encrypted parts (resumable, under storage limits).
Metadata merges field by field (last writer wins); highlights and bookmarks merge by id with tombstones.

**Both ways.** Rename, progress, bookmarks, highlights, notes, edited files, new files imported on the computer,
deletions — all flow back to the phone. A file edited on the computer becomes a new version on the phone (for a linked
file the phone keeps the edited copy in Frogity; the original in the folder is untouched).

**Control.** Both sides list connected devices; disconnecting a computer from the phone removes its access and the
computer wipes its copy on the next contact. "Sign out" on the computer wipes its local copy too.

## 3. Brainstorm — what the web needs to win

Principle: very little on screen, everything one keystroke away (⌘K). Power lives behind the command palette,
right-click menus and drag and drop.

### Library
- Grid of covers / dense list, sort (recent, title, kind, size, progress), filter by kind, finished/unread.
- Search titles **and full text** of every document (index built in the browser, decrypted, never sent anywhere).
- Drag files anywhere to import (PDF, EPUB, DOCX, MD, TXT, HTML, images, CSV…) → encrypted → on the phone in seconds.
- Multi-select: delete, merge PDFs, export, download originals.
- Reading progress and time synced from the phone.

### PDF workspace (the heart)
- Continuous pages, crisp at any zoom, fit width/page, keyboard navigation.
- **Pages at a glance**: a zoomable grid of every page (slider from 2 to 12 per row); drag to reorder, select many,
  rotate, delete, duplicate, extract to a new PDF, insert blank pages, insert pages from another PDF (merge).
- **Insert text** anywhere (font, size, colour), **highlight**, underline/strike, **freehand pen**, rectangles,
  arrows, **sticky notes**, **signature** (draw once, place anywhere), white-out (redact by covering), images/stamps.
- Fill PDF forms (AcroForm fields) — values written into the file.
- Find in document with all hits listed; outline/contents panel.
- Save writes a real PDF (pdf-lib) → new version synced to the phone. Undo/redo for everything.
- Export: flattened PDF, text, Markdown, page images (PNG), selected pages.

### Text documents
- Markdown / plain text / DOCX (converted) open in a clean editor with a minimal floating toolbar: headings, bold,
  italic, lists, quotes, links, code; word count; autosave and sync.
- Export as Markdown, HTML, DOCX-compatible HTML, PDF (print).
- New document (⌘N) — appears on the phone like any other.

### Reading on a big screen
- Liquid view for PDFs (text reflowed in a comfortable column), themes (paper, white, night), font size.
- EPUB reading with chapter navigation. Images with zoom. Audio/video players.
- **Split view**: two documents side by side (read a paper, write notes).

### Knowledge
- Every highlight and note across the library in one place; filter by document; export all as Markdown.
- Bookmarks jump straight to the page.
- Ask the document (the same free, opt-in assistant as on the phone: only the question and a few excerpts are sent).

### Comfort
- Dark mode following the system, keyboard shortcuts sheet (?), offline after first load (decrypted cache in the
  browser), sync status always visible but quiet, a toast for everything that happened in the background.
- Desktop only: on a phone-sized screen the page says "Frogity for the computer is made for big screens".

## 4. Pieces

| Piece | Where |
|---|---|
| Web app (Vite + React + TS, separate package) | `web/` |
| Sync server: tables `frogity_libraries`, `frogity_devices`, `frogity_items`, `frogity_pairings`, `frogity_hits`; private bucket `frogity`; edge function `frogity-sync` | Supabase project (existing, everything prefixed) |
| Phone additions: pairing sheet, sync engine | `src/lib/sync/*`, a row in Settings |
| Hosting | Vercel project `frogity-web` |
