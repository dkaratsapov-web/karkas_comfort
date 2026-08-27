/* Каркас Комфорт — интерфейсная логика. Без зависимостей. */
(() => {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
  const RATES = (() => {
    try { return JSON.parse(document.body.dataset.rates); }
    catch { return { standart: 32000, komfort: 41000, pod_kluch: 52000 }; }
  })();

  /* ---------- события аналитики ----------
     Работает и с Яндекс.Метрикой, и с Google Analytics, и без них.
     Номер счётчика Метрики берётся из data-metrika у <body>. */
  const track = (name, params) => {
    const id = document.body.dataset.metrika;
    if (id && typeof window[`ym`] === 'function') window.ym(Number(id), 'reachGoal', name, params);
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
    if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event: name, ...(params || {}) });
  };
  document.addEventListener('click', (e) => {
    const call = e.target.closest('[data-lead-call]');
    if (call) track('call_click', { page: location.pathname });
    const msg = e.target.closest('[data-lead-messenger]');
    if (msg) track('messenger_click', { page: location.pathname });
  });

  /* ---------- мобильное меню ---------- */
  const burger = $('.burger');
  const mobileNav = $('#mobile-nav');
  if (burger && mobileNav) {
    const closeBtn = $('.mobile-nav__close', mobileNav);
    const focusables = () => $$('a, button', mobileNav).filter((el) => el.offsetParent !== null);

    const setOpen = (open) => {
      burger.setAttribute('aria-expanded', String(open));
      mobileNav.classList.toggle('is-open', open);
      mobileNav.hidden = !open;
      document.body.classList.toggle('is-locked', open);   // фон не прокручивается
      if (open) (focusables()[0] || mobileNav).focus({ preventScroll: true });
      else burger.focus({ preventScroll: true });
    };

    burger.addEventListener('click', () => setOpen(burger.getAttribute('aria-expanded') !== 'true'));
    if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));
    mobileNav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });

    document.addEventListener('keydown', (e) => {
      if (!mobileNav.classList.contains('is-open')) return;
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ---------- шапка: тень при прокрутке ---------- */
  const header = $('.header');
  if (header) {
    const onScroll = () => header.classList.toggle('is-stuck', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- технология: слои стены ---------- */
  const wall = $('#wall');
  if (wall) {
    const note = $('#wall-note', wall);
    const cut = $('.wall__cut', wall);
    const layers = $$('.layer', wall);
    layers.forEach((layer, index) => {
      layer.setAttribute('aria-pressed', 'false');
      const show = () => {
        layers.forEach((l) => { const on = l === layer; l.classList.toggle('is-active', on); l.setAttribute('aria-pressed', String(on)); });
        if (note) note.textContent = layer.dataset.note;
        if (cut) {
          cut.classList.add('has-active');
          cut.classList.toggle('lit-frame', index === 2);
          $$('rect[data-cut]', cut).forEach((r) => r.classList.toggle('is-lit', Number(r.dataset.cut) === index));
        }
      };
      layer.addEventListener('click', show);
      layer.addEventListener('focus', show);
    });
  }

  /* ---------- появление блоков при скролле ---------- */
  const reveals = $$('.reveal');
  if (reveals.length && 'IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  /* ---------- телефонная маска ---------- */
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

  /* ---------- кнопка «рассчитать этот проект» подставляет проект в форму ---------- */
  $$('[data-project]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('input[name="project"]').forEach((i) => { i.value = btn.dataset.project; });
    });
  });

  /* ---------- отправка форм ---------- */
  async function sendLead(data) {
    const endpoint = document.body.dataset.leadEndpoint;   // адрес обработчика заявок
    if (!endpoint) return { ok: true, demo: true };
    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    let payload = {};
    try { payload = await res.json(); } catch { /* сервер ответил не JSON */ }
    return { ok: res.ok && payload.ok !== false, error: payload.error };
  }

  $$('form.form').forEach((form) => {
    const markField = (field, bad) => {
      field.classList.toggle('field--error', bad);
      const input = $('input, textarea, select', field);
      const msg = $('.field__error', field);
      if (!input) return;
      input.setAttribute('aria-invalid', String(bad));
      if (msg && msg.id) {
        if (bad) input.setAttribute('aria-describedby', msg.id);
        else input.removeAttribute('aria-describedby');
      }
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      let firstBad = null;
      $$('.field', form).forEach((field) => {
        const input = $('input, textarea, select', field);
        if (!input || !input.required) return;
        const isPhone = input.type === 'tel';
        const bad = isPhone ? input.value.replace(/\D/g, '').length < 11 : !input.value.trim();
        markField(field, bad);
        if (bad && !firstBad) firstBad = input;
      });

      const consentWrap = $('.consent', form);
      const consent = consentWrap && $('input', consentWrap);
      const errorBox = $('.form__error', form);
      const showError = (text) => { form.classList.add('has-error'); if (errorBox) errorBox.textContent = text; };
      form.classList.remove('has-error');

      if (consent) {
        const bad = !consent.checked;
        consentWrap.classList.toggle('consent--error', bad);
        consent.setAttribute('aria-invalid', String(bad));
        if (bad && !firstBad) firstBad = consent;
      }

      if (firstBad) {
        showError(consent && !consent.checked && firstBad === consent
          ? 'Отметьте согласие на обработку персональных данных — без него мы не имеем права принять заявку.'
          : 'Проверьте заполнение: подсвеченные поля заполнены не полностью.');
        firstBad.focus();
        return;
      }

      const btn = $('button[type="submit"]', form);
      if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Отправляем…'; }
      const data = Object.fromEntries(new FormData(form).entries());
      data.page = location.pathname;

      try {
        const result = await sendLead(data);
        if (result.ok) {
          form.classList.add('is-sent');
          track('lead_sent', { page: location.pathname, project: data.project || '' });
        } else {
          showError(result.error || 'Не удалось отправить заявку. Позвоните нам: 8 (920) 171-69-69');
          track('lead_error', { page: location.pathname });
        }
      } catch {
        showError('Не удалось отправить заявку — проверьте связь или позвоните: 8 (920) 171-69-69');
        track('lead_error', { page: location.pathname });
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
      }
    });

    $$('.field input, .field textarea', form).forEach((input) => {
      input.addEventListener('input', () => markField(input.closest('.field'), false));
    });
    const consentInput = $('.consent input', form);
    if (consentInput) consentInput.addEventListener('change', () => {
      consentInput.closest('.consent').classList.remove('consent--error');
      consentInput.setAttribute('aria-invalid', 'false');
    });
  });

  /* ---------- квиз-расчёт ---------- */
  const quiz = $('#quiz');
  if (quiz) {
    const steps = $$('.quiz__step', quiz);
    const bars = $$('.quiz__bar i', quiz);
    const stepLabel = $('#quiz-step', quiz);
    const resultBox = $('#quiz-result', quiz);
    const areaInput = $('#quiz-area', quiz);
    const areaOut = $('#quiz-area-value', quiz);
    const state = { step: 0, area: 100, tier: 'komfort', land: 'yes' };

    const total = () => state.area * RATES[state.tier];
    const range = () => `${(total() * .95 / 1e6).toFixed(1).replace('.', ',')} – ${(total() * 1.08 / 1e6).toFixed(1).replace('.', ',')} млн ₽`;

    const render = () => {
      steps.forEach((s, i) => s.classList.toggle('is-current', i === state.step));
      bars.forEach((b, i) => b.classList.toggle('is-done', i <= state.step));
      if (stepLabel) stepLabel.textContent = `Шаг ${state.step + 1} из ${steps.length}`;
      if (areaOut) areaOut.textContent = `${state.area} м²`;
      if (resultBox) resultBox.innerHTML = `<span class="muted">Предварительно для дома ${state.area} м², комплектация «${{ standart: 'Стандарт', komfort: 'Комфорт', pod_kluch: 'Под ключ' }[state.tier]}»</span><b>${range()}</b>`;
      $$('.quiz__option', quiz).forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.value === state[o.dataset.group])));
      const projectInput = $('input[name="project"]', quiz);
      if (projectInput) projectInput.value = `Квиз: ${state.area} м², ${state.tier}, участок: ${state.land === 'yes' ? 'есть' : 'нет'}, ориентир ${range()}`;
    };

    $$('.quiz__option', quiz).forEach((option) => {
      option.addEventListener('click', () => {
        state[option.dataset.group] = option.dataset.value;
        render();
      });
    });
    if (areaInput) areaInput.addEventListener('input', () => { state.area = Number(areaInput.value); render(); });
    $$('[data-quiz-next]', quiz).forEach((b) => b.addEventListener('click', () => {
      state.step = Math.min(state.step + 1, steps.length - 1);
      track('quiz_step', { step: state.step + 1 });
      render();
    }));
    $$('[data-quiz-prev]', quiz).forEach((b) => b.addEventListener('click', () => { state.step = Math.max(state.step - 1, 0); render(); }));
    render();
  }

  /* ---------- каталог: фильтры и сортировка ----------
     Карточки приходят с сервера готовыми (их видно и без JS, и поисковику),
     поэтому здесь мы только показываем нужные и меняем их порядок. */
  const catalog = $('#catalog');
  if (catalog) {
    const list = $('#catalog-list', catalog);
    const count = $('#catalog-count', catalog);
    const toggle = $('.filters__toggle', catalog);
    const filters = $('.filters', catalog);
    const cards = $$('.project', list);
    const params = new URLSearchParams(location.search);
    const state = {
      floors: params.get('floors') || 'all',
      size: params.get('size') || 'all',
      sort: params.get('sort') || 'area-asc'
    };
    const num = (card, key) => Number(card.dataset[key]);
    const inSize = (card) => {
      const area = num(card, 'area');
      return state.size === 'all'
        || (state.size === 's' && area < 90)
        || (state.size === 'm' && area >= 90 && area < 150)
        || (state.size === 'l' && area >= 150);
    };
    const plural = (n) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'проект'
      : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'проекта' : 'проектов');

    const syncUrl = () => {
      const q = new URLSearchParams();
      if (state.floors !== 'all') q.set('floors', state.floors);
      if (state.size !== 'all') q.set('size', state.size);
      if (state.sort !== 'area-asc') q.set('sort', state.sort);
      history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
    };

    let empty = null;
    const render = () => {
      const shown = cards.filter((card) =>
        (state.floors === 'all' || card.dataset.floors === state.floors) && inSize(card));
      const [key, dir] = state.sort.split('-');
      const field = key === 'price' ? 'price' : 'area';
      shown.sort((a, b) => (num(a, field) - num(b, field)) * (dir === 'desc' ? -1 : 1));
      cards.forEach((card) => { card.hidden = !shown.includes(card); });
      shown.forEach((card) => list.append(card));          // порядок задаётся перестановкой узлов
      if (count) count.textContent = plural(shown.length);
      if (!empty) {
        empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'По этим параметрам проектов нет — подберём индивидуально, позвоните нам.';
        list.after(empty);
      }
      empty.hidden = shown.length > 0;
    };

    $$('.chip', catalog).forEach((chip) => {
      const group = chip.dataset.group;
      chip.setAttribute('aria-pressed', String(state[group] === chip.dataset.value));
      chip.addEventListener('click', () => {
        $$(`.chip[data-group="${group}"]`, catalog).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        state[group] = chip.dataset.value;
        syncUrl(); render();
      });
    });

    const sortSel = $('#catalog-sort', catalog);
    if (sortSel) {
      sortSel.value = state.sort;
      sortSel.addEventListener('change', () => { state.sort = sortSel.value; syncUrl(); render(); });
    }

    if (toggle && filters) {
      filters.classList.add('is-collapsed');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        const collapsed = filters.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
      });
    }

    render();
  }

  /* ---------- активный пункт меню ---------- */
  const section = (url) => (url.split('?')[0].split('#')[0].replace(/^\/|\/$/g, '').split('/')[0] || '');
  const here = section(location.pathname);
  $$('.nav a, .mobile-nav a').forEach((a) => {
    const target = section(a.getAttribute('href') || '');
    if (target && target === here) a.setAttribute('aria-current', 'page');
  });
})();
