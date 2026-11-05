/* Настоящий визит на боевой сайт из браузера.
 *
 * Проверяет не разметку, а поведение: грузится ли счётчик Метрики,
 * уходит ли обращение к mc.yandex.ru и что отвечает сервер Яндекса.
 * Запускается на раннере GitHub — из среды разработки домен закрыт.
 *
 *   node tools/live-visit.mjs https://example.ru/
 */
import { existsSync } from 'node:fs';

const url = process.argv[2] || 'https://xn--80aa2abbmnbmggrx.xn--p1ai/';
const chrome = [
  process.env.PW_CHROME,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!chrome) { console.log('браузера на машине нет — проверка невозможна'); process.exit(0); }
console.log('браузер:', chrome);

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const hits = [];
page.on('request', (r) => { if (r.url().includes('yandex')) hits.push(['запрос ', r.method(), r.url().slice(0, 110)]); });
page.on('response', (r) => { if (r.url().includes('yandex')) hits.push(['ответ  ', String(r.status()), r.url().slice(0, 110)]); });
page.on('requestfailed', (r) => { if (r.url().includes('yandex')) hits.push(['не дошёл', r.failure()?.errorText || '', r.url().slice(0, 110)]); });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

const resp = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
console.log('страница:', resp?.status(), resp?.url());
await page.waitForTimeout(12000);

const inside = await page.evaluate(() => ({
  ym: typeof window.ym,
  counters: Object.keys(window).filter((k) => /^yaCounter/.test(k)),
  metrika: !!(window.Ya && window.Ya._metrika),
  body: document.body.dataset.metrika || null,
  blocks: [...document.querySelectorAll('script')].filter((s) => s.textContent.includes('113852042')).length,
}));

console.log('\nобращения к Яндексу:');
console.log(hits.length ? hits.map((h) => '  ' + h.join(' ')).join('\n') : '  ни одного');
console.log('\nвнутри страницы:', JSON.stringify(inside));
if (errors.length) console.log('\nошибки в браузере:\n' + errors.map((e) => '  ' + e).join('\n'));

await browser.close();
