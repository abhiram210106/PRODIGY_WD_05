/* ==========================================================================
   Nimbus – weather app
   Data: Open-Meteo (forecast, geocoding, air quality) – free, no API key.
   Reverse geocoding for "my location": BigDataCloud client API – free, no key.
   ========================================================================== */
(() => {
'use strict';

/* --------------------------------------------------------------------------
   Config
   -------------------------------------------------------------------------- */
const API = {
  geo: 'https://geocoding-api.open-meteo.com/v1/search',
  wx:  'https://api.open-meteo.com/v1/forecast',
  aq:  'https://air-quality-api.open-meteo.com/v1/air-quality',
  rev: 'https://api.bigdatacloud.net/data/reverse-geocode-client'
};
const DEFAULT_PLACE = { name: 'London', region: 'England, United Kingdom', lat: 51.50853, lon: -0.12574 };
const REFRESH_MS = 10 * 60 * 1000;
const MAX_SAVED = 8;
const MAX_RECENT = 6;
const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* --------------------------------------------------------------------------
   Small helpers
   -------------------------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const placeKey = p => `${(+p.lat).toFixed(2)},${(+p.lon).toFixed(2)}`;

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('nimbus:' + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('nimbus:' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }
};

async function fetchJSON(url, { signal, timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json && json.error) throw new Error(json.reason || 'API error');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------------------
   Weather codes (WMO) → label, family
   -------------------------------------------------------------------------- */
const WMO = {
  0: ['Clear sky', 'clear'], 1: ['Mainly clear', 'clear'], 2: ['Partly cloudy', 'partly'], 3: ['Overcast', 'cloudy'],
  45: ['Fog', 'fog'], 48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle'], 55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'], 57: ['Heavy freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'], 67: ['Heavy freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Violent showers', 'rain'],
  85: ['Light snow showers', 'snow'], 86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm with hail', 'storm'], 99: ['Severe thunderstorm with hail', 'storm']
};
const wmo = code => WMO[code] || ['Unknown', 'cloudy'];
const WET = ['drizzle', 'rain', 'snow', 'storm'];

const SKY = {
  clear:  { day: ['#1a5fc8', '#55a8ec'], night: ['#050a1d', '#1c2b58'] },
  partly: { day: ['#2a66b8', '#7fb0dc'], night: ['#0a1230', '#28375f'] },
  cloudy: { day: ['#4a5b71', '#8799ae'], night: ['#131925', '#323e51'] },
  fog:    { day: ['#66737f', '#a2adb7'], night: ['#1a2027', '#3b4550'] },
  rain:   { day: ['#27323f', '#54667b'], night: ['#0d131b', '#293543'] },
  snow:   { day: ['#566983', '#9bb0c8'], night: ['#141d2c', '#3a4b64'] },
  storm:  { day: ['#1d1c30', '#484566'], night: ['#0a0a16', '#282640'] }
};
const SKY_KEY = { clear: 'clear', partly: 'partly', cloudy: 'cloudy', fog: 'fog', drizzle: 'rain', rain: 'rain', snow: 'snow', storm: 'storm' };

/* --------------------------------------------------------------------------
   SVG weather icons (animated only when large / `animate: true`)
   -------------------------------------------------------------------------- */
const RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
  return `<line x1="${(32 + c * 17).toFixed(1)}" y1="${(32 + s * 17).toFixed(1)}" x2="${(32 + c * 23).toFixed(1)}" y2="${(32 + s * 23).toFixed(1)}"/>`;
}).join('');

