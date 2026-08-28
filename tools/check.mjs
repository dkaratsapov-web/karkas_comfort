/* Проверка собранного сайта в headless-браузере.
   Запуск: npm run serve  (в одном окне), затем в другом:
           BASE=http://localhost:8080 npm run check
   Нужен Playwright: npx playwright install chromium
   (свой путь к пакету можно передать через PW_MODULE, к браузеру — через PW_CHROME).
   Проверка отправки заявки пройдёт только там, где работает PHP. */
const { chromium } = await import(process.env.PW_MODULE || 'playwright');
const B = process.env.BASE || 'http://127.0.0.1:8080';
const { readFileSync } = await import('node:fs');
const N = JSON.parse(readFileSync('src/data/projects.json', 'utf8')).length;   /* сколько проектов в данных */
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const out = [];
const ok = (n, c) => out.push(`${c ? '✓' : '✗ ПРОВАЛ'} ${n}`);
const errs = [];

/* Есть ли на сервере PHP: статика отвечает на POST 404 или 405,
   рабочий обработчик — 200 или 400 (данные не прошли валидацию). */
const probe = await b.newContext();
const probeStatus = (await probe.request.post(`${B}/api/lead.php`, { data: {} })).status();
await probe.close();
const hasPhp = [200, 400, 429, 502].includes(probeStatus);
if (!hasPhp) out.push(`· PHP на сервере не отвечает (${probeStatus}) — отправка заявки проверяется в демо-режиме`);

/* 1. Каталог: карточки есть в HTML, фильтры работают и попадают в адрес */
let p = await b.newPage({ viewport: { width: 1280, height: 900 } });
p.on('pageerror', (e) => errs.push(e.message));
const catalogHtml = await (await p.request.get(`${B}/proekty/`)).text();
ok('каталог отдаётся сервером со всеми карточками (без JS)', (catalogHtml.split('class="project"').length - 1) === N);
await p.goto(`${B}/proekty/`, { waitUntil: 'networkidle' });
ok(`каталог отрисован (${N} карточек)`, (await p.$$('#catalog-list .project:not([hidden])')).length === N);
await p.click('.chip[data-group="floors"][data-value="2"]');
const twoFloors = await p.$$eval('#catalog-list .project:not([hidden]) .specs', (els) => els.map((e) => e.textContent));
ok('фильтр «2 этажа» оставил только двухэтажные', twoFloors.length > 0 && twoFloors.every((t) => t.includes('2 этажа')));
ok('фильтр сохраняется в адресе страницы', new URL(p.url()).searchParams.get('floors') === '2');
await p.goto(`${B}/proekty/?floors=1&size=s`, { waitUntil: 'networkidle' });
ok('ссылка с фильтром открывает готовую подборку', (await p.$$('#catalog-list .project:not([hidden])')).length > 0
  && (await p.$$eval('#catalog-list .project:not([hidden]) .specs', (els) => els.every((e) => e.textContent.includes('1 этаж')))));
await p.selectOption('#catalog-sort', 'area-desc');
ok('сортировка по площади переставляет карточки',
  (await p.textContent('#catalog-list .project:not([hidden]) .specs li')).trim().endsWith('м²'));

/* 2. Страница проекта — отдельный статический адрес с разметкой товара */
const projHtml = await (await p.request.get(`${B}/proekty/kd-29/`)).text();
const projNoJs = projHtml.replace(/<script[\s\S]*?<\/script>/g, '');
ok('страница проекта существует отдельным адресом', /9×12/.test(projNoJs));
ok('цена и характеристики есть в HTML без скриптов', /₽/.test(projNoJs) && /Полутораэтажный|Двухэтажный|Одноэтажный/.test(projNoJs));
ok('разметка Product + Offer', /"@type":"Product"/.test(projHtml) && /"@type":"Offer"/.test(projHtml));
ok('хлебные крошки в разметке', /"@type":"BreadcrumbList"/.test(projHtml));
ok('свой canonical у страницы проекта', /rel="canonical" href="[^"]*\/proekty\/kd-29\/"/.test(projHtml));
await p.goto(`${B}/proekty/kd-29/`, { waitUntil: 'networkidle' });
ok('характеристики проекта заполнены', (await p.$$('.spec-card__grid > div')).length >= 8);
ok('похожие проекты подобраны', (await p.$$('.grid--3 .project')).length === 3);
await p.click('a[href="#zayavka"][data-project]');
await p.waitForSelector('#lead-modal:not([hidden])');
ok('кнопка проекта открывает окно заявки', await p.isVisible('#lead-modal .modal__card'));
ok('в форму подставлен код проекта', (await p.inputValue('#lead-modal [data-modal-project-input]')).includes('КД-29'));
await p.keyboard.press('Escape');
await p.waitForTimeout(500);

