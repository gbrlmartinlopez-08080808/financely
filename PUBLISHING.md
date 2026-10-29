# Publishing Quire on Google Play

This is the checklist, in the order you should do it. Items marked **BLOCKER** will get the app rejected or cause trouble later if skipped. Policies change, so confirm anything marked *(verify)* in Play Console → *Policy and programs* before submitting.

---

## 0. Decide these first (they are hard to change later)

1. **BLOCKER – the name.** "Quire" is already the name of a well-known project-management product (quire.io) and probably registered as a trademark in software classes. Google can remove an app after a trademark complaint. Pick a name that is unique, then search: Google Play, USPTO TESS, EUIPO eSearch, WIPO Global Brand Database, plus the web. Do not put another company's brand (Adobe, Google, "PDF") in the name.
2. **BLOCKER – the application ID.** Currently `app.quire.reader` (in `android/app/build.gradle` → `applicationId`, `namespace`, `capacitor.config.ts` → `appId`, `AndroidManifest`, Java package folders). **It can never change after the first upload.** Use a domain you control or a unique string, e.g. `com.yourname.pages`.
   Changing it also means the phone currently running the test build treats the new app as a different app (uninstall the old one).
3. **Contact details.** A support email and a public privacy-policy URL. Put them in `src/lib/config.ts` (`SUPPORT_EMAIL`, `PRIVACY_URL`) – the app links to them from *Settings → About* and from the "Report this answer" button.

## 1. Accounts and identity

- **Google Play Developer account**: one-time US$25 fee, identity verification (government ID; phone + email verification).
- **Personal vs organisation.** Personal accounts created after Nov 2023 must run a **closed test with at least 12 testers opted in for 14 continuous days** before they can apply for production access *(verify the current numbers)*. Organisation accounts need a D-U-N-S number and skip that test.
- **EU Digital Services Act**: you must declare in Play Console whether you are a *trader*. A free hobby app with no income is typically non-trader, but Google asks – answer honestly. Traders' name/address/phone become public on the listing.
- Free app = no payments profile needed. If you ever add paid features, you need one and sales-tax setup.

## 2. Build the right file (AAB, signed with *your* key)

Play requires an **Android App Bundle (.aab)**, not an APK, for new apps.

