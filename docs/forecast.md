# 📅 WEATHER_FORECAST — Multi-Day Outlook

> **Intent:** `WEATHER_FORECAST`  
> **Slug:** `skywire-forecast`  
> **Miner ID:** 7305  
> **Descriptor:** [`skywire-forecast.yaml`](../skywire-forecast.yaml)

---

## What It Does

Returns a multi-day weather forecast for any named place. Each day includes the high, low, sky condition, rain probability, and wind speed. The response includes both structured per-day data and a natural-language summary — one sentence per day stating exactly what you'd read off a forecast.

Defaults to **3 days**, configurable up to **7 days**. Understands natural language like "5 day forecast for Berlin" or "forecast for Friday."

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/forecast/{location}` | Default 3-day forecast, location in path |
| `GET` | `/forecast?location=Berlin&days=5` | Configurable days via query params |
| `GET` | `/forecast?query=5+day+forecast+for+Berlin` | Natural language parsing |

### Usage Examples

```bash
# Default 3-day forecast
curl -s https://telegraph-sky.margyn.workers.dev/forecast/Tokyo | jq .

# 7-day forecast
curl -s "https://telegraph-sky.margyn.workers.dev/forecast?location=London&days=7" | jq .

# Natural language
curl -s "https://telegraph-sky.margyn.workers.dev/forecast?query=forecast+for+Paris+this+week" | jq .

# Specific day
curl -s "https://telegraph-sky.margyn.workers.dev/forecast?query=forecast+for+Tokyo+tomorrow" | jq .
```

---

## Input Schema

```yaml
type: object
properties:
  location:
    type: string
    description: Place name to forecast for (e.g. London, Tokyo)
  days:
    type: integer
    description: Number of days to forecast, 1 to 7, default 3
required:
  - location
```

**Constraints:**
- `location` max length: 80 characters
- `days`: 1–7 (defaults to 3)
- Accepts full questions — "this week" → 7 days, "weekend" → 3 days

---

## Smart Day Parsing

The miner extracts forecast windows from natural language:

| Input | Resolved Window |
|-------|-----------------|
| `3 day forecast for London` | 3 days |
| `forecast for this week` | 7 days |
| `weekend forecast` | 3 days |
| `forecast for tomorrow` | Single day (tomorrow only) |
| `forecast for Friday` | Single day (that Friday) |
| No window specified | 3 days (default) |

### Single-Day Targeting

When a specific day is named ("tomorrow", "Friday"), the response contains **only that day** with a complete, detailed sentence — not a multi-day dump. This matches how the intent's ground truth works for single-day questions.

---

## Output Schema

| Field | Type | Description |
|-------|------|-------------|
| `intent` | string | Always `"WEATHER_FORECAST"` |
| `location` | string | Canonical resolved place name |
| `country` | string | Country of the resolved place |
| `latitude` | number | Latitude |
| `longitude` | number | Longitude |
| `forecast_days` | integer | Number of days returned |
| `days` | array | Per-day forecast objects |
| `summary` | string | Natural-language summary |
| `confidence` | number | Always `0.95` |
| `source` | string | `"open-meteo daily forecast"` |
| `as_of` | string | ISO timestamp |

### Per-Day Object

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | ISO date (`YYYY-MM-DD`) |
| `label` | string | "today", "tomorrow", or day name |
| `high_c` | number | High temperature (°C) |
| `low_c` | number | Low temperature (°C) |
| `condition` | string | Sky condition in words |
| `weather_code` | integer | WMO weather code |
| `precipitation_probability_percent` | integer | Max rain probability (%) |
| `wind_speed_kmh` | number | Max wind speed (km/h) |

### Example Response — Multi-Day

```json
{
  "intent": "WEATHER_FORECAST",
  "location": "Berlin",
  "country": "Germany",
  "latitude": 52.52,
  "longitude": 13.405,
  "forecast_days": 3,
  "days": [
    {
      "date": "2026-08-26",
      "label": "today",
      "high_c": 24.8,
      "low_c": 15.2,
      "condition": "partly cloudy",
      "weather_code": 2,
      "precipitation_probability_percent": 20,
      "wind_speed_kmh": 18.5
    },
    {
      "date": "2026-08-27",
      "label": "tomorrow",
      "high_c": 26.1,
      "low_c": 16.4,
      "condition": "clear",
      "weather_code": 0,
      "precipitation_probability_percent": 5,
      "wind_speed_kmh": 12.3
    },
    {
      "date": "2026-08-28",
      "label": "Friday",
      "high_c": 22.3,
      "low_c": 14.8,
      "condition": "light rain",
      "weather_code": 61,
      "precipitation_probability_percent": 65,
      "wind_speed_kmh": 22.1
    }
  ],
  "summary": "Berlin, Germany: today 25°C partly cloudy, 20% chance of rain; tomorrow 26°C clear, 5% chance of rain; Friday 22°C light rain, 65% chance of rain. Winds around 19 km/h.",
  "confidence": 0.95,
  "source": "open-meteo daily forecast",
  "as_of": "2026-08-26T10:15:22.003Z"
}
```

### Example Response — Single Day (Tomorrow)

```json
{
  "intent": "WEATHER_FORECAST",
  "location": "Tokyo",
  "country": "Japan",
  "forecast_days": 1,
  "days": [
    {
      "date": "2026-08-27",
      "label": "tomorrow",
      "high_c": 32.1,
      "low_c": 25.8,
      "condition": "rain showers",
      "weather_code": 81,
      "precipitation_probability_percent": 70,
      "wind_speed_kmh": 15.4
    }
  ],
  "summary": "Tomorrow in Tokyo, Japan: rain showers with a high near 32°C and a low of 26°C, a 70% chance of rain and light winds around 15 km/h.",
  "confidence": 0.95
}
```

---

## Summary Formatting

### Multi-Day Format

```
{Place}, {Country}: {day1_label} {high}°C {condition}, {rain}% chance of rain; {day2_label} ... Winds around {wind} km/h.
```

### Single-Day Format

```
{DayName} in {Place}, {Country}: {condition} with a high near {high}°C and a low of {low}°C, a {rain}% chance of rain and {wind_desc} winds around {wind} km/h.
```

**Wind descriptions:**
- < 20 km/h → "light"
- 20–39 km/h → "moderate"
- ≥ 40 km/h → "strong"

---

## On-Chain Encoding

### Strings
| Index | Name | Source |
|-------|------|--------|
| 0 | `location` | Canonical place name |
| 1 | `summary` | Natural-language forecast summary |
| 2 | `country` | Country of the resolved place |

### Integers
| Index | Name | Source | Multiplier |
|-------|------|--------|-----------|
| 0 | `forecast_days` | Number of days returned | ×1 |

---

## Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `400` | No location provided | `{ "error": "name a location, for example /forecast/London" }` |
| `404` | Place not found | `{ "error": "forecast unavailable for {place}", "detail": "..." }` |
| `502` | open-meteo API failure | `{ "error": "forecast unavailable for {place}", "detail": "..." }` |

---

## Semantic Mapping

```yaml
semantics:
  signal_mapping:
    confidence_field: confidence
    label_field: summary
    reason_field: summary
  supported_intents:
    - WEATHER_FORECAST
```