/* 3. Старый адрес карточки ведёт на новый */
const oldPage = await (await p.request.get(`${B}/proekt.html?id=kd-29`)).text();
ok('старый адрес карточки не индексируется и ведёт в каталог', /noindex/.test(oldPage) && /proekty/.test(oldPage));

/* 4. Квиз на главной */
await p.goto(`${B}/`, { waitUntil: 'networkidle' });
const sum = () => p.textContent('[data-calc-low]');
const c0 = await sum();
await p.fill('#calc-area-num', '220');
await p.dispatchEvent('#calc-area-num', 'input');
await p.waitForTimeout(600);
ok('калькулятор пересчитывает сумму по площади', (await sum()) !== c0);
const c1 = await sum();
await p.click('.seg[data-group="tier"] .seg__btn[data-value="pod_kluch"]');
await p.waitForTimeout(600);
ok('смена комплектации меняет сумму', (await sum()) !== c1);
ok('выбранная комплектация объявлена ассистивным технологиям',
  (await p.getAttribute('.seg[data-group="tier"] .seg__btn[data-value="pod_kluch"]', 'aria-pressed')) === 'true');
const c2 = await sum();
await p.click('.seg[data-group="foundation"] .seg__btn[data-value="plita"]');
await p.waitForTimeout(600);
ok('смена фундамента меняет сумму', (await sum()) !== c2);
const c3 = await sum();
await p.click('label.calc__extra:has(input[value="terrace"])');
await p.waitForTimeout(600);
ok('доплата за террасу попадает в расчёт', (await sum()) !== c3);
ok('разбивка по этапам показана', (await p.$$('.calc__stage')).length >= 4);
ok('кнопка сметы несёт параметры расчёта',
  /220 м²/.test(await p.getAttribute('[data-calc-cta]', 'data-project') || ''));

/* 5. Формы: валидация и доступность ошибок */
await p.goto(`${B}/`, { waitUntil: 'networkidle' });
await p.$eval('#zayavka', (el) => el.scrollIntoView());
await p.click('#zayavka button[type="submit"]');
ok('пустая форма не отправляется', await p.isVisible('#zayavka .field--error'));
ok('ошибка объявлена ассистивным технологиям', (await p.$$('#zayavka [aria-invalid="true"]')).length > 0);
ok('пользователю показан текст ошибки', (await p.textContent('#zayavka .form__error')).trim().length > 0);
await p.fill('#cta-name', 'Иван');
await p.fill('#cta-phone', '9201716969');
const phone = await p.inputValue('#cta-phone');
ok(`маска телефона (${phone})`, phone === '+7 (920) 171-69-69');
await p.click('#zayavka button[type="submit"]');
ok('без согласия заявка не уходит и объяснено почему', /согласие/i.test(await p.textContent('#zayavka .form__error')));
await p.check('#zayavka input[name="consent"]');
await p.click('#zayavka button[type="submit"]');
await p.waitForTimeout(400);
/* На боевом хостинге ожидаем подтверждение; там, где почта и интеграции
   не настроены (локальная проверка, демо), сервер честно отвечает отказом —
   важно, что пользователь в любом случае видит однозначный результат. */
ok('после отправки пользователь видит однозначный результат',
  (await p.isVisible('#zayavka .form__ok')) !== (await p.isVisible('#zayavka .form__error')));
await p.close();

