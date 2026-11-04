// Set these before publishing. SUPPORT_EMAIL receives AI-answer reports and user feedback.
export const SUPPORT_EMAIL = 'gbrlmartinlopez40@gmail.com';
export const PRIVACY_URL = 'https://gbrlmartinlopez-08080808.github.io/financely/privacy.html';
export const APP_VERSION = '6.0';
export const PLAY_URL = 'https://play.google.com/store/apps/details?id=app.frogity.reader';

/**
 * The daily feed ("Interesting"): one small file for everyone, rebuilt a few times a day (see .github/workflows/feed.yml).
 * The first address that answers is used; a copy ships inside the app as a last resort.
 */
export const FEED_URLS = [
  'https://gbrlmartinlopez-08080808.github.io/financely/feed/daily.json',
  'https://raw.githubusercontent.com/gbrlmartinlopez-08080808/financely/main/docs/feed/daily.json',
  // the branch the feed is kept on while the app is developed there (a copy on main is used once it is merged)
  'https://raw.githubusercontent.com/gbrlmartinlopez-08080808/financely/claude/bold-meitner-fajwuj/docs/feed/daily.json',
];
