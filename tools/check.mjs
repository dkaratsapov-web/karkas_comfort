/* Проверка собранного сайта в headless-браузере.
   Запуск: npm run serve  (в одном окне), затем в другом:
           BASE=http://localhost:8080 npm run check
   Нужен Playwright: npx playwright install chromium
   Проверка отправки заявки пройдёт только там, где работает PHP. */
const { chromium } = await import('playwright')
  .catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
const B = process.env.BASE || 'http://127.0.0.1:8080';
const b = await chromium.launch();
const out = [];
const ok = (n, c) => out.push(`${c ? '✓' : '✗ ПРОВАЛ'} ${n}`);

// 1. Каталог: фильтры
let p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(`${B}/proekty.html`, { waitUntil: 'networkidle' });
ok('каталог отрисован (15 карточек)', (await p.$$('#catalog-list .project')).length === 15);
await p.click('.chip[data-value="2"]');
const twoFloors = await p.$$eval('#catalog-list .specs', els => els.map(e => e.textContent));
ok('фильтр «2 этажа» оставил только двухэтажные', twoFloors.length > 0 && twoFloors.every(t => t.includes('2 этажа')));
await p.click('.chip[data-group="size"][data-value="l"]');
const cnt = await p.textContent('#catalog-count');
ok(`комбинация фильтров работает (${cnt})`, /\d/.test(cnt));
await p.click('.chip[data-group="floors"][data-value="all"]');
await p.click('.chip[data-group="size"][data-value="all"]');
await p.selectOption('#catalog-sort', 'area-desc');
const first = await p.textContent('#catalog-list .specs li');
ok('сортировка по площади (сначала 200 м²)', first.trim() === '200 м²');

// 2. Страница проекта
await p.goto(`${B}/proekt.html?id=kd-29`, { waitUntil: 'networkidle' });
ok('страница проекта берёт данные из ?id', (await p.textContent('#p-title')).includes('9×12'));
ok('заголовок вкладки обновлён', (await p.title()).includes('КД-29'));
ok('таблица характеристик заполнена', (await p.$$('#p-specs tr')).length === 8);
ok('похожие проекты подобраны', (await p.$$('#p-similar .project')).length === 3);
ok('в форму подставлен код проекта', (await p.inputValue('#p-project-input')).includes('КД-29'));

// 3. Калькулятор
await p.goto(`${B}/index.html`, { waitUntil: 'networkidle' });
const sum0 = await p.textContent('#calc-sum');
await p.fill('#calc-area', '200');
await p.dispatchEvent('#calc-area', 'input');
const sum1 = await p.textContent('#calc-sum');
ok(`калькулятор пересчитывает (${sum0} → ${sum1})`, sum0 !== sum1);
await p.check('input[value="pod_kluch"]');
const sum2 = await p.textContent('#calc-sum');
ok(`смена комплектации меняет сумму (${sum2})`, sum1 !== sum2);
ok('расчёт ипотечного платежа', /\d/.test(await p.textContent('#calc-monthly')));

// 4. Валидация формы
await p.click('a[href="#zayavka"]');
await p.click('#zayavka button[type="submit"]');
ok('пустая форма не отправляется', await p.isVisible('#zayavka .field--error'));
await p.fill('#cta-name', 'Иван');
await p.fill('#cta-phone', '9201716969');
const phone = await p.inputValue('#cta-phone');
ok(`маска телефона (${phone})`, phone === '+7 (920) 171-69-69');
await p.check('#zayavka input[name="consent"]');
await p.click('#zayavka button[type="submit"]');
await p.waitForTimeout(300);
ok('после отправки показано подтверждение', await p.isVisible('#zayavka .form__ok'));
await p.close();

// 5. Мобильная версия
p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
p.on('pageerror', e => errs.push(e.message));
await p.goto(`${B}/index.html`, { waitUntil: 'networkidle' });
const noHScroll = await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
ok('нет горизонтальной прокрутки на 390px', noHScroll);
await p.click('.burger');
ok('мобильное меню открывается', await p.isVisible('.mobile-nav.is-open a[href="proekty.html"]'));
await p.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('is-visible')));
await p.click('.burger');
await p.screenshot({ path: 'mob-top.png' });
await p.evaluate(() => document.querySelector('#proekty').scrollIntoView());
await p.waitForTimeout(300);
await p.screenshot({ path: 'mob-catalog.png' });
await p.close();

// 6. Все страницы: битые ссылки и ошибки
p = await b.newPage({ viewport: { width: 1280, height: 900 } });
p.on('pageerror', e => errs.push(e.message));
const pages = ['index.html','karkasnye-doma.html','proekty.html','proekt.html','obekty.html','uslugi.html','o-kompanii.html','kontakty.html','politika.html','404.html'];
const missing = [];
for (const page of pages) {
  const resp = await p.goto(`${B}/${page}`, { waitUntil: 'networkidle' });
  if (!resp.ok()) missing.push(`${page} → ${resp.status()}`);
  const links = await p.$$eval('a[href$=".html"]', as => [...new Set(as.map(a => a.getAttribute('href')))]);
  for (const l of links) {
    const r = await p.request.get(`${B}/${l.split('?')[0]}`);
    if (!r.ok()) missing.push(`${page}: ссылка ${l} → ${r.status()}`);
  }
}
ok('все страницы и внутренние ссылки открываются' + (missing.length ? ': ' + missing.join(', ') : ''), missing.length === 0);
// слои технологии
await p.goto(`${B}/index.html`, { waitUntil: 'networkidle' });
await p.click('#wall .layer:nth-child(3)');
ok('слой стены переключается', (await p.textContent('#wall-note')).includes('Стойки 150×50'));
ok('разрез подсвечивает выбранный слой', await p.isVisible('.wall__cut rect[data-cut="2"].is-lit'));
// заявка реально уходит на сервер
const req = p.waitForResponse(r => r.url().includes('/api/lead.php'), { timeout: 15000 });
await p.goto(`${B}/kontakty.html`, { waitUntil: 'networkidle' });
await p.fill('#k-name', 'Пётр');
await p.fill('#k-phone', '9201716969');
await p.check('form.form input[name="consent"]');
await p.click('form.form button[type="submit"]');
const resp = await req;
const json = await resp.json().catch(() => ({}));
await p.waitForTimeout(300);
const shownOk = await p.isVisible('form.form .form__ok');
const shownErr = await p.isVisible('form.form .form__error');
if (resp.status() === 429) {
  // сработало ограничение частоты — проверяем, что отказ показан пользователю
  ok('ограничение частоты заявок работает и показано пользователю', shownErr && !shownOk);
} else {
  ok(`форма отправляет заявку на /api/lead.php (${resp.status()}, ok=${json.ok})`, resp.status() === 200 && json.ok === true);
  ok('после успешного ответа показано подтверждение', shownOk && !shownErr);
}
ok('в форме есть скрытая ловушка для ботов', await p.$('input[name="website"]') !== null);
await p.goto(`${B}/index.html`, { waitUntil: 'networkidle' });
ok('шрифты подгружены', await p.evaluate(() => [...document.fonts].every(f => f.status === 'loaded') && document.fonts.check('16px Onest')));
ok('нет JS-ошибок' + (errs.length ? ': ' + errs.join(' | ') : ''), errs.length === 0);
await b.close();
console.log(out.join('\n'));
const failed = out.filter((l) => l.startsWith('✗')).length;
console.log(failed ? `\nНе прошло проверок: ${failed}` : `\nВсе проверки пройдены: ${out.length}`);
process.exit(failed ? 1 : 0);
