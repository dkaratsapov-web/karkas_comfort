/* Забирает файлы с публичной папки Яндекс.Диска в materials/.
 *
 * Запускается не здесь, а на раннере GitHub Actions: из среды сборки
 * домены Яндекса закрыты сетевой политикой, а у раннера сеть открыта.
 * Ручной запуск: вкладка Actions → «Забрать с Яндекс.Диска» → Run workflow.
 *
 *   node tools/yadisk.mjs --link <ссылка> [--folder имя] [--path /подпапка]
 *                         [--max-mb 90] [--total-mb 300] [--video frames|skip|full]
 *
 * Видео по умолчанию в репозиторий не кладётся: вместо ролика сохраняются
 * несколько кадров и характеристики файла. Иначе репозиторий распухает,
 * а GitHub всё равно не принимает файлы больше 100 МБ.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, extname, basename } from 'node:path';
import { tmpdir } from 'node:os';

const API = 'https://cloud-api.yandex.net/v1/disk/public/resources';
const VIDEO = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.mpg', '.mpeg']);

/* ---------- аргументы ---------- */
const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const link = arg('link');
if (!link) {
  console.error('Не передана ссылка. Пример: node tools/yadisk.mjs --link https://disk.yandex.ru/d/xxxx');
  process.exit(1);
}
const subPath = arg('path', '/');
const maxBytes = Number(arg('max-mb', '90')) * 1024 * 1024;
const totalBytes = Number(arg('total-mb', '300')) * 1024 * 1024;
const videoMode = arg('video', 'frames');
if (!['frames', 'skip', 'full'].includes(videoMode)) {
  console.error(`Непонятный режим для видео: ${videoMode}. Допустимо: frames, skip, full.`);
  process.exit(1);
}

