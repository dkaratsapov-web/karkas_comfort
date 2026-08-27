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
const modal = partial('modal');

/* Фотография первого экрана: если файл положен в assets/img/photos/,
   берём его; пока файла нет — временная иллюстрация. */
const HERO_PHOTO = ['hero.jpg', 'hero.jpeg', 'hero.webp', 'hero.png']
  .map((f) => `assets/img/photos/${f}`).find((f) => existsSync(f));

const projects = JSON.parse(read('src/data/projects.json'));
const cases = JSON.parse(read('src/data/cases.json'));
const pricing = JSON.parse(read('src/data/pricing.json'));
const reviews = JSON.parse(read('src/data/reviews.json'));
const articles = JSON.parse(read('src/data/articles.json'));

const img = (f) => `/assets/img/photos/${f}`;
/* Уменьшенный вариант кадра (…-800.jpg), если он подготовлен рядом с оригиналом.
   Полный файл остаётся для полноэкранного просмотра. */
const small = (f) => {
  const alt = f.replace(/\.(jpe?g|png|webp)$/i, '-800.$1');
  return existsSync(`assets/img/photos/${alt}`) ? alt : f;
};
const srcset = (f, sizes) => {
  const alt = small(f);
  return alt === f ? `src="${img(f)}"` : `src="${img(alt)}" srcset="${img(alt)} 800w, ${img(f)} 1700w" sizes="${sizes}"`;
};
const photoAlt = (p, i) => `Каркасный дом ${p.code} ${p.size} м, ${p.photos && p.photos.length ? 'фото' : 'кадр'} ${i + 1}`;


/* Витрина на главной: построенный объект и проекты с альбомами.
   Тип подписан на каждой плитке, чтобы проект не выдавался за объект. */
const projectTile = (p) => `        <a class="tile" href="${projectUrl(p.slug)}">
          <div class="tile__media"><img ${srcset(shotsOf(p)[0] || '', '(min-width: 1100px) 33vw, 100vw')} alt="Каркасный дом ${p.code}, ${p.size} м" loading="lazy" width="900" height="600"></div>
          <div class="tile__body">
            <p class="tile__badge tile__badge--plan">Проект, альбом и смета</p>
            <h3>Дом ${p.size} (${p.code})</h3>
            <p class="tile__meta"><span>${p.area} м²</span><span>${floorsLabel(p.floors)}</span><span>${bedroomsWord(p.bedrooms)}</span></p>
            <p class="tile__price">${p.prices ? `${money(priceOf(p))} за тёплый контур` : `от ${money(priceOf(p))}`}</p>
          </div>
        </a>`;

const articleUrl = (slug) => `/stati/${slug}/`;
const ARTICLE_IMG = (a) => (a.cover ? `/assets/img/photos/${a.cover}` : '/assets/img/og.png');
const dateRu = (iso) => {
  const m = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const [y, mo, d] = iso.split('-');
  return `${Number(d)} ${m[Number(mo) - 1]} ${y}`;
};

function articleBody(blocks) {
  return blocks.map((b) => {
    if (b.h2) return `        <h2>${esc(b.h2)}</h2>`;
    if (b.h3) return `        <h3>${esc(b.h3)}</h3>`;
    if (b.p) return `        <p>${esc(b.p)}</p>`;
    if (b.ul) return `        <ul class="checks checks--tight">\n${b.ul.map((i) => `          <li>${esc(i)}</li>`).join('\n')}\n        </ul>`;
    if (b.table) return `        <div class="table-wrap"><table class="data-table">
          <thead><tr>${b.table[0].map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${b.table.slice(1).map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody>
        </table></div>`;
    return '';
  }).join('\n');
}

const articleCard = (a) => `        <article class="post">
          <a class="post__media${/razrez|fasad|vid-|plan|3d/.test(a.cover || '') ? ' post__media--sheet' : ''}" href="${articleUrl(a.slug)}" tabindex="-1" aria-hidden="true">
            <img ${srcset(a.cover, '(min-width: 900px) 33vw, 100vw')} alt="" loading="lazy" width="900" height="600">
          </a>
          <div class="post__body">
            <p class="post__tag">${esc(a.tag)}</p>
            <h3 class="post__title"><a href="${articleUrl(a.slug)}">${esc(a.h1 || a.title)}</a></h3>
            <p class="post__lead">${esc(a.lead)}</p>
            <p class="post__meta"><time datetime="${a.updated || a.date}">${dateRu(a.updated || a.date)}</time><span>${a.read} мин чтения</span></p>
          </div>
        </article>`;

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

