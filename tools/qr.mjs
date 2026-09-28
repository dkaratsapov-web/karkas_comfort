/* Сборка QR-кода на сайт со знаком компании в центре.
   Запуск:  npm i --no-save qrcode sharp && node tools/qr.mjs materials/qr
   Адрес берётся из src/data/site.json (поле domain), знак — из
   assets/img/favicon.svg. Уровень коррекции H: под знаком можно
   потерять до 30 % модулей, поэтому окно в центре вырезается честно,
   а не закрывается картинкой поверх данных.
   После сборки проверьте код декодером или обычной камерой. */

import QR from 'qrcode';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const site = JSON.parse(readFileSync('src/data/site.json', 'utf8'));
const DOMAIN = process.env.QR_DOMAIN || site.domain || 'каркаскомфорт.рф';
/* в код пишем punycode: так адрес открывает любой сканер,
   а браузер всё равно покажет кириллицу в адресной строке */
const URL_PUNY = new URL(`https://${DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')}/`).href;
const OUT = process.argv[2] || 'materials/qr';
mkdirSync(OUT, { recursive: true });

/* знак из favicon.svg: тёмный квадрат со скруглением и золотой домик */
const mark = readFileSync('assets/img/favicon.svg', 'utf8');
const markInner = mark.replace(/^[\s\S]*?<title>[\s\S]*?<\/title>/, '').replace(/<\/svg>\s*$/, '');

function build({ dark, light, logoBg, file }) {
  const qr = QR.create(URL_PUNY, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const quiet = 4;                       /* тихая зона по стандарту */
  const total = n + quiet * 2;
  const unit = 24;                       /* px на модуль в системе координат */
  const size = total * unit;

  /* окно под знак: центр, нечётное число модулей — чтобы село по сетке */
  const hole = n % 2 === 0 ? 10 : 9;
  const from = Math.floor((n - hole) / 2);
  const to = from + hole;

  let cells = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!data[y * n + x]) continue;
      if (x >= from && x < to && y >= from && y < to) continue;   /* под знаком не рисуем */
      cells += `<rect x="${(x + quiet) * unit}" y="${(y + quiet) * unit}" width="${unit}" height="${unit}"/>`;
    }
  }

  const holePx = hole * unit;
  const holeX = (from + quiet) * unit;
  const pad = unit * 0.9;
  const logoBox = holePx - pad * 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QR-код на сайт каркаскомфорт.рф">
  <title>Каркас Комфорт — каркаскомфорт.рф</title>
  <rect width="${size}" height="${size}" fill="${light}"/>
  <g fill="${dark}" shape-rendering="crispEdges">${cells}</g>
  <rect x="${holeX - pad / 2}" y="${holeX - pad / 2}" width="${holePx + pad}" height="${holePx + pad}" rx="${unit}" fill="${logoBg}"/>
  <svg x="${holeX + pad}" y="${holeX + pad}" width="${logoBox}" height="${logoBox}" viewBox="0 0 686 686">${markInner}</svg>
</svg>`;
  writeFileSync(`${OUT}/${file}.svg`, svg);
  return svg;
}

const light = build({ dark: '#14171A', light: '#FFFFFF', logoBg: '#FFFFFF', file: 'qr-karkascomfort' });
const onDark = build({ dark: '#F8F9F6', light: '#14171A', logoBg: '#14171A', file: 'qr-karkascomfort-on-dark' });

for (const [name, svg] of [['qr-karkascomfort', light], ['qr-karkascomfort-on-dark', onDark]]) {
  await sharp(Buffer.from(svg)).resize(1200, 1200, { kernel: 'nearest' }).png().toFile(`${OUT}/${name}.png`);
}
console.log('готово:', OUT);
