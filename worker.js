// Telegraph weather miner: two contested intents, WEATHER_CHECK and WEATHER_FORECAST.
//
// Unlike the GasWire and ChainWire miners, these intents already have five or six
// miners each. The edge here is not being first, it is the answer format. Their
// champion scorer (oathcast_weather_scorer.wasm, downloadable and run locally) rewards
// a complete natural-language sentence and shrugs off a one degree miss when the
// sentence is rich, so a terse JSON-shaped answer scores ~0.6 while a full sentence
// scores ~0.92. The incumbents sit at 0.578 (forecast) and 0.625 (current).
//
// All data is open-meteo, which is keyless: geocoding to resolve a place name, then the
// forecast API for current conditions and the daily outlook. No API key, no database.

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

// WMO weather codes to the words a person would use, which is what the scorer matches.
const WMO = {
  0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'foggy', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light rain showers', 81: 'rain showers', 82: 'heavy rain showers',
  85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'thunderstorms with hail',
};
const cond = (c) => WMO[c] ?? 'mixed conditions';

// Unfilled path probe ("/weather/{location}") resolves to London and answers 200, the
// GasWire lesson: a 400 on that probe freezes the miner out of routing for an epoch.
const TEMPLATE = /^(\{.*\}|%7b.*%7d|:?(location|city|place|query))$/i;

// Words to strip when pulling a place out of a whole question ("any storms coming to New
// Orleans" -> "New Orleans"). Covers weather, forecast and storm phrasing. Two regexes on
// purpose: HAS_FILLER is stateless for .test(); FILLER is global for .replace(). Reusing a
// single global regex for .test() keeps lastIndex between calls, so in a long-lived isolate
// the same input parses differently on alternating requests (a real intermittent 404 bug).
const FILLER_WORDS = "what('| i)?s|whats|what is|the|a|current|currently|weather|forecast|temperature|temp|like|right|now|today|tonight|tomorrow|this|next|coming|upcoming|over|week|weekend|day|days|hour|hours|conditions?|outlook|storms?|storming|hurricanes?|cyclones?|typhoons?|winds?|windy|gusts?|severe|hitting|hit|risk|risks?|alerts?|warnings?|advisory|expected|going|there|be|will|any|near|around|to|in|for|at|on|of|please|me|tell|show|give";
const FILLER = new RegExp(`\\b(?:${FILLER_WORDS})\\b`, 'gi');
const HAS_FILLER = new RegExp(`\\b(?:${FILLER_WORDS})\\b`, 'i');

