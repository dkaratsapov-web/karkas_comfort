/* Каркас Комфорт — интерфейсная логика. Без зависимостей. */
(() => {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
  const RATES = (() => {
    try { return JSON.parse(document.body.dataset.rates); }
    catch { return { standart: 57000, komfort: 68000, pod_kluch: 80000 }; }
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
      ['.grid > *, .tiers > *, .bento > *, .bento-grid > *, .shots > *, .steps > *, .timeline > *, .figures > *', 55],
      ['.split > *, .card, .project, .tile, .geo', 45]
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
        if (seen.has(el) || el.closest('.header, .mobile-nav, .hero, .chero')) return;
        seen.add(el);
        const sibs = el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : 0;
        el.dataset.reveal = '';
        el.style.setProperty('--d', `${Math.min(sibs, 5) * step}ms`);
        io.observe(el);
      });
    });
  };
  reveal();

  /* ---------- цифры досчитывают при появлении ----------
     Значение берём из разметки, поэтому без скрипта и при отключённой
     анимации на странице сразу стоит готовое число. */
  const counters = $$('[data-count]');
  if (counters.length && 'IntersectionObserver' in window
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        io.unobserve(el);
        const to = Number(el.dataset.count);
        if (!Number.isFinite(to)) return;
        const unit = el.dataset.countUnit ? ` ${el.dataset.countUnit}` : '';
        const t0 = performance.now(), dur = 900;
        const tick = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          const eased = 1 - Math.pow(1 - k, 3);
          el.textContent = `${Math.round(to * eased)}${unit}`;
          if (k < 1) requestAnimationFrame(tick);
        };
        el.textContent = `0${unit}`;
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.6 });
    counters.forEach((el) => io.observe(el));
  }

  /* ---------- вкладки комплектаций ----------
     Переключение панелей с клавиатурой: стрелки, Home и End.
     Без скрипта видны все панели, поэтому прятать умеет только он. */
  const tabs = () => {
    $$('[data-tabs]').forEach((box) => {
      const list = box.querySelector('[role="tablist"]');
      if (!list) return;
      const buttons = Array.from(list.querySelectorAll('[role="tab"]'));
      const panels = buttons.map((b) => document.getElementById(b.getAttribute('aria-controls'))).filter(Boolean);
      if (buttons.length !== panels.length || !buttons.length) return;

      const select = (i, focus) => {
        buttons.forEach((b, n) => {
          const on = n === i;
          b.setAttribute('aria-selected', on ? 'true' : 'false');
          b.tabIndex = on ? 0 : -1;
          panels[n].classList.toggle('is-active', on);
        });
        if (focus) buttons[i].focus();
      };

      select(Math.max(0, buttons.findIndex((b) => b.getAttribute('aria-selected') === 'true')), false);

      buttons.forEach((b, i) => {
        b.addEventListener('click', () => select(i, false));
        b.addEventListener('keydown', (e) => {
          const last = buttons.length - 1;
          const to = e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
            : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1)
              : e.key === 'Home' ? 0
                : e.key === 'End' ? last : null;
          if (to === null) return;
          e.preventDefault();
          select(to, true);
        });
      });
    });
  };
  tabs();

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

  /* ---------- квиз: расчёт стоимости по шагам ----------
     Вопросы и цифры берутся из src/data/pricing.json (data-pricing
     на <body>): ставки по комплектациям, поправка на этажность,
     фундамент по площади застройки, доплаты и доли этапов. Формулы
     здесь, числа — в данных. Итог расчёта уходит в заявку текстом,
     поэтому менеджер видит, что именно считал посетитель. */
  const quiz = $('#quiz');
  let quizReady = false;
  let P = null;
  try { P = JSON.parse(document.body.dataset.pricing); } catch { P = null; }

  if (quiz && P) {
    quizReady = true;
    const card = $('.quiz__card', quiz);
    const stepsHost = $('[data-quiz-steps]', quiz);
    const nav = $('[data-quiz-nav]', quiz);
    const result = $('[data-quiz-result]', quiz);
    const bar = $('[data-quiz-bar]', quiz);
    const counter = $('[data-quiz-counter]', quiz);
    const nf = new Intl.NumberFormat('ru-RU');
    const money0 = (n) => nf.format(Math.round(n / 1000) * 1000);

    const state = {
      area: 120,
      floors: P.floors[0].id,
      tier: P.tiers[1] ? P.tiers[1].id : P.tiers[0].id,
      foundation: P.foundations[0].id,
      extras: new Set()
    };

    /* --- вопросы --- */
    const radios = (group, items, note) => items.map((it, i) => `
      <label class="quiz__opt">
        <input type="radio" name="quiz-${group}" value="${it.id}"${state[group] === it.id ? ' checked' : ''}>
        <span class="quiz__opt-body">
          <b>${it.name}</b>
          ${note(it) ? `<em>${note(it)}</em>` : ''}
        </span>
      </label>`).join('');

    const steps = [
      {
        title: 'Какая площадь дома?',
        hint: 'Общая площадь всех этажей.',
        html: `
          <div class="quiz__area">
            <label class="sr-only" for="quiz-area-num">Площадь дома в квадратных метрах</label>
            <input class="quiz__num" type="number" id="quiz-area-num" min="40" max="300" step="1" inputmode="numeric" value="${state.area}">
            <span class="quiz__unit">м²</span>
          </div>
          <label class="sr-only" for="quiz-area">Площадь ползунком</label>
          <input class="quiz__range" type="range" id="quiz-area" min="40" max="300" step="5" value="${state.area}">
          <div class="quiz__presets">${(P.examples || []).map((a) => `<button class="quiz__preset" type="button" data-area="${a}">${a} м²</button>`).join('')}</div>`
      },
      {
        title: 'Сколько этажей?',
        hint: 'Полтора этажа — мансарда вместо второго этажа.',
        html: radios('floors', P.floors, () => '')
      },
      {
        title: 'Какая комплектация?',
        hint: 'Что входит в каждую — в разделе «Проекты и цены».',
        html: radios('tier', P.tiers, (it) => `${nf.format(P.ratePerM2[it.id])} ₽/м² · ${it.note}`)
      },
      {
        title: 'Какой фундамент?',
        hint: 'Если не знаете — оставьте сваи, уточним после выезда на участок.',
        html: radios('foundation', P.foundations, (it) => `${nf.format(it.perM2)} ₽/м² · ${it.note}`)
      },
      {
        title: 'Что добавить к дому?',
        hint: 'Можно ничего не выбирать.',
        html: P.extras.map((it) => `
          <label class="quiz__opt">
            <input type="checkbox" name="quiz-extra" value="${it.id}">
            <span class="quiz__opt-body">
              <b>${it.name}</b>
              <em>${it.note} · <span data-extra-sum="${it.id}"></span></em>
            </span>
          </label>`).join('')
      }
    ];

    stepsHost.innerHTML = steps.map((s, i) => `
      <fieldset class="quiz__step" data-step="${i}"${i ? ' hidden' : ''}>
        <legend class="quiz__question">${s.title}</legend>
        <p class="quiz__hint">${s.hint}</p>
        <div class="quiz__opts">${s.html}</div>
      </fieldset>`).join('');

    /* --- расчёт --- */
    const extraSum = (it) => (it.fixed || 0) + (it.perM2 ? it.perM2 * state.area : 0);

    const compute = () => {
      const floor = P.floors.find((f) => f.id === state.floors) || P.floors[0];
      const tier = P.tiers.find((t) => t.id === state.tier) || P.tiers[0];
      const found = P.foundations.find((f) => f.id === state.foundation) || P.foundations[0];
      const house = state.area * P.ratePerM2[tier.id] * floor.factor;
      const footprint = state.area / Number(floor.id);
      const foundation = footprint * found.perM2;
      const picked = P.extras.filter((it) => state.extras.has(it.id));
      const extras = picked.reduce((sum, it) => sum + extraSum(it), 0);
      const total = house + foundation + extras;
      const term = (P.terms.find((t) => state.area <= t.maxArea) || P.terms[P.terms.length - 1]).text;
      return { total, tier, floor, found, picked, term };
    };

    const refreshExtras = () => {
      P.extras.forEach((it) => {
        const cell = $(`[data-extra-sum="${it.id}"]`, quiz);
        if (cell) cell.textContent = `+${nf.format(Math.round(extraSum(it) / 1000))} тыс. ₽`;
      });
    };

    /* --- площадь --- */
    const range = $('#quiz-area', quiz);
    const num = $('#quiz-area-num', quiz);
    const setArea = (v, from) => {
      const n = Math.min(300, Math.max(40, Math.round(Number(v) || 40)));
      state.area = n;
      if (from !== 'range') range.value = String(Math.round(n / 5) * 5);
      if (from !== 'num') num.value = String(n);
      refreshExtras();
    };
    range.addEventListener('input', () => setArea(range.value, 'range'));
    num.addEventListener('input', () => { if (num.value.length >= 2) setArea(num.value, 'num'); });
    num.addEventListener('blur', () => setArea(num.value));
    $$('.quiz__preset', quiz).forEach((btn) => {
      btn.addEventListener('click', () => setArea(btn.dataset.area));
    });

    stepsHost.addEventListener('change', (e) => {
      const input = e.target;
      if (input.type === 'radio') {
        const group = input.name.replace('quiz-', '');
        state[group] = input.value;
      }
      if (input.type === 'checkbox' && input.name === 'quiz-extra') {
        if (input.checked) state.extras.add(input.value); else state.extras.delete(input.value);
      }
    });

    /* --- шаги --- */
    let step = 0;
    const total = steps.length;
    const show = (n) => {
      step = n;
      $$('.quiz__step', quiz).forEach((el) => { el.hidden = Number(el.dataset.step) !== n; });
      counter.textContent = `Шаг ${n + 1} из ${total}`;
      bar.style.width = `${Math.round((n + 1) / (total + 1) * 100)}%`;
      $('[data-quiz-back]', quiz).disabled = n === 0;
      card.scrollTop = 0;
      const first = $('.quiz__step:not([hidden]) input', quiz);
      if (first) first.focus({ preventScroll: true });
    };

    const summary = (r, low, high) =>
      `Квиз: ${state.area} м², ${r.floor.name.toLowerCase()}, «${r.tier.name}», фундамент ${r.found.name.toLowerCase()}`
      + (r.picked.length ? `, дополнительно: ${r.picked.map((it) => it.name.toLowerCase()).join(', ')}` : '')
      + `. Расчёт ${money0(low)}–${money0(high)} ₽, срок ${r.term}.`;

    const finish = () => {
      const r = compute();
      const low = r.total * (1 - P.spread);
      const high = r.total * (1 + P.spread);

      $('[data-quiz-low]', quiz).textContent = money0(low);
      $('[data-quiz-high]', quiz).textContent = money0(high);
      $('[data-quiz-note]', quiz).textContent =
        `${state.area} м², ${r.floor.name.toLowerCase()}, «${r.tier.name}», ${r.found.name.toLowerCase()}`
        + (r.picked.length ? `, ${r.picked.map((it) => it.name.toLowerCase()).join(', ')}` : '');
      $('[data-quiz-term]', quiz).textContent = r.term;
      $('[data-quiz-perm2]', quiz).textContent =
        `${nf.format(Math.round(r.total / state.area / 100) * 100)} ₽`;

      /* доли этапов зависят от комплектации: нулевые не показываем */
      const rows = P.stages
        .map((st) => ({ name: st.name, share: st.share[r.tier.id] || 0 }))
        .filter((st) => st.share > 0);
      const sum = rows.reduce((a, b) => a + b.share, 0) || 1;
      const max = Math.max(...rows.map((st) => st.share));
      $('[data-quiz-stages]', quiz).innerHTML = `<p class="quiz__label">Оплата по этапам</p>` + rows.map((st) => {
        const value = r.total * (st.share / sum);
        return `<div class="quiz__stage">
          <span class="quiz__stage-name">${st.name}</span>
          <span class="quiz__stage-bar"><i style="--w:${Math.round(st.share / max * 100)}%"></i></span>
          <span class="quiz__stage-sum">${nf.format(Math.round(value / 10000) * 10000)} ₽</span>
        </div>`;
      }).join('');

      $('[data-quiz-summary]', quiz).value = summary(r, low, high);

      stepsHost.hidden = true;
      nav.hidden = true;
      result.hidden = false;
      counter.textContent = 'Готово';
      bar.style.width = '100%';
      card.scrollTop = 0;
      const name = $('#q-name', quiz);
      if (name) name.focus({ preventScroll: true });
      track('quiz_done', { page: location.pathname, area: state.area, tier: r.tier.id });
    };

    $('[data-quiz-next]', quiz).addEventListener('click', () => {
      if (step < total - 1) show(step + 1); else finish();
    });
    $('[data-quiz-back]', quiz).addEventListener('click', () => { if (step > 0) show(step - 1); });

    /* --- открытие и закрытие --- */
    const focusables = () => $$('button, a[href], input, textarea, select', card)
      .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    let opener = null;

    const close = () => {
      quiz.classList.remove('is-open');
      const done = () => { quiz.hidden = true; quiz.removeEventListener('transitionend', done); };
      quiz.addEventListener('transitionend', done);
      setTimeout(done, 400);
      document.body.classList.remove('is-locked');
      if (opener) opener.focus({ preventScroll: true });
    };

    const open = (from) => {
      opener = from || null;
      quiz.hidden = false;
      requestAnimationFrame(() => quiz.classList.add('is-open'));
      document.body.classList.add('is-locked');
      refreshExtras();
      show(0);
      track('quiz_open', { page: location.pathname });
    };

    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-quiz-open]');
      if (!link) return;
      e.preventDefault();
      open(link);
    });

    quiz.addEventListener('click', (e) => { if (e.target.closest('[data-quiz-close]')) close(); });
    document.addEventListener('keydown', (e) => {
      if (quiz.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
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
      /* кнопка квиза ведёт на ту же форму, но если квиз собрался — открывает его */
      if (quizReady && link.hasAttribute('data-quiz-open')) return;
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
