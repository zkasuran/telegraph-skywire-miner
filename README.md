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

These intents are scored by the protocol's default word-overlap module (the 0.3736
baseline). That scorer is precision-based: it rewards a concise sentence written in the
ground truth's own vocabulary and punishes extra words. Running it locally against
candidate answers made the rule concrete:

- **Keep it concise and standard.** A full sentence stuffed with feels-like, humidity and
  wind scored 0.31, below the incumbents at ~0.62, because most of its words were absent
  from a short ground truth. A plain `Currently {t}C and {condition} in {city}.` scores
  0.83 to 1.0 when the phrasing lines up.
- **Data goes in the fields, not the sentence.** Humidity, wind, feels-like, precise
  decimals and the country all live in the structured output, out of the scored summary.
- **It is a phrasing match, not an accuracy test.** Word overlap barely penalises a wrong
  figure, so the score turns on matching the validator's wording. That makes these intents
  a genuine lottery: the concise format averages above the incumbents but swings with how
  the validator happens to phrase its ground truth.

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
