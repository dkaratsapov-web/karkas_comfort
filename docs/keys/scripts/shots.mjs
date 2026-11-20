// Снимки сайта и админки для кейса. Сайт — копия dist во временной папке
// с демо-учёткой и демо-заявками (настоящих данных там нет), раздаётся
// php -S, чтобы работала админка.
//
//   npm run build
//   node docs/keys/scripts/shots.mjs            # пишет в docs/keys/screens/
//
// Нужен php и Playwright (PW_MODULE; PW_CHROME — по желанию).
import { mkdirSync, cpSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const OUT = fileURLToPath(new URL('../screens', import.meta.url));
for (const d of ['desktop', 'mobile', 'admin']) mkdirSync(`${OUT}/${d}`, { recursive: true });

/* копия сайта с демо-данными админки */
const SITE = mkdtempSync(join(tmpdir(), 'kk-case-'));
cpSync(`${ROOT}/dist`, SITE, { recursive: true });
const hash = execFileSync('php', ['-r', 'echo password_hash("demo-pass-123", PASSWORD_DEFAULT);']).toString();
writeFileSync(`${SITE}/api/admin-users.json`, JSON.stringify({ users: [{ login: 'demo', name: 'Владелец (демо)', hash, role: 'owner' }] }));
const rows = [
  ['Алексей', 'Дом 8×10, комплектация «Тёплый контур»', '/proekty/', 'Главная, форма первого экрана'],
  ['Марина', 'Хотим к лету, участок в Конаково', '/', 'Карта охвата'],
  ['Сергей', 'Баня-дом 6×6', '/proekty/', 'Квиз расчёта'],
  ['Ольга', 'Перезвоните вечером', '/kontakty/', 'Контакты'],
  ['Дмитрий', 'Ипотека, нужен расчёт', '/', 'Плашка про ипотеку'],
];
writeFileSync(`${SITE}/api/leads.jsonl`, rows.map(([name, message, page, place], i) => JSON.stringify({
  id: `demo${i}`, at: new Date(Date.now() - i * 7200e3 - 3600e3).toISOString(), name, phone: `+7 (900) 000-00-0${i + 1}`,
  message, project: '', page, source: 'site', place, device: i % 2 ? 'телефон' : 'компьютер', consent: 'согласие на обработку ПД',
  test: false, sent: { mail: true, telegram: false, max: true, crm: false },
})).join('\n') + '\n');

const PORT = 8093;
const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', SITE], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const BASE = `http://127.0.0.1:${PORT}`;

const { chromium } = await import(process.env.PW_MODULE || 'playwright');
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const jpg = (p, path, full = false) => p.screenshot({ path, fullPage: full, type: 'jpeg', quality: 82 });
const settle = async (p) => {
  await p.evaluate(() => document.fonts && document.fonts.ready);
  await p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-visible')));
  await p.waitForTimeout(500);
};
const warm = async (p) => {
  await p.evaluate(async () => {
    document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; });
    for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 70)); }
    scrollTo(0, 0);
  });
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(1200);
};
const at = async (p, sel, off = 0) => {
  await p.evaluate(([s, o]) => { const e = document.querySelector(s); if (e) scrollTo(0, e.getBoundingClientRect().top + scrollY - o); }, [sel, off]);
  await p.waitForTimeout(900);
};

