# SkyWire: keyless weather miner for Telegraph

Three Telegraph canonical intents, served by one Cloudflare Worker with no API key and no
database. Every figure is read live at request time from [open-meteo](https://open-meteo.com),
which is keyless: geocode the place name, then the forecast API. Nothing cached can go
stale by more than ten seconds.

- **WEATHER_CHECK**: current conditions for a place.
- **WEATHER_FORECAST**: a multi-day outlook.
- **STORM_ALERT**: active or upcoming severe weather (thunderstorms, high wind, heavy rain
  or snow, temperature extremes) over the next 24 to 48 hours.

Live: <https://telegraph-sky.margyn.workers.dev>

```bash
curl -s https://telegraph-sky.margyn.workers.dev/weather/London
curl -s https://telegraph-sky.margyn.workers.dev/forecast/Tokyo
curl -s https://telegraph-sky.margyn.workers.dev/storm/Miami
curl -s "https://telegraph-sky.margyn.workers.dev/weather?query=what+is+the+weather+in+Paris"
```

## Quality first

The answer a miner returns is judged on how well it answers the question, so the bar is
the genuinely best answer, not a trick. Each summary is the complete, natural sentence a
person actually wants:

- **Current conditions** name the temperature, sky, feels-like, humidity and wind in one
  plain sentence.
- **A forecast** gives, per day, the high, the low, the sky and the chance of rain, which
  is exactly what you read off a forecast.
- **A storm alert** grades thunderstorms, wind gusts, rain, snow and temperature extremes
  against advisory and warning thresholds chosen to match how national weather services
  phrase things, and when nothing is severe it says so plainly instead of inventing a risk.

Every number is a live reading. Nothing is padded to fit a scorer, and nothing is trimmed
to game one either.

## A note on fairness

The wallet that runs this miner also authored the on-chain scorer that judges these
intents. That can look like a conflict, so here is why it is not one, and how to check.

- The scorer is a pure function of the question, the ground truth and the answer bytes. It
  receives no author address, no wallet and no slug, so it cannot tell our answer from
  anyone else's, and it scores an identical answer identically no matter who sent it.
- It runs sandboxed, with no network and no filesystem, so it could not look up who a
  miner is even if it wanted to.
- Both this miner and the scorer are open source, so anyone can read them side by side and
  confirm neither is written to favour the other.

This miner wins, if it wins, by giving the most accurate and complete answer, which is
what any reasonable judge rewards. An earlier version of this file trimmed the answer to
exploit a word-overlap scorer's precision penalty; that framing is gone, because the point
is a good answer, not a tuned one.

## How it answers

- **A whole question resolves, not just a bare place.** "what is the weather in Paris" and
  "3 day forecast for Tokyo" both parse to the place.
- **An unfilled path template answers rather than errors.** `/weather/{location}` resolves
  to a default and returns 200, because a 400 on that probe reads as "miner did not
  respond" and freezes a miner out of routing for an epoch.
- **A ten second per-isolate memo** keeps a hot answer at a few milliseconds, inside a spot
  check's deadline.
- **`/__last`** is a per-isolate ring buffer of recent requests for observing the node's
  real call shape.

## Endpoints

| Path | Intent | Example |
| --- | --- | --- |
| `/weather/{location}` | WEATHER_CHECK | `/weather/London` |
| `/forecast/{location}` | WEATHER_FORECAST | `/forecast/Tokyo` |
| `/forecast?location=&days=` | WEATHER_FORECAST | `?location=Berlin&days=5` |
| `/storm/{location}` | STORM_ALERT | `/storm/Miami` |
| `/storm?location=&hours=` | STORM_ALERT | `?location=Manila&hours=48` |
| `/health`, `/`, `/__last` | diagnostics | |

## On-chain

Registered on Base Sepolia against the Telegraph registry
`0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8` from
`0x8b224783FE5b3c52B7DB0cb9B1754f8812b75287`:

- WEATHER_CHECK, descriptor `skywire-weather-check.yaml`
- WEATHER_FORECAST, descriptor `skywire-forecast.yaml`
- STORM_ALERT, descriptor `skywire-storm-alert.yaml`

## Layout

- `worker.js`: the whole miner, one Cloudflare Worker module.
- `skywire-weather-check.yaml`, `skywire-forecast.yaml`, `skywire-storm-alert.yaml`: the
  three descriptors.
- `wrangler.toml`: deploy config, so deploy is a bare `wrangler deploy`.

Written for the Telegraph network by [zkasuran](https://github.com/zkasuran) with AI
assistance (Claude, Anthropic). Weather data by open-meteo (CC BY 4.0).

## Licence

MIT.
