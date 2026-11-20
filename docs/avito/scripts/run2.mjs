// Набор креативов v2. Цифры — из src/data сайта (cases.json, pricing.json).
// node docs/avito/scripts/run2.mjs [часть имени, например grafit]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { list, graphite, magazine, wide, CUT, SRC, render } from './make2.mjs';
const require = createRequire(import.meta.url);
const R = fileURLToPath(new URL('../../..', import.meta.url));
const sharp = require(`${R}node_modules/sharp`);
const HERE = fileURLToPath(new URL('..', import.meta.url));
const ratio = async (f) => { const m = await sharp(`${HERE}sources/${f}-cut.webp`).metadata(); return m.width / m.height; };

const r117 = await ratio('kd-117-foto-03');
const r2 = await ratio('proekt-2-foto-01');
const r4 = await ratio('proekt-4-foto-01');
const MAIN = 500 * 1024;
const set = [];
const sizes = [['1x1', 1080, 1080], ['4x3', 1200, 900], ['3x4', 1200, 1600]];

for (const [tag, W, H] of sizes) {
  const sq = tag === '1x1', land = tag === '4x3';
  // A. «Лист»: объект в Гришкино — габариты, площадь и срок из данных объекта № 5
  set.push({ name: `A-list-grishkino-${tag}`, W, H, html: list({
    W, H, cut: CUT('kd-117-foto-03'), ratio: r117,
    eyebrow: 'Объект в Гришкино', head: land ? '117 м² за 2,5 месяца' : '117 м²<br>за 2,5 месяца', sub: 'Тёплый контур, Тверская область',
    hx: land ? 0.6 : 0.5, hb: land ? 0.84 : sq ? 0.86 : 0.84, hw: land ? 0.56 : sq ? 0.7 : 0.8,
    anchors: [
      { ax: 0.40, ay: 0.95, tx: 0.07, ty: land ? 0.91 : sq ? 0.925 : 0.91, label: 'ж/б сваи', sub: 'фундамент' },
      { ax: 0.80, ay: 0.36, tx: 0.93, ty: land ? 0.36 : sq ? 0.375 : 0.37, label: '8,45 × 10,5 м', sub: 'габариты', align: 'right' },
    ],
    stampRows: [['Объект', '№ 5'], ['Площадь', '117 м²'], ['Срок', '2,5 мес.']],
  }) });
  // B. «Графит»: цена тёплого контура на доме в СНТ Курово
  set.push({ name: `B-grafit-cena-${tag}`, W, H, html: graphite({
    W, H, cut: CUT('proekt-2-foto-01'), ratio: r2,
    eyebrow: 'Тёплый контур', price: 'от 57 000 ₽', unit: 'за м², смета фиксируется в договоре', note: 'СНТ Курово,<br>Тверская область',
    hx: 0.5, hb: land ? 0.80 : sq ? 0.82 : 0.8, hw: land ? 0.6 : sq ? 0.8 : 0.9,
  }) });
  // C. «Журнал»: объект № 7 в Удомле
  set.push({ name: `C-zhurnal-udomlya-${tag}`, W, H, html: magazine({
    W, H, photo: SRC('proekt-7-foto-01-graded.jpg'), pos: '50% 45%',
    place: 'Удомля', meta: ['120 м²', 'Построили мы'], head: 'Объект № 7',
  }) });
  // D. «Графит»: дом с террасой в Олбово
  set.push({ name: `D-grafit-olbovo-${tag}`, W, H, html: graphite({
    W, H, cut: CUT('proekt-4-foto-01'), ratio: r4,
    eyebrow: 'Своими бригадами', price: 'Дом 140 м²', unit: 'с террасой, дер. Олбово', note: 'Гарантия 5 лет<br>по договору',
    hx: 0.5, hb: land ? 0.80 : sq ? 0.82 : 0.8, hw: land ? 0.6 : sq ? 0.8 : 0.9,
  }) });
}
set.push({ name: 'W-glavnaya-1320x492', W: 1320, H: 492, limit: MAIN, html: wide({ W: 1320, H: 492, cuts: [{ src: CUT('kd-117-foto-03'), ratio: r117 }], head: 'Каркасные дома<br>под ключ', sub: 'от 57 000 ₽ за м², смета в договоре' }) });
set.push({ name: 'W-glavnaya-2934x456', W: 2934, H: 456, limit: MAIN, html: wide({ W: 2934, H: 456, cuts: [{ src: CUT('kd-117-foto-03'), ratio: r117 }, { src: CUT('proekt-2-foto-01'), ratio: r2 }, { src: CUT('proekt-4-foto-01'), ratio: r4 }], head: 'Каркасные дома<br>под ключ в Твери', sub: 'от 57 000 ₽ за м², смета в договоре' }) });

const only = process.argv[2];
await render(only ? set.filter((s) => s.name.includes(only)) : set);
