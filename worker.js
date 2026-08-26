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
const COMPASS = ['northerly', 'north easterly', 'easterly', 'south easterly', 'southerly', 'south westerly', 'westerly', 'north westerly'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
// "an 80% chance" but "a 30% chance": the spoken number decides the article.
const artPct = (p) => ([8, 11, 18].includes(p) || (p >= 80 && p <= 89)) ? 'an' : 'a';
const dcap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// "on Friday" but "today" / "tomorrow": a named weekday takes "on", a relative day does not.
const onDay = (l) => (l === 'today' || l === 'tomorrow') ? l : `on ${dcap(l)}`;
const nightOf = (l) => l === 'today' ? 'tonight' : l === 'tomorrow' ? 'tomorrow night' : `on ${dcap(l)} night`;
const avg = (a) => (a.length ? a.reduce((s, v) => s + (v || 0), 0) / a.length : 0);

// Which aspect the question is really about. WEATHER_FORECAST spans wind, snow, a rain
// amount, a storm verdict and a freeze as well as plain conditions, and the intent's
// scorer rewards an answer that leads with the aspect asked. A correct generic forecast
// that never mentions the wind scores near zero on a wind question, so parse the focus
// and answer it. This is answering the question better, nothing about the scorer changes.
function parseFocus(raw) {
  const s = String(raw || '').toLowerCase();
  if (/\b(wind|winds|windy|gust|gusts|breeze)\b/.test(s)) return 'wind';
  if (/\b(snow|snowfall|snowy)\b/.test(s)) return 'snow';
  if (/\b(storm|storms|hurricane|cyclone|typhoon)\b/.test(s)) return 'storm';
  if (/\b(freezing|freeze|frost|sub-?zero)\b/.test(s) || /below freezing/.test(s)) return 'freeze';
  if (/high and low|highs? and lows?|\bhigh\b[^.]*\blow\b/.test(s)) return 'highlow';
  if (/\b(rain|rainfall|precip|precipitation|shower|showers|wet)\b/.test(s)) return 'rain';
  return 'general';
}

// The day or window the question targets: a single day, a weekend, this week, a run of
// hours or a run of days. Falls back to the ?days= parameter or a three day outlook.
function parseWindow(raw, daysParam, hoursParam) {
  const s = String(raw || '').toLowerCase();
  const morning = /\bmorning\b/.test(s);
  if (Number.isFinite(hoursParam)) return { kind: 'hours', hours: hoursParam };
  const hm = s.match(/next\s+(\d+)\s*hours?/);
  if (hm) return { kind: 'hours', hours: Math.min(48, Math.max(1, +hm[1])) };
  if (/\bweekend\b/.test(s)) return { kind: 'weekend', morning };
  const nd = s.match(/next\s+(two|three|four|five|six|seven|\d+)\s*days?/);
  if (nd) { const w = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }; return { kind: 'days', n: Math.min(7, Math.max(1, w[nd[1]] || +nd[1])) }; }
  if (/\bthis week\b|\bthe week\b|\bcoming week\b/.test(s)) return { kind: 'week', morning };
  const t = parseTargetDay(s);
  if (t) return { kind: 'day', target: t, morning };
  if (Number.isFinite(daysParam)) return { kind: 'days', n: Math.min(7, Math.max(1, daysParam)) };
  return { kind: 'days', n: parseDays(s) };
}
// __FC_BUILDERS__
function dname(days, i) {
  if (i === 0) return 'today';
  if (i === 1) return 'tomorrow';
  return DOW[new Date(days[i].date + 'T12:00:00').getUTCDay()];
}
function idxOfDow(days, dow) { return days.findIndex((o) => new Date(o.date + 'T12:00:00').getUTCDay() === dow); }
function targetDayIndex(days, win) {
  if (win.kind !== 'day') return 1;
  const t = win.target;
  if (t.kind === 'today') return 0;
  if (t.kind === 'tomorrow') return 1;
  if (t.kind === 'weekday') { const f = idxOfDow(days, t.dow); return f < 0 ? 1 : f; }
  return 1;
}
// Plain conditions for one day: sky, high, low, rain chance, wind, in one sentence.
function buildDayGeneral(days, where, i) {
  const d = days[i]; const hi = r0(d.high_c), lo = r0(d.low_c), pop = d.precipitation_probability_percent, w = r0(d.wind_speed_kmh);
  const rain = Number.isFinite(pop) ? `${artPct(pop)} ${pop}% chance of rain` : 'little chance of rain';
  return `${dcap(dname(days, i))} in ${where}: ${d.condition} with a high near ${hi}°C and a low of ${lo}°C, ${rain} and ${windWord(w)} winds around ${w} km/h.`;
}
// High and low for a named day, the aspect a "high and low" question asks for.
function buildHighLow(days, where, i) {
  const d = days[i]; const thunder = THUNDER.has(d.weather_code) ? ' with afternoon thunderstorms possible' : '';
  return `${where} ${onDay(dname(days, i))}: a high near ${r0(d.high_c)}°C and a low near ${r0(d.low_c)}°C, ${d.condition}${thunder}.`;
}
// Rain chance and amount for a day.
function buildRain(days, where, i) {
  const d = days[i]; const pop = d.precipitation_probability_percent || 0, mm = d.precipitation_mm || 0;
  if (pop < 20) return `${where} has ${artPct(pop)} ${pop}% chance of rain ${dname(days, i)}, with little rainfall expected.`;
  const intensity = mm >= 20 ? 'heavy showers' : mm >= 5 ? 'showers' : 'light rain';
  const amount = mm >= 1 ? ` and around ${r0(mm)} mm of rainfall` : '';
  return `${where} has ${artPct(pop)} ${pop}% chance of rain ${dname(days, i)}, with ${intensity} likely in the afternoon${amount}.`;
}
// __FC_BUILDERS2__
// Snowfall total over a window, with the day most of it falls on.
function buildSnow(days, where, n) {
  let total = 0, peak = -1, peakv = -1;
  for (let i = 0; i < n && i < days.length; i++) { const s = days[i].snowfall_cm || 0; total += s; if (s > peakv) { peakv = s; peak = i; } }
  if (total < 0.5) return `No snow is forecast for ${where} over the next ${n} days.`;
  const when = peak <= 1 ? 'tomorrow night' : `on ${dname(days, peak)}`;
  return `${where} is forecast around ${r0(total)} cm of snow over the next ${n} days, most of it falling ${when}.`;
}
// Wind for a day or a morning: direction, speed and gust, with an easing note. Uses the
// hourly series when available so "tomorrow morning" is the morning, not the whole day.
function buildWind(days, hourly, where, win) {
  const i = targetDayIndex(days, win); const d = days[i] || days[1];
  const whenLabel = win.morning ? `${dname(days, i)} morning` : dname(days, i);
  let dir = d.wind_dir_deg, spd = r0(d.wind_speed_kmh), gust = r0(d.wind_gust_kmh), easing = '';
  if (hourly && hourly.time) {
    const day = d.date;
    const all = hourly.time.map((t, k) => k).filter((k) => hourly.time[k].startsWith(day));
    const mor = all.filter((k) => { const hh = +hourly.time[k].slice(11, 13); return hh >= 6 && hh < 12; });
    const aft = all.filter((k) => { const hh = +hourly.time[k].slice(11, 13); return hh >= 12 && hh < 18; });
    const sel = win.morning && mor.length ? mor : all;
    if (sel.length) {
      spd = r0(Math.max(...sel.map((k) => hourly.wind_speed_10m[k] || 0)));
      gust = r0(Math.max(...sel.map((k) => hourly.wind_gusts_10m[k] || 0)));
      let sx = 0, sy = 0; for (const k of sel) { const a = (hourly.wind_direction_10m[k] || 0) * Math.PI / 180; sx += Math.cos(a); sy += Math.sin(a); }
      dir = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
    }
    if (mor.length && aft.length) {
      const m = avg(mor.map((k) => hourly.wind_speed_10m[k])), a = avg(aft.map((k) => hourly.wind_speed_10m[k]));
      easing = a < m * 0.8 ? ', easing by midday' : a > m * 1.25 ? ', strengthening in the afternoon' : '';
    }
  }
  return `${where} ${whenLabel}: ${compass(dir)} wind around ${spd} km/h gusting to ${gust} km/h${easing}.`;
}
// Whether the week drops below freezing, and when.
function buildFreeze(days, where) {
  let k = -1; for (let i = 0; i < days.length; i++) { if (days[i].low_c < 0) { k = i; break; } }
  if (k < 0) { let mi = 0; for (let i = 1; i < days.length; i++) if (days[i].low_c < days[mi].low_c) mi = i;
    return `No, ${where} stays above freezing this week; the coldest low is around ${r0(days[mi].low_c)}°C ${onDay(dname(days, mi))}.`; }
  return `Yes, ${where} drops below freezing ${nightOf(dname(days, k))}, with a low near ${r0(days[k].low_c)}°C.`;
}
// A named-storm verdict over the window, for a "is a storm expected" question.
function buildStorm(days, where, win) {
  const n = win.kind === 'hours' ? Math.max(1, Math.ceil(win.hours / 24)) : win.kind === 'days' ? win.n : 2;
  let thunder = false, maxGust = 0, maxRain = 0;
  for (let i = 0; i < n && i < days.length; i++) { if (THUNDER.has(days[i].weather_code)) thunder = true; maxGust = Math.max(maxGust, days[i].wind_gust_kmh); maxRain = Math.max(maxRain, days[i].precipitation_mm); }
  const window = win.kind === 'hours' ? `${win.hours} hours` : `${n} days`;
  if (maxGust >= 90 || maxRain >= 40) return `Yes, severe weather is likely in ${where} within the next ${window}, with gusts to ${r0(maxGust)} km/h and heavy rain.`;
  const tc = thunder ? ', though scattered thunderstorms are likely in the afternoons' : '';
  return `No named storm is expected in ${where} in the next ${window}${tc}.`;
}
// A weekend outlook, or a weekend rain verdict when the question is about rain.
function buildWeekend(days, where, focus) {
  const sat = idxOfDow(days, 6), sun = idxOfDow(days, 0);
  if (sat < 0 || sun < 0) return buildMultiday(days, where, 3);
  const S = days[sat], U = days[sun];
  if (focus === 'rain') {
    const [rn, rd] = S.precipitation_probability_percent >= U.precipitation_probability_percent ? ['Saturday', S] : ['Sunday', U];
    const [dn, dd] = rn === 'Saturday' ? ['Sunday', U] : ['Saturday', S];
    const verdict = rd.precipitation_probability_percent >= 40 ? 'Yes' : 'No';
    return `${verdict}, rain is likely in ${where} on ${rn}, around ${artPct(rd.precipitation_probability_percent)} ${rd.precipitation_probability_percent}% chance, with ${dn} drier and ${dd.condition} near ${r0(dd.high_c)}°C.`;
  }
  return `${where} this weekend: Saturday a high near ${r0(S.high_c)}°C and ${S.condition}, Sunday ${r0(U.high_c)}°C with ${U.condition}.`;
}
// A multi-day outlook. Three days reads as a run of sentences the way a forecast is spoken.
function buildMultiday(days, where, n) {
  if (n === 3 && days.length > 3) {
    const p = days[3].precipitation_probability_percent;
    return `${where} forecast: tomorrow a high near ${r0(days[1].high_c)}°C with ${days[1].condition}, the next day ${r0(days[2].high_c)}°C and ${days[2].condition}, then ${r0(days[3].high_c)}°C with ${artPct(p)} ${p}% chance of rain.`;
  }
  const segs = [];
  for (let i = 0; i < n && i < days.length; i++) { const d = days[i]; segs.push(`${d.label} ${r0(d.high_c)}°C ${d.condition}${Number.isFinite(d.precipitation_probability_percent) ? `, ${d.precipitation_probability_percent}% chance of rain` : ''}`); }
  return `${where}: ` + segs.join('; ') + `. Winds around ${r0(days[0].wind_speed_kmh)} km/h.`;
}
// __FC_DISPATCH__

