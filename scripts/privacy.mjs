// PRIVACY.md → docs/privacy.html (a plain page you can host on GitHub Pages for the Play Console privacy-policy URL)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { marked } from 'marked';

const md = readFileSync(new URL('../PRIVACY.md', import.meta.url), 'utf8');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Frogity — Privacy Policy</title>
<style>
body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 18px 64px;color:#111;background:#fafaf9}
h1{font-size:28px}h2{margin-top:32px;font-size:20px}table{border-collapse:collapse;width:100%;font-size:14px}
td,th{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}th{background:#f0efed}
@media(prefers-color-scheme:dark){body{background:#0d0d0d;color:#eee}td,th{border-color:#333}th{background:#1a1a1a}a{color:#8fb0ff}}
</style></head><body>
${marked.parse(md)}
</body></html>`;
mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/privacy.html', import.meta.url), html);
console.log('wrote docs/privacy.html');
