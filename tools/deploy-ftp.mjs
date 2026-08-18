/* Выгрузка папки dist на хостинг по FTP / FTPS.
   Настройки берутся из файла .env в корне проекта (см. .env.example).

   npm run deploy            — загрузить всё содержимое dist
   npm run deploy -- --dry   — показать, что будет загружено, ничего не меняя  */
import { Client } from 'basic-ftp';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* --- читаем .env без внешних зависимостей --- */
const env = { ...process.env };
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const need = ['FTP_HOST', 'FTP_USER', 'FTP_PASSWORD'];
const missing = need.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Не хватает настроек: ${missing.join(', ')}.\nСкопируйте .env.example в .env и заполните.`);
  process.exit(1);
}

const REMOTE = env.FTP_REMOTE_DIR || '/public_html';
const dry = process.argv.includes('--dry');

if (!existsSync('dist/index.html')) {
  console.error('Нет собранной папки dist. Сначала выполните: npm run build');
  process.exit(1);
}

const list = (dir, prefix = '') => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? list(full, `${prefix}${name}/`) : [`${prefix}${name}`];
});
const files = list('dist');

console.log(`Файлов к загрузке: ${files.length} → ${env.FTP_HOST}${REMOTE}`);
if (dry) {
  files.slice(0, 40).forEach((f) => console.log('  ' + f));
  if (files.length > 40) console.log(`  … и ещё ${files.length - 40}`);
  console.log('\nПробный запуск: ничего не загружено.');
  process.exit(0);
}

const client = new Client(30000);
client.ftp.verbose = false;
try {
  await client.access({
    host: env.FTP_HOST,
    port: Number(env.FTP_PORT || 21),
    user: env.FTP_USER,
    password: env.FTP_PASSWORD,
    secure: env.FTP_SECURE === 'false' ? false : true,
    secureOptions: { rejectUnauthorized: env.FTP_STRICT_TLS === 'true' }
  });
  await client.ensureDir(REMOTE);
  client.trackProgress((info) => {
    if (info.name) process.stdout.write(`\r  ${info.name.padEnd(52).slice(0, 52)}`);
  });
  await client.uploadFromDir('dist', REMOTE);
  client.trackProgress();
  console.log('\nГотово. Проверьте сайт и очистите кеш браузера (Ctrl+F5).');
} catch (e) {
  console.error('\nОшибка выгрузки:', e.message);
  process.exitCode = 1;
} finally {
  client.close();
}