function icon(kind, day = true, { animate = false, cls = '' } = {}) {
  const A = animate && !RM;

  const sun = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s}) translate(-32 -32)">
      <g stroke="#FFCF4A" stroke-width="3.2" stroke-linecap="round">${A ? '<animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="40s" repeatCount="indefinite"/>' : ''}${RAYS}</g>
      <circle cx="32" cy="32" r="11.5" fill="url(#g-sun)"/></g>`;

  const moon = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s}) translate(-32 -32)">
      <path d="M38 12A20 20 0 1 0 54 42A17 17 0 0 1 38 12Z" fill="url(#g-moon)"/></g>`;

  const cloud = (dark, dx = 0, dy = 0) => `<g transform="translate(${dx} ${dy})" fill="${dark ? 'url(#g-cloud-dk)' : 'url(#g-cloud)'}">
      <circle cx="22" cy="40" r="8"/><circle cx="33" cy="32" r="11"/><circle cx="45" cy="39" r="9"/><rect x="22" y="40" width="23" height="8"/></g>`;

  const drops = (len, color = '#8FD0FF') => [26, 34, 42].map((x, i) =>
    `<line class="d d${i + 1}" x1="${x}" y1="50" x2="${x - len * .35}" y2="${50 + len}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`).join('');

  let body = '';
  switch (kind) {
    case 'clear':
      body = day ? sun(32, 32, 1.25) : moon(32, 32, 1.1);
      break;
    case 'partly':
      body = (day ? sun(24, 24, .8) : moon(23, 23, .75)) + cloud(false, 4, 3);
      break;
    case 'cloudy':
      body = cloud(true, -8, -7) + cloud(false, 3, 2);
      break;
    case 'fog':
      body = cloud(false, 0, -7) +
        `<g stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9">
           <line class="fl" x1="14" y1="47" x2="44" y2="47"/><line class="fl fl2" x1="20" y1="54" x2="52" y2="54"/><line class="fl" x1="14" y1="61" x2="40" y2="61"/></g>`;
      break;
    case 'drizzle':
      body = cloud(false, 0, -5) + drops(4);
      break;
    case 'rain':
      body = cloud(true, 0, -5) + drops(8);
      break;
    case 'snow':
      body = cloud(false, 0, -5) + [25, 33, 41].map((x, i) =>
        `<circle class="f f${i + 1}" cx="${x}" cy="${53 + (i % 2) * 3}" r="2" fill="#fff"/>`).join('');
      break;
    case 'storm':
      body = cloud(true, 0, -6) + '<path class="bolt" d="M35 41 L27 54 H33 L30 63 L42 48 H36 L39 41Z" fill="#FFD84D"/>';
      break;
    default:
      body = cloud(false);
  }
  return `<svg class="ico ${A ? 'a' : ''} ${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;
}

/* --------------------------------------------------------------------------
   Sky effects: rain, snow, stars, drifting clouds, lightning
   -------------------------------------------------------------------------- */
const FX = (() => {
  const cv = document.getElementById('fx');
  const ctx = cv.getContext('2d');
  const flashEl = document.getElementById('flash');
  const RAIN = { 51: 45, 53: 65, 55: 90, 56: 55, 57: 90, 61: 90, 63: 150, 65: 230, 66: 110, 67: 210, 80: 110, 81: 180, 82: 270, 95: 200, 96: 230, 99: 270 };
  const SNOW = { 71: 70, 73: 120, 75: 200, 77: 60, 85: 100, 86: 190 };

  let W = 0, H = 0, cfg = {}, rain = [], snow = [], stars = [], clouds = [];
  let raf = 0, prev = 0, t = 0, flashTimer = 0;

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function build() {
    const scale = clamp(W / 1280, .55, 1.4);
    rain = Array.from({ length: Math.round((cfg.rain || 0) * scale) }, () => ({ x: rnd(-100, W + 150), y: rnd(-H, H), l: rnd(12, 26), v: rnd(750, 1150), a: rnd(.18, .5) }));
    snow = Array.from({ length: Math.round((cfg.snow || 0) * scale) }, () => ({ x: rnd(0, W), y: rnd(-H, H), r: rnd(1, 3.4), v: rnd(28, 90), d: rnd(.5, 1.6), p: rnd(0, 6.28), a: rnd(.5, .95) }));
    stars = Array.from({ length: Math.round((cfg.stars || 0) * scale) }, () => ({ x: rnd(0, W), y: rnd(0, H * .7), r: rnd(.4, 1.4), s: rnd(.6, 2), p: rnd(0, 6.28) }));
    clouds = Array.from({ length: cfg.clouds || 0 }, () => ({ x: rnd(-200, W), y: rnd(-.05 * H, .6 * H), r: rnd(130, 270), v: rnd(4, 14), a: cfg.cloudA * rnd(.6, 1.2) }));
  }

  function draw(dt) {
    t += dt;
    ctx.clearRect(0, 0, W, H);

    for (const s of stars) {
      const a = .35 + .65 * Math.abs(Math.sin(t * s.s + s.p));
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
    }

    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x - c.r * 1.9 > W) c.x = -c.r * 1.9;
      ctx.save();
      ctx.translate(c.x, c.y); ctx.scale(1.9, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, c.r);
      g.addColorStop(0, `rgba(${cfg.cloudRGB},${c.a.toFixed(3)})`);
      g.addColorStop(1, `rgba(${cfg.cloudRGB},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, c.r, 0, 6.283); ctx.fill();
      ctx.restore();
    }

    if (rain.length) {
      ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      for (const p of rain) {
        p.y += p.v * dt; p.x -= p.v * dt * .18;
        if (p.y > H + 30) { p.y = -30; p.x = rnd(-50, W + 150); }
        ctx.strokeStyle = `rgba(205,228,255,${p.a.toFixed(2)})`;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.l * .18, p.y - p.l); ctx.stroke();
      }
    }

    for (const p of snow) {
      p.y += p.v * dt; p.x += Math.sin(t * p.d + p.p) * 22 * dt;
      if (p.y > H + 10) { p.y = -10; p.x = rnd(0, W); }
      ctx.fillStyle = `rgba(255,255,255,${p.a.toFixed(2)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
    }
  }

  function frame(ts) {
    const dt = Math.min((ts - prev) / 1000, .05);
    prev = ts;
    draw(dt);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    if (RM) { draw(0); return; }
    prev = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function scheduleFlash() {
    clearTimeout(flashTimer);
    if (!cfg.flash || RM) return;
    flashTimer = setTimeout(() => {
      flashEl.classList.remove('on');
      void flashEl.offsetWidth;            // restart the animation
      flashEl.classList.add('on');
      scheduleFlash();
    }, rnd(3500, 9000));
  }

  function set(kind, isDay, code) {
    const night = !isDay;
    cfg = { clouds: 0, cloudA: 0, cloudRGB: night ? '160,175,205' : '255,255,255', rain: 0, snow: 0, stars: 0, flash: false };
    switch (kind) {
      case 'clear':
        if (night) cfg.stars = 170;
        break;
      case 'partly':
        cfg.clouds = 5; cfg.cloudA = night ? .09 : .12;
        if (night) cfg.stars = 90;
        break;
      case 'cloudy':
        cfg.clouds = 9; cfg.cloudA = night ? .1 : .16;
        break;
      case 'fog':
        cfg.clouds = 12; cfg.cloudA = night ? .12 : .2;
        break;
      case 'drizzle':
      case 'rain':
        cfg.clouds = 6; cfg.cloudA = .24; cfg.cloudRGB = night ? '6,9,14' : '24,30,42';
        cfg.rain = RAIN[code] || 120;
        break;
      case 'snow':
        cfg.clouds = 5; cfg.cloudA = night ? .1 : .14;
        cfg.snow = SNOW[code] || 120;
        break;
      case 'storm':
        cfg.clouds = 7; cfg.cloudA = .3; cfg.cloudRGB = '12,12,26';
        cfg.rain = RAIN[code] || 200; cfg.flash = true;
        break;
    }
    document.body.style.setProperty('--glow', (!night && (kind === 'clear' || kind === 'partly')) ? '1' : '0');
    build();
    scheduleFlash();
    start();
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { size(); build(); if (RM) draw(0); }, 150);
  });
  size();
  return { set };
})();

/* --------------------------------------------------------------------------
   State & elements
   -------------------------------------------------------------------------- */
const state = {
  unit: store.get('unit', 'metric'),
  place: null,
  data: null,
  aq: null,
  updated: 0,
  sig: '',
  req: 0,
  saved: store.get('saved', []),
  recent: store.get('recent', [])
};

const els = {
  sky: $('#sky'), main: $('#main'), progress: $('#progress'), notice: $('#notice'), status: $('#srStatus'),
  form: $('#searchForm'), q: $('#q'), suggest: $('#suggest'), locate: $('#locate'), saved: $('#saved'),
  place: $('#place'), region: $('#region'), clock: $('#clock'), star: $('#saveBtn'),
  heroIcon: $('#heroIcon'), temp: $('#temp'), cond: $('#cond'), summary: $('#summary'),
  feels: $('#feels'), hi: $('#hi'), lo: $('#lo'), updated: $('#updated'),
  hourly: $('#hourly'), days: $('#days'), stats: $('#stats'), sun: $('#sun'),
  theme: $('#themeColor')
};

/* --------------------------------------------------------------------------
   Units & formatting
   -------------------------------------------------------------------------- */
const metric = () => state.unit === 'metric';
const conv = {
  t: v => metric() ? v : v * 9 / 5 + 32,
  speed: v => metric() ? v : v * 0.621371,
  press: v => metric() ? v : v * 0.02953,
  vis: v => metric() ? v / 1000 : v / 1609.344,
  len: v => metric() ? v : v / 25.4
};
const fmtT = v => `${Math.round(conv.t(v))}°`;
const n1 = v => String(Math.round(v * 10) / 10);

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hr12 = h => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
const t12 = (h, m) => `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
const isoHour = s => +s.slice(11, 13);
const isoTime12 = s => t12(+s.slice(11, 13), +s.slice(14, 16));
const dayName = (iso, i) => i === 0 ? 'Today' : DAYS[new Date(iso.slice(0, 10) + 'T00:00:00Z').getUTCDay()].slice(0, 3);
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compassName = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

/* --------------------------------------------------------------------------
   UI helpers: busy state, notices
   -------------------------------------------------------------------------- */
function setBusy(on) {
  els.progress.classList.toggle('on', on);
  els.main.setAttribute('aria-busy', String(on));
  if (state.data) els.main.dataset.state = on ? 'refreshing' : 'ready';
}

let noticeAction = null;
function notice(message, type = 'info', action = null) {
  noticeAction = action;
  els.notice.hidden = false;
  els.notice.className = 'notice ' + type;
  els.notice.innerHTML =
    `<span>${esc(message)}</span>` +
    (action ? `<button type="button" class="notice-btn">${esc(action.label)}</button>` : '') +
    `<button type="button" class="notice-x" aria-label="Dismiss message">×</button>`;
}
function clearNotice() { els.notice.hidden = true; noticeAction = null; }
els.notice.addEventListener('click', e => {
  if (e.target.closest('.notice-x')) clearNotice();
  else if (e.target.closest('.notice-btn') && noticeAction) { const a = noticeAction; clearNotice(); a.run(); }
});

/* --------------------------------------------------------------------------
   Data fetching
   -------------------------------------------------------------------------- */
function wxUrl(p) {
  const q = new URLSearchParams({
    latitude: p.lat, longitude: p.lon, timezone: 'auto', forecast_days: 7,
    temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm',
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,dew_point_2m',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day,visibility,uv_index,pressure_msl',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum'
  });
  return `${API.wx}?${q}`;
}
function aqUrl(p) {
  const q = new URLSearchParams({ latitude: p.lat, longitude: p.lon, current: 'us_aqi,pm2_5', timezone: 'auto' });
  return `${API.aq}?${q}`;
}

async function load(place, { silent = false } = {}) {
  const id = ++state.req;
  if (!silent) setBusy(true); else els.progress.classList.add('on');
  try {
    const [wx, aq] = await Promise.all([fetchJSON(wxUrl(place)), fetchJSON(aqUrl(place)).catch(() => null)]);
    if (id !== state.req) return false;                 // a newer request replaced this one
    state.place = place; state.data = wx; state.aq = aq; state.updated = Date.now();
    store.set('last', place);
    if (els.notice.classList.contains('error')) clearNotice();
    render();
    return true;
  } catch (err) {
    if (id !== state.req) return false;
    const offline = !navigator.onLine;
    notice(
      offline ? 'You’re offline. Reconnect to see the latest weather.' : 'Couldn’t load the weather right now. Check your connection and try again.',
      'error',
      { label: 'Try again', run: () => load(place) }
    );
    return false;
  } finally {
    if (id === state.req) setBusy(false);
  }
}

async function reverseGeocode(lat, lon) {
  const q = new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: 'en' });
  const j = await fetchJSON(`${API.rev}?${q}`, { timeout: 8000 });
  const name = j.city || j.locality || j.principalSubdivision || '';
  if (!name) return null;
  const region = [j.principalSubdivision && j.principalSubdivision !== name ? j.principalSubdivision : '', j.countryName].filter(Boolean).join(', ');
  return { name, region };
}