/* компьютер, 1440 */
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('kk-cookie', 'necessary'); } catch {} });
  const p = await ctx.newPage();
  const go = async (u) => { await p.goto(BASE + u, { waitUntil: 'networkidle' }); await settle(p); };
  const D = `${OUT}/desktop`;
  await go('/'); await warm(p);
  await jpg(p, `${D}/01-glavnaya-pervyy-ekran.jpg`);
  await at(p, '.bento-grid', 260); await jpg(p, `${D}/02-pochemu-my.jpg`);
  await p.evaluate(() => document.querySelector('[data-geo-host]')?.scrollIntoView({ block: 'center' }));
  await p.waitForSelector('.gx__svg', { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2500);
  await at(p, '[data-geo-host]', 140); await jpg(p, `${D}/04-karta-okhvata.jpg`);
  const kashin = await p.evaluateHandle(() => [...document.querySelectorAll('.gx__label')].find((t) => t.textContent === 'Кашин')?.closest('g')?.querySelector('.gx__hit'));
  if (kashin.asElement()) { await kashin.asElement().click({ force: true }); await p.waitForTimeout(1200); await jpg(p, `${D}/05-karta-uchastok-forma.jpg`); }
  await at(p, '.reel', 220); await jpg(p, `${D}/06-lenta-video.jpg`);
  await go('/'); await warm(p); await jpg(p, `${D}/00-glavnaya-tselikom.jpg`, true);
  for (const [u, n] of [['/proekty/', '07-katalog-proektov'], ['/proekty/kolesnikovo/', '08-stranitsa-proekta'], ['/obekty/', '09-obekty'], ['/obekty/obekt-2/', '10-stranitsa-obekta']]) { await go(u); await warm(p); await jpg(p, `${D}/${n}.jpg`); }
  const ph = await p.$('.shots [data-zoom], [data-zoom]');
  if (ph) { await ph.click().catch(() => {}); await p.waitForTimeout(1200); await jpg(p, `${D}/11-prosmotr-foto.jpg`); await p.keyboard.press('Escape'); }
  await go('/stati/'); await warm(p);
  const q = await p.$('input[type="search"]'); if (q) { await q.fill('фундамент'); await p.waitForTimeout(700); }
  await jpg(p, `${D}/12-stati-poisk.jpg`);
  for (const [u, n] of [['/stati/chto-proverit-v-dogovore/', '13-statya'], ['/video/', '14-video'], ['/kontakty/', '15-kontakty']]) { await go(u); await warm(p); await jpg(p, `${D}/${n}.jpg`); }
  await go('/'); await warm(p);
  const calc = await p.$('[data-quiz-open]');
  if (calc) { await calc.click().catch(() => {}); await p.waitForTimeout(1000); await jpg(p, `${D}/16-kviz-rascheta.jpg`); }
  await ctx.close();
}
/* подсказка комплектаций — без отключённой анимации, иначе она полупрозрачная */
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('kk-cookie', 'necessary'); } catch {} });
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await settle(p);
  await p.evaluate(() => { const t = document.querySelector('.tier'); scrollTo(0, t.getBoundingClientRect().top + scrollY - 470); });
  await p.waitForTimeout(1200);
  const heads = await p.$$('.tier__head'); if (heads[1]) { await heads[1].hover(); await p.waitForTimeout(2400); }
  await jpg(p, `${OUT}/desktop/03-komplektatsii-podskazka.jpg`);
  await ctx.close();
}
/* телефон, 390 × 844, плотность 2 */
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('kk-cookie', 'necessary'); } catch {} });
  const p = await ctx.newPage();
  const go = async (u) => { await p.goto(BASE + u, { waitUntil: 'networkidle' }); await settle(p); };
  const M = `${OUT}/mobile`;
  await go('/'); await warm(p);
  await jpg(p, `${M}/01-pervyy-ekran.jpg`);
  const burger = await p.$('.header__burger, .burger, [aria-controls="mobile-nav"]');
  if (burger) { await burger.click(); await p.waitForTimeout(800); await jpg(p, `${M}/02-menyu.jpg`); }
  await go('/'); await warm(p);
  await at(p, '.swipe', 90); await jpg(p, `${M}/03-lenta-obektov.jpg`);
  await at(p, '.reel', 200); await jpg(p, `${M}/04-lenta-video.jpg`);
  await p.evaluate(() => document.querySelector('[data-geo-host]')?.scrollIntoView({ block: 'center' }));
  await p.waitForSelector('.gx__svg', { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2500);
  await at(p, '[data-geo-host]', 90); await jpg(p, `${M}/05-karta.jpg`);
  await at(p, '.tier', 90); await jpg(p, `${M}/06-komplektatsii.jpg`);
  await at(p, 'footer', 0); await jpg(p, `${M}/07-podval-knopki.jpg`);
  await go('/obekty/obekt-2/'); await warm(p); await jpg(p, `${M}/08-obekt.jpg`);
  await go('/proekty/burashevo/'); await warm(p); await jpg(p, `${M}/09-proekt.jpg`);
  await ctx.close();
}
/* админка на демо-данных */
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const A = `${OUT}/admin`;
  await p.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
  await jpg(p, `${A}/01-vkhod.jpg`);
  await p.fill('input[name="login"]', 'demo');
  await p.fill('input[name="password"]', 'demo-pass-123');
  await Promise.all([p.waitForNavigation().catch(() => {}), p.click('button[type="submit"]')]);
  for (const [u, n] of [['/admin/index.php', '02-zayavki'], ['/admin/tasks.php', '04-zadachi'], ['/admin/people.php', '05-klienty'], ['/admin/settings.php', '06-nastroyki-priema'], ['/admin/content.php', '07-soderzhimoe'], ['/admin/users.php', '08-polzovateli']]) {
    const r = await p.goto(BASE + u, { waitUntil: 'networkidle' }).catch(() => null);
    if (r && r.ok()) await jpg(p, `${A}/${n}.jpg`); else console.log('нет', u);
  }
  await p.goto(BASE + '/admin/index.php', { waitUntil: 'networkidle' });
  const deal = await p.$('a[href*="deal.php?id="]');
  if (deal) { await deal.click(); await p.waitForLoadState('networkidle'); await jpg(p, `${A}/09-sdelka.jpg`); }
  await ctx.close();
}
await b.close();
php.kill();
console.log('ok', OUT);
