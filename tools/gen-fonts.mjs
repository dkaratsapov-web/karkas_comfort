/* Сабсет шрифтов: одно семейство — один файл.
   Раньше браузер тянул по два файла на семейство (кириллица + латиница),
   потому что в текстах есть «м²», «×», «·», «—» из латинского диапазона.
   Здесь переменные шрифты Google Fonts урезаются до нужных знаков
   и собираются в один woff2 со всеми начертаниями по весу.

   Исходники (переменные TTF) лежат в tools/fonts-src/ и в сборке не участвуют.
   Запуск: npm run fonts (нужен python3 с fonttools и brotli).              */
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';

const OUT = 'assets/fonts';
const SRC = 'tools/fonts-src';
mkdirSync(OUT, { recursive: true });

/* Что оставляем: латиница ASCII, кириллица, типографская пунктуация,
   градусы, степени, знак умножения, средняя точка, стрелка, рубль. */
const UNICODES = [
  'U+0020-007E', 'U+00A0', 'U+00AB', 'U+00BB', 'U+00B0', 'U+00B2', 'U+00B3',
  'U+00B7', 'U+00D7', 'U+0301', 'U+0400-045F', 'U+0490-0491',
  'U+2010-2015', 'U+2018-201F', 'U+2022', 'U+2026', 'U+2030', 'U+2039-203A',
  'U+2116', 'U+2192', 'U+2212', 'U+20BD'
].join(',');

const FAMILIES = [
  { src: 'Manrope.ttf', out: 'manrope-wght.woff2' },
  { src: 'PlayfairDisplay.ttf', out: 'playfair-display-wght.woff2' }
];

for (const f of FAMILIES) {
  const source = `${SRC}/${f.src}`;
  if (!existsSync(source)) {
    console.log(`пропуск: нет ${source} — шрифт в assets/fonts уже собран`);
    continue;
  }
  execFileSync('python3', ['-m', 'fontTools.subset', source,
    `--unicodes=${UNICODES}`, '--flavor=woff2', '--layout-features=kern,liga,onum,tnum',
    '--name-IDs=*', `--output-file=${OUT}/${f.out}`], { stdio: 'inherit' });
  console.log(`${f.out}: ${(statSync(`${OUT}/${f.out}`).size / 1024).toFixed(1)} КБ`);
}