/* ---------- цены ---------- */
function priceOf(p) { return p.prices?.kontur ?? p.price ?? Math.round(p.area * pricing.ratePerM2.standart); }
function priceTop(p) { return p.prices?.pod_kluch ?? Math.round(p.area * pricing.ratePerM2.pod_kluch); }
function projectUrl(slug) { return `/proekty/${slug}/`; }
const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
const priceNote = (p) => (p.prices ? 'тёплый контур, по смете' : p.price ? 'под ключ, по договору' : 'под ключ, ориентировочно');
const termOf = (p) => p.term || (p.area <= 90 ? '1,5–2 месяца' : p.area <= 150 ? '2–3 месяца' : '3–4 месяца');
const floorsLabel = (f) => (f === 1 ? '1 этаж' : f === 1.5 ? '1,5 этажа' : '2 этажа');
const floorsWord = (f) => (f === 1 ? 'Одноэтажный' : f === 1.5 ? 'Полутораэтажный' : 'Двухэтажный');
const bedroomsWord = (n) => `${n} ${n === 1 ? 'спальня' : n < 5 ? 'спальни' : 'спален'}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* фотография объекта, если её передал заказчик, иначе временная иллюстрация */
/* Кадры для карточки и галереи: фотографии объекта, иначе визуализации,
   иначе объёмные виды из альбома, иначе временная развёртка фасада. */
const shotsOf = (p) => (p.photos && p.photos.length ? p.photos
  : p.viz && p.viz.length ? p.viz
  : (p.drawings || []).filter((d) => /vid-|3d/.test(d.file)).map((d) => d.file));
const shotsAnchor = (p) => (p.photos && p.photos.length ? '#foto' : p.viz && p.viz.length ? '#viz' : '#chertezhi');
const photoOf = (p) => {
  const list = shotsOf(p);
  return list.length ? `/assets/img/photos/${list[0]}` : `/assets/img/projects/${p.slug}.svg`;
};

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
  main: hash('assets/js/main.js')
};
const previewBar = '';   // плашку демо-версии заказчик просил убрать

/* в превью сайт лежит в подпапке — правим корневые ссылки и закрываем от индексации */
const rebase = (html) => (BASE
  ? html
    .replace(/(href|src|data-zoom|data-full)="\/(?!\/)/g, `$1="${BASE}/`)
    /* srcset — это список «путь ширина, путь ширина», его тоже надо переписать */
    .replace(/srcset="([^"]+)"/g, (_, list) => `srcset="${list.replace(/(^|,\s*)\/(?!\/)/g, `$1${BASE}/`)}"`)
  : html);

/* Адреса без .html: страница живёт в своей папке (obekty/index.html),
   поэтому все внутренние ссылки делаем от корня и убираем расширение. */
const pageUrl = (file) => (file === 'index.html' ? '/' : file === '404.html' ? '/404.html' : `/${file.replace(/\.html$/, '')}/`);
const outPath = (file) => (file === 'index.html' || file === '404.html' ? file : `${file.replace(/\.html$/, '')}/index.html`);

