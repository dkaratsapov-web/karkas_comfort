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

  document.documentElement.classList.add('js');

  /* ---------- появление блоков при прокрутке ----------
     Секции и карточки выезжают снизу с небольшой задержкой друг за другом.
     Без IntersectionObserver и при отключённой анимации всё видно сразу. */
  const reveal = () => {
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const groups = [
      ['.section__head', 0],
      ['.grid > *, .tiers > *, .bento > *, .shots > *, .steps > *, .timeline > *, .figures > *', 55],
      ['.split > *, .card, .project, .tile', 45]
    ];
    const seen = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    groups.forEach(([sel, step]) => {
      $$(sel).forEach((el) => {
        if (seen.has(el) || el.closest('.header, .mobile-nav, .hero')) return;
        seen.add(el);
        const sibs = el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : 0;
        el.dataset.reveal = '';
        el.style.setProperty('--d', `${Math.min(sibs, 5) * step}ms`);
        io.observe(el);
      });
    });
  };
  reveal();

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

  /* ---------- калькулятор стоимости ----------
     Всё считается из data-pricing на <body>: ставки, поправка на этажность,
     фундамент по площади застройки, доплаты и доли этапов. Формулы здесь,
     цифры — в src/data/pricing.json. */
  const calc = $('#calc');
  if (calc) {
    let P = null;
    try { P = JSON.parse(document.body.dataset.pricing); } catch { P = null; }
    if (P) {
      const state = {
        area: 120,
        floors: P.floors[0].id,
        tier: 'komfort',
        foundation: P.foundations[0].id,
        extras: new Set()
      };

      const nf = new Intl.NumberFormat('ru-RU');
      const money0 = (n) => nf.format(Math.round(n / 1000) * 1000);

      /* сегментированный переключатель */
      const seg = (host, items, group, render) => {
        host.innerHTML = items.map((it) => `<button class="seg__btn" type="button" data-value="${it.id}" aria-pressed="${state[group] === it.id}">${render(it)}</button>`).join('');
        host.addEventListener('click', (e) => {
          const btn = e.target.closest('.seg__btn');
          if (!btn) return;
          state[group] = btn.dataset.value;
          $$('.seg__btn', host).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
          update();
        });
      };

      seg($('[data-group="floors"]', calc), P.floors, 'floors', (it) => it.name);
      seg($('[data-group="foundation"]', calc), P.foundations, 'foundation',
        (it) => `<b>${it.name}</b><span>${it.note}</span>`);
      seg($('[data-group="tier"]', calc), P.tiers, 'tier',
        (it) => `<b>${it.name}</b><span>${it.note}</span><em>${nf.format(P.ratePerM2[it.id])} ₽/м²</em>`);

      /* доплаты */
      const extrasHost = $('[data-group="extras"]', calc);
      extrasHost.innerHTML = P.extras.map((it) => `<label class="calc__extra">
        <input type="checkbox" value="${it.id}">
        <span class="calc__extra__body"><b>${it.name}</b><span>${it.note}</span></span>
        <em data-extra-sum="${it.id}"></em>
      </label>`).join('');
      extrasHost.addEventListener('change', (e) => {
        const box = e.target.closest('input[type="checkbox"]');
        if (!box) return;
        if (box.checked) state.extras.add(box.value); else state.extras.delete(box.value);
        update();
      });

      /* площадь: ползунок и поле связаны */
      const range = $('#calc-area', calc);
      const num = $('#calc-area-num', calc);
      const setArea = (v, from) => {
        const n = Math.min(300, Math.max(40, Math.round(Number(v) || 40)));
        state.area = n;
        if (from !== 'range') range.value = String(Math.round(n / 5) * 5);
        if (from !== 'num') num.value = String(n);
        update();
      };
      range.addEventListener('input', () => setArea(range.value, 'range'));
      num.addEventListener('input', () => { if (num.value.length >= 2) setArea(num.value, 'num'); });
      num.addEventListener('blur', () => setArea(num.value));

      /* плавный счётчик: цифры не прыгают, а доезжают */
      const spin = (el, to) => {
        const from = Number(el.dataset.v || 0);
        if (from === to) { el.textContent = money0(to); return; }
        el.dataset.v = String(to);
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = money0(to); return; }
        const t0 = performance.now(), dur = 420;
        const tick = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          const e = 1 - Math.pow(1 - k, 3);
          el.textContent = money0(from + (to - from) * e);
          if (k < 1 && el.dataset.v === String(to)) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };

      const extraSum = (it) => (it.fixed || 0) + (it.perM2 ? it.perM2 * state.area : 0);

      const compute = () => {
        const floor = P.floors.find((f) => f.id === state.floors) || P.floors[0];
        const tier = P.tiers.find((t) => t.id === state.tier) || P.tiers[1];
        const found = P.foundations.find((f) => f.id === state.foundation) || P.foundations[0];
        const house = state.area * P.ratePerM2[tier.id] * floor.factor;
        const footprint = state.area / Number(floor.id);
        const foundation = footprint * found.perM2;
        const extras = P.extras.filter((it) => state.extras.has(it.id)).reduce((sum, it) => sum + extraSum(it), 0);
        const total = house + foundation + extras;
        const term = (P.terms.find((t) => state.area <= t.maxArea) || P.terms[P.terms.length - 1]).text;
        return { total, house, foundation, extras, tier, floor, found, term };
      };

      const stagesHost = $('[data-calc-stages]', calc);
      const update = () => {
        const r = compute();
        const low = r.total * (1 - P.spread);
        const high = r.total * (1 + P.spread);
        spin($('[data-calc-low]', calc), low);
        spin($('[data-calc-high]', calc), high);

        $('[data-calc-note]', calc).textContent =
          `Дом ${state.area} м², ${r.floor.name.toLowerCase()}, «${r.tier.name}», фундамент: ${r.found.name.toLowerCase()}`;
        $('[data-calc-term]', calc).textContent = r.term;
        $('[data-calc-perm2]', calc).textContent = `${nf.format(Math.round(r.total / state.area / 100) * 100)} ₽`;

        P.extras.forEach((it) => {
          const cell = $(`[data-extra-sum="${it.id}"]`, calc);
          if (cell) cell.textContent = `+ ${nf.format(Math.round(extraSum(it) / 1000) * 1000)} ₽`;
        });

        /* этапы: доли зависят от комплектации, нулевые не показываем */
        const rows = P.stages
          .map((st) => ({ name: st.name, share: st.share[r.tier.id] || 0 }))
          .filter((st) => st.share > 0);
        const sum = rows.reduce((a, b) => a + b.share, 0) || 1;
        const max = Math.max(...rows.map((st) => st.share));
        stagesHost.innerHTML = rows.map((st) => {
          const value = r.total * (st.share / sum);
          return `<div class="calc__stage">
            <span class="calc__stage__name">${st.name}</span>
            <span class="calc__stage__bar"><i style="--w:${Math.round(st.share / max * 100)}%"></i></span>
            <span class="calc__stage__sum">${nf.format(Math.round(value / 10000) * 10000)} ₽</span>
          </div>`;
        }).join('');

        const cta = $('[data-calc-cta]', calc);
        const picked = P.extras.filter((it) => state.extras.has(it.id)).map((it) => it.name.toLowerCase());
        cta.dataset.project = `Расчёт: ${state.area} м², ${r.floor.name}, «${r.tier.name}», фундамент ${r.found.name.toLowerCase()}`
          + (picked.length ? `, доп: ${picked.join(', ')}` : '')
          + ` — ${money0(low)}–${money0(high)} ₽`;
      };

      update();
    }
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

  /* ---------- окно заявки ----------
     Кнопки «Рассчитать» больше не прыгают к якорю, а открывают форму
     поверх страницы. Контекст (проект или комплектация) уезжает
     в скрытое поле, чтобы менеджер видел, откуда пришла заявка. */
  const modal = $('#lead-modal');
  if (modal) {
    const card = $('.modal__card', modal);
    const projectNote = $('[data-modal-project]', modal);
    const projectInput = $('[data-modal-project-input]', modal);
    let opener = null;

    const focusables = () => $$('button, a[href], input, textarea, select', card)
      .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);

    const close = () => {
      modal.classList.remove('is-open');
      const done = () => { modal.hidden = true; modal.removeEventListener('transitionend', done); };
      modal.addEventListener('transitionend', done);
      setTimeout(done, 400);
      document.body.classList.remove('is-locked');
      if (opener) opener.focus({ preventScroll: true });
    };

    const open = (from) => {
      opener = from || null;
      const project = from ? (from.dataset.project || from.closest('[data-project]')?.dataset.project || '') : '';
      if (projectInput) projectInput.value = project;
      if (projectNote) {
        projectNote.hidden = !project;
        projectNote.textContent = project ? `Проект: ${project}` : '';
      }
      modal.hidden = false;
      requestAnimationFrame(() => modal.classList.add('is-open'));
      document.body.classList.add('is-locked');
      const first = focusables()[1] || focusables()[0];
      if (first) first.focus({ preventScroll: true });
      track('lead_modal_open', { page: location.pathname });
    };

    /* все кнопки, которые раньше вели к форме на странице */
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href$="#zayavka"], a[href$="#raschet"], [data-lead-modal]');
      if (!link || link.closest('.modal')) return;
      e.preventDefault();
      const nav = link.closest('.mobile-nav');
      if (nav && nav.classList.contains('is-open')) $('.burger')?.click();
      open(link);
    });

    modal.addEventListener('click', (e) => { if (e.target.closest('[data-modal-close]')) close(); });
    document.addEventListener('keydown', (e) => {
      if (modal.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ---------- галерея проекта: переключение главного кадра ---------- */
  const gal = $('[data-gallery]');
  if (gal) {
    const main = $('.gallery__main img', gal);
    const now  = $('[data-gallery-current]', gal);
    const thumbs = $$('button.gallery__thumb', gal);
    thumbs.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const img = $('img', btn);
        main.src = btn.dataset.full || img.src;
        main.alt = img.alt;
        main.dataset.zoomIndex = String(i);
        thumbs.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        if (now) now.textContent = String(i + 1);
      });
    });
  }

  /* ---------- просмотр фотографий во весь экран ---------- */
  const zoomables = $$('[data-zoom]');
  if (zoomables.length) {
    let box = null, items = [], idx = 0, opener = null;

    const build = () => {
      box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Просмотр фотографии');
      box.innerHTML =
        '<button class="lightbox__close" type="button" aria-label="Закрыть">&times;</button>' +
        '<button class="lightbox__nav lightbox__nav--prev" type="button" aria-label="Предыдущее фото">&#8249;</button>' +
        '<figure class="lightbox__stage"><img alt=""><figcaption class="lightbox__cap"></figcaption></figure>' +
        '<button class="lightbox__nav lightbox__nav--next" type="button" aria-label="Следующее фото">&#8250;</button>';
      document.body.append(box);
      box.addEventListener('click', (e) => {
        if (e.target === box || e.target.closest('.lightbox__close')) close();
        else if (e.target.closest('.lightbox__nav--prev')) go(-1);
        else if (e.target.closest('.lightbox__nav--next')) go(1);
      });
      return box;
    };

    const show = () => {
      const el = items[idx];
      const img = $('img', box);
      img.src = el.dataset.zoom || el.currentSrc || el.src;
      img.alt = el.alt || '';
      $('.lightbox__cap', box).textContent = `${el.alt || ''} — ${idx + 1} из ${items.length}`;
      $$('.lightbox__nav', box).forEach((b) => { b.hidden = items.length < 2; });
    };

    const go = (step) => { idx = (idx + step + items.length) % items.length; show(); };

    const close = () => {
      if (!box) return;
      box.classList.remove('is-open');
      box.hidden = true;
      document.body.classList.remove('is-locked');
      if (opener) opener.focus({ preventScroll: true });
    };

    const open = (el) => {
      /* data-zoom-target: элемент открывает чужой набор (главный кадр — всю галерею) */
      const group = el.dataset.zoomTarget || el.dataset.zoomGroup || '';
      items = $$(`[data-zoom][data-zoom-group="${group}"]`);
      if (!items.length) items = [el];
      idx = items.indexOf(el);
      if (idx < 0) idx = Math.min(items.length - 1, Number(el.dataset.zoomIndex || 0));
      opener = el.closest('button, a') || el;
      box = box || build();
      box.hidden = false;
      box.classList.add('is-open');
      document.body.classList.add('is-locked');
      show();
      $('.lightbox__close', box).focus({ preventScroll: true });
      track('photo_zoom', { page: location.pathname });
    };

    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-zoom]');
      if (el) { e.preventDefault(); open(el); }
    });

    document.addEventListener('keydown', (e) => {
      if (!box || box.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Tab') {
        const f = $$('button:not([hidden])', box);
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  /* ---------- активный пункт меню ---------- */
  const section = (url) => (url.split('?')[0].split('#')[0].replace(/^\/|\/$/g, '').split('/')[0] || '');
  const here = section(location.pathname);
  $$('.nav a, .mobile-nav a').forEach((a) => {
    const target = section(a.getAttribute('href') || '');
    if (target && target === here) a.setAttribute('aria-current', 'page');
  });
})();
