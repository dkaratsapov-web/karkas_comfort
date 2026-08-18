/* Каркас Комфорт — интерфейсная логика. Без зависимостей. */
(() => {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';

  /* ---------- Мобильное меню ---------- */
  const burger = $('.burger');
  const mobileNav = $('#mobile-nav');
  if (burger && mobileNav) {
    burger.addEventListener('click', () => {
      const open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      mobileNav.classList.toggle('is-open', !open);
    });
    mobileNav.addEventListener('click', (e) => {
      if (e.target.closest('a')) { burger.setAttribute('aria-expanded', 'false'); mobileNav.classList.remove('is-open'); }
    });
  }


  /* ---------- Шапка: тень при прокрутке ---------- */
  const header = $('.header');
  if (header) {
    const onScroll = () => header.classList.toggle('is-stuck', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- Технология: слои стены ---------- */
  const wall = $('#wall');
  if (wall) {
    const note = $('#wall-note', wall);
    const cut = $('.wall__cut', wall);
    const layers = $$('.layer', wall);
    $$('.layer', wall).forEach((layer, index) => {
      const show = () => {
        layers.forEach((l) => l.classList.toggle('is-active', l === layer));
        note.textContent = layer.dataset.note;
        if (cut) {
          cut.classList.add('has-active');
          cut.classList.toggle('lit-frame', index === 2);
          $$('rect[data-cut]', cut).forEach((r) => r.classList.toggle('is-lit', Number(r.dataset.cut) === index));
        }
      };
      layer.addEventListener('click', show);
      layer.addEventListener('mouseenter', show);
      layer.addEventListener('focus', show);
    });
  }

  /* ---------- Появление блоков при скролле ---------- */
  const reveals = $$('.reveal');
  if (reveals.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  /* ---------- Телефонная маска ---------- */
  $$('input[type="tel"]').forEach((input) => {
    const format = (value) => {
      let d = value.replace(/\D/g, '');
      if (d.startsWith('8')) d = '7' + d.slice(1);
      if (!d.startsWith('7')) d = '7' + d;
      d = d.slice(0, 11);
      const p = ['+7'];
      if (d.length > 1) p.push(' (' + d.slice(1, 4));
      if (d.length >= 5) p.push(') ' + d.slice(4, 7));
      if (d.length >= 8) p.push('-' + d.slice(7, 9));
      if (d.length >= 10) p.push('-' + d.slice(9, 11));
      return p.join('');
    };
    input.addEventListener('focus', () => { if (!input.value) input.value = '+7 ('; });
    input.addEventListener('input', () => { input.value = format(input.value); });
    input.addEventListener('blur', () => { if (input.value.replace(/\D/g, '').length < 11) input.value = input.value.trim() === '+7 (' ? '' : input.value; });
  });

  /* ---------- Отправка форм ----------
     Бэкенда нет: форма проверяет данные и показывает подтверждение.
     Подключение к CRM/почте — см. README, функция sendLead(). */
  async function sendLead(data) {
    const endpoint = document.body.dataset.leadEndpoint;   // задаётся в разметке при подключении бэкенда
    if (!endpoint) return { ok: true, demo: true };
    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    return { ok: res.ok };
  }

  $$('form.form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      let valid = true;
      $$('.field', form).forEach((field) => {
        const input = $('input, textarea, select', field);
        if (!input || !input.required) return;
        const isPhone = input.type === 'tel';
        const bad = isPhone ? input.value.replace(/\D/g, '').length < 11 : !input.value.trim();
        field.classList.toggle('field--error', bad);
        if (bad && valid) { input.focus(); valid = false; }
      });
      const consent = $('.consent input', form);
      if (consent && !consent.checked) { consent.focus(); return; }
      if (!valid) return;

      const btn = $('button[type="submit"]', form);
      if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Отправляем…'; }
      const data = Object.fromEntries(new FormData(form).entries());
      data.page = location.pathname;
      try { await sendLead(data); form.classList.add('is-sent'); }
      catch { alert('Не удалось отправить заявку. Позвоните нам: 8 (920) 171-69-69'); }
      finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
    });
    $$('.field input, .field textarea', form).forEach((input) => {
      input.addEventListener('input', () => input.closest('.field').classList.remove('field--error'));
    });
  });

  /* ---------- Калькулятор стоимости ---------- */
  const calc = $('#calc');
  if (calc) {
    const RATE = { standart: 32000, komfort: 41000, pod_kluch: 52000 };
    const area = $('#calc-area', calc);
    const areaOut = $('#calc-area-value', calc);
    const sum = $('#calc-sum', calc);
    const term = $('#calc-term', calc);
    const monthly = $('#calc-monthly', calc);
    const recalc = () => {
      const a = Number(area.value);
      const tier = ($('input[name="tier"]:checked', calc) || {}).value || 'standart';
      const foundation = $('#calc-foundation', calc).checked ? 190000 : 0;
      const total = a * RATE[tier] + foundation;
      areaOut.textContent = a + ' м²';
      sum.textContent = money(total);
      // ипотека: аннуитет, ставка 5 % годовых, срок 20 лет, взнос 20 %
      const body = total * .8, r = .05 / 12, n = 20 * 12;
      monthly.textContent = money(body * r / (1 - Math.pow(1 + r, -n)));
      if (term) term.textContent = a <= 90 ? '1,5–2 месяца' : a <= 150 ? '2–3 месяца' : '3–4 месяца';
    };
    calc.addEventListener('input', recalc);
    recalc();
  }

  /* ---------- Каталог: фильтры ---------- */
  const catalog = $('#catalog');
  if (catalog && window.KK_PROJECTS) {
    const list = $('#catalog-list', catalog);
    const count = $('#catalog-count', catalog);
    const state = { floors: 'all', size: 'all', sort: 'area-asc' };

    const inSize = (p) => state.size === 'all'
      || (state.size === 's' && p.area < 90)
      || (state.size === 'm' && p.area >= 90 && p.area < 150)
      || (state.size === 'l' && p.area >= 150);

    const card = (p) => `
      <article class="project">
        <div class="project__media">
          <img src="assets/img/projects/${p.slug}.svg" alt="Каркасный дом ${p.code}, ${p.size} м, ${p.area} м²" loading="lazy" width="800" height="460">
          <span class="project__code">${p.code}</span>
        </div>
        <div class="project__body">
          <h3 class="project__title"><a href="proekt.html?id=${p.slug}">Каркасный дом ${p.size}</a></h3>
          <ul class="specs">
            <li>${p.area} м²</li>
            <li>${p.floors === 1 ? '1 этаж' : p.floors === 1.5 ? '1,5 этажа' : '2 этажа'}</li>
            <li>${p.bedrooms} спальни</li>
            ${p.terrace ? '<li>терраса</li>' : ''}
          </ul>
          <div class="project__foot">
            <span class="price">от ${money(p.area * 32000)}<small>под ключ, ориентировочно</small></span>
            <span class="project__more">Подробнее →</span>
          </div>
        </div>
      </article>`;

    const render = () => {
      let items = window.KK_PROJECTS.filter((p) =>
        (state.floors === 'all' || String(p.floors) === state.floors) && inSize(p));
      const [key, dir] = state.sort.split('-');
      items.sort((a, b) => (a[key] - b[key]) * (dir === 'asc' ? 1 : -1));
      list.innerHTML = items.map(card).join('') || '<p class="muted">По этим параметрам проектов нет — подберём индивидуально, позвоните нам.</p>';
      count.textContent = items.length + ' ' + (items.length % 10 === 1 && items.length % 100 !== 11 ? 'проект' : [2,3,4].includes(items.length % 10) && ![12,13,14].includes(items.length % 100) ? 'проекта' : 'проектов');
    };

    $$('.chip', catalog).forEach((chip) => {
      chip.addEventListener('click', () => {
        const group = chip.dataset.group;
        $$(`.chip[data-group="${group}"]`, catalog).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        state[group] = chip.dataset.value;
        render();
      });
    });
    const sortSel = $('#catalog-sort', catalog);
    if (sortSel) sortSel.addEventListener('change', () => { state.sort = sortSel.value; render(); });
    render();
  }

  /* ---------- Страница проекта ---------- */
  const projectPage = $('#project-page');
  if (projectPage && window.KK_PROJECTS) {
    const id = new URLSearchParams(location.search).get('id');
    const p = window.KK_PROJECTS.find((x) => x.slug === id) || window.KK_PROJECTS[0];
    const floors = p.floors === 1 ? 'Одноэтажный' : p.floors === 1.5 ? 'Полутораэтажный' : 'Двухэтажный';
    document.title = `Проект каркасного дома ${p.size} (${p.code}) — Каркас Комфорт`;
    const set = (sel, html) => { const el = $(sel, projectPage); if (el) el.innerHTML = html; };
    set('#p-title', `Каркасный дом ${p.size} <span class="muted">· ${p.code}</span>`);
    set('#p-crumb', `Дом ${p.size} (${p.code})`);
    set('#p-note', p.note);
    set('#p-price', `от ${money(p.area * 32000)}<small>под ключ, ориентировочная стоимость</small>`);
    set('#p-specs', [
      ['Габариты', p.size + ' м'], ['Площадь', p.area + ' м²'], ['Этажность', floors],
      ['Спальни', p.bedrooms], ['Терраса', p.terrace ? 'есть' : 'нет'],
      ['Срок строительства', p.area <= 90 ? '1,5–2 месяца' : p.area <= 150 ? '2–3 месяца' : '3–4 месяца'],
      ['Фундамент', 'свайно-винтовой / ленточный'], ['Гарантия', '5 лет по договору']
    ].map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join(''));
    const img = $('#p-image', projectPage);
    if (img) { img.src = `assets/img/projects/${p.slug}.svg`; img.alt = `Каркасный дом ${p.code}, ${p.size} м`; }
    const hidden = $('#p-project-input', projectPage);
    if (hidden) hidden.value = `${p.code} (${p.size}, ${p.area} м²)`;

    const similar = window.KK_PROJECTS.filter((x) => x.slug !== p.slug)
      .sort((a, b) => Math.abs(a.area - p.area) - Math.abs(b.area - p.area)).slice(0, 3);
    set('#p-similar', similar.map((s) => `
      <article class="project">
        <div class="project__media">
          <img src="assets/img/projects/${s.slug}.svg" alt="Каркасный дом ${s.code}" loading="lazy" width="800" height="460">
          <span class="project__code">${s.code}</span>
        </div>
        <div class="project__body">
          <h3 class="project__title"><a href="proekt.html?id=${s.slug}">Каркасный дом ${s.size}</a></h3>
          <ul class="specs"><li>${s.area} м²</li><li>${s.bedrooms} спальни</li></ul>
          <div class="project__foot"><span class="price">от ${money(s.area * 32000)}<small>под ключ</small></span></div>
        </div>
      </article>`).join(''));
  }

  /* ---------- Активный пункт меню ---------- */
  const page = location.pathname.split('/').pop() || 'index.html';
  $$('.nav a, .mobile-nav a').forEach((a) => {
    if (a.getAttribute('href') === page) a.setAttribute('aria-current', 'page');
  });
})();
