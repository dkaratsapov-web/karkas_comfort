/* Проверка мобильной версии только тех страниц, которые затронули правки.
 *
 * Это инструмент для агента-ревьюера (.claude/agents/mobile-reviewer.md):
 * он собирает факты, а оценку и исправления даёт агент. Инструмент сам по
 * себе ничего не чинит и выкладку не блокирует — для этого есть verify.
 *
 * Что делает:
 *  1. Находит изменённые файлы: незакоммиченные правки, иначе последний
 *     коммит (или --since <ref>, или явно --pages / /proekty/ ...).
 *  2. Переводит файлы в адреса страниц. Страница из src/pages — сама она.
 *     Данные (projects.json и т. п.) — страницы, которые из них собираются.
 *     Общие стили, скрипты и куски разметки — страницы, где встречаются
 *     классы из изменённых строк.
 *  3. Открывает каждую страницу на 390 и 360 px как телефон и меряет то,
 *     что дизайнер проверяет глазами: кегли и интерлиньяж, длину строки,
 *     висячие слова в заголовках, поля по краям и ритм отступов, цели для
 *     пальца, поля форм (iOS увеличивает страницу при шрифте поля меньше
 *     16 px), перекрытие экрана липкими элементами, мутные и растянутые
 *     картинки, есть ли действие на первом экране.
 *  4. Сохраняет снимки экранов по одному на экран телефона и отчёт
 *     в .cache/mobile-review/<время>/ — report.md и report.json.
 *
 * Запуск: npm run review:mobile [-- --pages / /proekty/] [-- --since HEAD~3]
 * Нужен собранный dist/ (npm run build) и Playwright (PW_MODULE, PW_CHROME).
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = 'dist';
const WIDTHS = [390, 360];
const HEIGHT = 844;
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.slice(i + 1).filter((a, k, all) => !all.slice(0, k + 1).some((x) => x.startsWith('--'))) : null; };

/* ---------- 1–2. какие страницы проверять ---------- */
const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

function changedFiles() {
  const since = opt('--since');
  if (since && since[0]) return { range: `${since[0]}..HEAD + рабочие правки`, files: [...new Set((sh(`git diff --name-only ${since[0]}`) + sh('git diff --name-only HEAD')).split('\n').filter(Boolean))] };
  const dirty = sh('git diff --name-only HEAD').split('\n').filter(Boolean).concat(sh('git ls-files --others --exclude-standard').split('\n').filter(Boolean));
  const src = dirty.filter((f) => !f.startsWith('dist/'));
  if (src.length) return { range: 'незакоммиченные правки', files: src };
  return { range: 'последний коммит', files: sh('git diff --name-only HEAD~1 HEAD').split('\n').filter((f) => f && !f.startsWith('dist/')) };
}

function diffText(files) {
  const since = opt('--since');
  const base = since && since[0] ? since[0] : (sh('git diff --name-only HEAD').trim() ? 'HEAD' : 'HEAD~1');
  return files.map((f) => sh(`git diff ${base} -- "${f}"`)).join('\n');
}

const pageOf = (file) => {
  const name = file.replace(/^src\/pages\//, '').replace(/\.html$/, '');
  return name === 'index' ? '/' : `/${name}/`;
};

function distPages() {
  const out = [];
  const walk = (dir, url) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (['assets', 'api', 'admin'].includes(e.name)) continue;
        walk(join(dir, e.name), `${url}${e.name}/`);
      } else if (e.name === 'index.html') out.push(url);
    }
  };
  walk(ROOT, '/');
  return out;
}