const linkify = (html) => html
  /* ссылки на страницы: proekty.html?size=s -> /proekty/?size=s */
  .replace(/href="(?!https?:|\/\/|#|tel:|mailto:|data:)([a-z0-9-]+)\.html(\?[^"]*)?(#[^"]*)?"/gi,
    (_, name, query = '', hash = '') => `href="${name === 'index' ? '/' : name === '404' ? '/404.html' : `/${name}/`}${query}${hash}"`)
  /* корневые ссылки, записанные вручную: /proekty.html -> /proekty/ */
  .replace(/href="\/([a-z0-9-]+)\.html(\?[^"]*)?(#[^"]*)?"/gi,
    (m, name, query = '', hash = '') => (name === '404' || name === 'index'
      ? `href="/${name === 'index' ? '' : '404.html'}${query}${hash}"`
      : `href="/${name}/${query}${hash}"`))
  /* остальные относительные пути (стили, шрифты, картинки) — от корня */
  .replace(/(href|src)="(?!https?:|\/\/|\/|#|tel:|mailto:|data:)/g, '$1="/');

const version = (html) => html
  .replace(/assets\/css\/style\.css(?!\?)/g, `assets/css/style.css?v=${V.css}`)
  .replace(/assets\/js\/main\.js(?!\?)/g, `assets/js/main.js?v=${V.main}`);

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
const projectCard = (p) => `      <article class="project" data-floors="${p.floors}" data-area="${p.area}" data-price="${priceOf(p)}">
        <div class="project__media">
          <img src="${photoOf(p)}" alt="Каркасный дом ${p.code}, ${p.size} м, ${p.area} м²" loading="lazy" width="900" height="600">
          <span class="project__code">${p.code}</span>
        </div>
        <div class="project__body">
          <h3 class="project__title"><a href="${projectUrl(p.slug)}">Каркасный дом ${p.size}</a></h3>
          <ul class="specs"><li>${p.area} м²</li><li>${floorsLabel(p.floors)}</li><li>${bedroomsWord(p.bedrooms)}</li>${p.terrace ? '<li>терраса</li>' : ''}</ul>
          <div class="project__foot">
            <span class="price">${p.price || p.prices ? '' : 'от '}${money(priceOf(p))}<small>${priceNote(p)} · ${termOf(p)}</small></span>
            <span class="project__more">Подробнее →</span>
          </div>
        </div>
      </article>`;

const caseTile = (c) => `        <a class="tile" href="${projectUrl(c.slug)}">
          <div class="tile__media"><img src="${c.photos && c.photos.length ? `/assets/img/photos/${c.photos[0]}` : `/assets/img/projects/${c.slug}.svg`}" alt="${esc(c.title)}, ${c.area} м²" loading="lazy" width="900" height="600"></div>
          <div class="tile__body">
            <p class="tile__badge">Объект, есть съёмка</p>
            <h3>${esc(c.title)}</h3>
            <p class="tile__meta"><span>${c.size} м · ${c.area} м²</span><span>${c.term}</span><span>${esc(c.tier)}</span></p>
            ${c.place ? `<p class="tile__place">${esc(c.place)}</p>` : ''}
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
function page({ file, meta, content, extraLd = '' }) {
  /* на странице без блока заявки кнопка панели действий ведёт на расчёт с главной */
  const hasLeadForm = content.includes('id="zayavka"');
  const canonical = meta.canonical || `${SITE}${pageUrl(file)}`;
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
<body data-rates="${esc(JSON.stringify(pricing.ratePerM2))}" data-lead-endpoint="${LEAD_ENDPOINT}"${site.metrika ? ` data-metrika="${site.metrika}"` : ''}>
${previewBar}${header}
  <main id="main">
${content.trimEnd()}
  </main>
${footer}
${hasLeadForm ? actionbar : actionbar.replace('href="#zayavka"', 'href="/index.html#raschet"')}
${modal}
  <script src="assets/js/main.js" defer></script>
</body>
</html>
`;
  return rebase(version(linkify(html)));
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
  content = content.replace(/\{\{articles:(\d+)\}\}/g, (_, n) => articles.slice(0, Number(n)).map(articleCard).join('\n'));
  content = content.replace(/\{\{projects:count\}\}/g, () => String(projects.length));
  content = content.replace(/\{\{cta\}\}/g, () => cta);
  content = content.replace(/\{\{cases\}\}/g, () => cases.map(caseTile).join('\n'));
  content = content.replace(/\{\{showcase\}\}/g, () => [
    ...cases.map(caseTile),
    ...projects.filter((p) => p.prices).slice(0, 2).map(projectTile)
  ].join('\n'));
  content = content.replace(/\{\{projects:(\d+)\}\}/g, (_, n) => projects.slice(0, Number(n)).map(projectCard).join('\n'));
  content = content.replace(/\{\{projects:all\}\}/g, () => projects.map(projectCard).join('\n'));
  /* пока отзывов нет, секция с ними не выводится вовсе — не оставляем пустую рамку */
  content = reviews.length
    ? content.replace(/\{\{reviews\}\}/g, () => reviewsBlock())
    : content.replace(/[ \t]*<section[^>]*>(?:(?!<\/section>)[\s\S])*?\{\{reviews\}\}[\s\S]*?<\/section>\n/g, '')
             .replace(/\{\{reviews\}\}/g, '');

  const blocks = [];
  if (meta.breadcrumb) blocks.push(breadcrumbLd(meta.breadcrumb));
  if (meta.jsonld) blocks.push(ld(meta.jsonld));
  if (file === 'proekty.html') blocks.push(ld({
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: projects.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}${projectUrl(p.slug)}`, name: `Каркасный дом ${p.size} (${p.code})` }))
  }));

  const out = outPath(file);
  mkdirSync(`${OUT}/${out.split('/').slice(0, -1).join('/')}` || OUT, { recursive: true });
  writeFileSync(`${OUT}/${out}`, page({ file, meta, content, extraLd: blocks.join('\n') }));
  if (meta.noindex !== true) built.push({ url: pageUrl(file), priority: meta.priority ?? 0.6 });
  /* на GitHub Pages нет переадресации с сервера — кладём файл-заглушку,
     чтобы старые ссылки вида /obekty.html не отдавали 404 */
  if (PREVIEW && file !== 'index.html' && file !== '404.html') {
    writeFileSync(`${OUT}/${file}`, rebase(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="robots" content="noindex"><link rel="canonical" href="${SITE}${pageUrl(file)}">
<meta http-equiv="refresh" content="0; url=${pageUrl(file)}"></head>
<body><p>Страница переехала: <a href="${pageUrl(file)}">${pageUrl(file)}</a></p></body></html>\n`));
  }
}

