# Privacy Policy — Frogity

*Last updated: 30 October 2026. Fill in the contact line at the bottom, publish `docs/privacy.html` (generated from this file with `npm run privacy`) at a public URL such as GitHub Pages, then put that URL in `src/lib/config.ts` (`PRIVACY_URL`) and in Play Console.*

**Summary:** Frogity is a document reader. It has no accounts, no ads and no analytics. Your library stays on your phone. The app only uses the internet when you ask it to, as described below.

## What stays on your device
Your documents' copies, covers, reading position, bookmarks, highlights, notes, reading streaks (including freeze days), form details and signature you choose to save, and settings are stored locally on your phone. We (the developer) never receive them. Uninstalling the app deletes this data. Files you open "in place" via Android's file picker are not copied; the app only remembers where they are.

## What leaves your device, and only when you use these features
| Feature | What is sent | To whom |
|---|---|---|
| Look up a word | The selected word or phrase, your IP address | Wikipedia / Wiktionary (Wikimedia Foundation), dictionaryapi.dev |
| Save a web link | The address you typed or shared; your IP address; requests for the page's images | The website you named |
| Ask this document (optional, off by default) | Your question and a few short excerpts of the open document | Pollinations (open AI service) |
| Find free books (only when you open it) | Your search words; the file you pick is downloaded | Project Gutenberg (gutendex.com), Internet Archive, arXiv, Google Books, Open Library |
| Studio voice (only when you download one) | Nothing about you; the voice file and speech engine are downloaded once | Hugging Face, jsDelivr / cdnjs (CDNs) |
| Send feedback (optional, after your first streak milestone) | The rating and note you write, plus the app version and streak length, in an email you review before sending | Our support mailbox, via your email app |
| Rate on Google Play (optional) | Nothing from the app; the Play Store page opens | Google Play |
| Report an AI answer | The question and answer text you choose to email | Our support mailbox, via your email app |
| Use Frogity on a computer (optional, off until you connect a computer) | Your documents, covers, reading progress, highlights and bookmarks — **end-to-end encrypted on your phone first** (AES-256); only your own connected devices hold the key. A device name (e.g. "Chrome on Windows") and when each device was last seen. | Our sync server (Vercel) and file storage (Supabase), which only ever see encrypted bytes |

Stopping sync on the phone (Settings → Use Frogity on a computer → Stop syncing) deletes everything kept on the sync server for your library; disconnecting a computer wipes that computer's copy.

These services have their own privacy policies and may log requests (for example IP addresses). We do not control that. Do not use *Ask* with documents containing confidential or personal information.

## Forms, signatures, sharing, widget, background playback
- **Form filling** happens entirely on your phone. The details and signature you save stay on your phone and are used only to fill forms you open. Filled copies are saved to your library or shared only when you choose.
- **Book cards** (an image of a book cover in an acrylic holder) are made on your phone and only leave it through the Android share sheet when you choose to share.
- **Home-screen widget** shows your streak and today's progress. These numbers are kept in the app's private storage and are not sent anywhere.
- **Listening in the background** uses a media notification (a foreground service) so read-aloud keeps playing with the screen off. It shows the title of what you're listening to on your own lock screen and does not send anything off your phone.
- **Reminders** are notifications created on your phone; nothing is sent to a server.

## What we do not do
We do not run servers that store your data, show advertising, build advertising profiles, sell data, or use analytics or crash-reporting SDKs.

## Permissions
Internet access (for the features above), vibration (haptic feedback), notifications (the optional evening reminder and the listening player's controls), foreground service for media playback (keeps read-aloud going with the screen off) and access to files **you choose** in Android's system picker.

## Children
The app is not directed to children under 13 and the AI feature is intended for users 13 and older.

## Your rights
Because we hold no personal data about you, there is nothing for us to export or delete. For requests concerning the third-party services above, contact them directly. If you have questions: gbrlmartinlopez40@gmail.com.

## Changes
If this policy changes, the new version will be posted at this address with a new date.

**Contact / data controller:** Gabriel Martin Lopez (Frogity developer) · gbrlmartinlopez40@gmail.com