async function geocode(text, count = 6, signal) {
  const [name, ...rest] = text.split(',').map(s => s.trim());
  const hint = rest.join(' ').toLowerCase();
  const q = new URLSearchParams({ name, count: hint ? 20 : count, language: 'en', format: 'json' });
  const j = await fetchJSON(`${API.geo}?${q}`, { signal, timeout: 8000 });
  let res = j.results || [];
  if (hint) {
    const f = res.filter(p => [p.admin1, p.admin2, p.country, p.country_code].filter(Boolean).join(' ').toLowerCase().includes(hint));
    if (f.length) res = f;
  }
  return res.slice(0, count).map(p => ({
    name: p.name,
    region: [p.admin1 && p.admin1 !== p.name ? p.admin1 : '', p.country].filter(Boolean).join(', '),
    lat: p.latitude, lon: p.longitude
  }));
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */
function hourIndex(d) {
  const key = d.current.time.slice(0, 13);
  const i = d.hourly.time.findIndex(t => t.startsWith(key));
  return i < 0 ? 0 : i;
}

function applySky(kind, isDay) {
  const [top, bottom] = SKY[SKY_KEY[kind] || 'clear'][isDay ? 'day' : 'night'];
  els.sky.style.setProperty('--sky-top', top);
  els.sky.style.setProperty('--sky-bottom', bottom);
  els.theme.setAttribute('content', top);
}

function summarize(d, i0, kind) {
  const H = d.hourly;
  const last = Math.min(i0 + 12, H.time.length - 1);
  const noun = code => { const k = wmo(code)[1]; return k === 'snow' ? 'Snow' : k === 'storm' ? 'Thunderstorms' : 'Rain'; };

  if (WET.includes(kind)) {
    for (let i = i0 + 1; i <= last; i++) {
      if ((H.precipitation_probability[i] ?? 0) < 30 && !WET.includes(wmo(H.weather_code[i])[1])) {
        return `Should ease off around ${hr12(isoHour(H.time[i]))}.`;
      }
    }
    return 'Wet weather looks set to continue for the next 12 hours.';
  }
  for (let i = i0 + 1; i <= last; i++) {
    if ((H.precipitation_probability[i] ?? 0) >= 50) {
      return `${noun(H.weather_code[i])} likely around ${hr12(isoHour(H.time[i]))}.`;
    }
  }
  return 'No rain expected in the next 12 hours.';
}

function render() {
  const { place, data: d } = state;
  if (!d) return;
  const c = d.current, H = d.hourly, D = d.daily;
  const i0 = hourIndex(d);
  const [condText, kind] = wmo(c.weather_code);
  const isDay = !!c.is_day;

  const sig = `${kind}|${isDay}|${c.weather_code}`;
  if (sig !== state.sig) {
    state.sig = sig;
    applySky(kind, isDay);
    FX.set(kind, isDay, c.weather_code);
  }

  // Hero
  els.place.textContent = place.name;
  els.region.textContent = place.region || 'Current location';
  els.heroIcon.innerHTML = icon(kind, isDay, { animate: true });
  els.temp.textContent = Math.round(conv.t(c.temperature_2m));
  els.cond.textContent = condText;
  els.summary.textContent = summarize(d, i0, kind);
  els.feels.textContent = fmtT(c.apparent_temperature);
  els.hi.textContent = fmtT(D.temperature_2m_max[0]);
  els.lo.textContent = fmtT(D.temperature_2m_min[0]);
  tickClock();
  updateStar();

  renderHourly(d, i0);
  renderDaily(d);
  renderStats(d, i0);
  renderSun(d);
  renderSaved();

  els.main.dataset.state = 'ready';
  document.title = `${Math.round(conv.t(c.temperature_2m))}° ${condText} in ${place.name} – Nimbus`;
  els.status.textContent = `Weather updated for ${place.name}: ${Math.round(conv.t(c.temperature_2m))} degrees, ${condText}.`;
}

function renderHourly(d, i0) {
  const H = d.hourly;
  const n = Math.min(24, H.time.length - i0);
  const COL = 70, CH = 132, TOP = 30, BOT = 14;
  const idx = Array.from({ length: n }, (_, k) => i0 + k);
  const temps = idx.map(i => conv.t(H.temperature_2m[i]));
  const mn = Math.min(...temps), rg = Math.max(Math.max(...temps) - mn, 3);
  const pts = temps.map((v, k) => [k * COL + COL / 2, TOP + (1 - (v - mn) / rg) * (CH - TOP - BOT)]);

  let line = `M${pts[0][0]} ${pts[0][1].toFixed(1)}`;
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], mx = (x0 + x1) / 2;
    line += ` C${mx} ${y0.toFixed(1)} ${mx} ${y1.toFixed(1)} ${x1} ${y1.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  const area = `${line} L${last[0]} ${CH} L${pts[0][0]} ${CH} Z`;

  const times = idx.map((i, k) => {
    if (k === 0) return '<div>Now</div>';
    const h = isoHour(H.time[i]);
    if (h === 0) return `<div>${DAYS[new Date(H.time[i].slice(0, 10) + 'T00:00:00Z').getUTCDay()].slice(0, 3)}</div>`;
    return `<div>${hr12(h)}</div>`;
  }).join('');
  const icons = idx.map(i => `<div>${icon(wmo(H.weather_code[i])[1], !!H.is_day[i], { cls: 's' })}</div>`).join('');
  const pops = idx.map(i => { const p = H.precipitation_probability[i] ?? 0; return `<div>${p >= 10 ? p + '%' : ''}</div>`; }).join('');
  const dots = pts.map(([x, y], k) => `<circle cx="${x}" cy="${y.toFixed(1)}" r="${k === 0 ? 5 : 3}" fill="#fff" ${k === 0 ? 'stroke="rgba(255,255,255,.4)" stroke-width="6"' : ''}/>`).join('');
  const labels = pts.map(([x, y], k) => `<text x="${x}" y="${(y - 12).toFixed(1)}">${Math.round(temps[k])}°</text>`).join('');

  const prevScroll = els.hourly.querySelector('.hscroll')?.scrollLeft || 0;
  els.hourly.innerHTML = `
    <div class="hscroll" tabindex="0" role="region" aria-label="Hourly forecast, scrollable">
      <div class="hinner" style="--col:${COL}px">
        <div class="hrow times">${times}</div>
        <div class="hrow icons">${icons}</div>
        <svg class="curve" width="${n * COL}" height="${CH}" viewBox="0 0 ${n * COL} ${CH}" aria-hidden="true">
          <defs><linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
          <path d="${area}" fill="url(#curveFill)"/>
          <path d="${line}" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
          ${dots}${labels}
        </svg>
        <div class="hrow pops" aria-label="Chance of precipitation">${pops}</div>
      </div>
    </div>`;
  els.hourly.querySelector('.hscroll').scrollLeft = prevScroll;
}

function renderDaily(d) {
  const D = d.daily;
  const lows = D.temperature_2m_min.map(conv.t), highs = D.temperature_2m_max.map(conv.t);
  const mn = Math.min(...lows), mx = Math.max(...highs), rg = Math.max(mx - mn, 1);
  els.days.innerHTML = D.time.map((iso, i) => {
    const [label, kind] = wmo(D.weather_code[i]);
    const left = ((lows[i] - mn) / rg) * 100, width = Math.max(((highs[i] - lows[i]) / rg) * 100, 6);
    const p = D.precipitation_probability_max[i] ?? 0;
    const full = i === 0 ? 'Today' : DAYS[new Date(iso.slice(0, 10) + 'T00:00:00Z').getUTCDay()];
    return `<li aria-label="${esc(`${full}: ${label}, high ${Math.round(highs[i])}°, low ${Math.round(lows[i])}°`)}">
      <span class="dn">${dayName(iso, i)}</span>
      <span class="di">${icon(kind, true, { cls: 's' })}</span>
      <span class="dp">${p >= 10 ? p + '%' : ''}</span>
      <span class="dlo">${Math.round(lows[i])}°</span>
      <span class="bar"><i style="left:${left.toFixed(1)}%;width:${Math.min(width, 100 - left).toFixed(1)}%"></i></span>
      <span class="dhi">${Math.round(highs[i])}°</span>
    </li>`;
  }).join('');
}

function uvLabel(v) { return v < 3 ? 'Low' : v < 6 ? 'Moderate' : v < 8 ? 'High' : v < 11 ? 'Very high' : 'Extreme'; }
function aqiInfo(v) {
  if (v <= 50) return ['Good', '#4ade80'];
  if (v <= 100) return ['Moderate', '#facc15'];
  if (v <= 150) return ['Unhealthy for sensitive groups', '#fb923c'];
  if (v <= 200) return ['Unhealthy', '#ef4444'];
  if (v <= 300) return ['Very unhealthy', '#a855f7'];
  return ['Hazardous', '#be123c'];
}
function visLabel(km) { return km >= 10 ? 'Clear view' : km >= 4 ? 'Good' : km >= 1 ? 'Hazy' : 'Poor'; }

function renderStats(d, i0) {
  const c = d.current, H = d.hourly, D = d.daily;
  const speedU = metric() ? 'km/h' : 'mph';

  // pressure trend over the last 3 hours
  let trend = '';
  if (i0 >= 3 && H.pressure_msl[i0] != null && H.pressure_msl[i0 - 3] != null) {
    const diff = H.pressure_msl[i0] - H.pressure_msl[i0 - 3];
    trend = diff > 1 ? 'Rising' : diff < -1 ? 'Falling' : 'Steady';
  }

  const visRaw = H.visibility[i0];
  const km = (visRaw ?? 0) / 1000;
  const visVal = conv.vis(visRaw ?? 0);
  const uv = H.uv_index[i0] ?? 0;
  const aqi = state.aq?.current?.us_aqi;
  const pm = state.aq?.current?.pm2_5;
  const [aqiText, aqiColor] = aqi != null ? aqiInfo(aqi) : ['', '#fff'];
  const rainToday = D.precipitation_sum[0] ?? 0;
  const arrow = ((c.wind_direction_10m + 180) % 360).toFixed(0);

  const stat = (label, value, sub = '', extra = '') =>
    `<div class="stat"><dt>${label}</dt><dd><div class="v">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}${extra}</dd></div>`;

  els.stats.innerHTML = [
    stat('Humidity', `${Math.round(c.relative_humidity_2m)}%`, `Dew point ${fmtT(c.dew_point_2m)}`),
    stat('Wind',
      `<svg class="compass" viewBox="0 0 34 34" width="30" height="30" aria-hidden="true"><circle cx="17" cy="17" r="15" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.5"/><g transform="rotate(${arrow} 17 17)"><path d="M17 6 L22 24 L17 20.5 L12 24Z" fill="#fff"/></g></svg>${n1(conv.speed(c.wind_speed_10m))} <small>${speedU}</small>`,
      `From ${compassName(c.wind_direction_10m)}, gusts ${Math.round(conv.speed(c.wind_gusts_10m))} ${speedU}`),
    stat('Pressure', `${metric() ? Math.round(conv.press(c.pressure_msl)) : conv.press(c.pressure_msl).toFixed(2)} <small>${metric() ? 'hPa' : 'inHg'}</small>`, trend),
    stat('Visibility', visRaw == null ? '—' : `${visVal >= 10 ? Math.round(visVal) : n1(visVal)} <small>${metric() ? 'km' : 'mi'}</small>`, visRaw == null ? 'Not available' : visLabel(km)),
    stat('UV index', `${n1(uv)} <small>${uvLabel(uv)}</small>`, `Peak today ${n1(D.uv_index_max[0] ?? 0)}`,
      `<div class="uvbar" aria-hidden="true"><i style="left:${clamp(uv / 11, 0, 1) * 100}%"></i></div>`),
    stat('Cloud cover', `${Math.round(c.cloud_cover)}%`, c.cloud_cover < 20 ? 'Mostly clear' : c.cloud_cover < 60 ? 'Partly covered' : 'Mostly covered'),
    stat('Precipitation today', `${metric() ? n1(rainToday) : conv.len(rainToday).toFixed(2)} <small>${metric() ? 'mm' : 'in'}</small>`, rainToday > 0 ? 'Expected in total' : 'None expected'),
    stat('Air quality', aqi != null ? `${Math.round(aqi)} <small>US AQI</small>` : '—',
      aqi != null ? `<span class="dot" style="--c:${aqiColor}"></span>${aqiText}${pm != null ? `, PM2.5 ${n1(pm)} µg/m³` : ''}` : 'Not available here')
  ].join('');
}