/* ---------- страницы проектов ---------- */
const included = [
  ['Фундамент и каркас', 'Сваи с обвязкой, стойки 150×50 мм из доски камерной сушки, ветрозащита и перекрытия.'],
  ['Кровля и фасад', 'Металлочерепица с водостоком, вентилируемый фасад с покраской в два слоя.'],
  ['Коммуникации', 'Скрытая электрика с щитком, отопление, водоснабжение и канализация до точки подключения.'],
  ['Окна и двери', 'Двухкамерные стеклопакеты, входная утеплённая дверь, откосы и подоконники.']
];

/* Галерея: крупный кадр + лента миниатюр. Переключение — в main.js; без скрипта
   страница остаётся рабочей: виден первый кадр, миниатюры кликаются в лайтбокс. */
function galleryBlock(p) {
  const list = shotsOf(p);
  if (list.length < 2) {
    return `          <div class="gallery">
            <div class="gallery__main">
              <img src="${photoOf(p)}" alt="${photoAlt(p, 0)}" width="1200" height="800" fetchpriority="high">
            </div>
          </div>`;
  }
  const shown = list.slice(0, 5);
  const rest = list.length - shown.length;
  const thumbs = shown.map((f, i) => {
    const pic = `<img ${srcset(f, "(min-width: 1100px) 160px, 20vw")} alt="${photoAlt(p, i)}" loading="lazy" width="400" height="300">`;
    /* последняя миниатюра при большом наборе ведёт к полной галерее ниже */
    return i === shown.length - 1 && rest > 0
      ? `<a class="gallery__thumb gallery__thumb--more" href="${shotsAnchor(p)}" data-more="+${rest}" aria-label="Смотреть все ${list.length} кадров">${pic}</a>`
      : `<button class="gallery__thumb" type="button" aria-pressed="${i === 0}" data-full="${img(f)}">${pic}</button>`;
  }).join('\n              ');
  const sheets = !(p.photos && p.photos.length) && !(p.viz && p.viz.length);
  return `          <div class="gallery${sheets ? ' gallery--sheets' : ''}" data-gallery>
            <div class="gallery__main">
              <img src="${img(list[0])}" alt="${photoAlt(p, 0)}" width="1200" height="800" fetchpriority="high" data-zoom="${img(list[0])}" data-zoom-target="${p.slug}-${p.photos && p.photos.length ? 'all' : p.viz && p.viz.length ? 'viz' : 'sheets'}" data-zoom-index="0">
              <p class="gallery__count"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/></svg><span><span data-gallery-current>1</span> из ${list.length} — ${p.photos && p.photos.length ? 'фото объекта' : 'визуализация проекта'}</span></p>
            </div>
            <div class="gallery__thumbs">
              ${thumbs}
            </div>
          </div>`;
}

/* Планировка с экспликацией — только там, где есть данные обмеров из проекта. */
function planBlock(p) {
  if (!p.plan || !(p.rooms || []).length) return '';
  const rows = p.rooms.map((r, i) => `                  <tr><td>${i + 1}. ${esc(r.name)}</td><td>${r.area}</td></tr>`).join('\n');
  const total = p.roomsTotal ? `                <tfoot>
                  <tr><td>Итого по экспликации</td><td>${p.roomsTotal} м²</td></tr>
                </tfoot>` : '';
  const tep = (p.tep || []).map(([t, v]) => `                  <tr><th scope="row">${esc(t)}</th><td>${esc(v)}</td></tr>`).join('\n');
  return `
    <section class="section section--paper" id="planirovka">
      <div class="container">
        <div class="section__head">
          <p class="eyebrow">Планировка</p>
          <h2>План этажа и площади помещений</h2>
          <p class="lead">Цифры взяты из проекта${p.docs ? `. ${esc(p.docs)}` : ''}. Планировку подгоняем под вашу семью до старта работ.</p>
        </div>
        <div class="split split--narrow">
          <figure class="plan-sheet" style="margin:0">
            <img src="${img(p.plan)}" alt="Планировка каркасного дома ${p.code}, ${p.size} м" loading="lazy" width="1400" height="990" data-zoom="${img(p.plan)}" data-zoom-group="${p.slug}-plan">
          </figure>
          <div class="stack">
            <div class="card">
              <table class="rooms-table">
                <thead><tr><th scope="col">Помещение</th><th scope="col">Площадь, м²</th></tr></thead>
                <tbody>
${rows}
                </tbody>
${total}
              </table>
            </div>
${tep ? `            <div class="card">
              <h3 style="font-size:17px;margin-bottom:8px">Технико-экономические показатели</h3>
              <table class="specs-table">
                <tbody>
${tep}
                </tbody>
              </table>
            </div>` : ''}
          </div>
        </div>
      </div>
    </section>
`;
}

