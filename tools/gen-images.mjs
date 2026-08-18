// Генерация векторных иллюстраций каталога.
// Заменяются на реальные фото: положите файл с тем же именем (.webp/.jpg) в assets/img/projects/
// и поменяйте расширение в src/data/projects.json → см. README.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const P = {
  sky1: '#EAF4EE', sky2: '#F7F6F2', ground: '#DCE7DE', groundDark: '#C8D9CC',
  green: '#1F5C3A', greenMid: '#2A7A4B', greenLight: '#4FB07A',
  wood: '#C8791F', woodLight: '#E3A85C', woodDark: '#8E5411',
  roof: '#2C3A33', roofLight: '#3E5148', ink: '#14201A', glass: '#FFD9A0', frame: '#F7F6F2'
};

// детерминированный «шум» по строке — чтобы деревья не прыгали между сборками
const seeded = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => (h = Math.imul(h ^ (h >>> 15), 2246822507)) >>> 0; };

const tree = (x, y, s, fill) => `
  <g transform="translate(${x} ${y}) scale(${s.toFixed(2)})">
    <rect x="-3" y="-16" width="6" height="20" rx="2" fill="${P.woodDark}" opacity=".55"/>
    <path d="M0 -78 L26 -30 H-26 Z" fill="${fill}" opacity=".92"/>
    <path d="M0 -56 L30 -6 H-30 Z" fill="${fill}"/>
  </g>`;

const window = (x, y, w, h, lit = true) => `
  <g transform="translate(${x} ${y})">
    <rect width="${w}" height="${h}" rx="3" fill="${lit ? P.glass : '#BFD3C6'}"/>
    <rect width="${w}" height="${h}" rx="3" fill="none" stroke="${P.frame}" stroke-width="3"/>
    <line x1="${w / 2}" y1="0" x2="${w / 2}" y2="${h}" stroke="${P.frame}" stroke-width="3"/>
  </g>`;

function houseGeom({ floors, wide }) {
  const w = wide ? 430 : 350;                 // ширина фасада
  const x0 = (800 - w) / 2;
  const base = 400;                            // линия земли
  const wallH = floors === 2 ? 200 : floors === 1.5 ? 120 : 96;
  const roofH = floors === 1.5 ? 150 : floors === 2 ? 96 : 104;
  const wallY = base - wallH;
  const ridgeY = wallY - roofH;

  const planks = Array.from({ length: Math.floor(wallH / 16) }, (_, i) =>
    `<line x1="${x0}" y1="${wallY + 10 + i * 16}" x2="${x0 + w}" y2="${wallY + 10 + i * 16}" stroke="${P.woodDark}" stroke-width="1" opacity=".18"/>`).join('');

  const rowY = [wallY + 34];
  if (floors === 2) rowY.push(wallY + 122);
  const cols = wide ? 4 : 3;
  const winW = 56, gap = (w - cols * winW) / (cols + 1);
  const windows = rowY.flatMap((y, r) =>
    Array.from({ length: cols }, (_, c) => window(x0 + gap + c * (winW + gap), y, winW, r === 0 && floors !== 2 ? 62 : 54, (c + r) % 4 !== 3))
  ).join('');

  const mansard = floors === 1.5
    ? `<path d="M${400 - 58} ${ridgeY + 74} h116 v66 h-116 z" fill="${P.roofLight}"/>${window(400 - 40, ridgeY + 88, 80, 46)}`
    : '';

  const svg = `
    <g>
      <ellipse cx="400" cy="${base + 8}" rx="${w / 2 + 60}" ry="22" fill="${P.groundDark}" opacity=".55"/>
      <rect x="${x0}" y="${wallY}" width="${w}" height="${wallH}" fill="${P.woodLight}"/>
      <rect x="${x0}" y="${wallY}" width="${w}" height="${wallH}" fill="url(#wallShade)"/>
      ${planks}
      <path d="M${x0 - 34} ${wallY + 6} L400 ${ridgeY} L${x0 + w + 34} ${wallY + 6} Z" fill="${P.roof}"/>
      <path d="M${x0 - 34} ${wallY + 6} L400 ${ridgeY} L400 ${ridgeY + 16} L${x0 - 20} ${wallY + 20} Z" fill="${P.roofLight}" opacity=".7"/>
      ${mansard}
      ${windows}
      <rect x="${400 - 28}" y="${base - 84}" width="56" height="84" rx="4" fill="${P.wood}"/>
      <circle cx="${400 + 16}" cy="${base - 42}" r="3.5" fill="${P.frame}"/>
      <rect x="${x0 - 6}" y="${base - 6}" width="${w + 12}" height="10" rx="4" fill="${P.roof}" opacity=".18"/>
    </g>`;
  return { svg, x0, base, wallY };
}

