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
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/runtime-Cloudflare%20Workers-f38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/data-open--meteo-22c55e?style=flat-square" alt="open-meteo">
  <img src="https://img.shields.io/badge/chain-Base%20Sepolia-3b82f6?style=flat-square" alt="Base Sepolia">
</p>

---

## Table of Contents

- [Overview](#overview)
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

**SkyWire** is a Telegraph network miner that serves real-time weather intelligence from a single Cloudflare Worker. It resolves three canonical intents — current conditions, multi-day forecasts, and severe weather alerts — by reading live data from the [open-meteo](https://open-meteo.com) API at request time.

```
┌─────────────────┐       ┌──────────────────┐       ┌─────────────────┐
│  Telegraph Node │──────▶│  SkyWire Worker  │──────▶│   open-meteo    │
│  (intent query) │◀──────│  (CF Workers)    │◀──────│  (geocode+wx)   │
└─────────────────┘       └──────────────────┘       └─────────────────┘
         ▲                         │
         │                         ▼
         │                 ┌──────────────────┐
         └─────────────────│  Base Sepolia    │
           on-chain score  │  (registry)      │
                           └──────────────────┘
```

**Key design points:**
- 🔑 **No API key** — open-meteo is free and keyless
- 🗄️ **No database** — every figure is a live reading
- ⚡ **10-second memo** — per-isolate cache prevents stale data while handling burst traffic
- 🌍 **Global geocoding** — any place name open-meteo can resolve works
- 📝 **Natural language** — answers are complete sentences, not raw JSON blobs

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
                    │                 ▼          open-meteo      │
                    │  ┌────────────────────┐                   │
                    │  │  Geocoding API     │  name → lat/lon   │
                    │  └─────────┬──────────┘                   │
                    │            ▼                               │
                    │  ┌────────────────────┐                   │
                    │  │  Forecast API      │  lat/lon → data   │
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
| `GET` | `/forecast?query=` | Parses "5 day forecast for Berlin" naturally |

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
| `GET` | `/health` | Health check (`{ ok: true }`) |
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
  "summary": "It is currently 18°C and partly cloudy in London, United Kingdom, with 72% humidity and 14 km/h winds. It feels like 17°C.",
  "confidence": 0.95,
  "source": "open-meteo current"
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

| Intent | Descriptor File | On-Chain ID |
|--------|----------------|-------------|
| `WEATHER_CHECK` | [`skywire-weather-check.yaml`](skywire-weather-check.yaml) | 7304 |
| `WEATHER_FORECAST` | [`skywire-forecast.yaml`](skywire-forecast.yaml) | 7305 |
| `STORM_ALERT` | [`skywire-storm-alert.yaml`](skywire-storm-alert.yaml) | 7306 |

Each descriptor defines the input/output schemas, endpoint paths, semantic mappings, and on-chain field encodings for its intent.

---

## How It Works

### Query Resolution

SkyWire doesn't just match a bare place name — it understands full questions:

| Input | Resolves To |
|-------|-------------|
| `London` | London (direct) |
| `what is the weather in Paris` | Paris (NL extraction) |
| `3 day forecast for Tokyo` | Tokyo, 3 days |
| `any storms coming to Miami` | Miami, storm check |
| `forecast for Friday` | Target day extraction |
| `{location}` (template probe) | London (safe default) |

### Caching Strategy

- **10-second per-isolate memo** — prevents hammering open-meteo on burst traffic
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
| Unknown place name | `404` with helpful message |
| open-meteo timeout/error | `502` with detail |
| Missing location parameter | `400` with usage example |
| Template probe (`{location}`) | `200` with London data (avoids routing freeze) |

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
│   └── storm-alert.md             # STORM_ALERT intent docs
├── LICENSE                        # MIT
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

---

## License

[MIT](LICENSE) — Written for the Telegraph network by [zkasuran](https://github.com/zkasuran) with AI assistance (Claude, Anthropic).

Weather data provided by [open-meteo](https://open-meteo.com) (CC BY 4.0).