/* Полный набор фотографий объекта. */
function photosBlock(p) {
  const list = p.photos || [];
  if (list.length < 3) return '';
  const cells = list.map((f, i) => `          <figure><img ${srcset(f, "(min-width: 1200px) 25vw, (min-width: 760px) 33vw, 50vw")} alt="${photoAlt(p, i)}" loading="lazy" width="900" height="675" data-zoom="${img(f)}" data-zoom-group="${p.slug}-all"></figure>`).join('\n');
  return `
    <section class="section" id="foto">
      <div class="container">
        <div class="section__head">
          <p class="eyebrow">Объект</p>
          <h2>Как этот дом выглядит вживую</h2>
          <p class="lead">${list.length} фотографий с площадки: каркас, фасад из вертикальной доски, тёмные примыкания и терраса под общей кровлей. Живая съёмка — без визуализаций и стоковых картинок.</p>
        </div>
        <div class="shots shots--photos">
${cells}
        </div>
      </div>
    </section>
`;
}

/* Цены по комплектациям из сметы к договору. Показываем только итоги:
   состав материалов и закупочные цены на сайт не выносим. */
function pricesBlock(p) {
  if (!p.prices) return '';
  const rows = [
    ['Тёплый контур', p.prices.kontur, 'Фундамент, каркас, перекрытия, кровля, утепление, мембраны, окна, входная дверь и наружная отделка. Инженерии и внутренней отделки нет.'],
    ['Вайтбокс', p.prices.vaytboks, 'Тёплый контур плюс электрика, отопление, вода и канализация по дому, черновая отделка стен и полов.'],
    ['Под ключ с отделкой', p.prices.pod_kluch, 'Полный цикл с чистовой отделкой, напольными покрытиями, санузлом и межкомнатными дверями. Заезжаете с мебелью.']
  ].filter(([, v]) => v);
  return `
    <section class="section" id="ceny">
      <div class="container">
        <div class="section__head">
          <p class="eyebrow">Стоимость</p>
          <h2>Три комплектации этого дома</h2>
          <p class="lead">Суммы из сметы к договору на этот проект, а не расчёт по средней ставке за метр. Итог зависит от участка, грунта и удалённости: считаем точно после выезда.</p>
        </div>
        <div class="price-rows">
${rows.map(([name, sum, what], i) => `          <article class="price-row${i === 1 ? ' price-row--pick' : ''}">
            <div class="price-row__head">
              <h3>${esc(name)}</h3>
              <p class="price-row__sum">${money(sum)}</p>
            </div>
            <p class="price-row__what">${esc(what)}</p>
            <a class="btn btn--ghost btn--sm" href="#zayavka" data-project="${p.code}, ${esc(name)}">Уточнить смету<span class="btn__arrow" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13m-5-6 6 6-6 6"/></svg></span></a>
          </article>`).join('\n')}
        </div>
      </div>
    </section>
`;
}

/* Визуализации проекта. Подписаны честно: это не фотографии объекта. */
function vizBlock(p) {
  const list = p.viz || [];
  if (!list.length) return '';
  const cells = list.map((f, i) => `          <figure><img ${srcset(f, '(min-width: 1200px) 25vw, (min-width: 760px) 33vw, 50vw')} alt="Визуализация каркасного дома ${p.code}, кадр ${i + 1}" loading="lazy" width="900" height="506" data-zoom="${img(f)}" data-zoom-group="${p.slug}-viz"></figure>`).join('\n');
  return `
    <section class="section" id="viz">
      <div class="container">
        <div class="section__head">
          <p class="eyebrow">Как будет выглядеть</p>
          <h2>Визуализации проекта</h2>
          <p class="lead">Компьютерные визуализации по рабочему проекту: материалы фасада, цвет кровли и посадка дома на участке. Это не фотографии построенного объекта.</p>
        </div>
        <div class="shots shots--photos">
${cells}
        </div>
      </div>
    </section>
`;
}

