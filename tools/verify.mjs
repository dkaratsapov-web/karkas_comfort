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
  '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
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

let failed = 0;
failed += (await run('tools/check.mjs')) ? 1 : 0;
failed += (await run('tools/visual.mjs')) ? 1 : 0;
server.close();
if (failed) {
  console.error('\nПроверки не пройдены — публиковать нельзя.');
  process.exit(1);
}
console.log('\nПроверки пройдены.');
