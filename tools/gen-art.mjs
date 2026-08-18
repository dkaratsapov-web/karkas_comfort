/* Генератор иллюстраций: широкий кадр для первого экрана и карточки каталога.
   Стиль — «скандинавский люкс»: тёплый свет, слои глубины, мягкая дымка.
   Заменяются на реальные фотографии — см. README. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const C = {
  sky0: '#F6F1E7', sky1: '#EFE4D4', sky2: '#E4D6C3',
  sun: '#F7DCB0', sunCore: '#FBEBD2',
  far: '#C3CEC0', mid: '#93AB94', near: '#5F7D66', deep: '#3E5748',
  ground0: '#E3DCCC', ground1: '#D3CBB8', ground2: '#BFB7A2',
  wood: '#C89A64', woodDark: '#A87B47', woodLight: '#DDB684',
  roof: '#2E3A33', roofLight: '#3F5049',
  glass: '#FFD79B', glassCore: '#FFF0D4', frame: '#F6F1E7',
  stone: '#8C8578', smoke: '#FFFFFF'
};

const rng = (seed) => {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507)) >>> 0) / 4294967295;
};

/* --- Лес: полоса силуэтов деревьев с заданной плотностью и высотой --- */
function forest(rnd, { y, h, from, to, fill, opacity = 1, step = 26 }) {
  let d = `M${from} ${y + 40} `;
  for (let x = from; x <= to; x += step) {
    const th = h * (0.6 + rnd() * 0.7);
    const w = step * (0.62 + rnd() * 0.5);
    d += `L${(x - w / 2).toFixed(1)} ${y.toFixed(1)} L${x.toFixed(1)} ${(y - th).toFixed(1)} L${(x + w / 2).toFixed(1)} ${y.toFixed(1)} `;
  }
  d += `L${to} ${y + 40} Z`;
  return `<path d="${d}" fill="${fill}" opacity="${opacity}"/>`;
}

/* --- Ель крупным планом --- */
function spruce(x, groundY, scale, fill) {
  const s = scale;
  return `<g transform="translate(${x} ${groundY}) scale(${s.toFixed(2)})">
    <rect x="-4" y="-24" width="8" height="28" rx="3" fill="${C.deep}" opacity=".8"/>
    <path d="M0 -168 L34 -104 H-34 Z" fill="${fill}" opacity=".9"/>
    <path d="M0 -132 L44 -58 H-44 Z" fill="${fill}"/>
    <path d="M0 -92 L54 -14 H-54 Z" fill="${fill}"/>
  </g>`;
}