/* Конструктив: разрез из проекта и состав ограждающих конструкций. */
function structureBlock(p) {
  if (!p.section || !(p.layers || []).length) return '';
  const cols = p.layers.map((l) => `          <article class="card">
            <h3 style="font-size:17px">${esc(l.name)}</h3>
            <ul class="checks" style="margin-top:10px">
${l.items.map((i) => `              <li>${esc(i)}</li>`).join('\n')}
            </ul>
          </article>`).join('\n');
  return `
    <section class="section" id="konstruktiv">
      <div class="container">
        <div class="section__head">
          <p class="eyebrow">Конструктив</p>
          <h2>Что внутри стен, кровли и пола</h2>
          <p class="lead">Состав слоёв — прямо из разреза ${esc(p.section.title)}. Никаких «утеплитель по проекту»: толщины и материалы зафиксированы до начала работ.</p>
        </div>
        <figure class="plan-sheet" style="margin:0 0 clamp(18px,2vw,28px)">
          <img src="${img(p.section.file)}" alt="${esc(p.section.title)} — каркасный дом ${p.code}" loading="lazy" width="1700" height="1167" data-zoom="${img(p.section.file)}" data-zoom-group="${p.slug}-section">
        </figure>
        <div class="grid grid--3">
${cols}
        </div>
      </div>
    </section>
`;
}

/* Листы альбома: объёмные виды и фасады. */
function sheetsBlock(p) {
  const list = p.drawings || [];
  if (!list.length) return '';
  const cells = list.map((d) => `          <figure><img ${srcset(d.file, "(min-width: 760px) 33vw, 100vw")} alt="${esc(d.title)} — проект ${p.code}" loading="lazy" width="900" height="675" data-zoom="${img(d.file)}" data-zoom-group="${p.slug}-sheets"><figcaption>${esc(d.title)}</figcaption></figure>`).join('\n');
  return `
    <section class="section section--paper" id="chertezhi">
      <div class="container">
        <div class="section__head">
          <p class="eyebrow">Альбом проекта</p>
          <h2>Виды и фасады из эскизного проекта</h2>
          <p class="lead">Листы альбома: объёмные виды и фасады. Полный комплект передаём заказчику вместе с договором.</p>
        </div>
        <div class="shots shots--sheets">
${cells}
        </div>
      </div>
    </section>
`;
}

