/* Факты для агента-маркетолога (.claude/agents/marketing-reviewer.md).
 *
 * Инструмент собирает то, что маркетолог проверяет глазами, а оценку
 * и предложения даёт агент. Сам ничего не меняет и выкладку не блокирует.
 *
 * Что делает для каждой страницы, на компьютере (1440×900) и телефоне
 * (390×844):
 *  - снимает экраны сверху вниз (до 12 экранов на страницу);
 *  - первый экран: заголовок, подзаголовок, видимые кнопки и формы,
 *    есть ли цена, срок, гарантия, телефон, мессенджер, фото объекта;
 *  - «скелет» страницы: h1–h3 по порядку, все призывы (кнопки и
 *    ссылки-действия) с текстом и адресом, формы с полями, цены,
 *    сигналы доверия (гарантия, договор, ИНН, адрес, фото со сдачи,
 *    видео, отзывы, документы);
 *  - глубину: на каком экране первый призыв, первая форма, первая цена;
 *    сколько экранов до подвала;
 *  - мета: title, description, длина страницы.
 *  Пишет .cache/marketing-review/<время>/report.md, report.json и снимки.
 *
 * Запуск: npm run review:marketing [-- --pages / /proekty/]
 * Без --pages — ключевые страницы воронки. Нужен собранный dist/
 * и Playwright (PW_MODULE, PW_CHROME).
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = 'dist';
const args = process.argv.slice(2);
const i = args.indexOf('--pages');
const DEFAULT = ['/', '/proekty/', '/proekty/burashevo/', '/obekty/', '/obekty/obekt-5/', '/uslugi/', '/o-kompanii/', '/kontakty/', '/video/', '/stati/'];
const pages = i >= 0 ? args.slice(i + 1).filter((a) => !a.startsWith('--')) : DEFAULT;
const VIEWS = [{ tag: 'desktop', width: 1440, height: 900, mobile: false }, { tag: 'mobile', width: 390, height: 844, mobile: true }];
const MAX_SCREENS = 12;

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp4': 'video/mp4' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let f = join(ROOT, normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const B = `http://127.0.0.1:${port}`;

const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
const OUT = `.cache/marketing-review/${stamp}`;
mkdirSync(OUT, { recursive: true });

const { chromium } = await import(process.env.PW_MODULE || 'playwright');
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});

/* что собираем на странице — выполняется в браузере */
function collect() {
  const H = innerHeight;
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const top = (e) => e.getBoundingClientRect().top + scrollY;
  const screen = (e) => Math.floor(top(e) / H) + 1;
  const txt = (e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim();
  const trap = (e) => e.closest('.sr-only, [aria-hidden="true"]');

  const heads = [...document.querySelectorAll('h1, h2, h3')].filter((e) => vis(e) && !trap(e)).map((e) => ({ tag: e.tagName.toLowerCase(), text: txt(e).slice(0, 140), screen: screen(e) }));
  const ACT = /рассчит|получ|оставит|заявк|позвон|звонок|написать|max|telegram|телеграм|вконтакт|whatsapp|записат|консульт|смет|выезд|отправ|узнать|подобрать|скачать|смотреть|все |подробн|перейти|выбрать/i;
  const ctas = [...document.querySelectorAll('a, button')].filter((e) => vis(e) && !trap(e) && !e.closest('nav.nav, .mobile-nav, footer, .breadcrumbs, .crumbs'))
    .map((e) => ({ text: txt(e).slice(0, 80), href: e.getAttribute('href') || (e.type === 'submit' ? '[submit]' : '[button]'), screen: screen(e), primary: /btn(?!--ghost)|calcdock|actionbar/.test(e.className) }))
    .filter((c) => c.text && (ACT.test(c.text) || /^tel:|max\.ru|t\.me|vk\.com/.test(c.href)));
  const forms = [...document.querySelectorAll('form')].filter((f) => vis(f) && !trap(f)).map((f) => ({
    screen: screen(f),
    fields: [...f.querySelectorAll('input, select, textarea')].filter((x) => x.type !== 'hidden' && !x.closest('.sr-only') && vis(x)).map((x) => x.getAttribute('placeholder') || x.name || x.type),
    submit: txt(f.querySelector('[type=submit]') || f).slice(0, 60),
    consent: /согласи/i.test(txt(f)),
  }));
  const body = txt(document.body);
  const prices = [...new Set((body.match(/(?:от\s)?\d[\d\s]{2,}\s?₽(?:\s?(?:за|\/)\s?м²)?/g) || []).map((s) => s.replace(/\s+/g, ' ')))].slice(0, 20);
  const firstPrice = [...document.querySelectorAll('body *')].find((e) => e.children.length === 0 && /\d[\d\s]{2,}\s?₽/.test(e.textContent || '') && vis(e));
  const TRUST = { 'гарантия': /гаранти/i, 'договор': /договор/i, 'фиксированная смета': /фиксирован|смета не раст/i, 'ИНН/ОГРН': /ИНН|ОГРН/, 'адрес офиса': /Серебрян|офис/i, 'фото со сдачи/объекты': /со сдачи|построен|объект/i, 'видео': /видео|ролик/i, 'отзывы': /отзыв/i, 'ипотека/маткапитал': /ипотек|материнск/i, 'сроки': /месяц|мес\./i, 'лет на рынке': /с 20\d\d|лет на рынке|\d+ лет/i, 'количество домов': /\d+\+?\s*(?:домов|объектов)/i };
  const trust = Object.fromEntries(Object.entries(TRUST).map(([k, re]) => [k, re.test(body)]));
  const fold = {
    h1: txt(document.querySelector('h1') || document.body).slice(0, 140),
    lead: txt(document.querySelector('.hero__lead, .lead') || document.createElement('p')).slice(0, 200),
    ctas: ctas.filter((c) => c.screen === 1).map((c) => c.text),
    form: forms.some((f) => f.screen === 1),
    price: firstPrice ? screen(firstPrice) === 1 : false,
    phone: [...document.querySelectorAll('a[href^="tel:"]')].some((a) => vis(a) && a.getBoundingClientRect().top < H),
    messenger: [...document.querySelectorAll('a[href*="max.ru"], a[href*="t.me"], a[href*="vk.com"]')].some((a) => vis(a) && a.getBoundingClientRect().top < H),
    photo: [...document.images].some((im) => vis(im) && im.getBoundingClientRect().top < H && im.getBoundingClientRect().width > innerWidth * 0.3),
  };
  return {
    title: document.title, description: (document.querySelector('meta[name=description]') || {}).content || '',
    screens: Math.ceil(document.documentElement.scrollHeight / H),
    firstCta: ctas.length ? Math.min(...ctas.map((c) => c.screen)) : null,
    firstForm: forms.length ? Math.min(...forms.map((f) => f.screen)) : null,
    firstPrice: firstPrice ? screen(firstPrice) : null,
    fold, heads, ctas, forms, prices, trust,
  };
}

const report = [];
for (const url of pages) {
  const entry = { url };
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.mobile, hasTouch: v.mobile, reducedMotion: 'reduce' });
    await ctx.addInitScript(() => { try { localStorage.setItem('kk-cookie', 'necessary'); } catch {} });
    const page = await ctx.newPage();
    try {
      await page.goto(B + url, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) { entry[v.tag] = { error: String(e).slice(0, 120) }; await ctx.close(); continue; }
    await page.evaluate(async () => {
      document.querySelectorAll('img[loading="lazy"]').forEach((im) => { im.loading = 'eager'; });
      for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
      scrollTo(0, 0);
      document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-visible'));
    });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(400);
    const facts = await page.evaluate(collect);
    const slug = (url === '/' ? 'glavnaya' : url.replace(/^\/|\/$/g, '').replace(/\//g, '_'));
    facts.shots = [];
    for (let k = 0; k < Math.min(facts.screens, MAX_SCREENS); k++) {
      await page.evaluate((y) => scrollTo(0, y), k * v.height);
      await page.waitForTimeout(250);
      const file = `${OUT}/${slug}-${v.tag}-${String(k + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: file });
      facts.shots.push(file);
    }
    entry[v.tag] = facts;
    await ctx.close();
  }
  report.push(entry);
  console.log('снято', url);
}
await browser.close();
server.close();

/* отчёт */
const yes = (b) => (b ? 'да' : '**нет**');
const md = [`# Маркетинговый срез сайта — ${stamp}`, '', `Страниц: ${report.length}. Снимки и report.json — в ${OUT}/.`, ''];
for (const e of report) {
  md.push(`## ${e.url}`, '');
  for (const v of VIEWS) {
    const f = e[v.tag];
    if (!f || f.error) { md.push(`### ${v.tag}: не открылась ${f ? f.error : ''}`, ''); continue; }
    md.push(`### ${v.tag === 'desktop' ? 'Компьютер 1440' : 'Телефон 390'}`, '');
    md.push(`- title: ${f.title}`, `- description: ${f.description}`);
    md.push(`- длина: ${f.screens} экр.; первый призыв — экран ${f.firstCta ?? '—'}, первая форма — ${f.firstForm ?? '—'}, первая цена — ${f.firstPrice ?? '—'}`);
    md.push(`- первый экран: h1 «${f.fold.h1}»; подзаголовок «${f.fold.lead}»; кнопки: ${f.fold.ctas.join(' | ') || '—'}; форма ${yes(f.fold.form)}, цена ${yes(f.fold.price)}, телефон ${yes(f.fold.phone)}, мессенджер ${yes(f.fold.messenger)}, крупное фото ${yes(f.fold.photo)}`);
    md.push(`- доверие: ${Object.entries(f.trust).map(([k, b]) => `${k} ${b ? '✓' : '✗'}`).join(', ')}`);
    md.push(`- цены: ${f.prices.join('; ') || '—'}`);
    md.push(`- формы: ${f.forms.map((x) => `экр. ${x.screen}: [${x.fields.join(', ')}] → «${x.submit}»${x.consent ? '' : ' (без согласия!)'}`).join('; ') || '—'}`);
    md.push('- скелет:');
    for (const h of f.heads) md.push(`  - ${'  '.repeat(+h.tag[1] - 1)}${h.tag} (экр. ${h.screen}) ${h.text}`);
    md.push(`- призывы (${f.ctas.length}): ${f.ctas.map((c) => `«${c.text}» э${c.screen}`).join(', ')}`);
    md.push(`- снимки: ${f.shots.join(' ')}`, '');
  }
}
writeFileSync(`${OUT}/report.md`, md.join('\n'));
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(`\nОтчёт: ${OUT}/report.md`);