1. Generate your own upload key on your own computer (do **not** reuse the test key from this repo's build):
   ```bash
   keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
   ```
   Back up `upload.jks` and its passwords in two safe places. Enrol in **Play App Signing** (default); Google keeps the real app-signing key, you keep the upload key and can reset it if lost.
2. Local build:
   ```bash
   npm ci && npm run build && npx cap sync android
   # create android/keystore.properties (git-ignored):
   #   storeFile=../upload.jks  storePassword=…  keyAlias=upload  keyPassword=…
   cd android && ./gradlew bundleRelease
   # → android/app/build/outputs/bundle/release/app-release.aab
   ```
3. Or let GitHub build it: add repository secrets `ANDROID_KEYSTORE_B64` (`base64 -w0 upload.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`; the *Android* workflow then uploads a signed `.aab` + `.apk` on every push.
4. Raise `versionCode` in `android/app/build.gradle` for every upload (must always increase).
5. **Target API:** the project targets API 36, which satisfies Play's current requirement *(verify the yearly deadline)*.
6. **minSdk is 24 (Android 7).** The reader uses modern web features (`content-visibility`, `Intl.Segmenter`, ES2022). Old phones with an un-updated *Android System WebView* may not render it. Either raise `minSdkVersion` to 26 in `android/variables.gradle`, or accept the risk. Test on at least one older/cheaper device.

## 3. Store listing (draft text is in `store/listing.md`)

| Item | Requirement |
|---|---|
| App name | ≤ 30 characters |
| Short description | ≤ 80 characters |
| Full description | ≤ 4000 characters |
| Icon | 512×512 PNG (`public/icon-512.png` is a starting point) |
| Feature graphic | 1024×500 (`store/feature-graphic.png` is a draft) |
| Phone screenshots | at least 2, up to 8 (`store/screenshots/`) |
| Category | *Books & Reference* |
| Contact email, privacy-policy URL | required |

Do not claim things the app doesn't do, don't mention other apps/brands in the description, and don't use words like "#1", "best" or "free of ads" in the title.

## 4. Policy forms in Play Console

- **Privacy policy** – required, public URL, and it must also be reachable inside the app (done: Settings → About). Start from `PRIVACY.md`; host it on GitHub Pages or any site.
- **Data safety form** – conservative answers for this app *(verify wording in the form)*:
  - *Does the app collect or share user data?* **Yes, optionally**: (a) words you look up are sent to Wikipedia/Wiktionary/dictionaryapi.dev; (b) web links you save are fetched; (c) if you turn on *Ask*, your question and short excerpts of the open document go to Pollinations. Declare **User content / App activity (search terms)** as *shared with third parties*, **optional**, **encrypted in transit**, not used for advertising.
  - Library, reading history, notes: **stored on device only** – not collected.
  - Data deletion: nothing is stored on your servers; uninstalling removes local data.
- **Generative AI / AI-generated content policy** – the *Ask* feature produces AI output. Play requires a way for users to **report offensive AI content inside the app** (done: *Report this answer* → opens an email to `SUPPORT_EMAIL`; make sure that mailbox exists and is monitored) and that outputs follow Play's content rules. Mention the AI feature in your listing and content-rating answers.
- **Content rating (IARC questionnaire)** – answer honestly: no violence/sex etc. by the app itself, but users can open web pages and chat with AI, which can raise the rating. Expect "Everyone" or "Teen".
- **Target audience** – choose **18+ or 13+**, not "children". Selecting children triggers the Families policy (no third-party network calls etc.).
- **Ads** – "No ads". **Government app / news / health / financial** – no.
- **App access** – no login required.
- **Permissions** – the app declares only `INTERNET`, `VIBRATE`, and `WRITE_EXTERNAL_STORAGE` (≤ Android 9). It deliberately does **not** request "All files access" (Google restricts it heavily); documents are opened through Android's system file picker, which is permission-free and policy-friendly.
- **Intent filters** – the app registers *Open with* for many file types (including `*/*`). That is allowed, but reviewers may ask why; the answer is "it's a universal document reader".
- **Export compliance** – the app only uses standard HTTPS encryption (exempt category). Tick the US export-law declaration accordingly.

## 5. Legal and licensing

1. **Third-party licences** (all permissive; keep the notices – *Settings → About* already lists them): PDF.js (Apache-2.0), Tesseract/tesseract.js (Apache-2.0), Capacitor, React, KaTeX, marked, JSZip, jsPDF (MIT), mammoth (BSD-2), SheetJS CE (Apache-2.0). Fonts are all **SIL OFL 1.1** (redistribution is fine; do not sell the fonts themselves). Natural Earth map data is public domain.
2. **Wikipedia / Wiktionary text is CC BY-SA 4.0.** You must credit the source and licence wherever you show it (done on the lookup card + About). Pictures from Wikipedia carry their *own* licences (often CC BY-SA or public domain); the card links to the article where authorship is shown. If you change the app to store or republish that text/images elsewhere, review the licences again.
3. **Free third-party services have no guarantees.** `api.dictionaryapi.dev`, Wikimedia's APIs and Pollinations' text API are free and can rate-limit, change or disappear. Wikimedia asks apps to send an identifying `User-Agent`/`Api-User-Agent` with contact info – put your email in `src/lib/lookup.ts` (`HDRS`) before launch. Read each service's current terms. If the app becomes popular, put your own small proxy in front of them (and of the AI) so you can switch providers without an update.
4. **AI service terms & privacy.** Pollinations is a third party; its terms govern the data you send. The app asks for consent before first use and says what is sent. Keep that wording accurate if you change providers.
5. **Privacy law (GDPR/UK-GDPR/CCPA).** With no accounts and no servers you collect almost nothing, but IP addresses reach the third parties above. Your privacy policy must say so, name them, and give a contact. If you serve EU users, a short "data controller" line with your name/contact is expected.
6. **User content & copyright.** Quire reads files the user already owns. Do not add features that strip DRM or download paywalled content. The *Convert* and *Save link* features should be described as personal-use tools.
7. **Children.** Don't market to under-13s (COPPA) – the 13+/18+ target audience above handles this.
8. **Trademarks in assets.** The icon and artwork here are original. Don't add screenshots showing other brands' logos or copyrighted book covers/pages you don't have rights to – use public-domain material (the screenshots in `store/` use only generated/public-domain content).
9. **Open-source obligations if you modify libraries** – none are copyleft here, so no source-disclosure duty, but keep notices.
10. If you ever charge money or collect revenue: register as a business/sole trader as your country requires, handle VAT/sales tax, and update the DSA trader declaration.

## 6. Testing before you ship

- Install the AAB through **Internal testing** first (instant, up to 100 testers), then **Closed testing**, then **Production**.
- Check the **Pre-launch report** in Play Console (automatic device testing – crashes, accessibility).
- Test on: a low-RAM phone, Android 8–9 with an old WebView, tablet/landscape, dark mode, TalkBack, offline mode, a 500-page PDF, a 100 MB file, and a folder with 1000+ documents.
- Things I could not verify from the build server and you should: opening files and folders through Android's picker on your phone, saving web links with real sites, the suppressed system text-selection popup on MIUI/HyperOS, and the 8 % smaller interface on other screen sizes.

## 7. After launch

- Keep the **upload key** backed up. Losing it means asking Google to reset it (possible, but slow).
- Never commit the keystore or its passwords (they are git-ignored here).
- Keep your privacy policy and Data-safety form in sync whenever you add a network feature.
- Respond to reviews and to AI-answer reports; Google can pull apps that ignore AI-content reports.
