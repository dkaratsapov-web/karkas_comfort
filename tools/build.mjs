/* Сборка сайта: src/pages + src/partials -> dist/
   В dist/ лежит всё, что нужно залить на хостинг, и ничего лишнего.
   Отдельно генерируются статические страницы проектов /proekty/<slug>.html —
   раньше карточка рисовалась скриптом из ?id= и поисковик её не видел.
   Запуск: npm run build */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

/* Режим превью (GitHub Pages): PREVIEW=1 npm run build
   — сайт собирается в подпапку, закрывается от индексации,
     PHP-файлы не попадают в сборку (Pages их не исполняет). */
const PREVIEW = process.env.PREVIEW === '1';
const BASE = PREVIEW ? (process.env.BASE_PATH || '/karkas_comfort') : '';
const SITE = process.env.SITE_URL || (PREVIEW
  ? `https://dkaratsapov-web.github.io${BASE}`
  : 'https://karkascomfort.ru');
const OUT = process.env.OUT_DIR || 'dist';
const LEAD_ENDPOINT = PREVIEW ? '' : '/api/lead.php';   // на Pages нет PHP — формы работают в демо-режиме

const read = (p) => readFileSync(p, 'utf8');
const partial = (name) => read(`src/partials/${name}.html`);
const hash = (p) => createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 8);

const head = partial('head');
const header = partial('header');
const footer = partial('footer');
const cta = partial('cta');
const actionbar = partial('actionbar');

const projects = JSON.parse(read('src/data/projects.json'));
const cases = JSON.parse(read('src/data/cases.json'));
const pricing = JSON.parse(read('src/data/pricing.json'));
const reviews = JSON.parse(read('src/data/reviews.json'));
const site = JSON.parse(read('src/data/site.json'));

/* Счётчики подключаются, только если в src/data/site.json указан номер.
   Цели на заявку, звонок и клик по мессенджеру шлёт assets/js/main.js. */
const analytics = [
  site.metrika ? `  <script>
    (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
    m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
    (window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");
    ym(${JSON.stringify(site.metrika)}, "init", { clickmap:true, trackLinks:true, accurateTrackBounce:true, webvisor:false });
  </script>
  <noscript><div><img src="https://mc.yandex.ru/watch/${site.metrika}" style="position:absolute;left:-9999px" alt=""></div></noscript>` : '',
  site.gtag ? `  <script async src="https://www.googletagmanager.com/gtag/js?id=${site.gtag}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config",${JSON.stringify(site.gtag)});</script>` : ''
].filter(Boolean).join('\n');

writeFileSync('assets/js/projects-data.js',
  `/* Данные каталога. Источник: src/data/projects.json — правьте там и запускайте сборку. */\nwindow.KK_PROJECTS = ${JSON.stringify(
    projects.map((p) => ({ ...p, priceFrom: priceOf(p), priceTop: priceTop(p), url: projectUrl(p.slug) })), null, 2)};\nwindow.KK_PRICING = ${JSON.stringify(pricing)};\n`);

/* ---------- цены ---------- */
function priceOf(p) { return p.price ?? Math.round(p.area * pricing.ratePerM2.standart); }
function priceTop(p) { return Math.round(p.area * pricing.ratePerM2.pod_kluch); }
function projectUrl(slug) { return `/proekty/${slug}.html`; }
const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
const priceNote = (p) => (p.price ? 'под ключ, по договору' : 'под ключ, ориентировочно');
const termOf = (p) => p.term || (p.area <= 90 ? '1,5–2 месяца' : p.area <= 150 ? '2–3 месяца' : '3–4 месяца');
const floorsLabel = (f) => (f === 1 ? '1 этаж' : f === 1.5 ? '1,5 этажа' : '2 этажа');
const floorsWord = (f) => (f === 1 ? 'Одноэтажный' : f === 1.5 ? 'Полутораэтажный' : 'Двухэтажный');
const bedroomsWord = (n) => `${n} ${n === 1 ? 'спальня' : n < 5 ? 'спальни' : 'спален'}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* фотография объекта, если её передал заказчик, иначе временная иллюстрация */
const photoOf = (p) => (p.photos && p.photos.length ? `/assets/img/photos/${p.photos[0]}` : `/assets/img/projects/${p.slug}.svg`);

/* ---------- чистая папка выгрузки ---------- */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/proekty`, { recursive: true });
cpSync('assets', `${OUT}/assets`, { recursive: true });
if (PREVIEW) {
  writeFileSync(`${OUT}/robots.txt`, 'User-agent: *\nDisallow: /\n');   // превью не должно попасть в поиск
  writeFileSync(`${OUT}/.nojekyll`, '');                                 // Pages не должен обрабатывать сборку Jekyll
} else {
  if (existsSync('robots.txt')) cpSync('robots.txt', `${OUT}/robots.txt`);
  if (existsSync('server/.htaccess')) cpSync('server/.htaccess', `${OUT}/.htaccess`);
  if (existsSync('server/api')) cpSync('server/api', `${OUT}/api`, { recursive: true });
}
if (existsSync('server/site.webmanifest')) cpSync('server/site.webmanifest', `${OUT}/site.webmanifest`);
for (const f of ['favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'])
  if (existsSync(`assets/img/${f}`)) cpSync(`assets/img/${f}`, `${OUT}/${f}`);

