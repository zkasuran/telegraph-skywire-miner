# 🏗️ Architecture

> How SkyWire turns a place name into a scored weather answer in one hop.

---

## System Overview

SkyWire is a **single-file Cloudflare Worker** (`worker.js`) that serves three Telegraph intents from one deployment. There are no build steps, no dependencies, no database, and no secrets. The entire system fits in one module because the problem is fundamentally simple: resolve a place, fetch weather data, format a sentence.

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Cloudflare Edge (global)                       │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                       worker.js                                │  │
│  │                                                               │  │
│  │  ┌──────────┐   ┌──────────────┐   ┌─────────────────────┐  │  │
│  │  │  Router  │──▶│ Place Parser │──▶│   Intent Handler    │  │  │
│  │  │          │   │              │   │                     │  │  │
│  │  │ /weather │   │ extractPlace │   │  current()          │  │  │
│  │  │ /forecast│   │              │   │  forecast()         │  │  │
│  │  │ /storm   │   │ FILLER strip │   │  stormAlert()       │  │  │
│  │  │ /health  │   │ preposition  │   │                     │  │  │
│  │  │ /__last  │   │ extraction   │   └──────────┬──────────┘  │  │
│  │  └──────────┘   └──────────────┘              │             │  │
│  │                                               │             │  │
│  │  ┌────────────────────────────────────────────▼──────────┐  │  │
│  │  │                  Memo Cache (Map)                       │  │  │
│  │  │          10-second TTL · per-isolate · in-memory        │  │  │
│  │  └────────────────────────────────────────────┬──────────┘  │  │
│  │                                               │             │  │
│  └───────────────────────────────────────────────┼─────────────┘  │
│                                                  │                 │
└──────────────────────────────────────────────────┼─────────────────┘
                                                   │
                          ┌────────────────────────┼────────────────────┐
                          │                        ▼                    │
                          │              open-meteo (public)            │
                          │                                            │
                          │  ┌────────────────┐  ┌─────────────────┐  │
                          │  │ Geocoding API  │  │  Forecast API   │  │
                          │  │ name → coords  │  │  coords → data  │  │
                          │  └────────────────┘  └─────────────────┘  │
                          │                                            │
                          └────────────────────────────────────────────┘
```

---

## Request Lifecycle

Every request follows this exact path:

```
1. HTTP Request arrives at Cloudflare edge
       │
2. Router matches path prefix (/weather, /forecast, /storm, or diagnostic)
       │
3. Raw input extracted from path segment OR query params (location, city, place, query)
       │
4. extractPlace() resolves raw input to a clean place name
       │  ├── Template probe ({location}) → "London"
       │  ├── Bare place name (no spaces or question words) → as-is
       │  ├── Preposition extraction ("weather in Paris") → "Paris"
       │  └── Filler word stripping (fallback) → cleaned remainder
       │
5. Memo cache check (key = intent prefix + normalized place)
       │  ├── HIT (< 10s old) → return cached body
       │  └── MISS → continue to step 6
       │
6. geocode(place) → open-meteo Geocoding API → { name, country, lat, lon, tz }
       │
7. Intent-specific open-meteo Forecast API call
       │  ├── current():     ?current=temperature_2m,humidity,...
       │  ├── forecast():    ?daily=weather_code,temp_max,temp_min,...
       │  └── stormAlert():  ?hourly=weather_code,wind_gusts,precip,...
       │
8. Response formatting
       │  ├── Structured fields (temperature, condition, etc.)
       │  └── Natural-language summary sentence
       │