for (const p of projects) {
  const similar = projects.filter((x) => x.slug !== p.slug)
    .sort((a, b) => Math.abs(a.area - p.area) - Math.abs(b.area - p.area)).slice(0, 3);
  const title = `Каркасный дом ${p.size} (${p.code}) — ${p.area} м² под ключ | Каркас Комфорт`;
  const description = `Проект каркасного дома ${p.size} площадью ${p.area} м²: ${floorsWord(p.floors).toLowerCase()}, ${bedroomsWord(p.bedrooms)}, срок ${termOf(p)}. Цена ${p.price ? '' : 'от '}${money(priceOf(p))} под ключ с коммуникациями.`;

  const specs = [
    ['Габариты', `${p.size} м`],
    ['Площадь', `${p.area} м²`],
    ['Этажность', floorsWord(p.floors)],
    ['Спальни', String(p.bedrooms)],
    ['Терраса', p.terrace ? 'есть' : 'нет'],
    ['Срок строительства', termOf(p)],
    ...(p.structure || [['Фундамент', 'свайно-винтовой или ленточный']]),
    ['Гарантия', '5 лет по договору']
  ];

  const content = `    <ol class="crumbs container">
      <li><a href="/index.html">Главная</a></li>
      <li><a href="/proekty.html">Проекты</a></li>
      <li>Дом ${p.size} (${p.code})</li>
    </ol>

    <section class="section" style="padding-top:clamp(16px,2vw,28px)">
      <div class="container">
        <div class="split split--narrow">
          <div class="stack" style="gap:clamp(18px,2vw,28px)">
${galleryBlock(p)}

            <div class="card spec-card">
              <h2 class="spec-card__title">Характеристики проекта</h2>
              <dl class="spec-card__grid">
${specs.map(([t, v]) => `                <div><dt>${esc(t)}</dt><dd>${esc(v)}</dd></div>`).join('\n')}
              </dl>
            </div>
          </div>

          <aside class="project-aside">
            <div class="card">
              <p class="eyebrow">Проект дома</p>
              <h1 style="font-size:clamp(25px,2.8vw,34px)">Каркасный дом ${p.size}<span class="muted" style="display:block;font-size:.56em;font-weight:600;margin-top:6px">проект ${p.code}</span></h1>
              <p class="muted" style="margin-top:10px">${esc(p.note)}</p>
              <p class="price" style="margin-top:20px;padding-top:18px;border-top:1px solid var(--line-soft);font-size:clamp(26px,3vw,34px)">${p.price || p.prices ? '' : 'от '}${money(priceOf(p))}<small>тёплый контур${p.prices ? ' по смете' : p.price ? '' : ', ориентировочно'} · под ключ с отделкой ${p.prices ? '' : '— от '}${money(priceTop(p))} · срок ${termOf(p)}</small></p>
              <div class="stack" style="margin-top:20px">
                <a class="btn btn--block" href="#zayavka" data-project="${p.code} (${p.size}, ${p.area} м²)">Рассчитать этот проект</a>
                <a class="btn btn--ghost btn--block" href="#" data-lead-messenger>Написать в Telegram</a>
              </div>
              <ul class="checks checks--tight" style="margin-top:20px;padding-top:18px;border-top:1px solid var(--line-soft)">
                <li>Смета с ценами до подписания договора</li>
                <li>Фиксированная стоимость на весь срок</li>
                <li>Планировку меняем под вашу семью</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </section>

${pricesBlock(p)}${planBlock(p)}${vizBlock(p)}${photosBlock(p)}${structureBlock(p)}${sheetsBlock(p)}
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
          <a class="btn btn--ghost btn--sm" href="/proekty.html">Все ${projects.length} проектов</a>
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
  mkdirSync(`${OUT}/proekty/${p.slug}`, { recursive: true });
  writeFileSync(`${OUT}/proekty/${p.slug}/index.html`, page({ file: `proekty/${p.slug}/`, meta, content, extraLd: blocks.join('\n') }));
  if (PREVIEW) writeFileSync(`${OUT}/proekty/${p.slug}.html`, rebase(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="robots" content="noindex"><link rel="canonical" href="${SITE}${projectUrl(p.slug)}">
<meta http-equiv="refresh" content="0; url=${projectUrl(p.slug)}"></head>
<body><p>Страница переехала: <a href="${projectUrl(p.slug)}">${projectUrl(p.slug)}</a></p></body></html>\n`));
  built.push({ url: projectUrl(p.slug), priority: 0.8 });
}


/* ---------- полезные статьи ----------
   Тексты живут в src/data/articles.json. Отсюда собираются
   раздел /stati/ и страницы вида /stati/<slug>/ с разметкой Article,
   хлебными крошками и блоком вопросов. */
mkdirSync(`${OUT}/stati`, { recursive: true });

/* раздел со списком */
{
  const meta = {
    title: 'Статьи о строительстве каркасных домов | Каркас Комфорт',
    description: 'Разборы по строительству каркасного дома: цены и сметы, фундаменты, пирог стены, зимняя стройка и договор подряда. Опыт компании «Каркас Комфорт» в Тверской области.',
    canonical: `${SITE}/stati/`,
    ogimage: ARTICLE_IMG(articles[0]),
    scripts: []
  };
  const content = `    <ol class="crumbs container">
      <li><a href="/index.html">Главная</a></li>
      <li>Статьи</li>
    </ol>

    <section class="section" style="padding-top:clamp(16px,2vw,28px)">
      <div class="container">
        <div class="section__head">
          <p class="eyebrow">Полезное</p>
          <h1>Статьи о строительстве каркасных домов</h1>
          <p class="lead">Разбираем то, о чём чаще всего спрашивают на первом звонке: из чего складывается цена, какой фундамент выбрать, что внутри стены и на что смотреть в договоре.</p>
        </div>
        <div class="posts">
${articles.map(articleCard).join('\n')}
        </div>
      </div>
    </section>

${cta}`;
  const blocks = [
    breadcrumbLd([{ name: 'Главная', url: '/' }, { name: 'Статьи', url: '/stati/' }]),
    ld({
      '@context': 'https://schema.org', '@type': 'ItemList',
      itemListElement: articles.map((a, i) => ({
        '@type': 'ListItem', position: i + 1, url: `${SITE}${articleUrl(a.slug)}`, name: a.title
      }))
    })
  ];
  writeFileSync(`${OUT}/stati/index.html`, page({ file: 'stati/', meta, content, extraLd: blocks.join('\n') }));
  built.push({ url: '/stati/', priority: 0.7 });
}

