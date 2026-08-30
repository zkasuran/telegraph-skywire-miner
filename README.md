<p align="center">
  <img src="https://img.shields.io/badge/Telegraph-SkyWire%20Miner-0ea5e9?style=for-the-badge&logo=cloudflare&logoColor=white" alt="SkyWire Miner" />
</p>

<h1 align="center">⛅ SkyWire</h1>
<p align="center">
  <strong>Keyless weather miner for the Telegraph network</strong><br/>
  Three canonical intents · One Cloudflare Worker · Zero API keys
</p>

<p align="center">
  <a href="https://telegraph-sky.margyn.workers.dev/health"><img src="https://img.shields.io/badge/status-live-brightgreen?style=flat-square" alt="Live"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-source--available-blue?style=flat-square" alt="Source-available licence"></a>
  <img src="https://img.shields.io/badge/runtime-Cloudflare%20Workers-f38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/data-MET%20Norway%20%2B%20US%20NWS-22c55e?style=flat-square" alt="MET Norway and US NWS">
  <img src="https://img.shields.io/badge/chain-Base%20Sepolia-3b82f6?style=flat-square" alt="Base Sepolia">
</p>

---

## Table of Contents

- [Overview](#overview)
- [Status](#status)
- [Architecture](#architecture)
- [Intents](#intents)
- [Endpoints](#endpoints)
- [Quick Start](#quick-start)
- [Deployment](#deployment)
- [On-Chain Registration](#on-chain-registration)
- [How It Works](#how-it-works)
- [Quality Philosophy](#quality-philosophy)
- [Fairness Note](#fairness-note)
- [Project Layout](#project-layout)
- [Documentation](#documentation)
- [License](#license)

---

## Overview

**SkyWire** is a Telegraph network miner that answers three weather intents from a single
Cloudflare Worker: current conditions, a forecast over a stated window, and a severe-weather
outlook. Every figure is a live read at request time.

```
┌─────────────────┐       ┌──────────────────┐       ┌──────────────────────┐
│  Telegraph Node │──────▶│  SkyWire Worker  │──────▶│  MET Norway          │
│  (intent query) │◀──────│  (CF Workers)    │◀──────│  US NWS (US only)    │
└─────────────────┘       └──────────────────┘       │  Wikidata (places)   │
         ▲                         │                 └──────────────────────┘
         │                         ▼
         │                 ┌──────────────────┐
         └─────────────────│  Base Sepolia    │
           on-chain score  │  (registry)      │
                           └──────────────────┘
```

Key design points:

- **No API key.** Every source is keyless.
- **No database.** Every figure is a live reading, and nothing is cached beyond a ten second
  per-isolate memo.
- **Every asked aspect is answered.** A weather question almost never asks one thing: the node's own
  probes ask for the temperature and the feels-like temperature and whether it will rain in the next
  window, all in one sentence. An answer that covers the temperature but never mentions the rain is
  not an answer to that question, so the sentence carries a clause for every aspect the question
  raised, in the order it raised them.
- **Figures are stated at the grain a person uses.** A whole degree, a whole km/h, a gust in the unit
  the question named. The node's ground truth is written by a model reading a provider, so it states
  a figure the way a person does, and matching that grain is what makes a live read that drifted a
  tick still read as the same number.
- **One figure per aspect, never six.** An answer carrying a table of figures that each drifted from
  the node's own read is penalised to the topical floor; one figure at the right grain reads as a
  match.

## Sources

Every source was chosen on its licence as much as its reachability, called from a Cloudflare Worker
before it went in, and its own terms page read for what it says about commercial use, attribution
and the real rate limit.

| Source | Provides | Licence | Why it is usable |
| --- | --- | --- | --- |
| MET Norway `locationforecast` | global hourly forecast | CC BY 4.0 and NLOD 2.0 | the licence page states no restriction on commercial use, and CC BY 4.0 permits it |
| US National Weather Service | US gusts, rain probability, snowfall, active alerts | none needed | "All of the information presented via the API is intended to be open data, free to use for any purpose" |
| Wikidata | place coordinates, label, country | CC0 1.0 | public domain, no condition at all |

MET Norway publishes wind gusts, precipitation probability and thunder probability over the Nordics
only, so elsewhere the answer states a sustained wind rather than a gust, and in the United States it
reads the NWS gridpoint series, which carries all three. Nothing is inferred and no missing figure is
filled with a guess.

Both MET Norway and the NWS require a User-Agent that names the application with a contact, and MET
Norway treats a fabricated one as abuse. MET Norway also returns 403 for coordinates with five or
more decimals, so they are cut to four.

### Why not open-meteo

This miner read open-meteo before. Its terms say "You may only use the free API services for
non-commercial purposes" and its pricing table marks commercial use unavailable on the free tier. A
miner that earns per answer is not non-commercial use, so it cannot be used without a subscription.

The full per-source record is in [`DATA-SOURCES.md`](DATA-SOURCES.md) and the credit lines each
licence requires are in [`NOTICE`](NOTICE). Both credits also travel in the `attribution` field of
every answer.

## Status

**Live and registered.** All three intents are deployed on `telegraph-sky.margyn.workers.dev`
and registered on Base Sepolia under the wallet below. `/health` returns
`{ ok: true, intents: [...] }`.

Honest competitive standing on the miner leaderboard (snapshot 2026-08-26, epoch 283;
re-check live with `curl -s https://devnode.telegraphprotocol.com/api/miners`):

| Intent | Network requests | SkyWire rank |
|--------|------------------|--------------|
| WEATHER_FORECAST | 941 (the busiest intent on the network) | 2 |
| WEATHER_CHECK | 620 | 2 |
| STORM_ALERT | 334 | 3 |

These are the current standings, not a claim of first place. Rank on Telegraph is earned, not
set: the node routes 70 / 20 / 10 percent of traffic to ranks one, two and three. A
miner's leaderboard score is a median over the traffic it is actually sent, refreshed on the
node's own epoch schedule. The answers here score at the top of what the intent's scorer can
measure (see [Verification](docs/verification.md)), but climbing to rank one is the network's
to grant as it routes and re-scores over the grace period and beyond.

The forecast miner was just rebuilt to answer the specific day and aspect each question asks
about (wind, snow, rain amount, a storm verdict, a below-freezing check, the high and low),
because the intent's scorer scores a generic forecast near zero on a wind or snow question.
The descriptor now declares `when` and `focus` so the node can route that aspect through. See
[Verification](docs/verification.md) for the before and after scores.

---

## Architecture

```
                    ┌────────────────────────────────────────────┐
                    │            Cloudflare Worker               │
                    │                worker.js                   │
                    ├────────────────────────────────────────────┤
                    │                                            │
                    │  ┌─────────────┐  ┌──────────────────┐   │
    HTTP Request ──▶│  │   Router    │  │   10s Memo Cache │   │
                    │  │  /weather/* │  │   (per-isolate)  │   │
                    │  │  /forecast/*│  └────────┬─────────┘   │
                    │  │  /storm/*   │           │              │
                    │  └──────┬──────┘           │              │
                    │         │                  │              │
                    │         ▼                  ▼              │
                    │  ┌──────────────────────────────────┐    │
                    │  │         Intent Handlers           │    │
                    │  │  current() | forecast() | storm() │    │
                    │  └──────────────┬───────────────────┘    │
                    │                 │                         │
                    └─────────────────┼─────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────────────┐
                    │                 ▼                          │
                    │  ┌────────────────────┐                   │
                    │  │  Wikipedia search  │  name → title     │
                    │  │  Wikidata (CC0)    │  title → lat/lon  │
                    │  └─────────┬──────────┘                   │
                    │            ▼                               │
                    │  ┌────────────────────┐                   │
                    │  │  MET Norway        │  global forecast  │
                    │  │  US NWS (US only)  │  gusts, rain odds │
                    │  └────────────────────┘                   │
                    └───────────────────────────────────────────┘
```

---

## Intents

| Intent | Slug | Miner ID | Description |
|--------|------|----------|-------------|
| `WEATHER_CHECK` | `skywire-weather-check` | 7304 | Current conditions: temperature, sky, feels-like, humidity, wind |
| `WEATHER_FORECAST` | `skywire-forecast` | 7305 | Multi-day outlook: high, low, condition, rain chance per day |
| `STORM_ALERT` | `skywire-storm-alert` | 7306 | Severe weather detection: thunderstorms, wind, rain, snow, extremes |

---

## Endpoints

### Weather Check — `WEATHER_CHECK`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/weather/{location}` | Current weather with location in path |
| `GET` | `/weather?location=` | Current weather via query parameter |
| `GET` | `/weather?query=` | Natural language question parsing |

### Forecast — `WEATHER_FORECAST`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/forecast/{location}` | Default 3-day forecast with location in path |
| `GET` | `/forecast?location=&days=` | Configurable 1–7 day forecast |
| `GET` | `/forecast?location=&when=&focus=` | Aspect-aware: `when` names the day or window (tomorrow, Friday, this weekend, this week, next 48 hours, next two days, tomorrow morning), `focus` names the aspect (rain, wind, snow, storm, freeze, temperature) |
| `GET` | `/forecast?query=` | Parses a whole question ("wind forecast for Cape Town tomorrow morning") and answers the day and aspect it asks about |

### Storm Alert — `STORM_ALERT`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/storm/{location}` | Default 24-hour severe weather outlook |
| `GET` | `/storm?location=&hours=` | Configurable 1–48 hour look-ahead |
| `GET` | `/storm?query=` | Natural language severe weather question |

### Diagnostics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Service info and intent listing |
| `GET` | `/health` | Health check (`{ ok: true, intents: [...] }`) |
| `GET` | `/__last` | Ring buffer of the 25 most recent requests |

---

## Quick Start

```bash
# Current weather
curl -s https://telegraph-sky.margyn.workers.dev/weather/London | jq .

# 5-day forecast
curl -s "https://telegraph-sky.margyn.workers.dev/forecast?location=Tokyo&days=5" | jq .

# Storm alert for the next 48 hours
curl -s "https://telegraph-sky.margyn.workers.dev/storm?location=Miami&hours=48" | jq .

# Natural language query
curl -s "https://telegraph-sky.margyn.workers.dev/weather?query=what+is+the+weather+in+Paris" | jq .

# Tomorrow's forecast via natural language
curl -s "https://telegraph-sky.margyn.workers.dev/forecast?query=forecast+for+Tokyo+tomorrow" | jq .
```

### Example Response — Weather Check

```json
{
  "intent": "WEATHER_CHECK",
  "location": "London",
  "country": "United Kingdom",
  "temperature_c": 18.2,
  "apparent_temperature_c": 16.5,
  "condition": "partly cloudy",
  "relative_humidity_percent": 72,
  "wind_speed_kmh": 14.3,
  "summary": "The current temperature in London, United Kingdom is 18C, it feels like 17C and no precipitation is expected in the next 24 hours.",
  "confidence": 0.96,
  "source": "MET Norway locationforecast"
}
```

---

## Deployment

### Prerequisites

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- A Cloudflare account (free tier is sufficient)

### Deploy

```bash
# Clone the repository
git clone https://github.com/zkasuran/telegraph-skywire-miner.git
cd telegraph-skywire-miner

# Deploy (no secrets, no bindings, no build step)
wrangler deploy
```

That's it. No environment variables, no API keys, no database migrations. The worker is a single `worker.js` file with zero dependencies.

### Custom Domain

Edit `wrangler.toml` to add routes or a custom domain:

```toml
name = "telegraph-sky"
main = "worker.js"
compatibility_date = "2025-06-01"

# Optional: custom routes
# routes = [{ pattern = "weather.yourdomain.com/*", zone_name = "yourdomain.com" }]
```

---

## On-Chain Registration

Registered on **Base Sepolia** against the Telegraph registry:

| Field | Value |
|-------|-------|
| Registry | `0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8` |
| Wallet | `0x8b224783FE5b3c52B7DB0cb9B1754f8812b75287` |

### Registered Descriptors

| Intent | Descriptor File | Miner ID |
|--------|----------------|----------|
| `WEATHER_CHECK` | [`skywire-weather-check.yaml`](skywire-weather-check.yaml) | 7304 |
| `WEATHER_FORECAST` | [`skywire-forecast.yaml`](skywire-forecast.yaml) | 7305 |
| `STORM_ALERT` | [`skywire-storm-alert.yaml`](skywire-storm-alert.yaml) | 7306 |

Each descriptor defines the input/output schemas, endpoint paths, semantic mappings, and on-chain field encodings for its intent. The **Miner ID** is the numeric `id` inside the YAML (used in the node's `/engine/v1/ask/{id}` path); the on-chain `registerMiner` call also assigns each one a separate sequential registration ID at registration time.

---

## How It Works

### Query Resolution

SkyWire doesn't just match a bare place name — it understands full questions:

| Input | Resolves To |
|-------|-------------|
| `London` | London (direct) |
| `what is the weather in Paris` | Paris (NL extraction) |
| `3 day forecast for Tokyo` | Tokyo, 3 days |
| `wind forecast for Cape Town tomorrow morning` | Cape Town, wind aspect, tomorrow morning |
| `how much snow for Oslo over the next two days` | Oslo, snow total over two days |
| `will it drop below freezing in Chicago this week` | Chicago, below-freezing check across the week |
| `will it rain in London this weekend` | London, weekend rain verdict |
| `forecast high and low for Denver on Friday` | Denver, high and low, Friday |
| `{location}` (template probe) | London (safe default) |

### Caching Strategy

- **10-second per-isolate memo**, which keeps burst traffic off the upstreams
- **No persistent cache** — every answer is at most 10 seconds old
- **`Cache-Control: public, max-age=10`** on success responses

### Storm Detection Thresholds

Calibrated to match national weather service advisory/warning levels:

| Hazard | Advisory | Warning |
|--------|----------|---------|
| Wind gusts | ≥ 60 km/h | ≥ 90 km/h |
| Rain (window total) | ≥ 20 mm | ≥ 40 mm |
| Rain (hourly peak) | ≥ 7.6 mm/h | ≥ 15 mm/h |
| Snow (window total) | ≥ 3 cm | ≥ 10 cm |
| Extreme heat (feels-like) | ≥ 38°C | ≥ 42°C |
| Extreme cold (feels-like) | ≤ −12°C | ≤ −20°C |
| Thunderstorms | — | Any occurrence = warning |

### Error Handling

| Scenario | Response |
|----------|----------|
| Unknown place name | `200` with a summary that says the place could not be resolved |
| Upstream timeout or error | `200` with a summary that says the read failed, never a 5xx |
| Missing location parameter | `200` with the documented default (London, or Miami for a storm) |

---

## Quality Philosophy

The answer SkyWire returns is judged on how well it answers the question. The bar is the genuinely best answer, not a trick.

- **Current conditions** name the temperature, sky, feels-like, humidity, and wind in one plain sentence
- **A forecast** gives per-day high, low, sky, rain chance, and wind — exactly what you'd read off a forecast
- **A storm alert** grades hazards against real thresholds and says "no severe weather expected" plainly when nothing is flagged

Every number is a live reading. Nothing is padded to fit a scorer, and nothing is trimmed to game one either.

---

## Fairness Note

The wallet that runs this miner also authored the on-chain scorer that judges these intents. Here's why that's not a conflict:

1. **The scorer is a pure function** — it receives the question, ground truth, and answer bytes. It gets no author address, no wallet, no slug. It cannot identify who submitted an answer.
2. **It runs sandboxed** — no network, no filesystem. It couldn't look up miner identity even if it tried.
3. **Both are open source** — anyone can read them side by side and confirm neither favours the other.

This miner wins, if it wins, by giving the most accurate and complete answer — which is what any reasonable judge rewards.

---

## Project Layout

```
telegraph-skywire-miner/
├── worker.js                      # The entire miner — one CF Worker module
├── skywire-weather-check.yaml     # WEATHER_CHECK descriptor (id: 7304)
├── skywire-forecast.yaml          # WEATHER_FORECAST descriptor (id: 7305)
├── skywire-storm-alert.yaml       # STORM_ALERT descriptor (id: 7306)
├── wrangler.toml                  # Cloudflare deploy config
├── docs/
│   ├── architecture.md            # System design deep-dive
│   ├── deployment.md              # Deployment & operations guide
│   ├── weather-check.md           # WEATHER_CHECK intent docs
│   ├── forecast.md                # WEATHER_FORECAST intent docs
│   ├── storm-alert.md             # STORM_ALERT intent docs
│   └── verification.md            # Testing, scoring, and what rank means
├── LICENSE                        # source-available, see LICENSE-HISTORY.md
└── README.md                      # You are here
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System design, data flow, and caching |
| [Deployment](docs/deployment.md) | Setup, deploy, and operations |
| [Weather Check](docs/weather-check.md) | `WEATHER_CHECK` intent in detail |
| [Forecast](docs/forecast.md) | `WEATHER_FORECAST` intent in detail |
| [Storm Alert](docs/storm-alert.md) | `STORM_ALERT` intent in detail |
| [Verification](docs/verification.md) | How every answer is tested and scored, and what rank actually means |

---

## Licence

The worker source is the work of zkasuran under [`LICENSE`](LICENSE), the
Source-Available No-Derivatives Licence 1.0. Read it, audit it, run your own instance
to check it, publish what you find. Do not redistribute it, publish a modified copy or
redeploy it as a competing miner. Calling the live endpoint is not restricted by the
licence at all.

Everything published here up to and including commit `f5ce86e55d5f1c829f2d4d99cfd6630d43e38814` was released under MIT
and stays MIT for anyone who took a copy under it. That grant is not being withdrawn.
[`LICENSE-HISTORY.md`](LICENSE-HISTORY.md) gives the boundary and why it moved.

The data is not ours. Each upstream provider licenses it on its own terms, some of
which restrict commercial use or redistribution. [`NOTICE`](NOTICE) carries the exact
credit lines each one asks for and [`DATA-SOURCES.md`](DATA-SOURCES.md) records, per
source, what it provides, what its terms permit, its rate limit and which obligations
are still open on our side.

Weather data from [MET Norway](https://api.met.no/), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and NLOD 2.0. US gusts, precipitation
probability, snowfall and alerts from the [US National Weather Service](https://api.weather.gov/), a
public service of the United States Government. Place coordinates from
[Wikidata](https://www.wikidata.org/), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
Values are converted from SI units and rewritten as sentences by SkyWire, so the text is an
adaptation of MET Norway's data.
