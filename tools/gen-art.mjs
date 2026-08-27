/* Иллюстрации каталога: пока у проекта нет фотографии, карточка получает
   фасадную развёртку - тот же язык, что и в альбоме эскизного проекта.
   Никаких рисованных пейзажей: линия, штриховка, размерная цепочка.
   Как только в projects.json появятся photos, картинка не используется. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const INK = '#2A2620';
const PAPER = '#F3EDE3';
const WOOD = '#C08A4A';
const ROOF = '#3A362C';
const GLASS = '#2F5D3F';

/* «8,45×10,5» -> [8.45, 10.5]; «6х8» с русской х тоже понимается */
const dims = (size) => String(size).replace(',', '.').split(/[×xх]/i).map((n) => parseFloat(n.replace(',', '.')) || 8);

const defs = `<defs>
  <pattern id="hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
    <line x1="0" y1="0" x2="0" y2="7" stroke="${ROOF}" stroke-width="1" stroke-opacity=".34"/>
  </pattern>
  <pattern id="board" width="11" height="8" patternUnits="userSpaceOnUse">
    <line x1="0" y1="0" x2="0" y2="8" stroke="${INK}" stroke-width=".7" stroke-opacity=".2"/>
  </pattern>
</defs>`;

/* Размерная цепочка с засечками под объектом */
function dimension(x1, x2, y, label) {
  const tick = (x) => `<path d="M${x - 5} ${y + 5} L${x + 5} ${y - 5}" stroke="${INK}" stroke-width="1.4" stroke-opacity=".65"/>`;
  return `<g>
    <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${INK}" stroke-width="1" stroke-opacity=".45"/>
    ${tick(x1)}${tick(x2)}
    <line x1="${x1}" y1="${y - 26}" x2="${x1}" y2="${y + 10}" stroke="${INK}" stroke-width=".8" stroke-opacity=".25"/>
    <line x1="${x2}" y1="${y - 26}" x2="${x2}" y2="${y + 10}" stroke="${INK}" stroke-width=".8" stroke-opacity=".25"/>
    <text x="${(x1 + x2) / 2}" y="${y - 9}" text-anchor="middle" font-family="Menlo, Consolas, monospace" font-size="19" fill="${INK}" fill-opacity=".62">${label}</text>
  </g>`;
}