/* --- Дом: фронтальный фасад со щипцом, крышей и тёплым остеклением --- */
function house(o) {
  const { cx, groundY, width, floors, terrace, chimney = true } = o;
  const w = width, x0 = cx - w / 2, x1 = cx + w / 2;
  const wallH = floors === 2 ? w * 0.50 : floors === 1.5 ? w * 0.32 : w * 0.28;
  const gableH = floors === 1.5 ? w * 0.34 : floors === 2 ? w * 0.26 : w * 0.24;
  const wallY = groundY - wallH;
  const ridge = wallY - gableH;
  const eave = w * 0.05;
  const roofT = w * 0.028;

  const win = (x, y, ww, wh, mullions = 1) => {
    const bars = Array.from({ length: mullions }, (_, i) =>
      `<line x1="${x + (ww / (mullions + 1)) * (i + 1)}" y1="${y}" x2="${x + (ww / (mullions + 1)) * (i + 1)}" y2="${y + wh}" stroke="${C.frame}" stroke-width="${Math.max(2, ww * 0.04)}"/>`).join('');
    return `<g><rect x="${x}" y="${y}" width="${ww}" height="${wh}" rx="2" fill="url(#glassGrad)"/>${bars}
      <rect x="${x}" y="${y}" width="${ww}" height="${wh}" rx="2" fill="none" stroke="${C.frame}" stroke-width="${Math.max(3, ww * 0.055)}"/></g>`;
  };

  const planks = Array.from({ length: Math.floor(wallH / (w * 0.05)) }, (_, i) =>
    `<line x1="${x0}" y1="${wallY + (i + 1) * w * 0.05}" x2="${x1}" y2="${wallY + (i + 1) * w * 0.05}" stroke="${C.woodDark}" stroke-width=".9" opacity=".2"/>`).join('');

  // окна первого этажа: панорама в гостиную + два обычных
  const bigW = w * 0.30, bigH = wallH * (floors === 2 ? 0.34 : 0.58);
  const rowY = floors === 2 ? wallY + wallH * 0.56 : wallY + wallH * 0.22;
  const smallW = w * 0.10, smallH = bigH * 0.72;
  const ground = win(x0 + w * 0.08, rowY, bigW, bigH, 2)
    + win(x0 + w * 0.47, rowY + (bigH - smallH) / 2, smallW, smallH)
    + win(x0 + w * 0.62, rowY + (bigH - smallH) / 2, smallW, smallH);

  // второй этаж или окна в щипце
  const upper = floors === 2
    ? [0.08, 0.26, 0.47, 0.62, 0.78].map((k) => win(x0 + w * k, wallY + wallH * 0.12, smallW, wallH * 0.26)).join('')
    : floors === 1.5
      ? win(cx - w * 0.11, ridge + gableH * 0.42, w * 0.22, gableH * 0.34, 1)
      : '';

  const door = `<g>
      <rect x="${x0 + w * 0.845}" y="${groundY - wallH * 0.62}" width="${w * 0.095}" height="${wallH * 0.62}" rx="2" fill="${C.roof}"/>
      <rect x="${x0 + w * 0.857}" y="${groundY - wallH * 0.53}" width="${w * 0.028}" height="${wallH * 0.26}" rx="2" fill="url(#glassGrad)" opacity=".8"/>
      <rect x="${x0 + w * 0.83}" y="${groundY - 4}" width="${w * 0.125}" height="6" rx="2" fill="${C.stone}" opacity=".55"/>
    </g>`;

  // терраса примыкает к левой стене, настил уходит в перспективу
  const td = w * 0.30, tx = x0 - td, deckY = groundY - 6;
  const terraceSvg = terrace ? `<g>
      <path d="M${tx} ${deckY} H${x0} V${deckY + 12} H${tx - 8} Z" fill="${C.wood}"/>
      <path d="M${tx - 8} ${deckY + 12} H${x0} v6 H${tx - 10} Z" fill="${C.woodDark}" opacity=".65"/>
      <path d="M${tx - 6} ${wallY + wallH * 0.30} H${x0} v${roofT * 0.8} H${tx - 4} Z" fill="${C.roof}" opacity=".92"/>
      <rect x="${tx}" y="${wallY + wallH * 0.30}" width="${roofT * 0.8}" height="${deckY - wallY - wallH * 0.30}" fill="${C.woodDark}"/>
      <rect x="${tx + td * 0.55}" y="${wallY + wallH * 0.30}" width="${roofT * 0.7}" height="${deckY - wallY - wallH * 0.30}" fill="${C.woodDark}" opacity=".75"/>
      <rect x="${tx}" y="${deckY - w * 0.085}" width="${td}" height="${roofT * 0.55}" fill="${C.woodDark}" opacity=".45"/>
    </g>` : '';

  return `<g>
    <ellipse cx="${cx}" cy="${groundY + 8}" rx="${w * 0.72}" ry="${w * 0.05}" fill="${C.ground2}" opacity=".45"/>
    ${terraceSvg}
    ${chimney ? `<rect x="${cx + w * 0.17}" y="${ridge + gableH * 0.22}" width="${w * 0.05}" height="${gableH * 0.62}" rx="2" fill="${C.stone}"/>` : ''}
    <rect x="${x0}" y="${wallY}" width="${w}" height="${wallH}" fill="${C.wood}"/>
    <polygon points="${x0},${wallY} ${cx},${ridge} ${x1},${wallY}" fill="${C.woodLight}"/>
    <polygon points="${cx},${ridge} ${x1},${wallY} ${cx},${wallY}" fill="${C.woodDark}" opacity=".22"/>
    <rect x="${x0}" y="${wallY}" width="${w}" height="${wallH}" fill="url(#wallShade)"/>
    ${planks}
    <path d="M${x0 - eave} ${wallY + roofT * 0.4} L${cx} ${ridge - roofT * 0.6} L${x1 + eave} ${wallY + roofT * 0.4} L${x1 + eave} ${wallY + roofT * 1.6} L${cx} ${ridge + roofT * 0.7} L${x0 - eave} ${wallY + roofT * 1.6} Z" fill="${C.roof}"/>
    <path d="M${x0 - eave} ${wallY + roofT * 0.4} L${cx} ${ridge - roofT * 0.6} L${cx} ${ridge + roofT * 0.1} L${x0 - eave * 0.5} ${wallY + roofT}  Z" fill="${C.roofLight}" opacity=".9"/>
    ${upper}${ground}${door}
  </g>`;
}

