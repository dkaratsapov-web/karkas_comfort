/* Растровые иконки сайта из assets/img/mark.svg.
   Запуск: npm run icons  (нужен Playwright: npx playwright install chromium)
   Результат: favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png */
import { readFileSync, writeFileSync } from 'node:fs';

const mod = await import(process.env.PW_MODULE || 'playwright')
  .catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
const chromium = mod.chromium || mod.default?.chromium;

const svg = readFileSync('assets/img/mark.svg', 'utf8');
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});

async function png(size, radius) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;width:${size}px;height:${size}px;overflow:hidden;border-radius:${radius}px">
    <div style="width:${size}px;height:${size}px">${svg.replace('<svg', `<svg width="${size}" height="${size}"`)}</div></body>`);
  await page.waitForTimeout(120);
  const buf = await page.screenshot({ omitBackground: false });
  await page.close();
  return buf;
}

const p32 = await png(32, 0);
writeFileSync('assets/img/icon-32.png', p32);
writeFileSync('assets/img/apple-touch-icon.png', await png(180, 0));
writeFileSync('assets/img/icon-192.png', await png(192, 0));
writeFileSync('assets/img/icon-512.png', await png(512, 0));
await browser.close();

/* favicon.ico — контейнер ICO с PNG внутри, понимают все актуальные браузеры */
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);          // зарезервировано
header.writeUInt16LE(1, 2);          // тип: иконка
header.writeUInt16LE(1, 4);          // одно изображение
const entry = Buffer.alloc(16);
entry.writeUInt8(32, 0);             // ширина
entry.writeUInt8(32, 1);             // высота
entry.writeUInt8(0, 2);              // палитра не используется
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);           // плоскости
entry.writeUInt16LE(32, 6);          // бит на пиксель
entry.writeUInt32LE(p32.length, 8);  // размер данных
entry.writeUInt32LE(22, 12);         // смещение данных
writeFileSync('assets/img/favicon.ico', Buffer.concat([header, entry, p32]));

console.log('иконки готовы: favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png');
