/* Пролёт по дому в первом экране.
 *
 * Остров: React живёт только здесь, остальные страницы остаются статикой.
 * Разметка в HTML уже есть — это рабочая версия без скрипта (первый кадр,
 * заголовок, форма, цифры). Остров заменяет содержимое двух гнёзд: кадров
 * и подписей, и включает липкий режим секции.
 *
 * Механика: секция высокая, внутри липкий экран. Прокрутка внутри секции
 * ничего не двигает, она даёт прогресс 0…1. Всё остальное — функции от
 * этого числа. Двигаются только opacity и transform.
 */
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, useScroll, useSpring, useTransform, useMotionValueEvent } from 'motion/react';

const EASE_SETTINGS = { stiffness: 140, damping: 30, mass: 0.4 };

/* Отрезки остановок: равные доли прогресса с перекрытием на перелёте.
   Из них считаются и кадры, и подписи, и точки на шкале. */
function ranges(count) {
  const span = 1 / count;
  return Array.from({ length: count }, (_, i) => [i * span, (i + 1) * span]);
}

function Frame({ stop, range, progress, first, count }) {
  const [start, end] = range;
  const fade = 0.045;
  /* первый кадр виден с самого начала, последний — до конца */
  const opacity = useTransform(
    progress,
    first ? [0, end - fade, end] : [start - fade, start + fade * 0.6, end - fade, end],
    first ? [1, 1, 0] : (range[1] >= 0.999 ? [0, 1, 1, 1] : [0, 1, 1, 0])
  );
  /* наезд камеры: кадр входит крупнее и успокаивается к своей остановке */
  const scale = useTransform(progress, [start - fade, end], [1.06, 1]);

  return (
    <motion.img
      className="flight__frame"
      style={{ opacity, scale }}
      src={stop.src}
      srcSet={stop.srcset || undefined}
      sizes={stop.srcset ? '100vw' : undefined}
      alt={first ? stop.alt : ''}
      aria-hidden={first ? undefined : 'true'}
      width="1700"
      height="1133"
      fetchPriority={first ? 'high' : 'low'}
      decoding="async"
      draggable="false"
    />
  );
}

/* Выноска: кружок на точке кадра, тонкая линия и подпись.
   Координаты — проценты от кадра (x слева, y сверху) из flight.json.
   Появляется вместе со своей остановкой и гаснет вместе с ней. */
function Point({ point, range, progress, last }) {
  const [start, end] = range;
  const keys = [start - 0.02, start + 0.06, last ? 1 : end - 0.04, last ? 1.001 : end + 0.02];
  const opacity = useTransform(progress, keys, [0, 1, 1, last ? 1 : 0]);
  const scale = useTransform(progress, keys, [0.82, 1, 1, last ? 1 : 0.9]);
  const visibility = useTransform(opacity, (v) => (v < 0.04 ? 'hidden' : 'visible'));
  const side = point.x > 55 ? 'left' : 'right';

  return (
    <motion.div
      className={`flight__point flight__point--${side}`}
      style={{ left: `${point.x}%`, top: `${point.y}%`, opacity, scale, visibility }}
      aria-hidden="true"
    >
      <span className="flight__ring" />
      <span className="flight__leader" />
      <span className="flight__label">{point.label}</span>
    </motion.div>
  );
}

function Step({ stop, range, progress, last }) {
  const [start, end] = range;
  /* соседние подписи пересекаются: одна ещё уходит, другая уже входит —
     иначе между остановками остаётся пустая секунда */
  const keys = [start - 0.03, start + 0.03, last ? 1 : end - 0.03, last ? 1.001 : end + 0.03];
  const opacity = useTransform(progress, keys, [0, 1, 1, last ? 1 : 0]);
  const y = useTransform(progress, keys, [18, 0, 0, last ? 0 : -18]);
  /* погасшая подпись должна исчезать совсем: иначе она лежит поверх
     соседней — это ловит проверка на наложение текста и программы
     чтения с экрана читают всё сразу */
  const visibility = useTransform(opacity, (v) => (v < 0.04 ? 'hidden' : 'visible'));

  return (
    <motion.li className="flight__step" style={{ opacity, y, visibility }} aria-hidden={undefined}>
      <p className="flight__eyebrow">{stop.eyebrow}</p>
      <p className="flight__title">{stop.title}</p>
      <p className="flight__text">{stop.text}</p>
    </motion.li>
  );
}