function renderSun(d) {
  const rise = d.daily.sunrise[0], set = d.daily.sunset[0];
  if (!rise || !set) { els.sun.innerHTML = ''; return; }
  const r = Date.parse(rise + 'Z'), s = Date.parse(set + 'Z');
  const nowLocal = Date.now() + d.utc_offset_seconds * 1000;
  const raw = (nowLocal - r) / (s - r);
  const f = clamp(raw, 0, 1);
  const up = raw >= 0 && raw <= 1;
  const cx = 150 - 130 * Math.cos(Math.PI * f), cy = 100 - 90 * Math.sin(Math.PI * f);
  const mins = Math.round((s - r) / 60000);

  els.sun.innerHTML = `
    <svg viewBox="0 0 300 116" role="img" aria-label="Sun position between sunrise and sunset">
      <line x1="6" y1="100" x2="294" y2="100" stroke="rgba(255,255,255,.35)" stroke-width="1.5"/>
      <path d="M20 100 A130 90 0 0 1 280 100" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round"/>
      <path d="M20 100 A130 90 0 0 1 280 100" pathLength="1" fill="none" stroke="#FFD166" stroke-width="3" stroke-linecap="round" stroke-dasharray="${f.toFixed(4)} 1" opacity="${up ? 1 : .35}"/>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="${up ? 'url(#g-sun)' : '#9aa7bd'}" stroke="rgba(255,255,255,.55)" stroke-width="3"/>
    </svg>
    <dl class="sun-times">
      <div><dt>Sunrise</dt><dd>${isoTime12(rise)}</dd></div>
      <div><dt>Sunset</dt><dd>${isoTime12(set)}</dd></div>
    </dl>
    <p class="sun-len">${Math.floor(mins / 60)} h ${mins % 60} min of daylight today</p>`;
}