/* Имя партии: либо задано вручную, либо дата плюс имя папки на Диске. */
const today = new Date().toISOString().slice(0, 10);
const safe = (s) => String(s)
  .replace(/[\\/:*?"<>|]/g, '-')       // запрещённые в именах файлов знаки
  .replace(/\.{2,}/g, '.')             // никаких переходов на уровень выше
  .replace(/^[.\s]+|[.\s]+$/g, '')
  .slice(0, 80) || 'file';

/* Ссылка на альбом (disk.yandex.ru/a/…) публичным API не отдаётся: он знает
   только папки и файлы. Иногда за альбомом стоит та же публичная папка, просто
   с другим видом адреса, поэтому перед тем как сдаться, пробуем родственные
   формы. Если не вышло ни одной — заглядываем на саму страницу и рассказываем,
   что там лежит, чтобы не гадать вслепую. */
function candidates(raw) {
  const list = [raw];
  const m = raw.match(/^https?:\/\/(disk\.yandex\.[a-z.]+|yadi\.sk)\/([adi])\/([^/?#]+)/i);
  if (m) {
    const [, host, kind, hash] = m;
    for (const k of ['d', 'i', 'a']) {
      if (k !== kind) list.push(`https://${host}/${k}/${hash}`);
    }
    if (host !== 'disk.yandex.ru') list.push(`https://disk.yandex.ru/d/${hash}`);
  }
  return [...new Set(list)];
}

/* Разведка страницы: печатает, во что упакованы данные альбома.
   Нужна один раз, чтобы написать разбор не наугад. Включается --probe. */
async function probe(raw) {
  const res = await fetch(raw, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'ru' } });
  const html = await res.text();
  console.log(`ответ ${res.status}, ${html.length} знаков`);

  /* саму страницу кладём в репозиторий: разбирать её удобнее у себя,
     чем вычитывать по кускам из журнала прогона. Папка временная. */
  const spy = join('materials', '_разведка');
  mkdirSync(spy, { recursive: true });
  writeFileSync(join(spy, 'stranica.html'), html, 'utf8');
  console.log(`страница сохранена: ${join(spy, 'stranica.html')}`);

  const box = html.match(/<script[^>]*id="store-prefetch"[^>]*>([\s\S]*?)<\/script>/);
  if (!box) {
    console.log('store-prefetch на странице нет');
  } else {
    const text = box[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    console.log(`store-prefetch: ${text.length} знаков`);
    let data = null;
    try { data = JSON.parse(text); } catch (e) { console.log(`не разобрался как JSON: ${e.message}`); }
    if (data) {
      const walkKeys = (obj, path = '', depth = 0) => {
        if (depth > 3 || !obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj)) {
          const here = path ? `${path}.${k}` : k;
          const kind = Array.isArray(v) ? `массив[${v.length}]` : typeof v;
          console.log(`  ${here}: ${kind}`);
          if (!Array.isArray(v)) walkKeys(v, here, depth + 1);
          else if (v.length && typeof v[0] === 'object') {
            console.log(`    первый элемент: ${JSON.stringify(v[0]).slice(0, 600)}`);
          }
        }
      };
      walkKeys(data);
    }
  }

  const i = html.indexOf('downloader.disk');
  if (i !== -1) {
    console.log(`\n--- около первой ссылки на скачивание ---\n${html.slice(Math.max(0, i - 900), i + 600)}`);
  }
}

/* Разбор альбома. Публичный API альбомы не отдаёт, но на самой странице
   лежат адреса вида downloader.disk.yandex.ru/preview/…?filename=…&size=…
   Забираем их, просим кадр покрупнее и сохраняем под исходным именем.
   Это запасной путь: с обычной публичной папкой работает надёжный API. */
async function albumFiles(raw) {
  const res = await fetch(raw, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'ru' } });
  if (!res.ok) throw new Error(`страница альбома ответила ${res.status}`);
  const html = await res.text();

  const box = html.match(/<script[^>]*id="store-prefetch"[^>]*>([\s\S]*?)<\/script>/);
  if (!box) throw new Error('на странице альбома нет store-prefetch — разбирать нечего');
  const text = box[1]
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');                       // амперсанд разэкранируем последним
  const store = JSON.parse(text);

  const items = Object.values(store.resources || {}).filter((r) => r.type === 'file');
  if (!items.length) throw new Error('в альбоме не нашлось файлов');

  /* Имя партии берём из пути на Диске: «кк_павлинов_сдача» говорит больше,
     чем дата альбома. */
  const source = (items[0].path || '').split('/').slice(0, -1).pop() || 'albom';

  return {
    source,
    items: items.map((r) => {
      const meta = r.meta || {};
      /* HEIC и прочее, чего браузер не покажет, берём готовым кадром JPEG —
         на сайт всё равно идёт пережатая картинка. Остальное — оригиналом. */
      const webReady = /\.(jpe?g|png|webp|gif|mp4|pdf)$/i.test(r.name);
      const asPreview = !webReady;
      const url = asPreview
        ? (meta.xxxlPreview || meta.defaultPreview || meta.original)
        : (meta.original || meta.xxxlPreview || meta.defaultPreview);
      const stem = safe(basename(r.name, extname(r.name)));
      return {
        name: r.name,
        url,
        fallback: meta.defaultPreview || meta.original || meta.xxxlPreview,
        outName: asPreview ? `${stem}.jpg` : safe(r.name),
        size: Number(meta.size || 0),
        mediatype: meta.mediatype || '',
        asPreview,
      };
    }),
  };
}

async function fetchAlbum(folderArg) {
  const { source, items } = await albumFiles(link);
  const dir = join('materials', safe(folderArg || `${today}-${source}`));
  console.log(`Альбом «${source}»: файлов ${items.length}. Кладу в ${dir}/`);

  const taken = [];
  const skipped = [];
  let used = 0;

  for (const item of items) {
    if (item.mediatype === 'video' && videoMode === 'skip') {
      skipped.push({ rel: item.name, size: item.size, why: 'видео пропущено по настройке' });
      continue;
    }
    if (used > totalBytes) {
      skipped.push({ rel: item.name, size: item.size, why: 'исчерпан общий лимит партии' });
      continue;
    }

    let ok = false;
    for (const url of [item.url, item.fallback].filter(Boolean)) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 2048) continue;              // заглушка вместо снимка
        const file = join(dir, item.outName);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, buf);
        used += buf.length;
        taken.push({
          rel: item.outName,
          size: buf.length,
          from: item.asPreview ? `${item.name}, ${mb(item.size)}` : '',
          kind: item.asPreview ? 'кадр XXXL' : 'оригинал',
        });
        console.log(`  ✓ ${item.name} → ${item.outName}, ${mb(buf.length)}${item.asPreview ? ' (кадр XXXL)' : ''}`);
        ok = true;
        break;
      } catch { /* пробуем запасной адрес */ }
    }
    if (!ok) {
      skipped.push({ rel: item.name, size: item.size, why: 'файл не отдался' });
      console.log(`  ✗ ${item.name}`);
    }
  }
  return { taken, skipped, dir };
}

async function diagnose(raw) {
  console.error('\nСмотрю саму страницу, чтобы понять, что это за ссылка…');
  try {
    const res = await fetch(raw, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'ru' } });
    const html = await res.text();
    console.error(`  ответ страницы: ${res.status}, размер ${html.length} знаков`);
    const title = html.match(/<title[^>]*>([^<]{0,160})/i);
    if (title) console.error(`  заголовок: ${title[1].trim()}`);
    const keys = [...new Set([...html.matchAll(/"public_key"\s*:\s*"([^"]{6,120})"/g)].map((x) => x[1]))];
    if (keys.length) console.error(`  public_key на странице: ${keys.slice(0, 5).join(', ')}`);
    const albums = /album|Альбом/i.test(html);
    console.error(`  похоже на альбом: ${albums ? 'да' : 'нет'}`);
  } catch (e) {
    console.error(`  страницу тоже не удалось открыть: ${e.message}`);
  }
}