9. Store in memo cache + return JSON response
```

---

## Core Components

### 1. Router

A minimal path-prefix router in the Worker's `fetch` handler. No framework, no dependencies.

| Path Prefix | Handler | Intent |
|-------------|---------|--------|
| `/weather` | `current()` | WEATHER_CHECK |
| `/forecast` | `forecast()` | WEATHER_FORECAST |
| `/storm` | `stormAlert()` | STORM_ALERT |
| `/health` | inline | Diagnostics |
| `/` | inline | Service info |
| `/__last` | inline | Request ring buffer |

### 2. Place Parser (`extractPlace`)

The most intricate piece of logic. Handles the full spectrum of inputs Telegraph nodes send:

```
Input Spectrum:
├── "London"                              → London (direct)
├── "{location}"                          → London (template probe)
├── "what is the weather in Paris"        → Paris (preposition match)
├── "any storms coming to New Orleans"    → New Orleans (preposition match)
├── "3 day forecast for Tokyo"            → Tokyo (preposition match)
├── "weather London"                      → London (filler strip)
└── "Paris today"                         → Paris (filler strip + trailing time)
```

**Strategy layers (in priority order):**

1. **Template detection** — regex matches `{location}`, `%7blocation%7d`, `:location` etc. Returns "London"
2. **Bare name fast-path** — no spaces or no question words → return as-is
3. **Preposition extraction** — `in|for|at|near|around|to` followed by a place, respecting trailing time words
4. **Filler word stripping** — removes ~70 common question/weather words, returns the remainder

### 3. Memo Cache

```javascript
const MEMO = new Map();
const MEMO_TTL_MS = 10_000;  // 10 seconds
```

- **Per-isolate** — each CF Worker isolate has its own Map. No shared state.
- **10-second TTL** — guarantees freshness while absorbing burst traffic
- **Key format** — `c:london`, `f:d3:tokyo`, `s:24:miami` (intent prefix + normalized place)
- **No eviction** — entries expire naturally; Worker isolate recycling handles cleanup

**Why 10 seconds?** Telegraph spot checks have a deadline. A memo keeps hot answers at a few milliseconds, comfortably inside that deadline, while never serving data more than 10 seconds stale.

### 4. Intent Handlers

Each handler follows the same pattern:

```
geocode(place) → API call → format structured fields → build summary → return
```

#### `current(place)`
- Calls open-meteo with `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m`
- Formats one natural sentence with all five key metrics
- Adds feels-like clause only when ≥2°C different from actual

#### `forecast(place, raw, daysOverride)`
- Always fetches 7 days (so named weekdays resolve)
- Adds `wind_speed_10m_max` for complete per-day data
- Two output modes:
  - **Multi-day**: semicolon-separated day summaries
  - **Single-day**: full sentence for "tomorrow" / weekday targeting

#### `stormAlert(place, hours)`
- Fetches 3-day hourly forecast with `weather_code,wind_gusts_10m,precipitation,snowfall,apparent_temperature`
- Scans only the relevant window (now → now + hours)
- Grades each hazard type independently
- Overall level = worst individual hazard

### 5. WMO Code Translation

A static lookup table (`WMO`) translates numeric weather codes to natural English phrases. The scorer rewards natural-language condition names over codes.

### 6. Request Ring Buffer (`RECENT`)

```javascript
const RECENT = [];  // max 50 entries
```

An in-memory array of the last 50 requests, accessible at `/__last`. Used for:
- Observing what Telegraph nodes actually send
- Debugging query parsing issues
- Understanding traffic patterns

---

## Data Flow Diagram

```
Telegraph Node                  SkyWire Worker                    open-meteo
     │                               │                               │
     │  GET /weather/London          │                               │
     │──────────────────────────────▶│                               │
     │                               │                               │
     │                               │  GET /v1/search?name=London   │
     │                               │──────────────────────────────▶│
     │                               │                               │
     │                               │  { lat: 51.5, lon: -0.12 }   │
     │                               │◀──────────────────────────────│
     │                               │                               │
     │                               │  GET /v1/forecast?lat=&lon=   │
     │                               │     &current=temp,humidity,...  │
     │                               │──────────────────────────────▶│
     │                               │                               │
     │                               │  { current: { ... } }         │
     │                               │◀──────────────────────────────│
     │                               │                               │
     │  { summary: "It is...",       │                               │
     │    temperature_c: 18.2, ... } │                               │
     │◀──────────────────────────────│                               │
     │                               │                               │
```

---

## Design Decisions

### Why One File?

- **Zero build step** — `wrangler deploy` ships the file as-is
- **No dependency supply chain** — nothing to audit, update, or break
- **Full readability** — anyone can read the entire miner top-to-bottom in 5 minutes
- **CF Workers size limit** — a single file well under the 1 MB limit

### Why No Framework?

- The routing is 4 `if` statements
- Response construction is one helper (`json()`)
- No middleware needed — there's nothing to compose
- Every byte of framework is overhead that doesn't improve the answer

### Why Per-Isolate Cache Instead of KV/Durable Objects?

- **KV is eventually consistent** — writes take up to 60 seconds to propagate
- **Durable Objects add latency** — a round-trip to a coordination point
- **A Map is zero-latency** — and 10 seconds is fresh enough for weather
- **Isolate recycling is natural eviction** — no memory leak concern

### Why Default to London on Template Probes?

Telegraph routing periodically probes miners with unfilled templates (`/weather/{location}`) to verify they're alive. Returning a `400` on this probe marks the miner as unresponsive and freezes it out of routing for an epoch. Returning London weather at `200` is both correct (London is a valid answer) and keeps the miner in the routing pool.

### Why Natural Language Parsing?

Telegraph nodes don't always extract a bare place name before forwarding. A query like "what is the weather in Paris" arrives verbatim. The miner needs to handle this gracefully because:
1. A `400` on a real query also risks routing penalties
2. The intent spec says `location` can be a question
3. Users actually phrase things this way

---

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Cold start | ~5ms (no dependencies to load) |
| Memo cache hit | < 1ms |
| Full request (cache miss) | 200–500ms (two open-meteo calls) |
| Worker size | ~12 KB (single file, no minification needed) |
| Memory per isolate | Minimal (Map + 50-entry array) |

---

## Security Model

| Concern | Mitigation |
|---------|-----------|
| API key exposure | None exist — open-meteo is keyless |
| Data poisoning | Direct read from open-meteo; no user-writable cache |
| DDoS amplification | CF Workers handles rate limiting at the edge |
| Input injection | Place names URL-encoded; used only as query params to open-meteo |
| CORS | `access-control-allow-origin: *` (public data, intentional) |

---

## Relationship to Telegraph

```
┌─────────────────────────────────────────────────────────────────┐
│                     Telegraph Network                            │
│                                                                 │
│  ┌───────────┐     ┌───────────┐     ┌───────────────────────┐ │
│  │  User /   │     │ Telegraph │     │    On-Chain Scorer     │ │
│  │  dApp     │────▶│   Node    │────▶│  (pure function,      │ │
│  │           │     │           │     │   sandboxed, no net)   │ │
│  └───────────┘     └─────┬─────┘     └───────────────────────┘ │
│                           │                                     │
│                           │ routes intent                        │
│                           ▼                                     │
│                   ┌──────────────┐                              │
│                   │   SkyWire    │ ◀── this miner               │
│                   │   Worker     │                              │
│                   └──────────────┘                              │
│                                                                 │
│  Registry: 0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8          │
│  Chain: Base Sepolia                                            │
└─────────────────────────────────────────────────────────────────┘
```

The miner registers three descriptor YAMLs on-chain. The Telegraph node uses these to:
1. Know which endpoints to call for each intent
2. Understand the input/output schema
3. Encode the response for on-chain submission
4. Route queries to the correct miner based on intent matching