function terrace(show, geom) {
  if (!show) return '';
  const { x0, base } = geom;                     // открытая деревянная терраса у левой стены
  const w = 128, x = x0 - w, deck = base - 10;
  const railTop = deck - 44, railMid = deck - 24;
  const balusters = Array.from({ length: Math.floor(w / 20) }, (_, i) =>
    `<rect x="${x + 10 + i * 20}" y="${railTop}" width="4" height="${deck - railTop}" fill="${P.woodDark}" opacity=".45"/>`).join('');
  return `
    <g>
      <rect x="${x - 8}" y="${deck}" width="${w + 12}" height="14" rx="3" fill="${P.wood}"/>
      <rect x="${x - 8}" y="${deck + 14}" width="${w + 12}" height="7" rx="2" fill="${P.woodDark}" opacity=".65"/>
      ${balusters}
      <rect x="${x}" y="${railTop}" width="${w}" height="7" rx="3" fill="${P.woodDark}" opacity=".85"/>
      <rect x="${x}" y="${railMid}" width="${w}" height="4" rx="2" fill="${P.woodDark}" opacity=".55"/>
      <rect x="${x - 2}" y="${railTop - 6}" width="9" height="${deck - railTop + 6}" rx="2" fill="${P.woodDark}"/>
      <rect x="${x - 14}" y="${base + 2}" width="30" height="7" rx="3" fill="${P.woodDark}" opacity=".5"/>
    </g>`;
}

function scene(p) {
  const rnd = seeded(p.slug);
  const zones = [[24, 110], [640, 776], [56, 120], [676, 764], [30, 96], [700, 780]];
  const trees = zones.map((z, i) => {
    const x = z[0] + (rnd() % (z[1] - z[0]));
    const s = 0.5 + (rnd() % 55) / 100;
    return { x, s, far: i % 2 === 0 };
  }).sort((a, b) => a.s - b.s)
    .map((t) => tree(t.x, t.far ? 372 : 404, t.s, t.far ? P.greenLight : P.greenMid)).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 460" role="img" aria-label="Каркасный дом ${p.code}, ${p.size} м">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.sky1}"/><stop offset="1" stop-color="${P.sky2}"/></linearGradient>
    <linearGradient id="wallShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".10"/><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".08"/></linearGradient>
  </defs>
  <rect width="800" height="460" fill="url(#sky)"/>
  <circle cx="672" cy="96" r="42" fill="${P.woodLight}" opacity=".35"/>
  <path d="M0 404 Q200 372 420 398 T800 388 V460 H0 Z" fill="${P.ground}"/>
  ${trees}
  ${(() => { const h = houseGeom({ floors: p.floors, wide: p.area > 130 }); return terrace(p.terrace, h) + h.svg; })()}
  <path d="M0 436 Q220 420 460 432 T800 424 V460 H0 Z" fill="${P.groundDark}" opacity=".6"/>
</svg>`;
}

mkdirSync('assets/img/projects', { recursive: true });
const projects = JSON.parse(readFileSync('src/data/projects.json', 'utf8'));
for (const p of projects) writeFileSync(`assets/img/projects/${p.slug}.svg`, scene(p));
console.log(`сгенерировано иллюстраций: ${projects.length}`);
