/* Выгрузка папки dist на хостинг по FTPS.
   Настройки берутся из .env в корне проекта (см. .env.example) или из
   переменных окружения — так же работает и в GitHub Actions.

   npm run deploy              — залить изменившееся
   npm run deploy -- --dry     — показать план, ничего не трогая
   npm run deploy -- --force   — перезалить всё, включая медиа

   Два правила, которые важнее скорости:
   1) api/config.php на сервере не трогаем никогда, кроме первой установки:
      в нём боевая почта и токены, их нет и не должно быть в репозитории;
   2) api/leads.csv (накопленные заявки) не перезаписываем. */
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
  console.error(`Не хватает настроек: ${missing.join(', ')}.\nЛокально — скопируйте .env.example в .env и заполните.\nВ GitHub — Settings → Secrets and variables → Actions.`);
  process.exit(1);
}

const REMOTE = (env.FTP_REMOTE_DIR || '/public_html').replace(/\/$/, '');
const dry = process.argv.includes('--dry');
const force = process.argv.includes('--force');

if (!existsSync('dist/index.html')) {
  console.error('Нет собранной папки dist. Сначала выполните: npm run build');
  process.exit(1);
}

/* файлы, которые живут на сервере своей жизнью */
const KEEP_SERVER = new Set(['api/config.php', 'api/leads.csv']);
/* текст меняется часто и весит мало — заливаем всегда;
   медиа сверяем по размеру, иначе каждый деплой тащил бы сотню мегабайт */
const ALWAYS = /\.(html|css|js|json|xml|txt|php|webmanifest)$|(^|\/)\.htaccess$/i;

const list = (dir, prefix = '') => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? list(full, `${prefix}${name}/`) : [`${prefix}${name}`];
});
const files = list('dist').sort();

const byDir = new Map();
for (const rel of files) {
  const i = rel.lastIndexOf('/');
  const dir = i === -1 ? '' : rel.slice(0, i);
  if (!byDir.has(dir)) byDir.set(dir, []);
  byDir.get(dir).push(rel);
}

console.log(`Файлов в сборке: ${files.length} → ${env.FTP_HOST}${REMOTE}`);
if (dry) {
  for (const rel of files.slice(0, 40)) console.log('  ' + rel + (KEEP_SERVER.has(rel) ? '  (только если на сервере нет)' : ''));
  if (files.length > 40) console.log(`  … и ещё ${files.length - 40}`);
  console.log('\nПробный запуск: ничего не загружено.');
  process.exit(0);
}

const client = new Client(60000);
client.ftp.verbose = false;

/* сеть на хостингах рвётся — одна повторная попытка спасает деплой */
async function retry(label, fn, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw new Error(`${label}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1200 * i));
    }
  }
}

const stat = { uploaded: 0, skipped: 0, kept: 0, bytes: 0 };

try {
  await retry('подключение', () => client.access({
    host: env.FTP_HOST,
    port: Number(env.FTP_PORT || 21),
    user: env.FTP_USER,
    password: env.FTP_PASSWORD,
    secure: env.FTP_SECURE === 'false' ? false : true,
    secureOptions: { rejectUnauthorized: env.FTP_STRICT_TLS === 'true' }
  }));

  for (const [dir, names] of byDir) {
    const remoteDir = dir ? `${REMOTE}/${dir}` : REMOTE;
    await retry(`каталог ${dir || '/'}`, () => client.ensureDir(remoteDir));

    for (const rel of names) {
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      const local = join('dist', rel);
      const size = statSync(local).size;

      let remoteSize = -1;
      try { remoteSize = await client.size(name); } catch { /* файла нет */ }

      if (KEEP_SERVER.has(rel)) {
        if (remoteSize >= 0) { stat.kept++; continue; }        /* боевой файл не трогаем */
      } else if (!force && !ALWAYS.test(rel) && remoteSize === size) {
        stat.skipped++; continue;                               /* медиа не изменилось */
      }

      await retry(rel, () => client.uploadFrom(local, name));
      stat.uploaded++; stat.bytes += size;
      process.stdout.write(`\r  ${rel.padEnd(58).slice(0, 58)}`);
    }
  }

  const mb = (stat.bytes / 1048576).toFixed(1);
  console.log(`\nГотово: загружено ${stat.uploaded} файлов (${mb} МБ), пропущено без изменений ${stat.skipped}, сохранено серверных ${stat.kept}.`);
} catch (e) {
  console.error('\nОшибка выгрузки:', e.message);
  process.exitCode = 1;
} finally {
  client.close();
}
