/* Проверка собранного сайта по поисковым параметрам.
 *
 * Разметку проверяют check.mjs и visual.mjs; здесь — то, за что сайт
 * ранжируют: заголовки и описания, единственный H1, канонические адреса,
 * микроразметка, картинки с подписями, внутренние ссылки, карта сайта
 * и объём текста. Проверка читает только dist/, браузер не нужен.
 *
 * Запуск: npm run seo   (входит в npm run verify)
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.OUT_DIR || 'dist';
const site = JSON.parse(readFileSync('src/data/site.json', 'utf8'));
const host = (site.domain || 'каркаскомфорт.рф').replace(/^https?:\/\//, '').replace(/\/$/, '');
const SITE = new URL(`https://${host}`).origin;

/* ---------- границы, за которыми поисковик обрезает или ругается ---------- */
const TITLE = { min: 45, max: 60 };
const DESC  = { min: 150, max: 160 };
const WORDS_MIN = 120;          /* меньше — страница считается пустой */

const problems = [];
const notes = [];
const fail = (page, text) => problems.push(`${page}: ${text}`);

/* ---------- собираем страницы ---------- */
function pages(dir = OUT, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pages(full, `${prefix}${name}/`);
    if (!name.endsWith('.html')) return [];
    const url = name === 'index.html' ? `/${prefix}` : `/${prefix}${name}`;
    return [{ url, file: full, html: readFileSync(full, 'utf8') }];
  });
}

const all = pages().filter((p) => !p.url.startsWith('/proekt.html'));
const indexable = all.filter((p) => p.url !== '/404.html' && !/name="robots"[^>]*noindex/.test(p.html));

const text = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const attr = (html, re) => (html.match(re) || [])[1] || '';
const seenTitles = new Map();
const seenDescs  = new Map();
const seenH1     = new Map();

for (const page of indexable) {
  const { url, html } = page;

  /* заголовок окна */
  const title = attr(html, /<title>([^<]*)<\/title>/);
  if (!title) fail(url, 'нет <title>');
  else {
    if (title.length < TITLE.min) fail(url, `заголовок короткий (${title.length}): «${title}»`);
    if (title.length > TITLE.max) fail(url, `заголовок длиннее ${TITLE.max} (${title.length}): «${title.slice(0, 60)}…»`);
    const twin = seenTitles.get(title);
    if (twin) fail(url, `заголовок повторяет ${twin}`);
    else seenTitles.set(title, url);
  }

  /* описание */
  const desc = attr(html, /<meta name="description" content="([^"]*)"/);
  if (!desc) fail(url, 'нет описания');
  else {
    if (desc.length < DESC.min) fail(url, `описание короткое (${desc.length})`);
    if (desc.length > DESC.max) fail(url, `описание длиннее ${DESC.max} (${desc.length})`);
    const twin = seenDescs.get(desc);
    if (twin) fail(url, `описание повторяет ${twin}`);
    else seenDescs.set(desc, url);
  }

  /* единственный H1 */
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => text(m[1]));
  if (h1s.length === 0) fail(url, 'нет H1');
  if (h1s.length > 1) fail(url, `H1 несколько (${h1s.length})`);
  if (h1s[0]) {
    const twin = seenH1.get(h1s[0]);
    if (twin) fail(url, `H1 повторяет ${twin}`);
    else seenH1.set(h1s[0], url);
  }

  /* порядок заголовков: h3 без предшествующего h2 — разорванная структура */
  const levels = [...html.matchAll(/<h([1-6])[^>]*>/g)].map((m) => Number(m[1]));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      fail(url, `заголовки прыгают с H${levels[i - 1]} на H${levels[i]}`);
      break;
    }
  }

  /* канонический адрес */
  const canonical = attr(html, /<link rel="canonical" href="([^"]*)"/);
  const expect = `${SITE}${url === '/' ? '/' : url}`;
  if (!canonical) fail(url, 'нет canonical');
  else if (canonical !== expect) fail(url, `canonical ведёт не на себя: ${canonical}`);

  /* og:image должен существовать */
  const og = attr(html, /<meta property="og:image" content="([^"]*)"/);
  if (!og) fail(url, 'нет og:image');
  else if (og.startsWith(SITE)) {
    const local = join(OUT, og.slice(SITE.length));
    if (!existsSync(local)) fail(url, `og:image не найден: ${og}`);
  }

  /* картинки: подпись и размеры */
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const noAlt = imgs.filter((i) => !/\balt=/.test(i));
  if (noAlt.length) fail(url, `у ${noAlt.length} картинок нет alt`);
  const noSize = imgs.filter((i) => !/\bwidth=/.test(i) || !/\bheight=/.test(i));
  if (noSize.length) fail(url, `у ${noSize.length} картинок нет width/height`);

  /* объём текста */
  const words = text(html.replace(/<(header|footer|nav)[\s\S]*?<\/\1>/g, ' ')).split(' ').filter(Boolean).length;
  if (words < WORDS_MIN) fail(url, `мало текста: ${words} слов`);

  /* микроразметка разбирается */
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch { fail(url, 'микроразметка не разбирается как JSON'); }
  }
  const types = [...html.matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)].map((m) => m[1]);
  if (url !== '/' && !types.includes('BreadcrumbList')) fail(url, 'нет хлебных крошек в разметке');
  if (/^\/stati\/[^/]+\/$/.test(url) && !types.includes('Article')) fail(url, 'нет разметки Article');
  if (/^\/proekty\/[^/]+\/$/.test(url) && !types.includes('Product')) fail(url, 'нет разметки Product');

  /* язык и кодировка */
  if (!/<html lang="ru"/.test(html)) fail(url, 'не указан язык страницы');
  if (!/<meta charset="utf-8">/i.test(html)) fail(url, 'не указана кодировка');
  if (!/name="viewport"/.test(html)) fail(url, 'нет viewport');
}

