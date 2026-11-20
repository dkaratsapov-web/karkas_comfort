// Кейс: markdown → одна HTML-страница с картинками по относительным путям.
// node docs/keys/scripts/md2html.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const DIR = fileURLToPath(new URL('..', import.meta.url));
const md = readFileSync(`${DIR}keys-karkas-komfort.md`, 'utf8').split('\n');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
let html = '', list = false;
const close = () => { if (list) { html += '</ul>\n'; list = false; } };
for (const line of md) {
  let m;
  if ((m = line.match(/^# (.+)/))) { close(); html += `<h1>${inline(m[1])}</h1>\n`; }
  else if ((m = line.match(/^## (.+)/))) { close(); html += `<h2>${inline(m[1])}</h2>\n`; }
  else if ((m = line.match(/^!\[(.*?)\]\((.+?)\)/))) { close(); html += `<figure><a href="${m[2]}"><img src="${m[2]}" alt="${esc(m[1])}" loading="lazy"></a><figcaption>${esc(m[1])}</figcaption></figure>\n`; }
  else if ((m = line.match(/^- (.+)/))) { if (!list) { html += '<ul>\n'; list = true; } html += `<li>${inline(m[1])}</li>\n`; }
  else if (!line.trim()) close();
  else { close(); html += `<p>${inline(line)}</p>\n`; }
}
close();
writeFileSync(`${DIR}keys-karkas-komfort.html`, `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Кейс «Каркас Комфорт»</title>
<style>
:root { --bg: #F3F1EC; --ink: #17150F; --ink2: #4A463E; --line: #DDD8CE; --accent: #B8862F; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 920px; margin: 0 auto; padding: 48px 20px 96px; }
h1 { font-size: clamp(28px, 4.4vw, 44px); line-height: 1.12; letter-spacing: -.02em; margin: 0 0 24px; }
h2 { font-size: clamp(22px, 2.8vw, 30px); line-height: 1.2; margin: 56px 0 14px; padding-top: 22px; border-top: 1px solid var(--line); }
p, li { color: var(--ink2); }
p strong, li strong { color: var(--ink); }
ul { padding-left: 1.2em; }
li { margin: 6px 0; }
li::marker { color: var(--accent); }
figure { margin: 26px 0; }
figure img { display: block; width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--line); background: #fff; }
figcaption { font-size: 14px; color: var(--ink2); margin-top: 8px; }
a { color: inherit; }
</style>
</head>
<body>
<main>
${html}</main>
</body>
</html>
`);
console.log('ok');
