/* Публикация демо-версии на временный адрес GitHub Pages.

   Зачем нужен отдельный шаг: окружение github-pages пускает на публикацию
   только ветку по умолчанию, поэтому пуша в рабочую ветку мало — её надо
   ещё перемотать в ветку по умолчанию. Этот скрипт делает ровно это.

   npm run publish:demo         — запушить рабочую ветку и обновить демо
   npm run publish:demo -- --dry — показать, что будет сделано              */
import { execFileSync } from 'node:child_process';

const dry = process.argv.includes('--dry');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const run = (...args) => {
  if (dry) { console.log('  (проверка) git ' + args.join(' ')); return ''; }
  return git(...args);
};

/* --- незакоммиченные правки публиковать нечестно: их не будет в сборке --- */
if (git('status', '--porcelain')) {
  console.error('Есть незакоммиченные изменения. Сначала закоммитьте их, потом публикуйте:\n');
  console.error(git('status', '--short'));
  process.exit(1);
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const head = git('rev-parse', '--short', 'HEAD');

/* --- ветку по умолчанию спрашиваем у самого GitHub, а не у локальных ссылок --- */
const symref = git('ls-remote', '--symref', 'origin', 'HEAD');
const target = (symref.match(/ref:\s+refs\/heads\/(\S+)\s+HEAD/) || [])[1];
if (!target) {
  console.error('Не удалось определить ветку по умолчанию в origin.');
  process.exit(1);
}

console.log(`Рабочая ветка: ${branch} (${head})`);
console.log(`Ветка публикации: ${target}\n`);

run('push', 'origin', `${branch}`);
console.log(`  рабочая ветка отправлена`);

/* Перемотка без слияния: если ветка публикации ушла вперёд, GitHub откажет —
   и это правильно, чужие коммиты затирать нельзя. */
try {
  run('push', 'origin', `HEAD:refs/heads/${target}`);
} catch (e) {
  console.error(`\nGitHub отклонил обновление ветки ${target}.`);
  console.error('Скорее всего, там есть коммиты, которых нет в рабочей ветке.');
  console.error('Заберите их: git fetch origin && git merge origin/' + target);
  process.exit(1);
}
console.log(`  ветка публикации перемотана на ${head}`);

console.log(`\nДемо соберётся за 1–2 минуты: https://dkaratsapov-web.github.io/karkas_comfort/`);
console.log('Ход сборки: вкладка Actions → Preview site.');
if (dry) console.log('\nПробный запуск: ничего не отправлено.');