/* ---------- версии статики, чтобы браузер не показывал старый кеш ---------- */
const V = {
  css: hash('assets/css/style.css'),
  main: hash('assets/js/main.js'),
  data: hash('assets/js/projects-data.js')
};
const previewBar = PREVIEW ? `  <div class="preview-bar">
    <span><b>Демонстрационная версия.</b> Заявки не отправляются, цены и фотографии ориентировочные.</span>
    <a href="https://karkascomfort.ru">Действующий сайт →</a>
  </div>\n` : '';

/* в превью сайт лежит в подпапке — правим корневые ссылки и закрываем от индексации */
const rebase = (html) => (BASE
  ? html.replace(/(href|src)="\/(?!\/)/g, `$1="${BASE}/`)
  : html);

/* страницы проектов лежат в подпапке — их ссылки должны быть от корня */
const absolutize = (html) => html.replace(/(href|src)="(?!https?:|\/\/|\/|#|tel:|mailto:|data:)/g, '$1="/');

const version = (html) => html
  .replace(/assets\/css\/style\.css(?!\?)/g, `assets/css/style.css?v=${V.css}`)
  .replace(/assets\/js\/main\.js(?!\?)/g, `assets/js/main.js?v=${V.main}`)
  .replace(/assets\/js\/projects-data\.js(?!\?)/g, `assets/js/projects-data.js?v=${V.data}`);

/* ---------- микроразметка ---------- */
const ld = (obj) => `  <script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const breadcrumbLd = (items) => ld({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${SITE}${it.url}` }))
});
const productLd = (p) => ld({
  '@context': 'https://schema.org', '@type': 'Product',
  name: `Каркасный дом ${p.size} (${p.code})`,
  description: p.note,
  sku: p.code,
  image: `${SITE}${photoOf(p)}`,
  brand: { '@type': 'Brand', name: 'Каркас Комфорт' },
  offers: {
    '@type': 'Offer', priceCurrency: 'RUB', price: priceOf(p),
    availability: 'https://schema.org/InStock', url: `${SITE}${projectUrl(p.slug)}`,
    seller: { '@type': 'Organization', name: 'ООО «Каркас Комфорт»' }
  },
  additionalProperty: [
    { '@type': 'PropertyValue', name: 'Площадь', value: `${p.area} м²` },
    { '@type': 'PropertyValue', name: 'Этажность', value: floorsLabel(p.floors) },
    { '@type': 'PropertyValue', name: 'Спальни', value: String(p.bedrooms) }
  ]
});

/* ---------- шаблоны блоков ---------- */
const projectCard = (p) => `      <article class="project">
        <div class="project__media">
          <img src="${photoOf(p)}" alt="Каркасный дом ${p.code}, ${p.size} м, ${p.area} м²" loading="lazy" width="900" height="600">
          <span class="project__code">${p.code}</span>
        </div>
        <div class="project__body">
          <h3 class="project__title"><a href="${projectUrl(p.slug)}">Каркасный дом ${p.size}</a></h3>
          <ul class="specs"><li>${p.area} м²</li><li>${floorsLabel(p.floors)}</li><li>${bedroomsWord(p.bedrooms)}</li>${p.terrace ? '<li>терраса</li>' : ''}</ul>
          <div class="project__foot">
            <span class="price">${p.price ? '' : 'от '}${money(priceOf(p))}<small>${priceNote(p)} · ${termOf(p)}</small></span>
            <span class="project__more">Подробнее →</span>
          </div>
        </div>
      </article>`;

const caseTile = (c) => `        <a class="tile" href="${projectUrl(c.slug)}">
          <div class="tile__media"><img src="${c.photos && c.photos.length ? `/assets/img/photos/${c.photos[0]}` : `/assets/img/projects/${c.slug}.svg`}" alt="${esc(c.title)}, ${c.area} м²" loading="lazy" width="900" height="600"></div>
          <div class="tile__body">
            <h3>${esc(c.title)}</h3>
            <p class="tile__meta"><span>${c.size} м · ${c.area} м²</span><span>${c.term}</span><span>${esc(c.tier)}</span></p>
          </div>
        </a>`;

/* Отзывы: пока реальных нет, блок не выводится вовсе — выдуманные отзывы
   с сайта сняты, вёрстка ждёт настоящих (см. src/data/README.md). */
const reviewsBlock = () => (reviews.length ? `        <div class="reviews">
${reviews.map((r) => `          <article class="card review">
            <p class="review__stars" aria-label="Оценка 5 из 5">★★★★★</p>
            <q>${esc(r.text)}</q>
            <div class="review__author"><span class="review__avatar" aria-hidden="true">${esc(r.author.slice(0, 1))}</span><div><b>${esc(r.author)}</b><span>${esc(r.detail || '')}${r.source ? ` · ${r.url ? `<a href="${esc(r.url)}" rel="nofollow noopener">${esc(r.source)}</a>` : esc(r.source)}` : ''}</span></div></div>
          </article>`).join('\n')}
        </div>` : '');

/* ---------- сборка одной страницы ---------- */
function page({ file, meta, content, extraLd = '', root = false }) {
  const canonical = meta.canonical || `${SITE}/${file === 'index.html' ? '' : file}`;
  const ogimage = meta.ogimage ? `${SITE}${meta.ogimage}` : `${SITE}/assets/img/og.png`;
  let html = `<!doctype html>
<html lang="ru">
${head
    .replace(/\{\{title\}\}/g, esc(meta.title))
    .replace(/\{\{description\}\}/g, esc(meta.description))
    .replace(/\{\{canonical\}\}/g, canonical)
    .replace(/\{\{ogimage\}\}/g, ogimage)
    .replace(/\{\{scripts\}\}/g, (meta.scripts || []).map((s) => `\n  <script src="${s}" defer></script>`).join(''))
    .replace('</head>', `${extraLd ? extraLd + '\n' : ''}${PREVIEW ? '  <meta name="robots" content="noindex, nofollow">\n' : ''}${PREVIEW || !analytics ? '' : analytics + '\n'}</head>`)}
<body data-lead-endpoint="${LEAD_ENDPOINT}"${site.metrika ? ` data-metrika="${site.metrika}"` : ''}>
${previewBar}${header}
  <main id="main">
${content.trimEnd()}
  </main>
${footer}
${actionbar}
  <script src="assets/js/main.js" defer></script>
</body>
</html>
`;
  if (root) html = absolutize(html);
  return rebase(version(html));
}

/* ---------- обычные страницы ---------- */
const files = readdirSync('src/pages').filter((f) => f.endsWith('.html'));
const built = [];

for (const file of files) {
  const raw = read(`src/pages/${file}`);
  const m = raw.match(/^<!--meta\s+([\s\S]*?)-->\s*/);
  if (!m) throw new Error(`Нет блока <!--meta --> в ${file}`);
  const meta = JSON.parse(m[1]);
  let content = raw.slice(m[0].length);
  content = content.replace(/\{\{cta\}\}/g, () => cta);
  content = content.replace(/\{\{cases\}\}/g, () => cases.map(caseTile).join('\n'));
  content = content.replace(/\{\{projects:(\d+)\}\}/g, (_, n) => projects.slice(0, Number(n)).map(projectCard).join('\n'));
  content = content.replace(/\{\{projects:all\}\}/g, () => projects.map(projectCard).join('\n'));
  content = content.replace(/\{\{reviews\}\}/g, () => reviewsBlock());

  const blocks = [];
  if (meta.breadcrumb) blocks.push(breadcrumbLd(meta.breadcrumb));
  if (meta.jsonld) blocks.push(ld(meta.jsonld));
  if (file === 'proekty.html') blocks.push(ld({
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: projects.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}${projectUrl(p.slug)}`, name: `Каркасный дом ${p.size} (${p.code})` }))
  }));

  writeFileSync(`${OUT}/${file}`, page({ file, meta, content, extraLd: blocks.join('\n') }));
  if (meta.noindex !== true) built.push({ url: `/${file === 'index.html' ? '' : file}`, priority: meta.priority ?? 0.6 });
}