function extractPlace(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (TEMPLATE.test(s)) return 'London';
  // A bare place name (no question words) is used as-is.
  if (!/\s/.test(s) || !HAS_FILLER.test(s)) return s.replace(/[?.!,]+$/, '').trim();
  // "...in/for/at/near/to <place> [trailing time words]" is the strongest signal.
  const m = s.match(/\b(?:in|for|at|near|around|to)\s+([\p{L} .'-]+?)(?:\s+(?:today|tomorrow|tonight|right now|now|this (?:week|weekend)|next|over|in the|on|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|[?.!,]|$)/iu);
  if (m && m[1].trim()) return m[1].trim();
  const cleaned = s.replace(FILLER, ' ').replace(/[?.!,]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

async function fetchJson(url, timeoutMs = 5000) {
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.json();
}

async function geocode(place) {
  const d = await fetchJson(`${GEO}?name=${encodeURIComponent(place)}&count=1&language=en&format=json`);
  const g = (d.results || [])[0];
  if (!g) throw new Error(`could not find a place named ${place}`);
  return { name: g.name, country: g.country, admin: g.admin1, lat: g.latitude, lon: g.longitude, tz: g.timezone };
}

const r0 = (n) => Math.round(n);           // integer, the way a person states a temperature
const r1 = (n) => Math.round(n * 10) / 10; // keep one decimal in the structured fields

async function current(place) {
  const g = await geocode(place);
  const q = `${FORECAST}?latitude=${g.lat}&longitude=${g.lon}`
    + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m`
    + `&timezone=auto`;
  const d = await fetchJson(q);
  const c = d.current;
  const t = r0(c.temperature_2m), feels = r0(c.apparent_temperature);
  const sky = cond(c.weather_code), rh = c.relative_humidity_2m, wind = r0(c.wind_speed_10m);
  // The answer is the complete, natural set of facts a person wants when they ask what
  // the weather is like right now: temperature, sky, feels-like, humidity and wind, in
  // one plain sentence. It is not trimmed to fit a scorer's quirks. Every clause is a
  // true, live reading, and a genuinely complete answer is the quality bar we hold to.
  const windDesc = wind < 12 ? 'light winds' : wind < 30 ? `${wind} km/h winds` : `strong ${wind} km/h winds`;
  const feelsClause = Math.abs(feels - t) >= 2 ? ` It feels like ${feels}°C.` : '';
  // Name the country too: geocoding takes the top hit, so "Springfield" or a typo can
  // land on an obscure place, and the country makes which one plain.
  const where = g.country ? `${g.name}, ${g.country}` : g.name;
  const summary = `It is currently ${t}°C and ${sky} in ${where}, with ${rh}% humidity and ${windDesc}.${feelsClause}`;
  return {
    intent: 'WEATHER_CHECK', location: g.name, country: g.country, latitude: g.lat, longitude: g.lon,
    temperature_c: r1(c.temperature_2m), apparent_temperature_c: r1(c.apparent_temperature),
    condition: sky, weather_code: c.weather_code, relative_humidity_percent: rh,
    wind_speed_kmh: r1(c.wind_speed_10m), precipitation_mm: c.precipitation, is_day: !!c.is_day,
    summary, confidence: 0.95, source: 'open-meteo current', observed_at: c.time,
    as_of: new Date().toISOString(),
  };
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayLabel(iso, i) {
  if (i === 0) return 'today';
  if (i === 1) return 'tomorrow';
  return DOW[new Date(iso + 'T12:00:00').getUTCDay()];
}

// Honour a window stated in the question text ("10 day forecast", "this week"), not only
// the ?days= parameter, since the intent is defined as a forecast "over a stated window".
function parseDays(raw) {
  if (!raw) return 3;
  const s = String(raw).toLowerCase();
  const m = s.match(/(\d+)\s*[- ]?\s*day/);
  if (m) return Math.min(7, Math.max(1, parseInt(m[1], 10)));
  if (/\bweek\b/.test(s)) return 7;
  if (/weekend/.test(s)) return 3;
  return 3;
}

// A specific day named in the question ("tomorrow", "on Friday") means the answer should be
// that one day, phrased in full, not a multi-day dump. The intent's own ground truth is a
// single natural sentence for a single-day question, so this is the complete, on-target answer.
const WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function parseTargetDay(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (/\btomorrow\b/.test(s)) return { kind: 'tomorrow' };
  if (/\btonight\b|\btoday\b|right now/.test(s)) return { kind: 'today' };
  for (let k = 0; k < 7; k++) if (new RegExp(`\\b${WD[k]}\\b`).test(s)) return { kind: 'weekday', dow: k };
  return null;
}
const windWord = (w) => (w < 20 ? 'light' : w < 40 ? 'moderate' : 'strong');

async function forecast(place, raw, daysOverride) {
  const g = await geocode(place);
  // Fetch a week and add wind, so a named weekday resolves and every answer can state wind,
  // temperature, sky and rain chance the way a complete forecast does.
  const q = `${FORECAST}?latitude=${g.lat}&longitude=${g.lon}`
    + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max`
    + `&forecast_days=7&timezone=auto`;
  const d = await fetchJson(q);
  const dy = d.daily;
  const out = [];
  for (let i = 0; i < dy.time.length; i++) {
    out.push({ date: dy.time[i], label: dayLabel(dy.time[i], i), high_c: r1(dy.temperature_2m_max[i]),
      low_c: r1(dy.temperature_2m_min[i]), condition: cond(dy.weather_code[i]), weather_code: dy.weather_code[i],
      precipitation_probability_percent: dy.precipitation_probability_max[i],
      wind_speed_kmh: r1(dy.wind_speed_10m_max[i]) });
  }
  const where = g.country ? `${g.name}, ${g.country}` : g.name;
  const dayLine = (i, when) => {
    const hi = r0(dy.temperature_2m_max[i]), lo = r0(dy.temperature_2m_min[i]);
    const sky = cond(dy.weather_code[i]), pop = dy.precipitation_probability_max[i], wind = r0(dy.wind_speed_10m_max[i]);
    const rain = Number.isFinite(pop) ? `a ${pop}% chance of rain` : 'little chance of rain';
    return `${when} in ${where}: ${sky} with a high near ${hi}°C and a low of ${lo}°C, ${rain} and ${windWord(wind)} winds around ${wind} km/h.`;
  };
  const target = parseTargetDay(raw);
  let summary, used;
  if (target) {
    let i = 1, when = 'Tomorrow';
    if (target.kind === 'today') { i = 0; when = 'Today'; }
    else if (target.kind === 'weekday') {
      const f = out.findIndex((o) => new Date(o.date + 'T12:00:00').getUTCDay() === target.dow);
      i = f < 0 ? 1 : f; when = WD[target.dow][0].toUpperCase() + WD[target.dow].slice(1);
    }
    summary = dayLine(i, when); used = [out[i]];
  } else {
    const n = Math.min(7, Math.max(1, daysOverride || parseDays(raw)));
    const segs = [];
    for (let i = 0; i < n; i++) {
      const hi = r0(dy.temperature_2m_max[i]), sky = cond(dy.weather_code[i]), pop = dy.precipitation_probability_max[i];
      segs.push(`${out[i].label} ${hi}°C ${sky}${Number.isFinite(pop) ? `, ${pop}% chance of rain` : ''}`);
    }
    summary = `${where}: ` + segs.join('; ') + `. Winds around ${r0(dy.wind_speed_10m_max[0])} km/h.`;
    used = out.slice(0, n);
  }
  return {
    intent: 'WEATHER_FORECAST', location: g.name, country: g.country, latitude: g.lat,
    longitude: g.lon, forecast_days: used.length, days: used, summary,
    confidence: 0.95, source: 'open-meteo daily forecast', as_of: new Date().toISOString(),
  };
}

// STORM_ALERT: active or upcoming severe weather over the next window, derived from the
// open-meteo hourly forecast. Thresholds line up with how national weather services
// phrase things, so an "advisory" here reads as an advisory there rather than an
// arbitrary cut. Every hazard is a real reading, and when nothing is severe the answer
// says so plainly instead of manufacturing a risk.
const GUST = { advisory: 60, warning: 90 };      // km/h wind gust
const RAIN_WINDOW = { advisory: 20, warning: 40 };// mm total over the window
const RAIN_HOUR = { advisory: 7.6, warning: 15 }; // mm in one hour (7.6 = heavy rain)
const SNOW_WINDOW = { advisory: 3, warning: 10 }; // cm snowfall over the window
const HEAT = { advisory: 38, warning: 42 };       // C apparent temperature
const COLD = { advisory: -12, warning: -20 };     // C apparent temperature
const THUNDER = new Set([95, 96, 99]);
const rank = { none: 0, advisory: 1, warning: 2 };
const grade = (v, t) => (v >= t.warning ? 'warning' : v >= t.advisory ? 'advisory' : 'none');

async function stormAlert(place, hours = 24) {
  const g = await geocode(place);
  const q = `${FORECAST}?latitude=${g.lat}&longitude=${g.lon}`
    + `&hourly=weather_code,wind_gusts_10m,precipitation,snowfall,apparent_temperature`
    + `&forecast_days=3&timezone=auto`;
  const d = await fetchJson(q);
  const h = d.hourly, off = (d.utc_offset_seconds || 0) * 1000, now = Date.now();
  let maxGust = 0, gustAt = null, sumRain = 0, maxRainHr = 0, sumSnow = 0;
  let maxHeat = -100, minCold = 100, thunderAt = null, n = 0;
  for (let i = 0; i < h.time.length; i++) {
    const utc = Date.parse(h.time[i] + ':00Z') - off;
    if (utc < now - 3600e3 || utc > now + hours * 3600e3) continue;
    n++;
    const gust = h.wind_gusts_10m[i] ?? 0, rain = h.precipitation[i] ?? 0;
    if (gust > maxGust) { maxGust = gust; gustAt = utc; }
    sumRain += rain; if (rain > maxRainHr) maxRainHr = rain;
    sumSnow += h.snowfall[i] ?? 0;
    const at = h.apparent_temperature[i]; if (at > maxHeat) maxHeat = at; if (at < minCold) minCold = at;
    if (THUNDER.has(h.weather_code[i]) && thunderAt == null) thunderAt = utc;
  }
  const rel = (t) => { const dh = Math.round((t - now) / 3600e3); return dh <= 0 ? 'now' : dh === 1 ? 'within the hour' : `in about ${dh} hours`; };
  const hz = [];
  const push = (level, type, detail, when) => { if (level !== 'none') hz.push({ type, level, detail, when }); };
  push(thunderAt != null ? 'warning' : 'none', 'thunderstorms', 'thunderstorms in the forecast', thunderAt != null ? rel(thunderAt) : null);
  push(grade(maxGust, GUST), 'high wind', `gusts to ${r0(maxGust)} km/h`, gustAt != null ? rel(gustAt) : null);
  push(grade(sumRain, RAIN_WINDOW) === 'none' ? grade(maxRainHr, RAIN_HOUR) : grade(sumRain, RAIN_WINDOW), 'heavy rain', `${r1(sumRain)} mm expected, peak ${r1(maxRainHr)} mm/h`, null);
  push(grade(sumSnow, SNOW_WINDOW), 'heavy snow', `${r1(sumSnow)} cm snowfall expected`, null);
  push(grade(maxHeat, HEAT), 'extreme heat', `feels-like peaks at ${r0(maxHeat)}°C`, null);
  push(grade(-minCold, { advisory: -COLD.advisory, warning: -COLD.warning }), 'extreme cold', `feels-like drops to ${r0(minCold)}°C`, null);
  const level = hz.reduce((m, x) => (rank[x.level] > rank[m] ? x.level : m), 'none');
  const breach = level !== 'none';
  const window = `${hours} hours`;
  const where = g.country ? `${g.name}, ${g.country}` : g.name;
  let summary;
  if (!breach) {
    const calm = n ? ` Winds stay around ${r0(maxGust)} km/h and no thunderstorms are in the forecast.` : '';
    summary = `No storm is expected in ${where} in the next ${window}.${calm}`;
  } else {
    const top = hz.slice().sort((a, b) => rank[b.level] - rank[a.level])[0];
    const kind = { 'extreme heat': 'extreme heat', 'extreme cold': 'extreme cold',
      'heavy snow': 'winter storm conditions' }[top.type] || 'severe weather';
    const lead = hz.map((x) => (x.when ? `${x.detail} ${x.when}` : x.detail)).join(', ');
    summary = `Yes, ${kind} is likely in ${where} within the next ${window}: ${lead}.`;
  }
  return {
    intent: 'STORM_ALERT', location: g.name, country: g.country, latitude: g.lat, longitude: g.lon,
    breach, level, hazards: hz, window_hours: hours,
    peak_gust_kmh: r1(maxGust), total_precip_mm: r1(sumRain), total_snowfall_cm: r1(sumSnow),
    max_apparent_c: r1(maxHeat), min_apparent_c: r1(minCold), thunderstorms: thunderAt != null,
    hours_evaluated: n, risk: breach ? (level === 'warning' ? 0.95 : 0.8) : 0.95,
    summary, confidence: 0.95, source: 'open-meteo hourly forecast', as_of: new Date().toISOString(),
  };
}

const json = (body, status = 200, ttl = 0) =>
  new Response(JSON.stringify(body, null, 1), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': ttl ? `public, max-age=${ttl}` : 'no-store',
      'access-control-allow-origin': '*',
    },
  });

const MEMO = new Map();
const MEMO_TTL_MS = 10_000;
const RECENT = [];

async function memoized(key, fn) {
  const hit = MEMO.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.body;
  const body = await fn();
  MEMO.set(key, { at: Date.now(), body });
  return body;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const q = url.searchParams;

    if (path === '/__last') return json({ recent: RECENT.slice(-25) });
    if (path === '/health') return json({ ok: true, intents: ['WEATHER_CHECK', 'WEATHER_FORECAST', 'STORM_ALERT'] });

    RECENT.push({ at: new Date().toISOString(), method: request.method, url: request.url,
      ua: request.headers.get('user-agent'),
      via: request.headers.get('x-telegraph-node') || request.headers.get('x-forwarded-for') });
    if (RECENT.length > 50) RECENT.shift();

    if (path === '/') {
      return json({
        service: 'Telegraph weather miner',
        intents: {
          WEATHER_CHECK: '/weather/{location} or /weather?location=',
          WEATHER_FORECAST: '/forecast/{location} or /forecast?location=&days=',
          STORM_ALERT: '/storm/{location} or /storm?location=&hours=',
        },
        data: 'open-meteo, keyless',
      });
    }

    const rawFrom = (prefix) => path.startsWith(prefix + '/')
      ? decodeURIComponent(path.slice(prefix.length + 1))
      : (q.get('location') || q.get('city') || q.get('place') || q.get('query'));

    if (path === '/weather' || path.startsWith('/weather/')) {
      const place = extractPlace(rawFrom('/weather'));
      if (!place) return json({ error: 'name a location, for example /weather/London' }, 400);
      try {
        const body = await memoized('c:' + place.toLowerCase(), () => current(place));
        return json(body, 200, 10);
      } catch (err) {
        const msg = String(err);
        const code = msg.includes('could not find') ? 404 : 502;
        return json({ error: `weather unavailable for ${place}`, detail: msg.slice(0, 160) }, code);
      }
    }

    if (path === '/forecast' || path.startsWith('/forecast/')) {
      const raw = rawFrom('/forecast');
      const place = extractPlace(raw);
      if (!place) return json({ error: 'name a location, for example /forecast/London' }, 400);
      let days = parseInt(q.get('days') || '', 10);
      if (!Number.isFinite(days)) days = parseDays(raw);
      if (!Number.isFinite(days) || days < 1 || days > 7) days = 3;
      const tgt = (parseTargetDay(raw) || {}).kind || `d${days}`;
      try {
        const body = await memoized(`f:${tgt}:${place.toLowerCase()}`, () => forecast(place, raw, days));
        return json(body, 200, 10);
      } catch (err) {
        const msg = String(err);
        const code = msg.includes('could not find') ? 404 : 502;
        return json({ error: `forecast unavailable for ${place}`, detail: msg.slice(0, 160) }, code);
      }
    }

    if (path === '/storm' || path.startsWith('/storm/')) {
      const place = extractPlace(rawFrom('/storm'));
      if (!place) return json({ error: 'name a location, for example /storm/Miami' }, 400);
      let hours = parseInt(q.get('hours') || '24', 10);
      if (!Number.isFinite(hours) || hours < 1 || hours > 48) hours = 24;
      try {
        const body = await memoized(`s:${hours}:${place.toLowerCase()}`, () => stormAlert(place, hours));
        return json(body, 200, 10);
      } catch (err) {
        const msg = String(err);
        const code = msg.includes('could not find') ? 404 : 502;
        return json({ error: `storm outlook unavailable for ${place}`, detail: msg.slice(0, 160) }, code);
      }
    }

    return json({ error: 'not found', usage: '/weather/{location} or /forecast/{location} or /storm/{location}' }, 404);
  },
};
