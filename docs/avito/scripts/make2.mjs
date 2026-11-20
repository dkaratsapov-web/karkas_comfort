// Креативы Авито, версия 2: три художественных направления.
//  «Лист»    — дом вырезан из настоящего фото и стоит на чертёжном листе,
//              золотые выноски с характеристиками, штамп как на чертеже.
//  «Графит»  — тёмное поле с ритмом стоек каркаса, тёплый свет за домом,
//              цена крупным кеглем.
//  «Журнал»  — фото в паспарту на бумаге, подпись как в архитектурном издании.
// Текст — HTML шрифтом сайта Onest, картинки — настоящие кадры.
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const HERE = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');   // docs/avito
const R = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, ''); // корень репозитория
const OUT = `${HERE}/kreativy`;
mkdirSync(`${OUT}/.html`, { recursive: true });
const CUT = (f) => `file://${HERE}/sources/${f}-cut.webp`;
const SRC = (f) => `file://${HERE}/sources/${f}`;
const LOGO_D = `file://${R}/assets/img/logo-h.svg`;
const LOGO_L = `file://${R}/assets/img/logo-h-on-dark.svg`;

const INK = '#161A18', INK2 = '#3C423E', PAPER = '#EDE8DE', GOLD = '#C8871F', GOLD_D = '#8A5E2B', DARK = '#14171A';

