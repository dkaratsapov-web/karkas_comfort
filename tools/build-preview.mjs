/* Сборка демонстрационной версии для GitHub Pages.
   Отличия от боевой сборки: сайт лежит в подпапке, закрыт от индексации,
   формы работают в демо-режиме, PHP-файлы в сборку не попадают.
   Запуск: npm run preview */
process.env.PREVIEW = '1';
process.env.OUT_DIR = process.env.OUT_DIR || 'preview';
await import('./gen-art.mjs');
await import('./build.mjs');