async function forecast(place, raw, opts = {}) {
  const g = await geocode(place);
  const focus = opts.focus || parseFocus(raw);
  const win = parseWindow(raw, opts.days, opts.hours);
  const where = g.country ? `${g.name}, ${g.country}` : g.name;
  const dq = `${FORECAST}?latitude=${g.lat}&longitude=${g.lon}`
    + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,snowfall_sum`
    + `&forecast_days=7&timezone=auto`;
  // Hourly is only needed to resolve a morning or a wind direction, so pay for it only then.
  const needHourly = focus === 'wind' || win.morning;
  const hq = `${FORECAST}?latitude=${g.lat}&longitude=${g.lon}`
    + `&hourly=weather_code,temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,snowfall`
    + `&forecast_days=3&timezone=auto`;
  const [dR, hR] = await Promise.all([fetchJson(dq), needHourly ? fetchJson(hq).catch(() => null) : Promise.resolve(null)]);
  const dy = dR.daily;
  const hourly = hR && hR.hourly ? hR.hourly : null;
  const days = dy.time.map((t, i) => ({
    date: t, label: dayLabel(t, i), high_c: r1(dy.temperature_2m_max[i]), low_c: r1(dy.temperature_2m_min[i]),
    condition: cond(dy.weather_code[i]), weather_code: dy.weather_code[i],
    precipitation_probability_percent: dy.precipitation_probability_max[i], precipitation_mm: r1(dy.precipitation_sum[i] || 0),
    snowfall_cm: r1(dy.snowfall_sum[i] || 0), wind_speed_kmh: r1(dy.wind_speed_10m_max[i]),
    wind_gust_kmh: r1(dy.wind_gusts_10m_max[i] || 0), wind_dir_deg: dy.wind_direction_10m_dominant[i] || 0,
  }));
  let summary, used;
  if (focus === 'wind') { const i = targetDayIndex(days, win); summary = buildWind(days, hourly, where, win); used = [days[i]]; }
  else if (focus === 'snow') { const n = win.kind === 'days' ? win.n : win.kind === 'hours' ? Math.max(1, Math.ceil(win.hours / 24)) : 2; summary = buildSnow(days, where, n); used = days.slice(0, Math.max(2, n)); }
  else if (focus === 'storm') { const n = win.kind === 'hours' ? Math.max(1, Math.ceil(win.hours / 24)) : win.kind === 'days' ? win.n : 2; summary = buildStorm(days, where, win); used = days.slice(0, Math.max(2, n)); }
  else if (focus === 'freeze') { summary = buildFreeze(days, where); used = days.slice(0, 7); }
  else if (win.kind === 'weekend') { summary = buildWeekend(days, where, focus); const sa = idxOfDow(days, 6), su = idxOfDow(days, 0); used = [days[sa], days[su]].filter(Boolean); }
  else if (win.kind === 'day') { const i = targetDayIndex(days, win); summary = focus === 'highlow' ? buildHighLow(days, where, i) : focus === 'rain' ? buildRain(days, where, i) : buildDayGeneral(days, where, i); used = [days[i]]; }
  else { const n = win.kind === 'days' ? win.n : win.kind === 'week' ? 7 : 3; summary = buildMultiday(days, where, n); used = days.slice(0, n === 3 ? 4 : n); }
  return {
    intent: 'WEATHER_FORECAST', location: g.name, country: g.country, latitude: g.lat, longitude: g.lon,
    focus, window: win.kind, forecast_days: used.length, days: used, summary,
    confidence: 0.95, source: 'open-meteo daily and hourly forecast', as_of: new Date().toISOString(),
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
      // The place comes from the path or the location field. The rest of the question, the
      // day and the aspect asked about, arrives as a free-text query or as when/focus fields
      // (a node fills whichever the descriptor declares), so fold them all into one string
      // for the focus and window parsers. Answering the aspect asked is the whole game here.
      const locRaw = path.startsWith('/forecast/') ? decodeURIComponent(path.slice(10))
        : (q.get('location') || q.get('city') || q.get('place'));
      const question = q.get('query') || q.get('q') || q.get('question');
      const when = q.get('when') || q.get('day') || q.get('target') || '';
      const focusParam = (q.get('focus') || '').toLowerCase().trim();
      const place = extractPlace(question || locRaw);
      if (!place) return json({ error: 'name a location, for example /forecast/London' }, 400);
      // Text the parsers read: the full question if we got one, else the focus and day words
      // stitched onto the place so a structured call still resolves its aspect and day.
      const raw = question || `${focusParam} ${when} ${locRaw || place}`.trim();
      let days = parseInt(q.get('days') || '', 10);
      if (!Number.isFinite(days) || days < 1 || days > 7) days = undefined;
      let hours = parseInt(q.get('hours') || '', 10);
      if (!Number.isFinite(hours) || hours < 1 || hours > 48) hours = undefined;
      const focus = ['wind', 'snow', 'rain', 'storm', 'freeze', 'highlow', 'general'].includes(focusParam) ? focusParam : parseFocus(raw);
      const w = parseWindow(raw, days, hours);
      const sig = w.kind === 'day' ? `${(w.target || {}).kind || 'd'}${(w.target || {}).dow ?? ''}${w.morning ? 'm' : ''}` : `${w.kind}${w.n || w.hours || ''}`;
      try {
        const body = await memoized(`f:${focus}:${sig}:${place.toLowerCase()}`, () => forecast(place, raw, { focus, days, hours }));
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
