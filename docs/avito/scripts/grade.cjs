// Переносит свет, контраст, насыщенность и баланс белого с ретуши Higgsfield
// на исходное фото. Оттенки остаются родными: меняется кривая яркости
// (сопоставление гистограмм), общая насыщенность и баланс белого по середине
// кадра, где дом (небо в расчёт не входит). Все детали дома — из настоящего
// кадра: прямую ретушь не берём, нейросеть дорисовывала отражения и кирпич.
//
// node grade.cjs <исходник.jpg> <ретушь.png> <выход.jpg> [сила 0..1]
const sharp = require('sharp');
const [origPath, refPath, out, mixArg] = process.argv.slice(2);
const MIX = mixArg ? Number(mixArg) : 0.8;
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const stats = (buf, ch) => {
  const h = new Float64Array(256); let sat = 0, n = 0;
  for (let i = 0; i < buf.length; i += ch) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    h[Math.min(255, Math.round(lum(r, g, b)))]++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 20) { sat += (mx - mn) / mx; n++; }
  }
  let s = 0; const tot = buf.length / ch;
  for (let i = 0; i < 256; i++) { s += h[i]; h[i] = s / tot; }
  return { cdf: h, sat: sat / n };
};
(async () => {
  const om = await sharp(origPath).metadata();
  const ref = await sharp(refPath).resize(om.width, om.height, { fit: 'cover' }).removeAlpha().raw().toBuffer();
  const { data: src, info } = await sharp(origPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const A = stats(src, ch), B = stats(ref, ch);
  const lut = new Float64Array(256);
  let j = 0;
  for (let i = 0; i < 256; i++) { while (j < 255 && B.cdf[j] < A.cdf[i]) j++; lut[i] = i + (j - i) * MIX; }
  const sm = new Float64Array(256);
  for (let i = 0; i < 256; i++) { let s = 0, n = 0; for (let d = -5; d <= 5; d++) { const k = i + d; if (k >= 0 && k < 256) { s += lut[k]; n++; } } sm[i] = s / n; }
  const satK = Math.min(1.25, Math.max(0.9, 1 + (B.sat / A.sat - 1) * MIX));
  const mean = (buf) => {
    const m = [0, 0, 0]; let n = 0;
    for (let y = Math.round(info.height * 0.35); y < info.height * 0.85; y += 3)
      for (let x = Math.round(info.width * 0.2); x < info.width * 0.8; x += 3) {
        const i = (y * info.width + x) * ch; m[0] += buf[i]; m[1] += buf[i + 1]; m[2] += buf[i + 2]; n++;
      }
    return m.map((v) => v / n);
  };
  const ma = mean(src), mb = mean(ref);
  let gain = [0, 1, 2].map((c) => 1 + (mb[c] / ma[c] - 1) * 0.6);
  const gl = lum(...gain); gain = gain.map((g) => Math.max(0.92, Math.min(1.08, g / gl)));
  const o = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i += ch) {
    let r = src[i] * gain[0], g = src[i + 1] * gain[1], b = src[i + 2] * gain[2];
    const y = lum(r, g, b), y2 = sm[Math.min(255, Math.round(y))];
    const k = y > 0.5 ? y2 / y : 1;
    r *= k; g *= k; b *= k;
    const yy = lum(r, g, b);
    r = yy + (r - yy) * satK; g = yy + (g - yy) * satK; b = yy + (b - yy) * satK;
    o[i] = Math.max(0, Math.min(255, Math.round(r)));
    o[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    o[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }
  await sharp(o, { raw: info }).jpeg({ quality: 93 }).toFile(out);
  console.log('ok', out, 'насыщенность ×' + satK.toFixed(2), 'баланс', gain.map((g) => g.toFixed(3)).join(' '));
})();
