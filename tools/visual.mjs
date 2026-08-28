/* Визуальная проверка собранного сайта: ловит то, что не видно в разметке,
   но видно глазом - наложение текста, вылет за контейнер, обрезанные
   подписи, горизонтальную прокрутку и нечитаемый контраст.
   Запуск: node tools/visual.mjs (нужен поднятый сервер, BASE=...).
   Путь к playwright и браузеру - через PW_MODULE и PW_CHROME. */
const mod = await import(process.env.PW_MODULE || 'playwright');
const chromium = mod.chromium || mod.default?.chromium;
const { readdirSync, readFileSync } = await import('node:fs');

const B = process.env.BASE || 'http://127.0.0.1:8080';
const WIDTHS = [390, 768, 1024, 1440, 1728];
/* шапка и подвал одинаковые везде, поэтому их проверяем чаще, но на одной странице */
const SWEEP = [1000, 1120, 1200, 1260, 1320, 1400, 1480, 1560, 1620, 1700, 1800, 1920, 2100, 2400];

/* адреса берём из собранной карты сайта, чтобы не забыть новую страницу */
const sitemap = readFileSync('dist/sitemap.xml', 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
const pages = [...new Set(urls.length ? urls : ['/'])];

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const problems = [];

/* Скрипт выполняется в браузере: возвращает список найденных дефектов. */
const audit = () => {
  const out = [];
  const seen = new Set();
  const add = (kind, node, detail) => {
    const path = (el) => {
      const parts = [];
      for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
        parts.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string'
          ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
      }
      return parts.join(' > ');
    };
    const key = `${kind}|${path(node)}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, where: path(node), detail });
  };

  const visible = (el) => {
    /* содержимое свёрнутого details браузер держит в раскладке, но не рисует */
    const det = el.closest('details:not([open])');
    if (det && !el.closest('summary')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  /* элементы с собственным текстом (без вложенных блоков) */
  const leaves = [...document.querySelectorAll('main *, footer *, header *')].filter((el) => {
    if (!visible(el)) return false;
    if (el.closest('[hidden], .modal, .mobile-nav')) return false;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    return own;
  });

  /* 1. наложение текста на текст */
  for (let i = 0; i < leaves.length; i += 1) {
    const a = leaves[i].getBoundingClientRect();
    for (let j = i + 1; j < leaves.length; j += 1) {
      const b = leaves[j].getBoundingClientRect();
      if (leaves[i].contains(leaves[j]) || leaves[j].contains(leaves[i])) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w <= 2 || h <= 2) continue;
      const overlap = w * h;
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      /* абсолютно спозиционированные подписи поверх фото - это нормально */
      const csA = getComputedStyle(leaves[i]);
      const csB = getComputedStyle(leaves[j]);
      if (['absolute', 'fixed'].includes(csA.position) || ['absolute', 'fixed'].includes(csB.position)) continue;
      /* строчные элементы (ссылка внутри абзаца) занимают прямоугольник в несколько
         строк и «пересекаются» с соседями — это не дефект вёрстки */
      if (csA.display === 'inline' || csB.display === 'inline') continue;
      if (overlap / smaller > 0.12) {
        add('наложение текста', leaves[i], `с «${leaves[j].textContent.trim().slice(0, 32)}», ${Math.round(overlap / smaller * 100)}%`);
      }
    }
  }

  /* 2. текст обрезан своим же контейнером */
  for (const el of leaves) {
    const cs = getComputedStyle(el);
    if (cs.overflow === 'hidden' || cs.overflowX === 'hidden') {
      if (el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && cs.whiteSpace !== 'nowrap') {
        add('текст обрезан', el, `${el.scrollWidth} > ${el.clientWidth}px`);
      }
    }
  }

  /* 2b. текст шире своей ячейки: рисуется поверх соседа, рамка этого не видит */
  for (const el of leaves) {
    const cs = getComputedStyle(el);
    if (cs.position === 'absolute' || cs.position === 'fixed') continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.whiteSpace !== 'nowrap') {
      add('текст шире ячейки', el, `${el.scrollWidth} > ${el.clientWidth}px: «${el.textContent.trim().slice(0, 28)}»`);
    }
  }

  /* 2в. содержимое не влезает в блок: так кнопка вылезала из капсулы шапки */
  for (const el of document.querySelectorAll('header *, main *, footer *')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'visible' || cs.display === 'inline') continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 40 && el.children.length) {
      add('содержимое не влезает в блок', el, `${el.scrollWidth} > ${el.clientWidth}px`);
    }
  }

  /* 3. блок вылезает за свой контейнер по горизонтали */
  for (const el of document.querySelectorAll('main .container > *, footer .container > *')) {
    if (!visible(el)) continue;
    const p = el.parentElement.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.right > p.right + 2 || r.left < p.left - 2) {
      add('вылет за контейнер', el, `${Math.round(r.left)}..${Math.round(r.right)} против ${Math.round(p.left)}..${Math.round(p.right)}`);
    }
  }

  /* 4. мелкие цели проверяем только на телефоне: там палец, а не курсор */
  if (innerWidth <= 480) {
    for (const el of document.querySelectorAll('main a.btn, main button, .actionbar a, .mobile-nav a, header .im, header .burger')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 40 || r.width < 40) add('мелкая цель', el, `${Math.round(r.width)}×${Math.round(r.height)}px`);
    }
  }

  /* 5. горизонтальная прокрутка страницы */
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) {
    const wide = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > de.clientWidth + 1 && r.width > 0 && visible(el);
    }).slice(0, 3);
    wide.forEach((el) => add('горизонтальная прокрутка', el, `правый край ${Math.round(el.getBoundingClientRect().right)} при ширине ${de.clientWidth}`));
    if (!wide.length) out.push({ kind: 'горизонтальная прокрутка', where: 'документ', detail: `${de.scrollWidth} > ${de.clientWidth}` });
  }

  /* 6. картинки не загрузились */
  for (const img of document.images) {
    if (!img.complete || img.naturalWidth === 0) add('картинка не загрузилась', img, img.getAttribute('src') || '');
  }

  return out;
};

for (const url of pages) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    try {
      await page.goto(`${B}${url}`, { waitUntil: 'networkidle', timeout: 30000 });
      /* прокручиваем, чтобы отработали появления блоков и ленивые картинки */
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo({ top: y, behavior: 'instant' });
          await new Promise((r) => setTimeout(r, 40));
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
      await page.waitForTimeout(500);
      const found = await page.evaluate(audit);
      found.forEach((f) => problems.push({ url, width, ...f }));
      errs.forEach((e) => problems.push({ url, width, kind: 'ошибка JS', where: '-', detail: e }));
    } catch (e) {
      problems.push({ url, width, kind: 'страница не открылась', where: '-', detail: String(e).slice(0, 120) });
    }
    await page.close();
  }
}
/* частая сетка ширин на главной: ловим переполнение шапки между брейкпоинтами */
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  await page.goto(`${B}/`, { waitUntil: 'networkidle', timeout: 30000 });
  for (const width of SWEEP) {
    await page.setViewportSize({ width, height: 700 });
    await page.waitForTimeout(90);
    const found = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('header *, .actionbar *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.overflowX !== 'visible' || cs.display === 'inline') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 40) continue;
        if (el.scrollWidth > el.clientWidth + 1 && el.children.length) {
          out.push({ where: el.className || el.tagName, detail: `${el.scrollWidth} > ${el.clientWidth}px` });
        }
      }
      return out;
    });
    found.forEach((f) => problems.push({ url: '/ (шапка)', width, kind: 'содержимое не влезает в блок', ...f }));
  }
  await page.close();
}

await browser.close();

if (!problems.length) {
  console.log(`Визуальных дефектов нет: ${pages.length} страниц × ${WIDTHS.length} ширин, шапка ещё на ${SWEEP.length} ширинах`);
} else {
  const byPage = new Map();
  problems.forEach((p) => {
    const k = `${p.url} @ ${p.width}px`;
    if (!byPage.has(k)) byPage.set(k, []);
    byPage.get(k).push(p);
  });
  for (const [k, list] of byPage) {
    console.log(`\n${k}`);
    list.forEach((p) => console.log(`  ✗ ${p.kind}: ${p.where} — ${p.detail}`));
  }
  console.log(`\nВсего дефектов: ${problems.length} на ${byPage.size} экранах`);
  process.exitCode = 1;
}