function targets() {
  const explicit = opt('--pages');
  if (explicit && explicit.length) return { why: 'указаны вручную', pages: explicit };
  const { range, files } = changedFiles();
  const pages = new Set();
  const reasons = [];
  const data = {
    'src/data/projects.json': ['/proekty/', '/proekty/grishkino/'],
    'src/data/projects-archive.json': ['/proekty/'],
    'src/data/cases.json': ['/obekty/', '/obekty/obekt-1/'],
    'src/data/articles.json': ['/stati/', '/stati/kakoy-fundament-vybrat/'],
    'src/data/videos.json': ['/video/', '/'],
    'src/data/pricing.json': ['/'],
    'src/data/flight.json': ['/'],
    'src/data/geo.json': ['/'],
    'src/data/reviews.json': ['/'],
    'src/data/site.json': ['/', '/kontakty/'],
  };
  const shared = [];
  for (const f of files) {
    if (f.startsWith('src/pages/') && f.endsWith('.html')) { pages.add(pageOf(f)); reasons.push(`${f} → ${pageOf(f)}`); }
    else if (data[f]) { data[f].forEach((p) => pages.add(p)); reasons.push(`${f} → ${data[f].join(', ')}`); }
    else if (/^(assets\/(css|js)\/|src\/partials\/|src\/app\/|tools\/build\.mjs)/.test(f)) shared.push(f);
  }
  if (shared.length) {
    /* классы из изменённых строк — по ним находим страницы, где они стоят */
    const lines = diffText(shared).split('\n').filter((l) => /^[+-](?![+-])/.test(l));
    const classes = new Set();
    for (const l of lines) {
      for (const m of l.matchAll(/\.([a-z][a-z0-9]*(?:__|--)[a-z0-9-]+|[a-z][a-z0-9-]{3,})\b/g)) classes.add(m[1]);
      for (const m of l.matchAll(/class="([^"$]+)"/g)) m[1].split(/\s+/).forEach((c) => c && classes.add(c));
    }
    const noise = new Set(['container', 'section', 'btn', 'card', 'lead', 'eyebrow', 'muted', 'js', 'is-on', 'is-open', 'reveal', 'is-visible', 'prose', 'grid', 'split', 'field', 'form']);
    const useful = [...classes].filter((c) => !noise.has(c) && !/^(min|max|svg|png|jpg|html|body|root|hover|focus|after|before|com|ru)$/.test(c));
    const hits = new Map();
    for (const url of distPages()) {
      const file = url === '/' ? `${ROOT}/index.html` : `${ROOT}${url}index.html`;
      if (!existsSync(file)) continue;
      const html = readFileSync(file, 'utf8');
      const n = useful.filter((c) => html.includes(`"${c}"`) || html.includes(` ${c}"`) || html.includes(`"${c} `) || html.includes(` ${c} `)).length;
      if (n) hits.set(url, n);
    }
    /* общие правки задевают много страниц: берём те, где совпадений больше,
       и по одной странице каждого типа, чтобы не гонять все 69 */
    const byType = new Map();
    [...hits.entries()].sort((a, b) => b[1] - a[1]).forEach(([url, n]) => {
      const type = url === '/' ? '/' : url.split('/').slice(0, url.split('/').length > 3 ? 2 : 2).join('/') + (url.split('/').length > 3 ? '/*' : '');
      if (!byType.has(type)) byType.set(type, url);
    });
    const picked = [...byType.values()].slice(0, 5);
    picked.forEach((p) => pages.add(p));
    reasons.push(`общие файлы (${shared.join(', ')}) → по классам из правок: ${picked.join(', ') || 'совпадений нет'}`);
  }
  if (!pages.size) { pages.add('/'); reasons.push('страниц не нашлось — проверяется главная'); }
  return { why: `${range}: ${reasons.join('; ')}`, pages: [...pages] };
}

