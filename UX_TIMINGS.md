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
| …its Liquid view complete (made in the background) | 4–5 s (46 pages) | < 10 s per 40 pages | a thin ring round the Liquid button fills, and a line under the title says “liquid · 34% · converting” |
| Tap Liquid when it is ready → Liquid text on screen | 0.5 s | < 0.8 s | |
| Tap Liquid **before** it is ready (top bar, reading sheet or ⋯ menu) → Liquid opens with what is ready | < 0.5 s | < 2.5 s | always switches; the end of the text shows how far it is (bar, pages, time left); waiting pages show a small "being read" card |
| A normal paper added while a 30-page scan is being read | Liquid complete in 17 s | < 20 s | typed pages and scanned pages use separate lanes, the open book first |
| Back to the pages | 0.4 s | < 0.8 s | |
| Import a 30-page scan → reader + progress under the title | 1.0 s | < 1.5 s | “checking pages” shows from the first moment, before any page is converted |
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
| Add a book and start reading the pages straight away | Pages work at once. The ring round the Liquid button fills and the line under the title says how far it is — no pop-ups, nothing floating over the page. Tapping the title opens the reading sheet with the details. |
| Leave the book immediately | Reading goes on (it is not tied to the screen). The book's cover in the library shows a small ring with a percentage while you scroll past it; nothing else is shown. |
| Lock the phone / switch app | A foreground service keeps it going and a notification shows progress. |
| Close the app or it is killed | Every finished page was saved; the next start carries on from the first unfinished page. |
| Tap Liquid too early | Liquid opens at once with the pages that are ready and grows as the rest arrive. The end of the text gives the percentage, what is being done ("reading scanned pages · 7 of 30") and about how long is left. When it completes, the view stays exactly where you are reading. |
| Tap Listen too early | One message above the controls: Listen opens when Liquid is ready, with the percentage. |
| Something gets stuck | Every step reports each page it finishes; a step that stays silent too long (1 min checking, 1½ min converting, 2 min reading a page) is let go so other books carry on. The book starts again once by itself; if it stops again it says so (“Liquid couldn’t be finished — it stopped making progress”) with **Try again**, and a dot on the Liquid button. Time with the screen off doesn’t count. |
| Come back later | Liquid is ready (no ring, no line); it opens in half a second. |
| Add three books at once | They are prepared one after the other (never fighting); opening any of them is still instant. |
| Open a book that was left in Liquid mode before it was complete | It opens in Liquid with what is ready and keeps growing. |
| Replay the introduction | The language and natural voice are set again; an earlier choice of voice is never overwritten. |
| Set a language the app has no natural voice for | The phone's own best voice is used; nothing is downloaded. |

## Rules these numbers come from
1. Nothing the reader wants to do waits for background work. Pages first, always.
2. Background work saves after every page and reports its progress in one place per book (its cover in the library, the ring + the line under the title in the book). The open book's work goes first in every queue, including the first look through its pages.
3. No pop-up for "it is ready": the ring and the line simply go. Liquid is never disabled and never sits at 0% without saying why; a failure is said in words, with a way to try again.
4. The main thread never stalls more than ~250 ms for reading work; timers are not used for pacing in the background.
5. A tap answers within 100 ms (a state change), and anything that cannot finish by then shows progress.
6. Messages are placed once, above whatever is at the bottom (an open sheet, or the reader's controls at their resting place), and never slide around while they are up; offers (like "This looks like a form") sit inside the controls, not on top of them.