/* Local clock at the searched place + "updated" label */
function tickClock() {
  const d = state.data;
  if (!d) return;
  const t = new Date(Date.now() + d.utc_offset_seconds * 1000);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(t).replace(',', '');
  els.clock.textContent = `${date}, ${t12(t.getUTCHours(), t.getUTCMinutes())} local time`;

  const mins = Math.floor((Date.now() - state.updated) / 60000);
  els.updated.textContent = mins < 1 ? 'Updated just now' : `Updated ${mins} min ago`;
}
setInterval(tickClock, 15000);

/* --------------------------------------------------------------------------
   Saved & recent places
   -------------------------------------------------------------------------- */
const isSaved = p => state.saved.some(s => placeKey(s) === placeKey(p));

function updateStar() {
  const on = state.place && isSaved(state.place);
  els.star.setAttribute('aria-pressed', String(!!on));
  els.star.setAttribute('aria-label', on ? 'Remove from saved places' : 'Save this place');
  els.star.title = on ? 'Remove from saved places' : 'Save this place';
}

function renderSaved() {
  els.saved.hidden = state.saved.length === 0;
  els.saved.innerHTML = state.saved.map((p, i) => {
    const active = state.place && placeKey(p) === placeKey(state.place);
    return `<span class="chip ${active ? 'active' : ''}">
      <button type="button" class="go" data-i="${i}">${esc(p.name)}</button>
      <button type="button" class="x" data-i="${i}" aria-label="Remove ${esc(p.name)} from saved places">×</button></span>`;
  }).join('');
}