/* ---------- обращения к API ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params, tries = 4) {
  const url = `${API}${params.endpoint || ''}?${new URLSearchParams(params.query)}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok) return res.json();
    /* 429 и пятисотки — повод подождать и повторить, остальное безнадёжно */
    if (attempt >= tries || (res.status !== 429 && res.status < 500)) {
      throw new Error(`Яндекс.Диск ответил ${res.status} на ${url}\n${(await res.text()).slice(0, 300)}`);
    }
    await sleep(attempt * 1500);
  }
}

/* Публичная папка отдаётся страницами по 200 позиций. */
async function listDir(path) {
  const items = [];
  for (let offset = 0; ; offset += 200) {
    const data = await api({ query: { public_key: key, path, limit: 200, offset, sort: 'name' } });
    const box = data._embedded;
    if (!box) {                                   // одиночный файл, а не папка
      return [data];
    }
    items.push(...box.items);
    if (box.items.length < 200 || items.length >= (box.total ?? items.length)) break;
  }
  return items;
}

async function walk(path, rel = '') {
  const out = [];
  for (const item of await listDir(path)) {
    const name = safe(item.name);
    if (item.type === 'dir') {
      out.push(...await walk(item.path, rel ? `${rel}/${name}` : name));
    } else {
      out.push({ ...item, rel: rel ? `${rel}/${name}` : name, safeName: name });
    }
  }
  return out;
}

async function hrefOf(item) {
  if (item.file) return item.file;
  const data = await api({ endpoint: '/download', query: { public_key: key, path: item.path } });
  return data.href;
}