/* ---------- страницы проектов ---------- */
const included = [
  ['Фундамент и каркас', 'Сваи с обвязкой, стойки 150×50 мм из доски камерной сушки, ветрозащита и перекрытия.'],
  ['Кровля и фасад', 'Металлочерепица с водостоком, вентилируемый фасад с покраской в два слоя.'],
  ['Коммуникации', 'Скрытая электрика с щитком, отопление, водоснабжение и канализация до точки подключения.'],
  ['Окна и двери', 'Двухкамерные стеклопакеты, входная утеплённая дверь, откосы и подоконники.']
];

for (const p of projects) {
  const similar = projects.filter((x) => x.slug !== p.slug)
    .sort((a, b) => Math.abs(a.area - p.area) - Math.abs(b.area - p.area)).slice(0, 3);
  const title = `Каркасный дом ${p.size} (${p.code}) — ${p.area} м² под ключ | Каркас Комфорт`;
  const description = `Проект каркасного дома ${p.size} площадью ${p.area} м²: ${floorsWord(p.floors).toLowerCase()}, ${bedroomsWord(p.bedrooms)}, срок ${termOf(p)}. Цена ${p.price ? '' : 'от '}${money(priceOf(p))} под ключ с коммуникациями.`;

  const content = `    <ol class="crumbs container">
      <li><a href="/index.html">Главная</a></li>
      <li><a href="/proekty.html">Проекты</a></li>
      <li>Дом ${p.size} (${p.code})</li>
    </ol>

    <section class="section" style="padding-top:clamp(20px,2.4vw,36px)">
      <div class="container">
        <div class="split split--narrow">
          <div class="gallery">
            <div class="gallery__main">
              <img src="${photoOf(p)}" alt="Каркасный дом ${p.code}, ${p.size} м, ${p.area} м²" width="1200" height="800" fetchpriority="high">
            </div>
            <div class="gallery__thumbs">
              ${(p.photos && p.photos.length > 1
                ? p.photos.slice(1, 4).map((f, i) => `<img src="/assets/img/photos/${f}" alt="Каркасный дом ${p.code}, фото ${i + 2}" loading="lazy" width="400" height="300">`)
                : ['фасад', 'интерьер', 'терраса'].map((label) => `<div class="gallery__thumb" aria-hidden="true"></div>`)
              ).join('\n              ')}
              ${p.plan ? `<img src="/assets/img/photos/${p.plan}" alt="Планировка дома ${p.code}" loading="lazy" width="400" height="300">` : '<div class="gallery__thumb" aria-hidden="true"></div>'}
            </div>
          </div>

          <div class="stack">
            <div class="card">
              <p class="eyebrow">Проект дома</p>
              <h1 style="font-size:clamp(28px,3.4vw,40px)">Каркасный дом ${p.size}<span class="muted"> · ${p.code}</span></h1>
              <p class="muted" style="margin-top:10px">${esc(p.note)}</p>
              <p class="price" style="margin-top:20px;padding-top:18px;border-top:1px solid var(--line-soft);font-size:clamp(26px,3vw,34px)">${p.price ? '' : 'от '}${money(priceOf(p))}<small>тёплый контур${p.price ? '' : ', ориентировочно'} · под ключ с отделкой — от ${money(priceTop(p))} · срок ${termOf(p)}</small></p>
              <div class="stack" style="margin-top:20px">
                <a class="btn btn--block" href="#zayavka" data-project="${p.code} (${p.size}, ${p.area} м²)">Рассчитать этот проект</a>
                <a class="btn btn--ghost btn--block" href="https://wa.me/79201716969?text=${encodeURIComponent(`Здравствуйте! Интересует проект ${p.code} (${p.size}, ${p.area} м²)`)}" rel="nofollow noopener" data-lead-messenger>Спросить в WhatsApp</a>
              </div>
            </div>

            <div class="card">
              <table class="specs-table">
                <tbody>
                  <tr><th scope="row">Габариты</th><td>${p.size} м</td></tr>
                  <tr><th scope="row">Площадь</th><td>${p.area} м²</td></tr>
                  <tr><th scope="row">Этажность</th><td>${floorsWord(p.floors)}</td></tr>
                  <tr><th scope="row">Спальни</th><td>${p.bedrooms}</td></tr>
                  <tr><th scope="row">Терраса</th><td>${p.terrace ? 'есть' : 'нет'}</td></tr>
                  <tr><th scope="row">Срок строительства</th><td>${termOf(p)}</td></tr>
                  <tr><th scope="row">Фундамент</th><td>свайно-винтовой или ленточный</td></tr>
                  <tr><th scope="row">Гарантия</th><td>5 лет по договору</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section section--paper">
      <div class="container">
        <div class="section__head">
          <p class="eyebrow">Комплектация</p>
          <h2>Что входит в ${p.price ? '' : 'ориентировочную '}стоимость</h2>
        </div>
        <div class="grid grid--4">
${included.map(([t, d]) => `          <article class="card"><h3>${t}</h3><p>${d}</p></article>`).join('\n')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section__head section__head--row">
          <div>
            <p class="eyebrow">Похожие проекты</p>
            <h2>Дома близкой площади</h2>
          </div>
          <a class="btn btn--ghost btn--sm" href="/proekty.html">Все 15 проектов</a>
        </div>
        <div class="grid grid--3">
${similar.map(projectCard).join('\n')}
        </div>
      </div>
    </section>

${cta}`;

  const meta = {
    title, description,
    canonical: `${SITE}${projectUrl(p.slug)}`,
    ogimage: photoOf(p),
    scripts: []
  };
  const blocks = [
    productLd(p),
    breadcrumbLd([
      { name: 'Главная', url: '/' },
      { name: 'Проекты', url: '/proekty.html' },
      { name: `Дом ${p.size} (${p.code})`, url: projectUrl(p.slug) }
    ])
  ];
  writeFileSync(`${OUT}/proekty/${p.slug}.html`, page({ file: `proekty/${p.slug}.html`, meta, content, extraLd: blocks.join('\n'), root: true }));
  built.push({ url: projectUrl(p.slug), priority: 0.8 });
}

/* ---------- старый адрес карточки: редирект на новую страницу ---------- */
writeFileSync(`${OUT}/proekt.html`, rebase(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Проекты каркасных домов — Каркас Комфорт</title>
  <meta name="robots" content="noindex, follow">
  <link rel="canonical" href="${SITE}/proekty.html">
  <script>
    /* старые ссылки вида proekt.html?id=kd-40 ведут на статическую страницу проекта */
    var id = new URLSearchParams(location.search).get('id');
    location.replace(id ? '/proekty/' + id.replace(/[^a-z0-9-]/gi, '') + '.html' : '/proekty.html');
  </script>
  <meta http-equiv="refresh" content="0; url=/proekty.html">
</head>
<body><p>Страница переехала: <a href="/proekty.html">каталог проектов</a>.</p></body>
</html>
`));

/* ---------- sitemap ---------- */
const today = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
writeFileSync(`${OUT}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${built.map((b) => `  <url>
    <loc>${SITE}${b.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${b.priority}</priority>
  </url>`).join('\n')}
</urlset>
`);

console.log(`${OUT}/: страниц ${built.length} (из них проектов ${projects.length})${PREVIEW ? ` · превью для ${SITE}` : ''}, версии статики css=${V.css} js=${V.main}`);