els.saved.addEventListener('click', e => {
  const go = e.target.closest('.go'), x = e.target.closest('.x');
  if (go) choose(state.saved[+go.dataset.i]);
  if (x) {
    state.saved.splice(+x.dataset.i, 1);
    store.set('saved', state.saved);
    renderSaved(); updateStar();
  }
});

els.star.addEventListener('click', () => {
  if (!state.place) return;
  if (isSaved(state.place)) {
    state.saved = state.saved.filter(s => placeKey(s) !== placeKey(state.place));
  } else {
    if (state.saved.length >= MAX_SAVED) { notice(`You can save up to ${MAX_SAVED} places. Remove one to add another.`); return; }
    state.saved.push(slim(state.place));
  }
  store.set('saved', state.saved);
  renderSaved(); updateStar();
});

const slim = p => ({ name: p.name, region: p.region || '', lat: p.lat, lon: p.lon });

function remember(place) {
  state.recent = [slim(place), ...state.recent.filter(r => placeKey(r) !== placeKey(place))].slice(0, MAX_RECENT);
  store.set('recent', state.recent);
}

function choose(place) {
  closeSuggest();
  clearNotice();
  els.q.value = '';
  els.q.blur();
  remember(place);
  return load(slim(place));
}

/* --------------------------------------------------------------------------
   Search box with live suggestions (keyboard accessible)
   -------------------------------------------------------------------------- */