/* ---------- 3. замеры на странице ---------- */
const audit = () => {
  const W = innerWidth, H = innerHeight;
  const out = { typo: [], spacing: [], touch: [], forms: [], media: [], overlay: [], fold: {}, scale: {} };
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const where = (el) => {
    const parts = [];
    let e = el;
    for (let i = 0; e && i < 3 && e !== document.body; i++, e = e.parentElement) {
      parts.unshift(e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
    }
    return parts.join(' > ');
  };
  const text = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const y = (el) => Math.round(el.getBoundingClientRect().top + scrollY);

  /* типографика */
  const sizes = new Map();
  const blocks = [...document.querySelectorAll('main p, main li, main h1, main h2, main h3, main h4, main blockquote, main dd, main dt, main figcaption, main label, main .btn')].filter(vis);
  for (const el of blocks) {
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const lh = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight);
    const ratio = lh / fs;
    const t = text(el);
    if (!t) continue;
    sizes.set(Math.round(fs), (sizes.get(Math.round(fs)) || 0) + 1);
    const tag = el.tagName.toLowerCase();
    const heading = /^h[1-4]$/.test(tag);
    if (!heading && fs < 13 && t.length > 25) out.typo.push({ what: `мелкий текст ${fs}px`, where: where(el), y: y(el), text: t });
    if (!heading && t.length > 80 && ratio < 1.35) out.typo.push({ what: `тесный интерлиньяж ${ratio.toFixed(2)} при ${fs}px`, where: where(el), y: y(el), text: t });
    if (heading && ratio > 1.4) out.typo.push({ what: `рыхлый заголовок: интерлиньяж ${ratio.toFixed(2)}`, where: where(el), y: y(el), text: t });
    /* длина строки: ширина блока в знаках */
    if (!heading && t.length > 120) {
      const chars = el.getBoundingClientRect().width / (fs * 0.5);
      if (chars > 52) out.typo.push({ what: `длинная строка ≈${Math.round(chars)} знаков`, where: where(el), y: y(el), text: t });
    }
    /* висячее слово в заголовке */
    if (heading && t.length > 18) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((r) => r.width > 2);
      const lines = [];
      rects.forEach((r) => { const l = lines.find((x) => Math.abs(x.top - r.top) < fs * 0.5); if (l) { l.w += r.width; } else lines.push({ top: r.top, w: r.width }); });
      if (lines.length >= 2 && lines[lines.length - 1].w < lines[0].w * 0.22) out.typo.push({ what: 'висячее слово в последней строке заголовка', where: where(el), y: y(el), text: t });
    }
  }
  out.scale = Object.fromEntries([...sizes.entries()].sort((a, b) => a[0] - b[0]));
  if (sizes.size > 9) out.typo.push({ what: `много разных кеглей на странице: ${sizes.size} (${[...sizes.keys()].sort((a, b) => a - b).join(', ')} px)`, where: 'страница', y: 0, text: '' });

  /* поля по краям и выравнивание по левому краю */
  const lefts = new Map();
  for (const el of blocks) {
    const r = el.getBoundingClientRect();
    if (r.width > W - 4) continue;                       // во всю ширину — это фон
    if (getComputedStyle(el).textAlign === 'center') continue;
    if (el.closest('.swipe, .flight__inner, .gx, .cmp-wrap, .actionbar, .cookiebar')) continue;
    if (r.left < 12 && r.left >= 0) out.spacing.push({ what: `текст в ${Math.round(r.left)}px от края экрана`, where: where(el), y: y(el), text: text(el) });
    if (r.right > W - 12 && r.right <= W) out.spacing.push({ what: `текст в ${Math.round(W - r.right)}px от правого края`, where: where(el), y: y(el), text: text(el) });
    const k = Math.round(r.left);
    lefts.set(k, (lefts.get(k) || 0) + 1);
  }
  const main = [...lefts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  out.scale.lefts = Object.fromEntries(main);

  /* ритм: отступы между секциями */
  const secs = [...document.querySelectorAll('main > section, main > div > section')].filter(vis);
  const pads = secs.map((s) => ({ s, top: parseFloat(getComputedStyle(s).paddingTop), bottom: parseFloat(getComputedStyle(s).paddingBottom) }));
  out.scale.sectionPadding = pads.map((p) => `${Math.round(p.top)}/${Math.round(p.bottom)}`);
  for (let i = 1; i < secs.length; i++) {
    const gap = secs[i].getBoundingClientRect().top - secs[i - 1].getBoundingClientRect().bottom + pads[i].top + pads[i - 1].bottom;
    if (gap > 150) out.spacing.push({ what: `большой разрыв между блоками ≈${Math.round(gap)}px`, where: where(secs[i]), y: y(secs[i]), text: text(secs[i].querySelector('h2,h1') || secs[i]) });
  }
  /* слипшиеся соседи */
  for (const el of blocks) {
    const next = el.nextElementSibling;
    if (!next || !vis(next)) continue;
    const gap = next.getBoundingClientRect().top - el.getBoundingClientRect().bottom;
    if (/^H[1-4]$/.test(el.tagName) && gap < 4 && gap > -2 && text(next).length > 20) out.spacing.push({ what: `заголовок вплотную к тексту (${Math.round(gap)}px)`, where: where(el), y: y(el), text: text(el) });
  }

  /* цели для пальца */
  const taps = [...document.querySelectorAll('main a, main button, main [role="button"], main input[type="checkbox"], main summary, header a, header button, .actionbar a, .actionbar button')].filter(vis);
  const rects = taps.map((el) => ({ el, r: el.getBoundingClientRect() }));
  for (const { el, r } of rects) {
    if (el.closest('.prose p, .prose li, .post__lead, .crumbs')) continue;   // ссылки внутри текста
    if (r.height < 40 || r.width < 40) out.touch.push({ what: `маленькая цель ${Math.round(r.width)}×${Math.round(r.height)}px`, where: where(el), y: y(el), text: text(el) || el.getAttribute('aria-label') || '' });
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r, b = rects[j].r;
      if (rects[i].el.contains(rects[j].el) || rects[j].el.contains(rects[i].el)) continue;
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const gapX = Math.max(b.left - a.right, a.left - b.right);
      const gapY = Math.max(b.top - a.bottom, a.top - b.bottom);
      if ((overlapY > 10 && gapX >= 0 && gapX < 6) || (overlapX > 10 && gapY >= 0 && gapY < 6)) {
        out.touch.push({ what: `цели почти вплотную (${Math.round(Math.max(gapX, gapY))}px)`, where: `${where(rects[i].el)} | ${where(rects[j].el)}`, y: y(rects[i].el), text: `${text(rects[i].el)} / ${text(rects[j].el)}` });
      }
    }
  }

  /* формы */
  for (const el of [...document.querySelectorAll('main input:not([type=hidden]):not([type=checkbox]), main textarea, main select')].filter((e) => vis(e) && !e.closest('.sr-only'))) {   // ловушка для ботов спрятана намеренно
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const h = el.getBoundingClientRect().height;
    if (fs < 16) out.forms.push({ what: `шрифт поля ${fs}px — iOS увеличит страницу при вводе`, where: where(el), y: y(el), text: el.placeholder || el.name });
    if (h < 44) out.forms.push({ what: `поле низкое: ${Math.round(h)}px`, where: where(el), y: y(el), text: el.placeholder || el.name });
    if (!el.labels || !el.labels.length) { if (!el.getAttribute('aria-label')) out.forms.push({ what: 'у поля нет подписи', where: where(el), y: y(el), text: el.placeholder || el.name }); }
  }

  /* картинки */
  for (const img of [...document.querySelectorAll('main img')].filter(vis)) {
    if (!img.complete || !img.naturalWidth) continue;
    const r = img.getBoundingClientRect();
    const fit = getComputedStyle(img).objectFit;
    if (img.naturalWidth < r.width * 1.5 && r.width > 120 && !/\.svg/.test(img.currentSrc)) out.media.push({ what: `картинка мутная на экране с ретиной: ${img.naturalWidth}px на ${Math.round(r.width)}px`, where: where(img), y: y(img), text: img.currentSrc.split('/').pop() });
    if (fit === 'fill' || fit === '') {
      const nat = img.naturalWidth / img.naturalHeight, shown = r.width / r.height;
      if (Math.abs(nat - shown) / nat > 0.04) out.media.push({ what: `картинка растянута: ${nat.toFixed(2)} → ${shown.toFixed(2)}`, where: where(img), y: y(img), text: img.currentSrc.split('/').pop() });
    }
  }

  /* липкие и плавающие элементы: сколько экрана они закрывают */
  let fixedArea = 0;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if ((cs.position === 'fixed' || cs.position === 'sticky') && vis(el)) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > H) continue;
      if (cs.pointerEvents === 'none' && !el.children.length) continue;
      const area = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
      if (area > 2000) { fixedArea += area; out.overlay.push({ what: `${cs.position}: ${Math.round(r.width)}×${Math.round(r.height)}px`, where: where(el), y: Math.round(r.top), text: text(el).slice(0, 40) }); }
    }
  }
  out.fold.fixedShare = Math.round((fixedArea / (W * H)) * 100);

  /* первый экран: есть ли действие и что видно */
  const firstCta = [...document.querySelectorAll('main a.btn, main button.btn, main button[type=submit], main input[type=tel]')].filter(vis).find((el) => el.getBoundingClientRect().top < H && el.getBoundingClientRect().bottom > 0);
  out.fold.cta = firstCta ? `${text(firstCta) || firstCta.placeholder} (${Math.round(firstCta.getBoundingClientRect().top)}px)` : '';
  const h1 = document.querySelector('h1');
  out.fold.h1 = h1 ? { text: text(h1), top: Math.round(h1.getBoundingClientRect().top), size: parseFloat(getComputedStyle(h1).fontSize) } : null;
  out.fold.pageHeight = document.documentElement.scrollHeight;
  out.fold.screens = Math.round((document.documentElement.scrollHeight / H) * 10) / 10;
  out.fold.overflowX = document.documentElement.scrollWidth > W + 1 ? document.documentElement.scrollWidth - W : 0;
  return out;
};