/* страницы статей */
for (const a of articles) {
  const related = (a.related || []).map((s) => articles.find((x) => x.slug === s)).filter(Boolean);
  const meta = {
    title: `${a.title} | Каркас Комфорт`,
    description: a.description,
    canonical: `${SITE}${articleUrl(a.slug)}`,
    ogimage: ARTICLE_IMG(a),
    scripts: []
  };
  const content = `    <ol class="crumbs container container--text">
      <li><a href="/index.html">Главная</a></li>
      <li><a href="/stati/">Статьи</a></li>
      <li>${esc(a.h1 || a.title)}</li>
    </ol>

    <article class="section" style="padding-top:clamp(16px,2vw,28px)">
      <div class="container container--text">
        <header class="post-head">
          <p class="eyebrow">${esc(a.tag)}</p>
          <h1>${esc(a.h1 || a.title)}</h1>
          <p class="lead">${esc(a.lead)}</p>
          <p class="post__meta">
            <time datetime="${a.date}">Опубликовано ${dateRu(a.date)}</time>
            ${a.updated && a.updated !== a.date ? `<time datetime="${a.updated}">обновлено ${dateRu(a.updated)}</time>` : ''}
            <span>${a.read} мин чтения</span>
          </p>
        </header>
${a.cover ? `        <figure class="post-cover${/razrez|fasad|vid-|plan|3d/.test(a.cover) ? ' post-cover--sheet' : ''}">
          <img ${srcset(a.cover, '(min-width: 1100px) 900px, 100vw')} alt="${esc(a.h1 || a.title)}" width="1700" height="1100" fetchpriority="high">
        </figure>` : ''}
        <div class="prose">
${articleBody(a.body)}
        </div>
${(a.faq || []).length ? `        <section class="post-faq">
          <h2>Короткие ответы</h2>
          <div class="faq">
${a.faq.map((f) => `            <details class="faq__item">
              <summary>${esc(f.q)}</summary>
              <p>${esc(f.a)}</p>
            </details>`).join('\n')}
          </div>
        </section>` : ''}
      </div>
    </article>

${related.length ? `    <section class="section section--paper">
      <div class="container">
        <div class="section__head">
          <p class="eyebrow">Читайте дальше</p>
          <h2>Ещё по теме</h2>
        </div>
        <div class="posts">
${related.map(articleCard).join('\n')}
        </div>
      </div>
    </section>
` : ''}
${cta}`;

  const blocks = [
    ld({
      '@context': 'https://schema.org', '@type': 'Article',
      headline: a.title,
      description: a.description,
      image: `${SITE}${ARTICLE_IMG(a)}`,
      datePublished: a.date,
      dateModified: a.updated || a.date,
      inLanguage: 'ru-RU',
      author: { '@type': 'Organization', name: 'Каркас Комфорт', url: SITE },
      publisher: { '@type': 'Organization', name: 'ООО «Каркас Комфорт»', logo: { '@type': 'ImageObject', url: `${SITE}/assets/img/logo.svg` } },
      mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE}${articleUrl(a.slug)}` }
    }),
    breadcrumbLd([
      { name: 'Главная', url: '/' },
      { name: 'Статьи', url: '/stati/' },
      { name: a.h1 || a.title, url: articleUrl(a.slug) }
    ]),
    ...((a.faq || []).length ? [ld({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: a.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
    })] : [])
  ];

  mkdirSync(`${OUT}/stati/${a.slug}`, { recursive: true });
  writeFileSync(`${OUT}/stati/${a.slug}/index.html`, page({ file: `stati/${a.slug}/`, meta, content, extraLd: blocks.join('\n') }));
  built.push({ url: articleUrl(a.slug), priority: 0.7 });
}

/* ---------- старый адрес карточки: редирект на новую страницу ---------- */
writeFileSync(`${OUT}/proekt.html`, rebase(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Проекты каркасных домов — Каркас Комфорт</title>
  <meta name="robots" content="noindex, follow">
  <link rel="canonical" href="${SITE}/proekty/">
  <script>
    /* старые ссылки вида proekt.html?id=kd-40 ведут на статическую страницу проекта */
    var id = new URLSearchParams(location.search).get('id');
    location.replace(id ? '/proekty/' + id.replace(/[^a-z0-9-]/gi, '') + '/' : '/proekty/');
  </script>
  <meta http-equiv="refresh" content="0; url=/proekty/">
</head>
<body><p>Страница переехала: <a href="/proekty/">каталог проектов</a>.</p></body>
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
