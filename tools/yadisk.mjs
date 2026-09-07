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

/* ---------- разбор ---------- */
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} МБ`;

let key = link;                         // рабочая форма ссылки, найденная подбором

async function main() {
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
    console.error('Ни одна форма ссылки не открылась:');
    tried.forEach((t) => console.error(`  ${t}`));
    await diagnose(link);
    console.error('\nНужна ссылка на папку вида https://disk.yandex.ru/d/…');
    console.error('На Диске: выбрать папку → «Поделиться» → «Скопировать ссылку».');
    process.exit(1);
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

  /* ---------- опись партии ---------- */
  const lines = [
    `Партия с Яндекс.Диска, ${today}`,
    `Ссылка: ${link}`,
    subPath !== '/' ? `Подпапка: ${subPath}` : '',
    `Режим для видео: ${videoMode}`,
    '',
    `Взято: ${taken.length}`,
    ...taken.map((t) => {
      const info = t.info
        ? `, ${Math.round(t.info.seconds)} с, ${t.info.width}×${t.info.height}, ${t.info.codec}`
        : '';
      const frames = t.kind === 'видео' ? `, кадров: ${t.frames}, сам ролик не сохранён` : '';
      return `  ${t.rel} — ${mb(Number(t.size || 0))}${info}${frames}`;
    }),
  ];
  if (skipped.length) {
    lines.push('', `Пропущено: ${skipped.length}`,
      ...skipped.map((t) => `  ${t.rel} — ${mb(Number(t.size || 0))} — ${t.why}`));
  }
  lines.push('', 'Что дальше: нужное переносится в assets/img/… и src/data/…,',
    'разобранная папка удаляется целиком. Правила — в materials/README.md.', '');

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '_опись.txt'), lines.filter((l) => l !== null).join('\n'), 'utf8');

  console.log(`\nГотово. Взято ${taken.length}, пропущено ${skipped.length}. Опись: ${join(dir, '_опись.txt')}`);
  if (!taken.length) process.exit(1);
}

main().catch((e) => {
  console.error(`\nНе получилось: ${e.message}`);
  console.error('Проверьте, что ссылка открыта «по ссылке» и указывает на папку или файл Яндекс.Диска.');
  process.exit(1);
});