let entries = [];      // rendered rows
let active = -1;       // highlighted selectable row
let sugCtrl = null;
let sugTimer = 0;

const pinIcon = '<svg class="pin" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const locIcon = '<svg class="pin" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';

function openSuggest(list) {
  entries = list;
  active = -1;
  els.suggest.innerHTML = list.map((e, i) => {
    if (e.type === 'heading') return `<li class="h" role="presentation">${esc(e.text)}</li>`;
    if (e.type === 'empty') return `<li class="empty" role="presentation">${esc(e.text)}</li>`;
    if (e.type === 'locate') return `<li role="option" id="opt${i}" data-i="${i}">${locIcon}<span><span class="nm">Use my current location</span></span></li>`;
    return `<li role="option" id="opt${i}" data-i="${i}">${pinIcon}<span><span class="nm">${esc(e.place.name)}</span><span class="rg">${esc(e.place.region)}</span></span></li>`;
  }).join('');
  els.suggest.hidden = false;
  els.q.setAttribute('aria-expanded', 'true');
  els.q.removeAttribute('aria-activedescendant');
}

function closeSuggest() {
  els.suggest.hidden = true;
  els.q.setAttribute('aria-expanded', 'false');
  els.q.removeAttribute('aria-activedescendant');
  active = -1; entries = [];
  if (sugCtrl) sugCtrl.abort();
}

function showDefaultList() {
  const list = [{ type: 'locate' }];
  if (state.recent.length) {
    list.push({ type: 'heading', text: 'Recent searches' });
    state.recent.forEach(place => list.push({ type: 'place', place }));
  }
  openSuggest(list);
}

function highlight(next) {
  const sel = entries.map((e, i) => (e.type === 'place' || e.type === 'locate') ? i : -1).filter(i => i >= 0);
  if (!sel.length) return;
  const pos = sel.indexOf(active);
  const target = next > 0 ? sel[(pos + 1) % sel.length] : sel[(pos <= 0 ? sel.length : pos) - 1];
  active = target;
  els.suggest.querySelectorAll('[role=option]').forEach(li => li.setAttribute('aria-selected', String(+li.dataset.i === active)));
  const li = $(`#opt${active}`);
  if (li) { li.scrollIntoView({ block: 'nearest' }); els.q.setAttribute('aria-activedescendant', li.id); }
}

function activate(i) {
  const e = entries[i];
  if (!e) return;
  if (e.type === 'locate') { closeSuggest(); els.q.value = ''; locate(); }
  else if (e.type === 'place') choose(e.place);
}

