/* Сборка островов React в один файл.
 *
 * На сайте React живёт только там, где нужна сложная анимация: сейчас это
 * пролёт в первом экране. Остальные страницы остаются статикой без скриптов.
 * Бандл собирается локально, с CDN ничего не тянется — это правило проекта.
 *
 * Запуск: npm run bundle (входит в npm run build).
 */
import { build } from 'esbuild';
import { statSync, existsSync } from 'node:fs';

const entry = 'src/app/flight.jsx';
const out = 'assets/js/flight.js';

if (!existsSync(entry)) {
  console.log('островов нет — нечего собирать');
  process.exit(0);
}

await build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari15'],
  jsx: 'automatic',
  minify: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning'
});

const kb = (statSync(out).size / 1024).toFixed(0);
console.log(`${out}: ${kb} КБ (React + motion, остров первого экрана)`);
