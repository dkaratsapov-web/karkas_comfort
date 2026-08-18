/* Сборка сайта: src/pages + src/partials -> dist/
   В dist/ лежит всё, что нужно залить на хостинг, и ничего лишнего.
   Запуск: npm run build */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SITE = 'https://karkascomfort.ru';
const OUT = 'dist';
const LEAD_ENDPOINT = '/api/lead.php';       // обработчик заявок на хостинге

const read = (p) => readFileSync(p, 'utf8');
const partial = (name) => read(`src/partials/${name}.html`);
const hash = (p) => createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 8);

const head = partial('head');
const header = partial('header');
const footer = partial('footer');
const cta = partial('cta');

const projects = JSON.parse(read('src/data/projects.json'));
const cases = JSON.parse(read('src/data/cases.json'));
writeFileSync('assets/js/projects-data.js',
  `/* Данные каталога. Источник: src/data/projects.json — правьте там и запускайте сборку. */\nwindow.KK_PROJECTS = ${JSON.stringify(projects, null, 2)};\n`);

/* ---------- чистая папка выгрузки ---------- */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync('assets', `${OUT}/assets`, { recursive: true });
for (const f of ['robots.txt']) if (existsSync(f)) cpSync(f, `${OUT}/${f}`);
if (existsSync('server/.htaccess')) cpSync('server/.htaccess', `${OUT}/.htaccess`);
if (existsSync('server/api')) cpSync('server/api', `${OUT}/api`, { recursive: true });
if (existsSync('server/site.webmanifest')) cpSync('server/site.webmanifest', `${OUT}/site.webmanifest`);
for (const f of ['favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'])
  if (existsSync(`assets/img/${f}`)) cpSync(`assets/img/${f}`, `${OUT}/${f}`);

/* ---------- версии статики, чтобы браузер не показывал старый кеш ---------- */
const V = {
  css: hash('assets/css/style.css'),
  main: hash('assets/js/main.js'),
  data: hash('assets/js/projects-data.js')
};
const version = (html) => html
  .replace(/assets\/css\/style\.css(?!\?)/g, `assets/css/style.css?v=${V.css}`)
  .replace(/assets\/js\/main\.js(?!\?)/g, `assets/js/main.js?v=${V.main}`)
  .replace(/assets\/js\/projects-data\.js(?!\?)/g, `assets/js/projects-data.js?v=${V.data}`);

/* ---------- шаблоны блоков ---------- */
const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
const floorsLabel = (f) => (f === 1 ? '1 этаж' : f === 1.5 ? '1,5 этажа' : '2 этажа');

const projectCard = (p) => `      <article class="project">
        <div class="project__media">
          <img src="assets/img/projects/${p.slug}.svg" alt="Каркасный дом ${p.code}, ${p.size} м, ${p.area} м²" loading="lazy" width="800" height="460">
          <span class="project__code">${p.code}</span>
        </div>
        <div class="project__body">
          <h3 class="project__title"><a href="proekt.html?id=${p.slug}">Каркасный дом ${p.size}</a></h3>
          <ul class="specs"><li>${p.area} м²</li><li>${floorsLabel(p.floors)}</li><li>${p.bedrooms} спальни</li>${p.terrace ? '<li>терраса</li>' : ''}</ul>
          <div class="project__foot">
            <span class="price">от ${money(p.area * 32000)}<small>под ключ, ориентировочно</small></span>
            <span class="project__more">Подробнее →</span>
          </div>
        </div>
      </article>`;

const caseTile = (c) => `        <a class="tile ${c.class}" href="proekt.html?id=${c.slug}">
          <img src="assets/img/projects/${c.slug}.svg" alt="${c.title}, ${c.area} м²" loading="lazy" width="960" height="600">
          <div class="tile__body">
            <h3>${c.title}</h3>
            <p class="tile__meta"><span>${c.size} м · ${c.area} м²</span><span>${c.term}</span><span>${c.tier}</span></p>
          </div>
        </a>`;

/* ---------- страницы ---------- */
const pages = readdirSync('src/pages').filter((f) => f.endsWith('.html'));
const built = [];

for (const file of pages) {
  const raw = read(`src/pages/${file}`);
  const m = raw.match(/^<!--meta\s+([\s\S]*?)-->\s*/);
  if (!m) throw new Error(`Нет блока <!--meta --> в ${file}`);
  const meta = JSON.parse(m[1]);
  let content = raw.slice(m[0].length);
  content = content.replace(/\{\{cta\}\}/g, () => cta);
  content = content.replace(/\{\{cases\}\}/g, () => cases.map(caseTile).join('\n'));
  content = content.replace(/\{\{projects:(\d+)\}\}/g, (_, n) =>
    projects.slice(0, Number(n)).map(projectCard).join('\n'));

  const html = `<!doctype html>
<html lang="ru">
${head
    .replace(/\{\{title\}\}/g, meta.title)
    .replace(/\{\{description\}\}/g, meta.description)
    .replace(/\{\{canonical\}\}/g, `${SITE}/${file === 'index.html' ? '' : file}`)
    .replace(/\{\{scripts\}\}/g, (meta.scripts || []).map((s) => `\n  <script src="${s}" defer></script>`).join(''))}
<body data-lead-endpoint="${LEAD_ENDPOINT}">
  <a class="skip-link" href="#main">Перейти к содержимому</a>
${header}
  <main id="main">
${content.trimEnd()}
  </main>
${footer}
  <a class="call-fab" href="tel:+79201716969" aria-label="Позвонить">☎ Позвонить</a>
  <script src="assets/js/main.js" defer></script>
</body>
</html>
`;
  writeFileSync(`${OUT}/${file}`, version(html));
  built.push({ file, priority: meta.priority ?? 0.6 });
}

/* ---------- sitemap ---------- */
const today = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
writeFileSync(`${OUT}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${built.filter((b) => b.file !== '404.html').map((b) => `  <url>
    <loc>${SITE}/${b.file === 'index.html' ? '' : b.file}</loc>
    <lastmod>${today}</lastmod>
    <priority>${b.priority}</priority>
  </url>`).join('\n')}
</urlset>
`);

console.log(`dist/: страниц ${built.length}, версии статики css=${V.css} js=${V.main}`);