const defs = `<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.sky2}"/><stop offset=".45" stop-color="${C.sky1}"/><stop offset="1" stop-color="${C.sky0}"/>
  </linearGradient>
  <radialGradient id="sunGlow" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="${C.sunCore}" stop-opacity=".95"/>
    <stop offset=".45" stop-color="${C.sun}" stop-opacity=".55"/>
    <stop offset="1" stop-color="${C.sun}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="glassGrad" x1="0" y1="0" x2=".4" y2="1">
    <stop offset="0" stop-color="${C.glassCore}"/><stop offset="1" stop-color="${C.glass}"/>
  </linearGradient>
  <linearGradient id="wallShade" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity=".13"/><stop offset=".4" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity=".10"/>
  </linearGradient>
  <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".55"/>
  </linearGradient>
  <linearGradient id="groundGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.ground0}"/><stop offset="1" stop-color="${C.ground1}"/>
  </linearGradient>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="linear" slope=".055"/></feComponentTransfer>
  </filter>
  <filter id="soft"><feGaussianBlur stdDeviation="6"/></filter>
</defs>`;

/* ---------------- Широкий кадр для первого экрана ---------------- */
function hero() {
  const rnd = rng('hero-karkas-komfort');
  const W = 1600, H = 900, g = 690;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Каркасный дом на лесном участке в тёплом вечернем свете">
${defs}
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <circle cx="1276" cy="212" r="340" fill="url(#sunGlow)"/>
  <circle cx="1276" cy="212" r="58" fill="${C.sunCore}" opacity=".92"/>
  <path d="M0 520 Q260 470 520 505 T1080 496 T1600 470 V${g} H0 Z" fill="${C.far}" opacity=".55"/>
  ${forest(rnd, { y: 545, h: 120, from: -20, to: 1640, fill: C.far, opacity: .75, step: 34 })}
  ${forest(rnd, { y: 600, h: 165, from: -20, to: 1640, fill: C.mid, opacity: .9, step: 42 })}
  <rect x="0" y="500" width="${W}" height="180" fill="url(#mist)" opacity=".75"/>
  ${forest(rnd, { y: 662, h: 190, from: -30, to: 1640, fill: C.near, opacity: .95, step: 54 })}
  <path d="M0 ${g} Q400 ${g - 26} 820 ${g - 6} T1600 ${g - 30} V${H} H0 Z" fill="url(#groundGrad)"/>
  ${spruce(212, g + 52, 1.35, C.deep)}
  ${spruce(352, g + 22, .78, C.near)}
  ${spruce(58, g + 34, .95, C.near)}
  ${house({ cx: 1010, groundY: g + 58, width: 520, floors: 1.5, terrace: true })}
  ${spruce(1418, g + 50, 1.2, C.deep)}
  ${spruce(1546, g + 80, 1.5, C.deep)}
  <path d="M0 852 Q380 826 760 844 T1600 826 V${H} H0 Z" fill="${C.ground2}" opacity=".32"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity=".5"/>
</svg>`;
}

/* ---------------- Карточка каталога ---------------- */
function card(p) {
  const rnd = rng(p.slug);
  const W = 960, H = 600, g = 470;
  const width = p.area > 150 ? 520 : p.area > 100 ? 460 : 400;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Каркасный дом ${p.code}, ${p.size} м, ${p.area} м²">
${defs}
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <circle cx="${760 + rnd() * 80}" cy="150" r="190" fill="url(#sunGlow)"/>
  ${forest(rnd, { y: 400, h: 92, from: -20, to: 1000, fill: C.far, opacity: .7, step: 32 })}
  ${forest(rnd, { y: 448, h: 118, from: -20, to: 1000, fill: C.mid, opacity: .85, step: 40 })}
  <rect x="0" y="360" width="${W}" height="130" fill="url(#mist)" opacity=".7"/>
  <path d="M0 ${g} Q300 ${g - 18} 560 ${g - 4} T${W} ${g - 20} V${H} H0 Z" fill="url(#groundGrad)"/>
  ${spruce(78, g + 34, .62, C.near)}
  ${house({ cx: 470, groundY: g + 40, width, floors: p.floors, terrace: p.terrace, chimney: p.area > 70 })}
  ${spruce(872, g + 40, .78, C.deep)}
  <path d="M0 560 Q260 544 520 556 T${W} 544 V${H} H0 Z" fill="${C.ground2}" opacity=".3"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity=".45"/>
</svg>`;
}

mkdirSync('assets/img/projects', { recursive: true });
writeFileSync('assets/img/hero.svg', hero());
const projects = JSON.parse(readFileSync('src/data/projects.json', 'utf8'));
for (const p of projects) writeFileSync(`assets/img/projects/${p.slug}.svg`, card(p));
console.log(`иллюстрации: 1 кадр для героя + ${projects.length} карточек`);