function Dot({ range, progress }) {
  const [start, end] = range;
  const opacity = useTransform(progress, [start - 0.02, start + 0.02, end - 0.02, end + 0.02], [0.3, 1, 1, 0.3]);
  const width = useTransform(progress, [start - 0.02, start + 0.02, end - 0.02, end + 0.02], [26, 40, 40, 26]);
  return <motion.span className="flight__dot" style={{ opacity, width }} />;
}

/* Видеослой. Ролик не играет сам: его перематывают прогрессом по таблице
   keys ([прогресс, секунда]). Две точки с одной секундой = камера стоит,
   выноска успевает прочитаться. Перемотка без очереди: пока идёт одна,
   помним только последнее нужное время. */
function VideoStage({ video, progress }) {
  const ref = useRef(null);
  const wanted = useRef(0);
  const seeking = useRef(false);
  const keys = video.keys && video.keys.length ? video.keys : [[0, 0], [1, video.duration || 0]];
  const seconds = useTransform(progress, keys.map((k) => k[0]), keys.map((k) => k[1]));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onSeeked = () => {
      seeking.current = false;
      if (Math.abs(el.currentTime - wanted.current) > 0.04) {
        seeking.current = true;
        el.currentTime = wanted.current;
      }
    };
    el.addEventListener('seeked', onSeeked);
    return () => el.removeEventListener('seeked', onSeeked);
  }, []);

  useMotionValueEvent(seconds, 'change', (t) => {
    const el = ref.current;
    if (!el || !el.duration) return;
    wanted.current = Math.min(Math.max(t, 0), el.duration - 0.05);
    if (seeking.current) return;
    seeking.current = true;
    el.currentTime = wanted.current;
  });

  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches;
  return (
    <video
      ref={ref}
      className="flight__video"
      src={mobile && video.srcMobile ? video.srcMobile : video.src}
      poster={video.poster || undefined}
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      disableRemotePlayback
      aria-hidden="true"
    />
  );
}

function Flight({ section, stops, caption, video }) {
  const { scrollYProgress } = useScroll({ target: { current: section }, offset: ['start start', 'end end'] });
  /* пружина убирает рывки колеса: прогресс догоняет прокрутку мягко */
  const progress = useSpring(scrollYProgress, EASE_SETTINGS);
  const rows = ranges(stops.length);

  /* секции отдаём число — по нему CSS гасит цифры и показывает рассказ */
  useMotionValueEvent(progress, 'change', (p) => {
    section.style.setProperty('--p', p.toFixed(4));
    section.classList.toggle('is-flying', p > 0.06);
  });

  return (
    <>
      <div className="flight__media" aria-hidden="true">
        {video
          ? <VideoStage video={video} progress={progress} />
          : stops.map((stop, i) => (
              <Frame key={stop.src} stop={stop} range={rows[i]} progress={progress} first={i === 0} count={stops.length} />
            ))}
      </div>
      <div className="flight__scrim" aria-hidden="true" />
      <div className="flight__points" aria-hidden="true">
        {stops.map((stop, i) => stop.point && (
          <Point key={`p${i}`} point={stop.point} range={rows[i]} progress={progress} last={i === stops.length - 1} />
        ))}
      </div>
      <p className="flight__source">{caption}</p>
      <div className="flight__story">
        <ol className="flight__steps">
          {stops.map((stop, i) => (
            <Step key={stop.src} stop={stop} range={rows[i]} progress={progress} last={i === stops.length - 1} />
          ))}
        </ol>
        <div className="flight__rail" aria-hidden="true">
          {stops.map((stop, i) => (
            <Dot key={stop.src} range={rows[i]} progress={progress} />
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------- запуск ---------- */
function start() {
  const section = document.querySelector('[data-flight]');
  const host = document.querySelector('[data-flight-host]');
  const data = document.getElementById('flight-data');
  if (!section || !host || !data) return;

  /* движение выключено в системе — остаётся статичный первый экран */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  /* на коротком экране липкий режим съедает весь первый экран — не включаем */
  if (window.innerHeight < 520) return;

  let stops = [], caption = '', video = null;
  try {
    const parsed = JSON.parse(data.textContent);
    stops = parsed.stops || [];
    caption = parsed.caption || '';
    video = parsed.video || null;
  } catch { return; }
  if (stops.length < 2) return;

  section.dataset.flight = 'on';
  section.style.setProperty('--track', `${stops.length * 105}svh`);
  createRoot(host).render(<Flight section={section} stops={stops} caption={caption} video={video} />);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
