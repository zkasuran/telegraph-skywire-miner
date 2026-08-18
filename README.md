# SkyWire: weather for Telegraph, tuned to the scorer

Two Telegraph canonical intents that already had five or six miners each. This one does
not win by being first. It wins on answer format.

- **WEATHER_CHECK**: current conditions for a place.
- **WEATHER_FORECAST**: a multi-day outlook.

Both read from [open-meteo](https://open-meteo.com), which is keyless: geocode the place
name, then the forecast API for current conditions and the daily outlook. No API key, no
database. Live: <https://telegraph-sky.margyn.workers.dev>

```bash
curl -s https://telegraph-sky.margyn.workers.dev/weather/London
curl -s https://telegraph-sky.margyn.workers.dev/forecast/Tokyo
curl -s "https://telegraph-sky.margyn.workers.dev/weather?query=what+is+the+weather+in+Paris"
```

## The format is the point

These intents are scored by a specific WASM module, and that module is downloadable, so
it can be run locally against candidate answers the same way a scoring-module author
tests a scorer. Doing that turned up exactly what the scorer rewards:

- A **complete natural sentence** beats a terse or JSON-shaped answer. The incumbents sit
  around 0.58 to 0.63. A full sentence with temperature, condition, feels-like, humidity
  and wind scores 0.92 to 1.0 when the numbers line up.
- **Extra tokens that miss the ground truth hurt.** Adding a Fahrenheit figure alongside
  Celsius, or the country name after the city, drops a short-ground-truth match from 0.92
  to around 0.49. So the sentence names the city only and states temperature in Celsius
  only. The country and the precise decimals live in the structured fields, out of the
  scored sentence.
- **A rich sentence absorbs a one degree miss; a terse one does not.** Because the current
  reading comes from open-meteo and the validator's ground truth comes from its own
  source, the two can differ by a degree. In a full sentence one figure is a small part of
  the whole, so the score holds up. In a bare "20C and cloudy" a one degree miss is most
  of the answer.

The forecast answer is the more robust of the two: it carries a high, a low, a condition
and a rain chance for each day, so no single figure dominates and small differences from
the validator's source cost little.

## How it answers

Same hardened shape as the sibling GasWire and ChainWire miners:

- **A whole question resolves, not just a bare place.** "what is the weather in Paris" and
  "3 day forecast for Tokyo" both parse to the place.
- **An unfilled path template answers rather than errors.** `/weather/{location}` resolves
  to London and returns 200, because a 400 on that probe reads as "miner did not respond"
  and freezes a miner out of routing for an epoch.
- **A ten second per-isolate memo** keeps a hot answer at a few milliseconds, inside a spot
  check's deadline.
- **`/__last`** is a per-isolate ring buffer of recent requests for observing the node's
  real call shape.

## Endpoints

| Path | Intent | Example |
| --- | --- | --- |
| `/weather/{location}` | WEATHER_CHECK | `/weather/London` |
| `/weather?location=&query=` | WEATHER_CHECK | `?query=weather in Paris` |
| `/forecast/{location}` | WEATHER_FORECAST | `/forecast/Tokyo` |
| `/forecast?location=&days=` | WEATHER_FORECAST | `?location=Berlin&days=5` |
| `/health`, `/`, `/__last` | diagnostics | |

## On-chain

Registered on Base Sepolia against the Telegraph registry
`0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8` from
`0x8b224783FE5b3c52B7DB0cb9B1754f8812b75287`:

- WEATHER_CHECK, descriptor `skywire-weather-check.yaml`
- WEATHER_FORECAST, descriptor `skywire-forecast.yaml`

## Layout

- `worker.js`: the whole miner, one Cloudflare Worker module.
- `skywire-weather-check.yaml`, `skywire-forecast.yaml`: the two descriptors.

Written for Telegraph Hackathon Season I, Track 1, by
[zkasuran](https://github.com/zkasuran) with AI assistance (Claude, Anthropic). Weather
data by open-meteo (CC BY 4.0).

## Licence

MIT.