/* ---------- запуск ---------- */
const { why, pages } = targets();
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.mp4': 'video/mp4', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = createServer((q, r) => {
  if (q.url.includes('.php')) { r.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'); return; }
  let f = join(ROOT, normalize(decodeURIComponent(q.url.split('?')[0])).replace(/^(\.\.[/\\])+/, ''));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { r.writeHead(404).end(); return; }
  r.writeHead(200, { 'Content-Type': T[extname(f)] || 'application/octet-stream' });
  r.end(readFileSync(f));
});
const port = await new Promise((x) => server.listen(0, '127.0.0.1', () => x(server.address().port)));
const { chromium } = await import(process.env.PW_MODULE || 'playwright');
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const OUT = `.cache/mobile-review/${stamp}`;
mkdirSync(OUT, { recursive: true });
const report = { why, pages: [] };

for (const url of pages) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: HEIGHT }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await page.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      return (host === '127.0.0.1' || host === 'localhost') ? route.continue() : route.abort();
    });
    await page.addInitScript(() => { try { localStorage.setItem('kk-cookie', 'necessary'); } catch (e) { /* без хранилища */ } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const res = await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: 'networkidle' }).catch((e) => ({ status: () => String(e).slice(0, 80) }));
    if (!res || (typeof res.status() === 'number' && res.status() >= 400)) { report.pages.push({ url, width, error: `страница не открылась: ${res && res.status()}` }); await page.close(); continue; }
    await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
    await page.evaluate(async () => {
      document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; });
      for (let yy = 0; yy < document.documentElement.scrollHeight; yy += 600) { scrollTo(0, yy); await new Promise((r) => setTimeout(r, 40)); }
      document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-visible'));
      document.querySelectorAll('[data-reveal]').forEach((e) => e.classList.add('is-in'));
      scrollTo(0, 0);
    });
    await page.waitForTimeout(600);
    const facts = await page.evaluate(audit);
    const slug = (url.replace(/\//g, '_').replace(/^_|_$/g, '') || 'index') + `-${width}`;
    /* снимки по экранам: агент смотрит их по очереди, как человек листает */
    const shots = [];
    if (width === 390) {
      const total = Math.min(facts.fold.pageHeight, HEIGHT * 14);
      for (let k = 0, top = 0; top < total; k++, top += HEIGHT) {
        await page.evaluate((t) => scrollTo(0, t), top);
        await page.waitForTimeout(150);
        const file = `${OUT}/${slug}-${String(k + 1).padStart(2, '0')}.png`;
        await page.screenshot({ path: file });
        shots.push(file);
      }
    }
    report.pages.push({ url, width, facts, shots, errors });
    await page.close();
  }
}
await browser.close();
server.close();