async function fetchSuggestions(text) {
  if (sugCtrl) sugCtrl.abort();
  sugCtrl = new AbortController();
  const mine = sugCtrl;
  try {
    const results = await geocode(text, 6, mine.signal);
    if (mine.signal.aborted || els.q.value.trim() !== text) return;
    openSuggest(results.length
      ? results.map(place => ({ type: 'place', place }))
      : [{ type: 'empty', text: `No places found for “${text}”. Check the spelling or try a nearby city.` }]);
  } catch (err) {
    if (mine.signal.aborted) return;
    openSuggest([{ type: 'empty', text: 'Couldn’t search right now. Check your connection and try again.' }]);
  }
}

els.q.addEventListener('input', () => {
  clearTimeout(sugTimer);
  const text = els.q.value.trim();
  if (text.length < 2) { text.length === 0 ? showDefaultList() : closeSuggest(); return; }
  sugTimer = setTimeout(() => fetchSuggestions(text), 250);
});
els.q.addEventListener('focus', () => { if (!els.q.value.trim()) showDefaultList(); });
els.q.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); if (els.suggest.hidden) showDefaultList(); highlight(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(-1); }
  else if (e.key === 'Escape') { closeSuggest(); }
});

els.suggest.addEventListener('mousedown', e => e.preventDefault());   // keep focus in the input
els.suggest.addEventListener('click', e => {
  const li = e.target.closest('[role=option]');
  if (li) activate(+li.dataset.i);
});
document.addEventListener('click', e => { if (!els.form.contains(e.target)) closeSuggest(); });

els.form.addEventListener('submit', async e => {
  e.preventDefault();
  clearTimeout(sugTimer);
  if (active >= 0) { activate(active); return; }
  const text = els.q.value.trim();
  if (!text) { showDefaultList(); return; }

  const firstPlace = entries.find(en => en.type === 'place');
  if (firstPlace && !els.suggest.hidden) { choose(firstPlace.place); return; }

  setBusy(true);
  try {
    const results = await geocode(text, 1);
    if (!results.length) {
      setBusy(false);
      notice(`We couldn’t find “${text}”. Check the spelling or try a nearby city.`, 'error');
      return;
    }
    choose(results[0]);
  } catch {
    setBusy(false);
    notice('Couldn’t search right now. Check your connection and try again.', 'error');
  }
});

/* --------------------------------------------------------------------------
   Geolocation
   -------------------------------------------------------------------------- */
function locate({ initial = false, silent = false } = {}) {
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) {
      if (!silent) notice('This browser can’t share your location. Search for a city instead.', 'error');
      return resolve(false);
    }
    els.locate.classList.add('busy');
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const place = { name: 'Your location', region: '', lat, lon, current: true };
      try {
        const rev = await reverseGeocode(lat, lon);
        if (rev) Object.assign(place, rev);
      } catch { /* keep the generic name */ }
      els.locate.classList.remove('busy');
      const ok = await load(place);
      if (ok) clearNotice();
      resolve(ok);
    }, err => {
      els.locate.classList.remove('busy');
      if (!silent) {
        const msg = err.code === 1
          ? (initial ? 'Showing London for now. Allow location access or search for your city to see your local weather.'
                     : 'Location access is blocked. Allow it in your browser’s site settings, or search for a city.')
          : err.code === 3
            ? 'Finding your location took too long. Try again or search for a city.'
            : 'Your device couldn’t work out where you are. Search for a city instead.';
        notice(msg, initial && err.code === 1 ? 'info' : 'error', err.code === 1 ? null : { label: 'Try again', run: () => locate() });
      }
      resolve(false);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 });
  });
}
els.locate.addEventListener('click', () => { closeSuggest(); locate(); });

/* --------------------------------------------------------------------------
   Units
   -------------------------------------------------------------------------- */
function syncUnitButtons() {
  document.querySelectorAll('.units button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.unit === state.unit)));
}
document.querySelector('.units').addEventListener('click', e => {
  const b = e.target.closest('button[data-unit]');
  if (!b || b.dataset.unit === state.unit) return;
  state.unit = b.dataset.unit;
  store.set('unit', state.unit);
  syncUnitButtons();
  render();
});

/* --------------------------------------------------------------------------
   Auto refresh
   -------------------------------------------------------------------------- */
function refresh() {
  if (state.place && document.visibilityState === 'visible') load(state.place, { silent: true });
}
setInterval(refresh, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.updated && Date.now() - state.updated > REFRESH_MS) refresh();
});
window.addEventListener('online', () => { if (state.place && !els.notice.hidden) load(state.place); });

/* --------------------------------------------------------------------------
   Start
   -------------------------------------------------------------------------- */
async function init() {
  syncUnitButtons();
  renderSaved();

  const last = store.get('last', null);
  if (last && typeof last.lat === 'number') {
    load(last);
    if (last.current && navigator.permissions) {
      try {
        const perm = await navigator.permissions.query({ name: 'geolocation' });
        if (perm.state === 'granted') locate({ silent: true });
      } catch { /* permissions API unavailable */ }
    }
  } else {
    load(DEFAULT_PLACE);                 // show something straight away…
    locate({ initial: true });           // …then upgrade to the visitor's own location if allowed
  }
}
init();

})();
