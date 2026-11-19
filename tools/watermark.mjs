/* Водяной знак на фото объектов и листах проектов.
 *
 * Ставится при сборке и только в копии в dist/: исходники в assets/
 * остаются чистыми, и знак можно поменять или снять одной правкой здесь.
 *
 * Как выглядит: горизонтальный логотип шириной ~13 % кадра, в углу
 * с отступом. На тёмном и пёстром фоне — светлый вариант с мягкой тенью,
 * на светлом листе — тёмный, полупрозрачный. Угол выбирается сам: из
 * четырёх берётся самый спокойный, чтобы знак не лёг на таблицу чертежа
 * или на дверь в кадре. По умолчанию — правый нижний.
 *
 * Не трогаем: обложки статей (stati-*), постеры роликов (video-*),
 * кадры первого экрана (у них своя чистая копия, см. build.mjs).
 *
 * Пережатые кадры кешируются в .cache/watermark: повторная сборка
 * без новых фото знак заново не ставит.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const VERSION = 'wm-3';                   // поменять — и все знаки пересоберутся
const CACHE = '.cache/watermark';
const SKIP = /^(stati-|video-|hero|docs-)/;   // иллюстрации, не съёмка
const LIGHT = readFileSync('assets/img/logo-h-on-dark.svg', 'utf8');
const DARK = readFileSync('assets/img/logo-h.svg', 'utf8');

/* логотип нужной ширины: прозрачность и тень — средствами самого SVG */
function logoSvg(src, width, { opacity, shadow }) {
  const vb = src.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const height = Math.round((width * vb[3]) / vb[2]);
  const inner = src.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/, '');
  const pad = shadow ? Math.ceil(width * 0.06) : 0;
  const filter = shadow
    ? `<defs><filter id="s" x="-20%" y="-40%" width="140%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="${(vb[2] * 0.012).toFixed(2)}" flood-color="#000" flood-opacity=".55"/></filter></defs>`
    : '';
  return {
    svg: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width + pad * 2}" height="${height + pad * 2}" viewBox="${vb[0] - (pad * vb[2]) / width} ${vb[1] - (pad * vb[2]) / width} ${vb[2] + (pad * 2 * vb[2]) / width} ${vb[3] + (pad * 2 * vb[2]) / width}">${filter}<g opacity="${opacity}"${shadow ? ' filter="url(#s)"' : ''}>${inner}</g></svg>`),
    w: width + pad * 2,
    h: height + pad * 2,
    pad,
  };
}

/* самый спокойный угол: меньше всего перепадов яркости под знаком */
async function pickCorner(buf, W, H, bw, bh, m) {
  const small = 0.25;
  const g = sharp(buf).greyscale().resize(Math.round(W * small));
  const { data, info } = await g.raw().toBuffer({ resolveWithObject: true });
  const box = (x0, y0) => {
    const x = Math.max(0, Math.round(x0 * small)), y = Math.max(0, Math.round(y0 * small));
    const w = Math.round(bw * small), h = Math.round(bh * small);
    let sum = 0, sq = 0, n = 0;
    for (let j = y; j < Math.min(info.height, y + h); j++) {
      for (let i = x; i < Math.min(info.width, x + w); i++) {
        const v = data[j * info.width + i] / 255;
        sum += v; sq += v * v; n++;
      }
    }
    const mean = sum / n;
    return { mean, sd: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
  };
  const corners = [
    { name: 'br', x: W - bw - m, y: H - bh - m },
    { name: 'bl', x: m, y: H - bh - m },
    { name: 'tr', x: W - bw - m, y: m },
    { name: 'tl', x: m, y: m },
  ].map((c) => ({ ...c, ...box(c.x, c.y) }));
  /* правый нижний остаётся, если он не сильно пестрее лучшего */
  const best = corners.reduce((a, b) => (b.sd < a.sd ? b : a));
  return corners[0].sd <= best.sd * 1.35 + 0.01 ? corners[0] : best;
}

async function mark(file) {
  const src = readFileSync(file);
  const meta = await sharp(src).metadata();
  const W = meta.width, H = meta.height;
  if (!W || !H || W < 320) return src;
  const lw = Math.round(W * 0.13);
  const m = Math.round(W * 0.024);
  const probe = logoSvg(LIGHT, lw, { opacity: 1, shadow: false });
  const corner = await pickCorner(src, W, H, probe.w, probe.h, m);
  const light = corner.mean <= 0.62;
  const logo = light
    ? logoSvg(LIGHT, lw, { opacity: 0.8, shadow: true })
    : logoSvg(DARK, lw, { opacity: 0.55, shadow: false });
  const png = await sharp(logo.svg).png().toBuffer();
  const left = Math.max(0, Math.min(W - logo.w, corner.x - logo.pad));
  const top = Math.max(0, Math.min(H - logo.h, corner.y - logo.pad));
  return sharp(src)
    .composite([{ input: png, left, top }])
    .jpeg({ quality: 84, progressive: true, mozjpeg: true })
    .toBuffer();
}

export async function watermark(dir) {
  mkdirSync(CACHE, { recursive: true });
  const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f) && !SKIP.test(f));
  let done = 0, cached = 0;
  for (const f of files) {
    const path = `${dir}/${f}`;
    const key = createHash('sha1').update(VERSION).update(readFileSync(path)).digest('hex');
    const hit = `${CACHE}/${key}.jpg`;
    if (existsSync(hit)) {
      writeFileSync(path, readFileSync(hit));
      cached++;
      continue;
    }
    const out = await mark(path);
    writeFileSync(path, out);
    writeFileSync(hit, out);
    done++;
  }
  console.log(`водяной знак: ${done + cached} кадров (новых ${done}, из кеша ${cached})`);
}
