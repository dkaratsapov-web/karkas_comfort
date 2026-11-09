/* Карта охвата: где ваш участок и далеко ли до него от Твери.
 *
 * Остров React. В разметке страницы уже лежит статичная схема — она
 * видна без скрипта и пока остров не загрузился. Скрипт приходит, когда
 * блок подъезжает к экрану, и заменяет схему на рабочую карту.
 *
 * Что умеет:
 *  — тап по карте ставит отметку участка: из Твери к ней прочерчивается
 *    дуга с размерной подписью, справа — расстояние по прямой и ближайший
 *    город, где мы уже строили;
 *  — город на карте — кнопка: расстояние от Твери и построенные там
 *    объекты со ссылками;
 *  — «Рассчитать выезд» переносит место участка в заявку внизу страницы.
 *
 * Все цифры считаются из координат в src/data/geo.json. Это расстояние
 * по прямой, а не по дороге, и так и подписано: выдумывать километры
 * и время в пути нельзя.
 */
import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';

const W = 620;
const H = 440;
const PAD = 40;
const RINGS = [50, 100, 150, 200];
const EASE = [0.22, 1, 0.36, 1];

/* ---------- геометрия ---------- */

function projection(outline) {
  const lons = outline.map((c) => c[0]);
  const lats = outline.map((c) => c[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  /* по долготе сжимаем на косинус широты, иначе область растянется вширь */
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const spanX = (maxLon - minLon) * k, spanY = maxLat - minLat;
  const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
  const ox = (W - spanX * scale) / 2, oy = (H - spanY * scale) / 2;
  return {
    x: (lon) => ox + (lon - minLon) * k * scale,
    y: (lat) => oy + (maxLat - lat) * scale,
    lon: (x) => minLon + (x - ox) / (k * scale),
    lat: (y) => maxLat - (y - oy) / scale,
    /* километры в единицы схемы: градус широты — 111,2 км */
    km: (d) => (d / 111.2) * scale,
  };
}

function haversine(a, b) {
  const R = 6371;
  const rad = (v) => (v * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function inside(pt, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/* дуга из Твери к точке: изгиб в сторону, чтобы линия не совпала с лучом */
function arc(a, b) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(60, len * 0.22);
  /* текст подписи должен читаться слева направо — дуга всегда идёт от
     левого конца к правому */
  const [p, q] = a[0] <= b[0] ? [a, b] : [b, a];
  const nx = -(q[1] - p[1]) / len, ny = (q[0] - p[0]) / len;
  const cx = mx - nx * bend, cy = my - ny * bend;
  return `M${p[0].toFixed(1)} ${p[1].toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
}

const km = (d) => `${Math.round(d)} км`;

/* ---------- части ---------- */

/* Кольца режутся по контуру области, а подписи к ним — нет: иначе
   «150 км» и «200 км» уходили за край силуэта и пропадали. */
function Rings({ hub, P, circles = true, labels = true }) {
  return (
    <g className="gx__rings" aria-hidden="true">
      {RINGS.map((d, i) => {
        const r = P.km(d);
        return (
          <g key={d}>
            {circles && <motion.circle
              cx={hub[0]} cy={hub[1]} r={r}
              className="gx__ring"
              initial={{ pathLength: 0, opacity: 0 }}
              whileInView={{ pathLength: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.2, delay: 0.15 + i * 0.12, ease: EASE }}
            />}
            {labels && <motion.text
              className="gx__ringlabel"
              x={hub[0] + r * Math.cos(-Math.PI / 4) + 4}
              y={hub[1] + r * Math.sin(-Math.PI / 4) - 4}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.6 + i * 0.12 }}
            >
              {d} км
            </motion.text>}
          </g>
        );
      })}
    </g>
  );
}

function City({ c, P, active, dim, onPick, index, narrow }) {
  const x = P.x(c.lon), y = P.y(c.lat);
  /* на телефоне шрифт подписей крупнее, и у пары соседей подписи
     сталкиваются — для них в geo.json своя раскладка */
  const place = narrow && c.mobile ? { ...c, ...c.mobile } : c;
  const anchor = place.anchor || 'start';
  const lx = x + (anchor === 'end' ? -12 : 12);
  const label = c.hub ? `${c.name} — офис и отсчёт расстояний` : `${c.name}, ${km(c.dist)} от Твери`;
  return (
    <motion.g
      className={`gx__city${c.hub ? ' gx__city--hub' : ''}${active ? ' is-active' : ''}${dim ? ' is-dim' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={active}
      onClick={(e) => { e.stopPropagation(); onPick(c); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(c); }
      }}
      initial={{ opacity: 0, scale: 0.6 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ delay: 0.5 + index * 0.05, duration: 0.45, ease: EASE }}
      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
    >
      {/* поле для пальца: точка мелкая, а попадать надо */}
      <circle cx={x} cy={y} r="16" className="gx__hit" />
      {c.hub && <circle cx={x} cy={y} r="7" className="gx__pulse" />}
      <circle cx={x} cy={y} r={c.hub ? 6.5 : 4.5} className="gx__dot" />
      <text x={lx} y={y + (place.dy || 4)} textAnchor={anchor} className="gx__label">{c.name}</text>
    </motion.g>
  );
}

/* ---------- панель справа ---------- */

function Idle() {
  return (
    <motion.div key="idle" className="gx__card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
      <p className="gx__kicker">Где ваш участок?</p>
      <p className="gx__big">Нажмите на карту</p>
      <p className="gx__text">Покажем, сколько до него от Твери по прямой и в каком ближайшем городе мы уже строили. Можно выбрать и город на схеме.</p>
      <ul className="gx__legend" aria-hidden="true">
        <li><span className="gx__sw gx__sw--hub" />Тверь — офис, от неё считаем расстояния</li>
        <li><span className="gx__sw" />Города, где уже строили</li>
        <li><span className="gx__sw gx__sw--ring" />Кольца через каждые 50 км</li>
      </ul>
    </motion.div>
  );
}

function CityCard({ c, onPlot }) {
  const built = c.cases || [];
  return (
    <motion.div key={`c-${c.name}`} className="gx__card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: EASE }}>
      <p className="gx__kicker">{c.hub ? 'Офис' : 'Здесь уже строили'}</p>
      <p className="gx__big">{c.name}</p>
      {c.hub
        ? <p className="gx__text">Офис на ул. Серебряной. Выезд на замер по Твери и ближним районам — бесплатно.</p>
        : <p className="gx__measure"><b>{km(c.dist)}</b> от Твери по прямой</p>}
      {built.length > 0 && (
        <div className="gx__built">
          <p className="gx__sub">Наши дома здесь</p>
          {built.map((b) => (
            <a key={b.url} className="gx__obj" href={b.url}>
              {b.img && <img src={b.img} alt="" width="96" height="64" loading="lazy" />}
              <span><b>{b.title}</b>{b.area ? `${b.area} м²` : 'Съёмка со сдачи'}</span>
            </a>
          ))}
        </div>
      )}
      <button type="button" className="btn btn--ghost btn--sm gx__cta" onClick={() => onPlot({ lon: c.lon, lat: c.lat, near: c })}>
        Мой участок рядом
      </button>
    </motion.div>
  );
}

function PlotCard({ plot, onSend, onReset }) {
  return (
    <motion.div key={`p-${plot.lon.toFixed(3)}-${plot.lat.toFixed(3)}`} className="gx__card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: EASE }}>
      <p className="gx__kicker">Ваш участок</p>
      {plot.inside ? (
        <>
          <p className="gx__big"><span className="gx__approx">≈</span>{km(plot.dist)}</p>
          <p className="gx__text">от Твери по прямой. По дороге выйдет больше — маршрут посчитаем по адресу.</p>
          <p className="gx__measure">Ближайший город, где строили: <b>{plot.near.name}</b>{plot.nearDist >= 1 ? `, ${km(plot.nearDist)}` : ''}</p>
        </>
      ) : (
        <>
          <p className="gx__big">За краем схемы</p>
          <p className="gx__text">На схеме только Тверская область. Строим и в Московской — пришлите адрес, посчитаем выезд и доставку.</p>
        </>
      )}
      <div className="gx__actions">
        <button type="button" className="btn btn--accent btn--sm" onClick={onSend}>Рассчитать выезд и доставку</button>
        <button type="button" className="gx__reset" onClick={onReset}>Сбросить</button>
      </div>
    </motion.div>
  );
}

/* ---------- карта ---------- */

function GeoMap({ data }) {
  const P = useMemo(() => projection(data.outline), [data]);
  const svgRef = useRef(null);
  const hub = data.cities.find((c) => c.hub) || data.cities[0];
  const hubXY = [P.x(hub.lon), P.y(hub.lat)];
  const poly = useMemo(() => data.outline.map(([lon, lat]) => [P.x(lon), P.y(lat)]), [P, data]);
  const path = poly.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ' Z';

  const cities = useMemo(() => data.cities.map((c) => ({ ...c, dist: haversine(hub, c) })), [data, hub]);

  const [city, setCity] = useState(null);
  const [plot, setPlot] = useState(null);
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 600px)').matches);
  useEffect(() => {
    const mq = matchMedia('(max-width: 600px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const placePlot = useCallback(({ lon, lat, near }) => {
    const xy = [P.x(lon), P.y(lat)];
    const others = cities.map((c) => ({ c, d: haversine({ lon, lat }, c) })).sort((a, b) => a.d - b.d);
    const nearest = near ? { c: near, d: 0 } : others[0];
    setCity(null);
    setPlot({ lon, lat, xy, inside: inside(xy, poly), dist: haversine(hub, { lon, lat }), near: nearest.c, nearDist: nearest.d });
  }, [P, cities, poly, hub]);

  const onMap = (e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return;
    const { x, y } = pt.matrixTransform(m.inverse());
    placePlot({ lon: P.lon(x), lat: P.lat(y) });
  };

  const send = () => {
    if (!plot) return;
    const where = plot.inside
      ? `Участок ≈ ${km(plot.dist)} от Твери по прямой, ближе всего к: ${plot.near.name}`
      : 'Участок за пределами Тверской области';
    const coords = `${plot.lat.toFixed(4)}, ${plot.lon.toFixed(4)}`;
    /* в заявку внизу страницы: скрытое поле «проект» уходит менеджеру */
    const field = document.getElementById('p-project-input');
    if (field) field.value = `Карта охвата: ${where} (${coords})`;
    const form = document.getElementById('zayavka');
    if (form) {
      form.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      setTimeout(() => document.getElementById('cta-name')?.focus({ preventScroll: true }), 500);
    }
    if (window.ym && document.body.dataset.metrika) window.ym(Number(document.body.dataset.metrika), 'reachGoal', 'map_plot');
  };

  const target = plot ? plot.xy : city && !city.hub ? [P.x(city.lon), P.y(city.lat)] : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="gx">
        <div className="gx__stage">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="gx__svg"
            onClick={onMap}
            role="group"
            aria-label="Карта Тверской области: нажмите, чтобы отметить участок, или выберите город"
          >
            <defs>
              <pattern id="gx-stud" width="14" height="14" patternUnits="userSpaceOnUse">
                <path d="M14 0H0V14" fill="none" className="gx__grid" />
              </pattern>
              <clipPath id="gx-clip"><path d={path} /></clipPath>
            </defs>

            <path d={path} className="gx__land" />
            <rect width={W} height={H} fill="url(#gx-stud)" clipPath="url(#gx-clip)" pointerEvents="none" />
            <motion.path
              d={path}
              className="gx__edge"
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.6, ease: EASE }}
            />

            <g clipPath="url(#gx-clip)"><Rings hub={hubXY} P={P} labels={false} /></g>
            <Rings hub={hubXY} P={P} circles={false} />

            {/* луч к выбранному городу */}
            <AnimatePresence>
              {city && !city.hub && (
                <motion.path
                  key={`ray-${city.name}`}
                  d={`M${hubXY[0]} ${hubXY[1]} L${P.x(city.lon)} ${P.y(city.lat)}`}
                  className="gx__ray"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: EASE }}
                />
              )}
            </AnimatePresence>

            {cities.map((c, i) => (
              <City
                key={c.name}
                c={c}
                P={P}
                index={i}
                narrow={narrow}
                active={city?.name === c.name || plot?.near?.name === c.name}
                dim={Boolean(city || plot) && !(city?.name === c.name || plot?.near?.name === c.name || c.hub)}
                onPick={(v) => { setPlot(null); setCity(v); }}
              />
            ))}

            {/* отметка участка и размерная дуга */}
            <AnimatePresence>
              {plot && (
                <motion.g key={`plot-${plot.xy[0].toFixed(0)}-${plot.xy[1].toFixed(0)}`} exit={{ opacity: 0 }}>
                  <path id="gx-arc" d={arc(hubXY, plot.xy)} fill="none" stroke="none" />
                  <motion.path
                    d={arc(hubXY, plot.xy)}
                    className="gx__arc"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.8, ease: EASE }}
                  />
                  {plot.inside && (
                    <motion.text
                      className="gx__dim"
                      dy="-7"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.55, duration: 0.3 }}
                    >
                      <textPath href="#gx-arc" startOffset="50%" textAnchor="middle">≈ {km(plot.dist)}</textPath>
                    </motion.text>
                  )}
                  <motion.g
                    initial={{ y: -26, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.1 }}
                  >
                    <circle cx={plot.xy[0]} cy={plot.xy[1]} r="11" className="gx__pinhalo" />
                    <path
                      className="gx__pin"
                      d={`M${plot.xy[0]} ${plot.xy[1]} c-6 -8 -10 -12 -10 -18 a10 10 0 0 1 20 0 c0 6 -4 10 -10 18z`}
                    />
                    <circle cx={plot.xy[0]} cy={plot.xy[1] - 18} r="3.6" className="gx__pineye" />
                  </motion.g>
                </motion.g>
              )}
            </AnimatePresence>

            {/* отсечки на концах размерной линии к городу */}
            {target && !plot && (
              <circle cx={target[0]} cy={target[1]} r="10" className="gx__focus" />
            )}
          </svg>
          <p className="gx__note">Схема охвата: точки стоят по координатам городов, расстояния — по прямой.</p>
        </div>

        <aside className="gx__panel" aria-live="polite">
          <AnimatePresence mode="wait">
            {plot
              ? <PlotCard key="plot" plot={plot} onSend={send} onReset={() => setPlot(null)} />
              : city
                ? <CityCard key="city" c={city} onPlot={placePlot} />
                : <Idle key="idle" />}
          </AnimatePresence>
        </aside>
      </div>
    </MotionConfig>
  );
}

/* ---------- запуск ---------- */
function start() {
  const host = document.querySelector('[data-geo-host]');
  const raw = document.getElementById('geo-data');
  if (!host || !raw) return;
  let data;
  try { data = JSON.parse(raw.textContent); } catch { return; }
  if (!data.outline?.length || !data.cities?.length) return;
  host.classList.add('is-live');
  createRoot(host).render(<GeoMap data={data} />);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