const base = (W, H, bg) => `
@font-face { font-family: Onest; src: url(file://${R}/assets/fonts/onest-wght.woff2) format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
body { font-family: Onest, sans-serif; background: ${bg}; position: relative; -webkit-font-smoothing: antialiased; }
.a { position: absolute; }
.tx { white-space: nowrap; }
`;
const doc = (W, H, bg, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${base(W, H, bg)}</style></head><body>${body}</body></html>`;

/* бумага: мелкая и крупная сетка, зерно */
const paper = (u) => `
<div class="a" style="inset:0;background:
  linear-gradient(rgba(22,26,24,.06) 1px, transparent 1px) 0 0/${4 * u}px ${4 * u}px,
  linear-gradient(90deg, rgba(22,26,24,.06) 1px, transparent 1px) 0 0/${4 * u}px ${4 * u}px,
  linear-gradient(rgba(22,26,24,.07) 1px, transparent 1px) 0 0/${20 * u}px ${20 * u}px,
  linear-gradient(90deg, rgba(22,26,24,.07) 1px, transparent 1px) 0 0/${20 * u}px ${20 * u}px,
  radial-gradient(120% 90% at 50% 40%, #F3EFE7 0%, ${PAPER} 60%, #E3DDD1 100%)"></div>
<svg class="a" style="inset:0;width:100%;height:100%;opacity:.35;mix-blend-mode:multiply" xmlns="http://www.w3.org/2000/svg">
  <filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .1  0 0 0 0 .1  0 0 0 0 .1  0 0 0 .09 0"/></filter>
  <rect width="100%" height="100%" filter="url(#n)"/></svg>`;

/* дом: вырезка и мягкая контактная тень */
const house = ({ src, x, y, w, ratio, shadow = 'rgba(22,26,24,.28)' }) => {
  const h = w / ratio;
  return `
<div class="a" style="left:${x + w * 0.08}px;top:${y + h * 0.9}px;width:${w * 0.84}px;height:${h * 0.16}px;border-radius:50%;background:radial-gradient(closest-side, ${shadow}, rgba(0,0,0,0));filter:blur(${w * 0.012}px)"></div>
<img class="a" src="${src}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;filter:drop-shadow(0 ${w * 0.01}px ${w * 0.014}px rgba(0,0,0,.18))">`;
};

/* выноска как на чертеже: точка на доме, наклонная линия к полке,
   подпись на полке, пояснение под ней */
const callout = ({ px, py, tx, ty, label, sub, color = GOLD_D, u, align = 'left', ink = INK }) => {
  const fl = 3.3 * u, fs = 2.3 * u;
  const lw = Math.max([...label].length * fl * 0.56, sub ? [...sub].length * fs * 0.56 : 0) + 0.6 * u;
  const x0 = align === 'left' ? tx : tx - lw, x1 = x0 + lw;
  const join = Math.abs(px - x0) < Math.abs(px - x1) ? x0 : x1;
  return `
<svg class="a" style="inset:0;width:100%;height:100%;overflow:visible">
  <circle cx="${px}" cy="${py}" r="${0.7 * u}" fill="${color}"/>
  <circle cx="${px}" cy="${py}" r="${1.6 * u}" fill="none" stroke="${color}" stroke-width="1.2" opacity=".55"/>
  <line x1="${px}" y1="${py}" x2="${join}" y2="${ty}" stroke="${color}" stroke-width="1.4"/>
  <line x1="${x0}" y1="${ty}" x2="${x1}" y2="${ty}" stroke="${color}" stroke-width="1.4"/>
</svg>
<div class="a tx" data-text style="left:${x0}px;width:${lw}px;top:${ty - fl * 1.2 - 0.5 * u}px;text-align:${align}">
  <div style="font-size:${fl}px;font-weight:700;color:${ink};letter-spacing:-.01em;line-height:1.2">${label}</div>
</div>
${sub ? `<div class="a tx" data-text style="left:${x0}px;width:${lw}px;top:${ty + 0.7 * u}px;text-align:${align};font-size:${fs}px;color:${color};font-weight:500">${sub}</div>` : ''}`;
};

/* штамп чертежа */
const stamp = ({ u, rows, right, top }) => `
<div class="a" data-text style="right:${right}px;top:${top}px;border:1.4px solid ${INK};display:grid;grid-template-columns:auto auto;font-size:${1.9 * u}px;color:${INK}">
${rows.map(([k, v]) => `<div style="padding:${0.6 * u}px ${1.1 * u}px;border-right:1px solid rgba(22,26,24,.5);border-bottom:1px solid rgba(22,26,24,.5);color:${INK2}">${k}</div><div class="tx" style="padding:${0.6 * u}px ${1.1 * u}px;border-bottom:1px solid rgba(22,26,24,.5);font-weight:600">${v}</div>`).join('')}
</div>`;

/* размерная линия-надзаголовок */
const dimEyebrow = (u, text, color) => `<div class="tx" style="display:flex;align-items:center;gap:${1.2 * u}px;font-size:${2.6 * u}px;font-weight:500;color:${color};letter-spacing:.01em">
  <span style="position:relative;display:block;width:${6 * u}px;height:1px;background:${color}"><i style="position:absolute;left:0;top:-${0.9 * u}px;width:1px;height:${1.8 * u}px;background:${color}"></i><i style="position:absolute;right:0;top:-${0.9 * u}px;width:1px;height:${1.8 * u}px;background:${color}"></i></span>${text}</div>`;

/* «Лист»: дом стоит на нижней кромке hb (доля высоты) */
export const list = ({ W, H, cut, ratio, head, sub, eyebrow, anchors, stampRows, hx, hb, hw }) => {
  const u = Math.min(W, H) / 100;
  const m = 6 * u;
  const w = hw * W, x = hx * W - w / 2, h = w / ratio, y = hb * H - h;
  const calls = anchors.map((a) => callout({ u, px: x + a.ax * w, py: y + a.ay * h, tx: a.tx * W, ty: a.ty * H, label: a.label, sub: a.sub, align: a.align || 'left' })).join('');
  return doc(W, H, PAPER, `
${paper(u)}
<div class="a" style="inset:${3 * u}px;border:1px solid rgba(22,26,24,.28)"></div>
<div class="a" style="left:${m}px;top:${m}px"><img src="${LOGO_D}" style="height:${4.6 * u}px;display:block" data-logo></div>
<div class="a" data-text style="left:${m}px;top:${m + 9.5 * u}px">
  ${dimEyebrow(u, eyebrow, GOLD_D)}
  <div class="tx" style="margin-top:${1.6 * u}px;font-size:${7.2 * u}px;line-height:1.02;font-weight:750;letter-spacing:-.035em;color:${INK}">${head}</div>
  <div class="tx" style="margin-top:${1.4 * u}px;font-size:${2.8 * u}px;color:${INK2}">${sub}</div>
</div>
${house({ src: cut, x, y, w, ratio })}
${calls}
${stamp({ u, rows: stampRows, right: m, top: m })}
`);
};

/* «Графит» */
export const graphite = ({ W, H, cut, ratio, price, unit, eyebrow, note, hx, hb, hw }) => {
  const u = Math.min(W, H) / 100;
  const m = 6 * u;
  const w = hw * W, x = hx * W - w / 2, h = w / ratio, y = hb * H - h;
  return doc(W, H, DARK, `
<div class="a" style="inset:0;background:repeating-linear-gradient(90deg, rgba(232,234,230,.045) 0 1px, transparent 1px ${6 * u}px)"></div>
<div class="a" style="left:${x - w * 0.25}px;top:${y - h * 0.45}px;width:${w * 1.5}px;height:${h * 1.7}px;background:radial-gradient(closest-side, rgba(200,135,31,.30), rgba(200,135,31,.08) 55%, rgba(20,23,26,0))"></div>
<div class="a" style="left:0;right:0;top:${y + h * 0.965}px;height:1px;background:linear-gradient(90deg, rgba(232,234,230,0), rgba(232,234,230,.28) 20%, rgba(232,234,230,.28) 80%, rgba(232,234,230,0))"></div>
<div class="a" style="left:0;right:0;top:${y + h * 0.965}px;bottom:0;background:linear-gradient(rgba(20,23,26,0), rgba(10,12,14,.55))"></div>
${house({ src: cut, x, y, w, ratio, shadow: 'rgba(0,0,0,.65)' })}
<div class="a" data-text style="left:${m}px;top:${m}px">
  ${dimEyebrow(u, eyebrow, GOLD)}
  <div class="tx" style="margin-top:${1.8 * u}px;font-size:${11 * u}px;line-height:.95;font-weight:780;letter-spacing:-.045em;color:#F1EEE8">${price}</div>
  <div class="tx" style="margin-top:${1.6 * u}px;font-size:${3 * u}px;color:#A9B1AB">${unit}</div>
</div>
<div class="a" style="left:${m}px;bottom:${m}px"><img src="${LOGO_L}" style="height:${4.6 * u}px;display:block" data-logo></div>
<div class="a tx" data-text style="right:${m}px;bottom:${m + 0.6 * u}px;font-size:${2.5 * u}px;color:#A9B1AB;text-align:right">${note}</div>
`);
};

/* «Журнал» */
export const magazine = ({ W, H, photo, pos = '50% 50%', place, meta, head }) => {
  const u = Math.min(W, H) / 100;
  const m = 6 * u;
  const portrait = H > W * 1.1;
  const frameH = portrait ? H * 0.64 : H * 0.62;
  return doc(W, H, PAPER, `
${paper(u)}
<div class="a" style="left:${m}px;right:${m}px;top:${m + 8 * u}px;height:${frameH}px;padding:${1.1 * u}px;border-radius:${3.2 * u}px;background:rgba(22,26,24,.06);box-shadow:inset 0 0 0 1px rgba(22,26,24,.08), 0 ${3 * u}px ${7 * u}px -${3 * u}px rgba(22,26,24,.35)">
  <div style="width:100%;height:100%;border-radius:${2.1 * u}px;overflow:hidden;box-shadow:inset 0 1px 1px rgba(255,255,255,.3)">
    <img src="${photo}" style="width:100%;height:100%;object-fit:cover;object-position:${pos};display:block">
  </div>
</div>
<div class="a" style="left:${m}px;top:${m}px"><img src="${LOGO_D}" style="height:${4.6 * u}px;display:block" data-logo></div>
<div class="a tx" data-text style="right:${m}px;top:${m + 1 * u}px;font-size:${2.4 * u}px;color:${INK2};letter-spacing:.02em">${head}</div>
<div class="a" data-text style="left:${m}px;right:${m}px;bottom:${m}px">
  <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:${3 * u}px">
    <div class="tx" style="font-size:${9.4 * u}px;line-height:.92;font-weight:780;letter-spacing:-.045em;color:${INK}">${place}</div>
    <div style="text-align:right;padding-bottom:${0.8 * u}px">${meta.map((t, i) => `<div class="tx" style="font-size:${i ? 2.5 * u : 3.2 * u}px;font-weight:${i ? 500 : 700};color:${i ? GOLD_D : INK};margin-top:${i ? 0.6 * u : 0}px">${t}</div>`).join('')}</div>
  </div>
</div>
`);
};

/* Баннеры на главную: 8:3 — один дом справа; 13:2 — дома в ряд на одной
   линии горизонта, как улица */
export const wide = ({ W, H, cuts, head, sub }) => {
  const k = H / 100;
  const narrow = W / H < 4;
  const pad = 16 + 8 * k;
  const fs = narrow ? 10.5 * k : 15.5 * k;
  const ground = H * (narrow ? 0.98 : 0.9);
  let houses = '', glow = '';
  if (narrow) {
    const c = cuts[0], hh = H * 0.86, hw = hh * c.ratio, hx = W - pad - hw + hw * 0.04;
    glow = `<div class="a" style="left:${hx - hw * 0.2}px;top:${ground - hh * 1.3}px;width:${hw * 1.4}px;height:${hh * 1.6}px;background:radial-gradient(closest-side, rgba(200,135,31,.32), rgba(200,135,31,.08) 55%, rgba(20,23,26,0))"></div>`;
    houses = house({ src: c.src, x: hx, y: ground - hh, w: hw, ratio: c.ratio, shadow: 'rgba(0,0,0,.65)' });
  } else {
    const x0 = W * 0.36, x1 = W - pad, gap = 5 * k, hh = H * 0.74;
    const total = cuts.reduce((t, c) => t + hh * c.ratio, 0) + gap * (cuts.length - 1);
    const sc = Math.min(1, (x1 - x0) / total);
    let x = x1 - total * sc;
    for (const c of cuts) {
      const h = hh * sc, w = h * c.ratio;
      glow += `<div class="a" style="left:${x - w * 0.15}px;top:${ground - h * 1.3}px;width:${w * 1.3}px;height:${h * 1.6}px;background:radial-gradient(closest-side, rgba(200,135,31,.24), rgba(200,135,31,.06) 55%, rgba(20,23,26,0))"></div>`;
      houses += house({ src: c.src, x, y: ground - h, w, ratio: c.ratio, shadow: 'rgba(0,0,0,.65)' });
      x += w + gap * sc;
    }
  }
  return doc(W, H, DARK, `
<div class="a" style="inset:0;background:repeating-linear-gradient(90deg, rgba(232,234,230,.045) 0 1px, transparent 1px ${6 * k}px)"></div>
${glow}
<div class="a" style="left:${W * (narrow ? 0.45 : 0.33)}px;right:0;top:${ground - 0.035 * H * 0.86}px;height:1px;background:linear-gradient(90deg, rgba(232,234,230,0), rgba(232,234,230,.3) 30%)"></div>
${houses}
<div class="a" data-text style="left:${pad}px;top:50%;transform:translateY(-50%)">
  <img src="${LOGO_L}" style="height:${(narrow ? 8.5 : 10) * k}px;display:block;margin-bottom:${(narrow ? 6 : 7) * k}px" data-logo>
  <div style="font-size:${fs}px;line-height:1.02;font-weight:780;letter-spacing:-.04em;color:#F1EEE8">${head}</div>
  <div style="margin-top:${(narrow ? 5 : 6) * k}px">${dimEyebrow(k * (narrow ? 1.9 : 2.4), sub, GOLD)}</div>
</div>
`);
};

export { CUT, SRC, OUT };

/* рендер: JPEG точного размера; печатает долю текста (лимит Авито 20 %)
   и сжимает, пока файл не уложится в лимит веса */
export async function render(set) {
  const { chromium } = await import(process.env.PW_MODULE || 'playwright');
  const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  for (const { name, W, H, html, limit = 2 * 1024 * 1024 } of set) {
    const file = `${OUT}/.html/${name}.html`;
    writeFileSync(file, html);
    const p = await b.newPage({ viewport: { width: W, height: H } });
    await p.goto(`file://${file}`, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    const share = await p.evaluate(() => {
      const rs = [...document.querySelectorAll('[data-text], [data-logo]')].map((e) => e.getBoundingClientRect());
      return rs.reduce((s, r) => s + r.width * r.height, 0) / (innerWidth * innerHeight);
    });
    let q = 90; const path = `${OUT}/${name}.jpg`;
    for (;;) { await p.screenshot({ path, type: 'jpeg', quality: q }); if (statSync(path).size <= limit || q <= 50) break; q -= 6; }
    console.log(name, `${W}×${H}`, `текст ${(share * 100).toFixed(1)}%`, `${Math.round(statSync(path).size / 1024)} КБ`);
    await p.close();
  }
  await b.close();
}
