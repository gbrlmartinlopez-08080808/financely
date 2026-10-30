# Frogity — how long things take, and how long they may take

Numbers are from the build sandbox (a modest 4-core CPU, headless Chromium, phone-sized viewport), so a recent phone
should be as fast or faster. They are here so a tester knows what "normal" looks like and what is too slow.
Re-measure with the scripts described at the bottom after any change to reading, Liquid or Listen.

## What the reader sees, in order

| Moment | Measured | Budget | Notes |
|---|---|---|---|
| Finish the introduction → library on screen | 0.1 s | < 0.5 s | samples and the voice download start in the background |
| Cold start of the set-up app → shelf visible | 0.2 s | < 1 s | |
| Import a 40-page text PDF → first page on screen | 0.8 s | < 1.5 s | the reader opens at once; nothing waits for Liquid |
| …its Liquid view complete (made in the background) | 5.7 s | < 10 s per 40 pages | the drop in the top bar fills up meanwhile |
| Tap the full drop → Liquid text on screen | 0.5 s | < 0.8 s | |
| Back to the pages | 0.4 s | < 0.8 s | |
| Import a 30-page scan → reader + empty drop | 1.0 s | < 1.5 s | |
| 30 scanned pages read and Liquid complete | ≈ 55–70 s | ≈ 2–2.5 s/page on one reader, about half that on a phone with 2–3 | each page is saved the moment it is read |
| 3-page scan → complete | ≈ 10–13 s | | |
| Mixed book (typed + scanned pages) | ≈ 10 s for 5 pages | | typed pages are Liquid at once, scanned ones join as they are read |
| Open another book while a scan is being read | 0.4–1.1 s | < 1.2 s | the heavy work yields to the screen every ~9 ms |
| Longest main-thread stall while reading | 160 ms | < 250 ms | |
| Natural voice: download (≈ 93 MB with the speech engine) | 6 s here (fast link) | depends on the network | runs as background work with a notification |
| Press play with the natural voice warmed up | 1.9 s | < 2.5 s | first chunk is one short sentence; longer ones follow |
| Press play, voice not yet loaded | ≈ 5 s | < 6 s | the voice loads as soon as Listen opens |

## What a normal (imperfect) person does, and what happens

| What they do | What happens |
|---|---|
| Add a book and start reading the pages straight away | Pages work at once. The drop fills; a tap on it says how far it is, in one line, without any pop-ups. |
| Leave the book immediately | Reading goes on (it is not tied to the screen). The book's cover in the library shows a small ring with a percentage while you scroll past it; nothing else is shown. |
| Lock the phone / switch app | A foreground service keeps it going and a notification shows progress. |
| Close the app or it is killed | Every finished page was saved; the next start carries on from the first unfinished page. |
| Tap Liquid or Listen too early | A short tip explains Liquid is being prepared and how far it is; nothing breaks and nothing opens half-made. |
| Come back later | The drop is already full; Liquid opens in half a second. |
| Add three books at once | They are prepared one after the other (never fighting); opening any of them is still instant. |
| Open a book that was left in Liquid mode before it was complete | It opens on the pages, quietly. |
| Replay the introduction | The language and natural voice are set again; an earlier choice of voice is never overwritten. |
| Set a language the app has no natural voice for | The phone's own best voice is used; nothing is downloaded. |

## Rules these numbers come from
1. Nothing the reader wants to do waits for background work. Pages first, always.
2. Background work saves after every page and reports its progress in one place per book (its cover in the library, its drop in the book).
3. No pop-up for "it is ready": the drop is the notification.
4. The main thread never stalls more than ~250 ms for reading work; timers are not used for pacing in the background.
5. A tap answers within 100 ms (a state change), and anything that cannot finish by then shows progress.