/* ---------- 4. отчёт ---------- */
const md = [];
md.push(`# Мобильная проверка — ${stamp}`, '', `Что проверяется: ${why}`, '');
for (const p of report.pages) {
  md.push(`## ${p.url} — ${p.width}px`);
  if (p.error) { md.push(p.error, ''); continue; }
  const f = p.facts;
  md.push(`Экранов: ${f.fold.screens}. Первое действие на первом экране: ${f.fold.cta || '**нет**'}. H1: ${f.fold.h1 ? `«${f.fold.h1.text}» ${f.fold.h1.size}px на ${f.fold.h1.top}px` : 'нет'}. Липкие элементы закрывают ${f.fold.fixedShare}% экрана.${f.fold.overflowX ? ` **Страница шире экрана на ${f.fold.overflowX}px.**` : ''}`);
  md.push(`Кегли (px: сколько блоков): ${Object.entries(f.scale).filter(([k]) => /^\d+$/.test(k)).map(([k, v]) => `${k}:${v}`).join(' ')}. Левые края текста: ${Object.entries(f.scale.lefts || {}).map(([k, v]) => `${k}px×${v}`).join(', ')}. Отступы секций (верх/низ): ${(f.scale.sectionPadding || []).join(' ')}.`);
  const group = (title, list) => {
    if (!list.length) return;
    md.push('', `**${title}** (${list.length})`);
    const seen = new Set();
    list.filter((x) => { const k = x.what.replace(/\d+/g, '#') + x.where; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 14).forEach((x) => md.push(`- ${x.what} — \`${x.where}\` на ${x.y}px${x.text ? ` «${x.text}»` : ''}`));
  };
  group('Типографика', f.typo);
  group('Отступы и края', f.spacing);
  group('Цели для пальца', f.touch);
  group('Формы', f.forms);
  group('Картинки', f.media);
  group('Липкие элементы', f.overlay);
  if (p.errors.length) group('Ошибки JS', p.errors.map((e) => ({ what: e, where: '-', y: 0 })));
  if (p.shots.length) md.push('', `Снимки: ${p.shots.join(' ')}`);
  md.push('');
}
writeFileSync(`${OUT}/report.md`, md.join('\n'));
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`мобильная проверка: ${report.pages.length / WIDTHS.length} стр. — ${why}`);
console.log(`отчёт: ${OUT}/report.md`);