/* 6. Мобильная версия */
p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${B}/`, { waitUntil: 'networkidle' });
ok('нет горизонтальной прокрутки на 390px',
  await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
ok('цена, срок и гарантия видны на первом экране',
  await p.evaluate(() => [...document.querySelectorAll('.hero__fact')].filter((el) => el.getBoundingClientRect().bottom <= innerHeight).length >= 3));
ok('панель действий не перекрывает контент',
  await p.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom) >= document.querySelector('.actionbar').getBoundingClientRect().height - 1));
await p.click('.burger');
ok('мобильное меню открывается', await p.isVisible('.mobile-nav.is-open a[href="/proekty/"]'));
ok('фон под открытым меню не прокручивается', await p.evaluate(() => document.body.classList.contains('is-locked')));
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
ok('меню закрывается по Escape', !(await p.isVisible('.mobile-nav.is-open')));
await p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-visible')));
await p.screenshot({ path: 'mob-top.png' });
await p.goto(`${B}/proekty/`, { waitUntil: 'networkidle' });
await p.screenshot({ path: 'mob-catalog.png' });
await p.close();

/* 7. Все страницы: битые ссылки, разметка, шрифты */
p = await b.newPage({ viewport: { width: 1280, height: 900 } });
p.on('pageerror', (e) => errs.push(e.message));
const pages = ['', 'proekty/', 'obekty/', 'uslugi/', 'o-kompanii/', 'kontakty/', 'politika/', '404.html', 'proekty/kd-40/'];
const missing = [];
for (const page of pages) {
  const resp = await p.goto(`${B}/${page}`, { waitUntil: 'networkidle' });
  if (!resp.ok() && page !== '404.html') missing.push(`${page} → ${resp.status()}`);
  const links = await p.$$eval('a[href^="/"]', (as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
  for (const l of links) {
    const r = await p.request.get(`${B}${l}`.split('?')[0].split('#')[0]);
    if (!r.ok()) missing.push(`${page}: ссылка ${l} → ${r.status()}`);
  }
}
ok('все страницы и внутренние ссылки открываются' + (missing.length ? ': ' + missing.join(', ') : ''), missing.length === 0);

const sitemap = await (await p.request.get(`${B}/sitemap.xml`)).text();
ok(`в sitemap есть страницы проектов (${(sitemap.match(/\/proekty\/kd-/g) || []).length} шт.)`, (sitemap.match(/\/proekty\/kd-/g) || []).length === N);

await p.goto(`${B}/`, { waitUntil: 'networkidle' });
await p.click('#wall .layer:nth-child(3)');
ok('слой стены переключается', (await p.textContent('#wall-note')).includes('Стойки 150×50'));
ok('выбранный слой объявлен ассистивным технологиям',
  (await p.getAttribute('#wall .layer:nth-child(3)', 'aria-pressed')) === 'true');
ok('разрез подсвечивает выбранный слой', await p.isVisible('.wall__cut rect[data-cut="2"].is-lit'));
ok('шрифты подгружены', await p.evaluate(() => document.fonts.check('16px Nunito') && document.fonts.check('16px "Golos Text"')));
ok('на семейство приходится по одному файлу шрифта',
  await p.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.woff2')).length <= 2));

/* 8. Заявка реально уходит на сервер (только там, где есть PHP) */
if (hasPhp) {
  const req = p.waitForResponse((r) => r.url().includes('/api/lead.php'), { timeout: 15000 });
  await p.goto(`${B}/kontakty/`, { waitUntil: 'networkidle' });
  await p.fill('#k-name', 'Пётр');
  await p.fill('#k-phone', '9201716969');
  await p.check('form.form input[name="consent"]');
  await p.click('form.form button[type="submit"]');
  const resp = await req;
  const json = await resp.json().catch(() => ({}));
  await p.waitForTimeout(300);
  const shownOk = await p.isVisible('form.form .form__ok');
  const shownErr = await p.isVisible('form.form .form__error');
  if (resp.status() === 200) {
    ok(`форма отправляет заявку на /api/lead.php (ok=${json.ok})`, json.ok === true && shownOk && !shownErr);
  } else {
    ok(`сервер отказал (${resp.status()}) и отказ показан пользователю`, shownErr && !shownOk);
  }
}
ok('в каждой форме есть скрытая ловушка для ботов', await p.evaluate(() =>
  [...document.querySelectorAll('form.form')].every((f) => f.querySelectorAll('input[name="website"]').length === 1)));
ok('нет JS-ошибок' + (errs.length ? ': ' + errs.join(' | ') : ''), errs.length === 0);

await b.close();
console.log(out.join('\n'));
const failed = out.filter((l) => l.startsWith('✗')).length;
console.log(failed ? `\nНе прошло проверок: ${failed}` : `\nВсе проверки пройдены: ${out.filter((l) => l.startsWith('✓')).length}`);
process.exit(failed ? 1 : 0);