async function download(item, dest) {
  const res = await fetch(await hrefOf(item));
  if (!res.ok) throw new Error(`Не скачался ${item.rel}: ${res.status}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/* ---------- видео: кадры вместо самого файла ---------- */
const has = (bin) => {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
};

function videoInfo(file) {
  if (!has('ffprobe')) return null;
  try {
    const raw = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json',
      '-show_format', '-show_streams', file], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const data = JSON.parse(raw);
    const v = (data.streams || []).find((s) => s.codec_type === 'video') || {};
    return {
      seconds: Number(data.format?.duration || 0),
      width: v.width || 0,
      height: v.height || 0,
      codec: v.codec_name || '',
    };
  } catch { return null; }
}

function grabFrames(file, outDir, seconds) {
  if (!has('ffmpeg')) return 0;
  mkdirSync(outDir, { recursive: true });
  const points = seconds > 4 ? [0.08, 0.34, 0.6, 0.86].map((k) => seconds * k) : [0];
  let made = 0;
  points.forEach((t, i) => {
    const out = join(outDir, `кадр-${String(i + 1).padStart(2, '0')}.jpg`);
    try {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(2),
        '-i', file, '-frames:v', '1', '-q:v', '3', '-vf', 'scale=1280:-2', '-y', out], { stdio: 'ignore' });
      if (existsSync(out) && statSync(out).size > 0) made++;
    } catch { /* один невынутый кадр не повод валить всю партию */ }
  });
  return made;
}

/* Опись партии: что взято, что пропущено и почему. Читается человеком
   и служит подсказкой при разборе — потом папка удаляется целиком. */
function writeReport(dir, taken, skipped, isAlbum) {
  const lines = [
    `Партия с Яндекс.Диска, ${today}`,
    `Ссылка: ${link}`,
    isAlbum ? 'Источник: альбом — забраны кадры со страницы, не исходные файлы' : '',
    subPath !== '/' ? `Подпапка: ${subPath}` : '',
    isAlbum ? '' : `Режим для видео: ${videoMode}`,
    '',
    `Взято: ${taken.length}`,
    ...taken.map((t) => {
      const info = t.info
        ? `, ${Math.round(t.info.seconds)} с, ${t.info.width}×${t.info.height}, ${t.info.codec}`
        : '';
      const frames = t.kind === 'видео' ? `, кадров: ${t.frames}, сам ролик не сохранён` : '';
      const from = t.from && t.from !== t.rel ? ` (из ${t.from})` : '';
      return `  ${t.rel}${from} — ${mb(Number(t.size || 0))}${info}${frames}`;
    }),
  ];
  if (skipped.length) {
    lines.push('', `Пропущено: ${skipped.length}`,
      ...skipped.map((t) => `  ${t.rel} — ${mb(Number(t.size || 0))} — ${t.why}`));
  }
  lines.push('', 'Что дальше: нужное переносится в assets/img/… и src/data/…,',
    'разобранная папка удаляется целиком. Правила — в materials/README.md.', '');

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '_опись.txt'), lines.filter((l) => l !== '').join('\n'), 'utf8');
}

/* ---------- разбор ---------- */
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} МБ`;

let key = link;                         // рабочая форма ссылки, найденная подбором

async function main() {
  if (args.includes('--probe')) { await probe(link); return; }
  let root = null;
  const tried = [];
  for (const candidate of candidates(link)) {
    try {
      root = await api({ query: { public_key: candidate, path: subPath, limit: 1 } });
      key = candidate;
      if (candidate !== link) console.log(`Ссылка подобрана: ${candidate}`);
      break;
    } catch (e) {
      tried.push(`${candidate} — ${e.message.split('\n')[0]}`);
    }
  }
  if (!root) {
    /* Папкой ссылка не открылась. Возможно, это альбом — у него данные
       лежат на самой странице, забираем оттуда. */
    console.log('Публичным API ссылка не открылась:');
    tried.forEach((t) => console.log(`  ${t}`));
    console.log('Пробую разобрать как альбом.');
    let result;
    try {
      result = await fetchAlbum(arg('folder'));
    } catch (e) {
      console.error(`Альбом тоже не разобрался: ${e.message}`);
      await diagnose(link);
      console.error('\nНужна ссылка на папку вида https://disk.yandex.ru/d/…');
      console.error('На Диске: выбрать папку → «Поделиться» → «Скопировать ссылку».');
      process.exit(1);
    }
    writeReport(result.dir, result.taken, result.skipped, true);
    console.log(`\nГотово. Взято ${result.taken.length}, пропущено ${result.skipped.length}.`);
    if (!result.taken.length) process.exit(1);
    return;
  }
  const folder = safe(arg('folder', `${today}-${root.name || 'yadisk'}`));
  const dir = join('materials', folder);

  const files = await walk(subPath);
  if (!files.length) {
    console.error('В папке ничего не нашлось — проверьте ссылку и то, что доступ открыт по ссылке.');
    process.exit(1);
  }
  console.log(`Нашлось файлов: ${files.length}. Кладу в ${dir}/`);

  const taken = [];
  const skipped = [];
  const temp = join(tmpdir(), `yadisk-${Date.now()}`);
  let used = 0;

  for (const item of files) {
    const size = Number(item.size || 0);
    const isVideo = VIDEO.has(extname(item.safeName).toLowerCase());

    if (isVideo && videoMode === 'skip') {
      skipped.push({ ...item, why: 'видео пропущено по настройке' });
      continue;
    }
    if (size > maxBytes && !(isVideo && videoMode === 'frames')) {
      skipped.push({ ...item, why: `больше ${mb(maxBytes)}` });
      continue;
    }
    if (!isVideo || videoMode === 'full') {
      if (used + size > totalBytes) {
        skipped.push({ ...item, why: 'исчерпан общий лимит партии' });
        continue;
      }
    }

    try {
      if (isVideo && videoMode === 'frames') {
        /* ролик качаем во временную папку, в репозиторий кладём только кадры */
        mkdirSync(temp, { recursive: true });
        const tmpFile = join(temp, item.safeName);
        await download(item, tmpFile);
        const info = videoInfo(tmpFile);
        const stem = basename(item.safeName, extname(item.safeName));
        const frames = grabFrames(tmpFile, join(dir, '_видео', stem), info?.seconds || 0);
        rmSync(tmpFile, { force: true });
        taken.push({ ...item, kind: 'видео', frames, info });
        console.log(`  ✓ ${item.rel} — ${mb(size)}, кадров: ${frames}, сам файл не сохранён`);
      } else {
        await download(item, join(dir, item.rel));
        used += size;
        taken.push({ ...item, kind: 'файл' });
        console.log(`  ✓ ${item.rel} — ${mb(size)}`);
      }
    } catch (e) {
      skipped.push({ ...item, why: e.message });
      console.log(`  ✗ ${item.rel} — ${e.message}`);
    }
  }

  rmSync(temp, { recursive: true, force: true });

  writeReport(dir, taken, skipped, false);

  console.log(`\nГотово. Взято ${taken.length}, пропущено ${skipped.length}. Опись: ${join(dir, '_опись.txt')}`);
  if (!taken.length) process.exit(1);
}

main().catch((e) => {
  console.error(`\nНе получилось: ${e.message}`);
  console.error('Проверьте, что ссылка открыта «по ссылке» и указывает на папку или файл Яндекс.Диска.');
  process.exit(1);
});