/* ---------- внутренние ссылки: сироты и битые адреса ---------- */
const known = new Set(all.map((p) => p.url));
const linkedFrom = new Map();
for (const page of all) {
  const hrefs = [...page.html.matchAll(/<a\b[^>]*href="(\/[^"#?]*)/g)].map((m) => m[1]);
  for (const href of new Set(hrefs)) {
    const target = href.endsWith('/') || href.includes('.') ? href : `${href}/`;
    if (/\.(jpg|jpeg|png|webp|svg|mp4|xml|txt|ico|css|js|pdf|webmanifest)$/.test(target)) continue;
    if (!known.has(target)) { fail(page.url, `ссылка в никуда: ${href}`); continue; }
    if (target !== page.url) linkedFrom.set(target, (linkedFrom.get(target) || 0) + 1);
  }
}
for (const page of indexable) {
  if (page.url === '/') continue;
  if (!linkedFrom.get(page.url)) fail(page.url, 'на страницу никто не ссылается');
}

/* ---------- карта сайта ---------- */
const mapFile = join(OUT, 'sitemap.xml');
if (!existsSync(mapFile)) problems.push('нет sitemap.xml');
else {
  const xml = readFileSync(mapFile, 'utf8');
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const inMap = new Set(urls.map((u) => u.replace(SITE, '')));
  for (const page of indexable) {
    if (!inMap.has(page.url)) fail(page.url, 'страницы нет в sitemap.xml');
  }
  for (const u of inMap) {
    if (!known.has(u)) problems.push(`sitemap.xml: адрес ${u} никуда не ведёт`);
  }
  if (!/<lastmod>/.test(xml)) notes.push('в sitemap.xml нет дат изменения');
  const dup = urls.filter((u, i) => urls.indexOf(u) !== i);
  if (dup.length) problems.push(`sitemap.xml: повторы ${[...new Set(dup)].join(', ')}`);
}

/* ---------- robots.txt ---------- */
const robots = join(OUT, 'robots.txt');
if (!existsSync(robots)) problems.push('нет robots.txt');
else {
  const txt = readFileSync(robots, 'utf8');
  if (!txt.includes('Sitemap:')) problems.push('robots.txt: нет ссылки на карту сайта');
  if (/^Disallow: \/$/m.test(txt)) problems.push('robots.txt закрывает весь сайт');
}

/* ---------- итог ---------- */
const pagesChecked = indexable.length;
if (notes.length) console.log(notes.map((n) => `· ${n}`).join('\n'));
if (problems.length) {
  console.log(problems.map((p) => `✗ ${p}`).join('\n'));
  console.log(`\nПоисковых замечаний: ${problems.length} (страниц проверено: ${pagesChecked})`);
  process.exit(1);
}
console.log(`Поисковых замечаний нет: ${pagesChecked} страниц, ${seenTitles.size} заголовков, ${known.size} адресов.`);
