# DATA-SOURCES

Where every number SkyWire publishes comes from and whether we are allowed to use it. SkyWire's own code is MIT, Copyright (c) 2026 zkasuran. The data is not ours and carries its own terms, recorded here and in NOTICE.

Everything is read at request time with no API key and no stored dataset. The only two upstream endpoints are the `GEO` and `FORECAST` constants at the top of `worker.js`.

| Host | What it provides | Licence | Attribution required | Commercial use | Rate limit |
| --- | --- | --- | --- | --- | --- |
| api.open-meteo.com | current conditions, daily 7 day forecast, 3 day hourly series | CC-BY-4.0 | yes | not on the free keyless tier we use | 600/min, 5,000/hour, 10,000/day, 300,000/month |
| geocoding-api.open-meteo.com | place name to coordinates, country, timezone | CC-BY-4.0 | yes | not on the free keyless tier we use | same free tier limits, max 100 results per request |
| geonames.org | the place database behind Open-Meteo geocoding, never called directly | CC-BY-4.0 | yes | allowed | 10,000 credits/day, 1,000/hour per username |

## api.open-meteo.com

`FORECAST = 'https://api.open-meteo.com/v1/forecast'`, three call shapes, one per intent. WEATHER_CHECK requests `current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m` with `timezone=auto`. WEATHER_FORECAST requests the daily block (weather code, max and min temperature, precipitation probability and sum, max wind speed, max gusts, dominant wind direction, snowfall sum) over `forecast_days=7`, plus a 3 day hourly block only when the question is about wind or names a morning. STORM_ALERT requests a 3 day hourly block of weather code, gusts, precipitation, snowfall and apparent temperature, then walks the hours inside the asked window and grades them against fixed advisory and warning thresholds. WMO weather codes are mapped to plain words locally, so the sky condition text is ours and the code behind it is theirs.

When it fails: `fetchJson` sets a 5 second `AbortSignal.timeout` and throws on any non-2xx. The route handler returns 502 with the upstream error string truncated to 160 characters, so a caller can tell a network failure from a bad place name. Nothing stale is served in place of a live read. The one soft failure is the optional hourly call in the forecast path, wrapped in `.catch(() => null)`, so a wind answer falls back to the daily maximum wind and dominant direction instead of erroring.

## geocoding-api.open-meteo.com

`GEO = 'https://geocoding-api.open-meteo.com/v1/search'`, called with `count=1&language=en&format=json`. It runs first on every request because the forecast API takes coordinates. The resolved name and country are printed in the answer, so a typo landing on an obscure place is visible to whoever reads it.

When it fails: an empty `results` array throws "could not find a place named X" and the handler returns 404. Any other failure is a 502. An unsubstituted path template such as `/weather/{location}` resolves to London and answers 200 rather than 400, because a 400 on a routing probe freezes the miner out for an epoch.

## geonames.org

Never called. The Open-Meteo geocoding docs credit their place data to GeoNames under "Attribution", so the place names we publish are GeoNames-derived and carry the CC BY credit. The export page states "commercial usage is allowed" and asks for credit "with a link or another reference to GeoNames".

## Caching and call volume

A per-isolate `Map` memo holds each answer for 10 seconds, keyed by intent, parsed focus, window and lowercased place, so a burst on one place collapses to a single upstream pair. Success responses carry `Cache-Control: public, max-age=10`. There is no persistent store, no database and nothing that can go stale beyond 10 seconds.

Each miner request costs two upstream calls, three when the hourly series is needed. The descriptors declare `rate_limit_per_sec: 20`, which at sustained load is 40 to 60 upstream calls per second or 2,400 to 3,600 per minute against a free ceiling of 600 per minute. Real traffic has been far below that. The leaderboard snapshot in the README records 941, 620 and 334 network requests across a full epoch for the three intents.

## Compliance

### Obligations we meet

1. Open-Meteo is credited in the README with a link to open-meteo.com. The licence is named as CC BY 4.0.
2. NOTICE carries the exact credit lines for both Open-Meteo endpoints and for GeoNames, with the terms URL for each.
3. Our own code ships the MIT licence text with the copyright notice.

### Open items

1. **The free Open-Meteo tier is non-commercial only and this miner does not clearly qualify.** The terms say "You may only use the free API services for non-commercial purposes" and the pricing table marks commercial use unavailable on Free / Open-Access. All three descriptors set `min_price_usdc: 0.01`, so answers are sold on-chain. The miner is also entered in a hackathon with a cash prize pool. Open-Meteo's own list of commercial use includes "Integrating our service into commercial products or promotional activities" and their non-commercial carve-outs are private or non-profit sites, home automation, public research and educational content. We do not read this miner as sitting inside those carve-outs. Swap paths, in the order we would take them:
   - Subscribe to Open-Meteo API Standard. It grants "a commercial use licence and an API key for the dedicated customer endpoint" at customer-api.open-meteo.com with 1 million calls per month. The pricing page names the tier but shows no price. Open-Meteo's own announcement post gives $29 per month for Standard and $99 for Professional. Only the host and an `&apikey=` parameter change, so the worker edit is two constants.
   - Self-host. The Open-Meteo server is published on GitHub under AGPLv3 and the non-commercial term on the terms page is written against "the free API services" rather than the software.
   - Move to a keyless source whose terms do not restrict commercial use. api.met.no Locationforecast from the Norwegian Meteorological Institute is CC BY 4.0 plus NLOD 2.0, keyless, asks for the credit "Data from MET Norway", requires an identifying User-Agent with contact details and states "Anything over 20 requests/second per application (total, not per client) requires special agreement". Nothing on their terms or licence pages restricts commercial use. For US points api.weather.gov states "All of the information presented via the API is intended to be open data, free to use for any purpose", with an unpublished rate limit. Geocoding is the harder half. Nominatim is ODbL with share-alike, allows "an absolute maximum of 1 request per second" and its policy says services whose primary function is geocoding must run their own instance, so it is a poor fit. The GeoNames web service allows commercial use at 10,000 credits per day but needs a `username`, so it is not keyless.
2. **Attribution is missing from the data we serve.** Responses carry `source: "open-meteo current"` with no link and no licence link. CC BY asks for credit wherever the material appears. The fix is an `attribution` field on every response body plus a credit line on the `/` service page the descriptors publish as documentation.
3. **GeoNames is not credited in the repo.** The README and the docs name Open-Meteo only. The line is in NOTICE now and belongs in the README too.
4. **The README credit is missing two CC BY parts.** It names CC BY 4.0 without linking the licence and does not indicate that the data was changed. We round values, map WMO codes to words and render sentences, which is an adaptation.
5. **The declared burst rate is above the free ceiling.** `rate_limit_per_sec: 20` in each descriptor allows 40 to 60 upstream calls per second against a documented 600 per minute and Open-Meteo reserves the right to block IP addresses that misuse the service without prior notice. Observed traffic has never approached it. Either lower the declared rate, widen the memo window or move to a tier with no per-minute cap.