/* Фасад: стена с вертикальной доской, общий скат над террасой, проёмы */
function elevation({ cx, ground, span, floors, terrace, code, size }) {
  const [w] = dims(size);
  const wallH = Math.round(span * (floors >= 2 ? 0.46 : floors > 1 ? 0.38 : 0.28));
  const half = span / 2;
  const x0 = cx - half, x1 = cx + half;
  const top = ground - wallH;
  const eave = 26;
  const deckW = terrace ? span * 0.42 : 0;
  const ridgeX = cx;
  const ridgeY = top - span * 0.17;
  const roofR = x1 + eave + deckW;

  const windows = [];
  const count = span > 520 ? 4 : span > 400 ? 3 : 2;
  const openW = Math.round(span / (count * 2.4));
  const gap = (span - 70 - count * openW) / (count - 1 || 1);
  for (let i = 0; i < count; i += 1) {
    const wx = x0 + 35 + i * (openW + gap);
    const wy = top + wallH * 0.28;
    const hh = Math.round(wallH * 0.36);
    windows.push(`<g><rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${openW}" height="${hh}" rx="2" fill="${GLASS}" fill-opacity=".12" stroke="${INK}" stroke-width="1.4" stroke-opacity=".72"/>
      <line x1="${(wx + openW / 2).toFixed(1)}" y1="${wy.toFixed(1)}" x2="${(wx + openW / 2).toFixed(1)}" y2="${(wy + hh).toFixed(1)}" stroke="${INK}" stroke-width=".9" stroke-opacity=".4"/></g>`);
  }
  if (floors >= 2) {
    for (let i = 0; i < count - 1; i += 1) {
      const wx = x0 + 66 + i * (openW + gap);
      windows.push(`<rect x="${wx.toFixed(1)}" y="${(top + 36).toFixed(1)}" width="${openW - 6}" height="${Math.round(wallH * 0.26)}" rx="2" fill="${GLASS}" fill-opacity=".12" stroke="${INK}" stroke-width="1.4" stroke-opacity=".72"/>`);
    }
  }

  const roof = `M${(x0 - eave).toFixed(1)} ${(top + 8).toFixed(1)} L${ridgeX.toFixed(1)} ${ridgeY.toFixed(1)} L${roofR.toFixed(1)} ${(top + 8 + deckW * 0.12).toFixed(1)} L${roofR.toFixed(1)} ${(top + 22 + deckW * 0.12).toFixed(1)} L${ridgeX.toFixed(1)} ${(ridgeY + 14).toFixed(1)} L${(x0 - eave).toFixed(1)} ${(top + 22).toFixed(1)} Z`;

  const deck = terrace ? `
    <rect x="${x1.toFixed(1)}" y="${(ground - 14).toFixed(1)}" width="${deckW.toFixed(1)}" height="9" fill="${WOOD}" fill-opacity=".26" stroke="${INK}" stroke-width="1.3" stroke-opacity=".55"/>
    <line x1="${(x1 + deckW - 10).toFixed(1)}" y1="${(ground - 14).toFixed(1)}" x2="${(x1 + deckW - 10).toFixed(1)}" y2="${(top + 16 + deckW * 0.12).toFixed(1)}" stroke="${INK}" stroke-width="2.4" stroke-opacity=".6"/>
    <line x1="${(x1 + deckW * 0.42).toFixed(1)}" y1="${(ground - 14).toFixed(1)}" x2="${(x1 + deckW * 0.42).toFixed(1)}" y2="${(top + 14 + deckW * 0.05).toFixed(1)}" stroke="${INK}" stroke-width="2.4" stroke-opacity=".6"/>` : '';

  return `<g>
    <path d="${roof}" fill="url(#hatch)" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <rect x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${span}" height="${wallH}" fill="${WOOD}" fill-opacity=".16"/>
    <rect x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${span}" height="${wallH}" fill="url(#board)"/>
    <rect x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${span}" height="${wallH}" fill="none" stroke="${INK}" stroke-width="2.4"/>
    ${deck}
    <rect x="${(cx - 24).toFixed(1)}" y="${(ground - Math.round(wallH * 0.58)).toFixed(1)}" width="48" height="${Math.round(wallH * 0.58)}" fill="${ROOF}" fill-opacity=".15" stroke="${INK}" stroke-width="1.7" stroke-opacity=".78"/>
    ${windows.join('\n    ')}
    <rect x="${(x0 - 6).toFixed(1)}" y="${ground.toFixed(1)}" width="${(span + 12 + deckW).toFixed(1)}" height="10" fill="${ROOF}" fill-opacity=".28" stroke="${INK}" stroke-width="1.5" stroke-opacity=".55"/>
    ${dimension(x0, x1, ground + 58, `${String(w).replace('.', ',')} м`)}
  </g>`;
}

function sheet({ code, size, floors, terrace, w = 960, h = 600 }) {
  const ground = Math.round(h * 0.8);
  const [wide] = dims(size);
  const span = Math.max(420, Math.min(w * (terrace ? 0.54 : 0.72), wide * 66));
  const cx = terrace ? w / 2 - span * 0.2 : w / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Фасад каркасного дома ${code}, ${size} м">
${defs}
  <rect width="${w}" height="${h}" fill="${PAPER}"/>
  <line x1="0" y1="${ground + 10}" x2="${w}" y2="${ground + 10}" stroke="${INK}" stroke-width="1" stroke-opacity=".1"/>
  ${code ? `<text x="34" y="46" font-family="Menlo, Consolas, monospace" font-size="21" letter-spacing="1.5" fill="${INK}" fill-opacity=".42">${code}</text>` : ''}
  ${elevation({ cx, ground, span, floors, terrace, code, size })}
</svg>`;
}

mkdirSync('assets/img/projects', { recursive: true });
const projects = JSON.parse(readFileSync('src/data/projects.json', 'utf8'));
for (const p of projects) {
  writeFileSync(`assets/img/projects/${p.slug}.svg`, sheet({ code: p.code, size: p.size, floors: p.floors, terrace: p.terrace }));
}
/* кадр первого экрана: если фотографии нет, кладём ту же развёртку пошире */
writeFileSync('assets/img/hero.svg', sheet({ code: '', size: '10×12', floors: 1.5, terrace: true, w: 1600, h: 900 }));
console.log(`развёртки фасадов: ${projects.length} карточек`);
