# ⛅ WEATHER_CHECK — Current Conditions

> **Intent:** `WEATHER_CHECK`  
> **Slug:** `skywire-weather-check`  
> **Miner ID:** 7304  
> **Descriptor:** [`skywire-weather-check.yaml`](../skywire-weather-check.yaml)

---

## What It Does

Returns real-time current weather conditions for any named place on Earth. The response is a single natural-language sentence containing temperature, sky condition, feels-like temperature, humidity, and wind speed — exactly what a person wants when they ask "what's the weather like?"

Every figure is a **live reading** from [open-meteo](https://open-meteo.com) at request time. Nothing is cached beyond a 10-second per-isolate memo to handle burst traffic.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/weather/{location}` | Location in the URL path |
| `GET` | `/weather?location=London` | Location as query parameter |
| `GET` | `/weather?query=what+is+the+weather+in+Paris` | Full natural-language question |

### Path Variants

```bash
# Direct place name
curl -s https://telegraph-sky.margyn.workers.dev/weather/London

# Query parameter
curl -s "https://telegraph-sky.margyn.workers.dev/weather?location=New+York"

# Natural language
curl -s "https://telegraph-sky.margyn.workers.dev/weather?query=what+is+the+weather+in+Tokyo"
```

### Template Probe Handling

If the path contains an unsubstituted template like `/weather/{location}`, the miner resolves it to **London** and returns a `200` response. This prevents routing freezes in the Telegraph network — a `400` on a template probe reads as "miner did not respond" and can freeze a miner out for an epoch.

---

## Input Schema

```yaml
type: object
properties:
  location:
    type: string
    description: Place name to report current weather for (e.g. London, Tokyo)
required:
  - location
```

**Constraints:**
- `location` max length: 80 characters
- Accepts place names, city names, or full natural-language questions

---

## Output Schema

| Field | Type | Description |
|-------|------|-------------|
| `intent` | string | Always `"WEATHER_CHECK"` |
| `location` | string | Canonical resolved place name |
| `country` | string | Country of the resolved place |
| `latitude` | number | Latitude of the resolved location |
| `longitude` | number | Longitude of the resolved location |
| `temperature_c` | number | Current air temperature (°C, 1 decimal) |
| `apparent_temperature_c` | number | Feels-like temperature (°C, 1 decimal) |
| `condition` | string | Sky condition in words (e.g. "partly cloudy") |
| `weather_code` | integer | WMO weather code |
| `relative_humidity_percent` | integer | Relative humidity (%) |
| `wind_speed_kmh` | number | Wind speed (km/h, 1 decimal) |
| `precipitation_mm` | number | Current precipitation (mm) |
| `is_day` | boolean | Whether it's daytime at the location |
| `summary` | string | Complete natural-language sentence |
| `confidence` | number | Always `0.95` for a direct open-meteo read |
| `source` | string | `"open-meteo current"` |
| `observed_at` | string | Timestamp of the observation |
| `as_of` | string | ISO timestamp of when the response was generated |

### Example Response

```json
{
  "intent": "WEATHER_CHECK",
  "location": "Tokyo",
  "country": "Japan",
  "latitude": 35.6895,
  "longitude": 139.6917,
  "temperature_c": 28.4,
  "apparent_temperature_c": 32.1,
  "condition": "partly cloudy",
  "weather_code": 2,
  "relative_humidity_percent": 68,
  "wind_speed_kmh": 11.2,
  "precipitation_mm": 0,
  "is_day": true,
  "summary": "It is currently 28°C and partly cloudy in Tokyo, Japan, with 68% humidity and 11 km/h winds. It feels like 32°C.",
  "confidence": 0.95,
  "source": "open-meteo current",
  "observed_at": "2026-08-26T14:00",
  "as_of": "2026-08-26T14:02:31.442Z"
}
```

---

## Summary Formatting

The summary is always one complete sentence built from live data:

```
It is currently {temp}°C and {condition} in {place}, {country}, with {humidity}% humidity and {wind description}.
```

- **Wind description** adapts to speed:
  - < 12 km/h → "light winds"
  - 12–30 km/h → "{speed} km/h winds"
  - > 30 km/h → "strong {speed} km/h winds"
- **Feels-like clause** is appended only when it differs from actual temperature by ≥ 2°C:
  - `" It feels like {feels}°C."`

---

## On-Chain Encoding

When submitted on-chain, the response is encoded as:

### Strings
| Index | Name | Source |
|-------|------|--------|
| 0 | `location` | Canonical place name |
| 1 | `condition` | Sky condition in words |
| 2 | `summary` | Full natural-language sentence |

### Integers
| Index | Name | Source | Multiplier |
|-------|------|--------|-----------|
| 0 | `temperature_c_x10` | `temperature_c` | ×10 |
| 1 | `relative_humidity_percent` | `relative_humidity_percent` | ×1 |

---

## Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `400` | No location provided | `{ "error": "name a location, for example /weather/London" }` |
| `404` | Place not found in geocoding | `{ "error": "weather unavailable for {place}", "detail": "..." }` |
| `502` | open-meteo API error/timeout | `{ "error": "weather unavailable for {place}", "detail": "..." }` |

---

## WMO Weather Codes

The miner translates WMO codes to natural English:

| Code | Condition |
|------|-----------|
| 0 | clear |
| 1 | mainly clear |
| 2 | partly cloudy |
| 3 | overcast |
| 45 | foggy |
| 48 | freezing fog |
| 51, 53, 55 | light drizzle / drizzle / heavy drizzle |
| 61, 63, 65 | light rain / rain / heavy rain |
| 71, 73, 75 | light snow / snow / heavy snow |
| 80, 81, 82 | light rain showers / rain showers / heavy rain showers |
| 95, 96, 99 | thunderstorms / thunderstorms with hail |

---

## Semantic Mapping

```yaml
semantics:
  signal_mapping:
    confidence_field: confidence
    label_field: condition
    reason_field: summary
  supported_intents:
    - WEATHER_CHECK
```

The Telegraph network uses `confidence` for routing decisions, `condition` as the classification label, and `summary` as the human-readable explanation.
