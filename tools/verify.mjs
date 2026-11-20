/* Обязательная проверка перед публикацией: поднимает собранный сайт
   на свободном порту и прогоняет сценарии (tools/check.mjs) и
   визуальный контроль (tools/visual.mjs). Сервер гасится сам. */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = 'dist';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm'
};

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  /* заглушка обработчика заявки: проверяем поведение формы, а не PHP */
  if (url.endsWith('.php')) {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(body); } catch { data = Object.fromEntries(new URLSearchParams(body)); }
      const phone = String(data.phone || '').replace(/\D/g, '');
      const ok = Boolean(String(data.name || '').trim()) && phone.length >= 11 && Boolean(data.consent) && !data.website;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(ok ? { ok: true } : { ok: false, error: 'Проверьте имя, телефон и согласие' }));
    });
    return;
  }
  let file = join(ROOT, normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(existsSync(join(ROOT, '404.html')) ? readFileSync(join(ROOT, '404.html')) : 'not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});

const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const base = `http://127.0.0.1:${port}`;
console.log(`проверка на ${base}`);

const run = (script) => new Promise((resolve) => {
  const p = spawn(process.execPath, [script], { stdio: 'inherit', env: { ...process.env, BASE: base } });
  p.on('close', (code) => resolve(code));
});

/* VERIFY_PARTS="check,seo" — прогнать только эти части. В CI части идут
   параллельными заданиями на разных машинах; локально — все подряд. */
const parts = (process.env.VERIFY_PARTS || 'check,visual,seo').split(',').map((s) => s.trim());
let failed = 0;
for (const [part, script] of [['check', 'tools/check.mjs'], ['visual', 'tools/visual.mjs'], ['seo', 'tools/seo.mjs']]) {
  if (parts.includes(part)) failed += (await run(script)) ? 1 : 0;
}
server.close();
if (failed) {
  console.error('\nПроверки не пройдены — публиковать нельзя.');
  process.exit(1);
}
console.log('\nПроверки пройдены.');
