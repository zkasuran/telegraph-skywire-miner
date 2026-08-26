# 🌪️ STORM_ALERT — Severe Weather Detection

> **Intent:** `STORM_ALERT`  
> **Slug:** `skywire-storm-alert`  
> **Miner ID:** 7306  
> **Descriptor:** [`skywire-storm-alert.yaml`](../skywire-storm-alert.yaml)

---

## What It Does

Evaluates whether severe weather is active or upcoming for a named place over a configurable window (default 24 hours, up to 48). The miner reads the open-meteo hourly forecast, grades each hazard type against advisory and warning thresholds calibrated to match national weather service standards, and produces a clear verdict:

- **No severe weather** → says so plainly
- **Advisory level** → identifies the hazard and timing
- **Warning level** → flags high-severity conditions with detail

This is not a binary "storm yes/no" — it's a graded assessment that tells you *what*, *how bad*, and *when*.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/storm/{location}` | Default 24-hour look-ahead |
| `GET` | `/storm?location=Miami&hours=48` | Configurable window |
| `GET` | `/storm?query=any+storms+coming+to+Manila` | Natural language |

### Usage Examples

```bash
# 24-hour storm outlook
curl -s https://telegraph-sky.margyn.workers.dev/storm/Miami | jq .

# 48-hour window
curl -s "https://telegraph-sky.margyn.workers.dev/storm?location=Manila&hours=48" | jq .

# Natural language
curl -s "https://telegraph-sky.margyn.workers.dev/storm?query=any+severe+weather+near+New+Orleans" | jq .
```

---

## Input Schema

```yaml
type: object
properties:
  location:
    type: string
    description: Place name to assess for severe weather (e.g. Miami, Manila)
  hours:
    type: integer
    description: Look-ahead window in hours, 1 to 48, default 24
required:
  - location
```

**Constraints:**
- `location` max length: 80 characters
- `hours`: 1–48 (defaults to 24)

---

## Hazard Detection

The miner evaluates **six hazard types**, each graded independently against calibrated thresholds:

### Threshold Table

| Hazard | Advisory Trigger | Warning Trigger | Source Data |
|--------|-----------------|-----------------|-------------|
| 🌪️ **Thunderstorms** | — | Any WMO code 95/96/99 | `weather_code` |
| 💨 **High Wind** | Gusts ≥ 60 km/h | Gusts ≥ 90 km/h | `wind_gusts_10m` |
| 🌧️ **Heavy Rain** (total) | ≥ 20 mm in window | ≥ 40 mm in window | `precipitation` sum |
| 🌧️ **Heavy Rain** (hourly) | ≥ 7.6 mm/h peak | ≥ 15 mm/h peak | `precipitation` max |
| ❄️ **Heavy Snow** | ≥ 3 cm in window | ≥ 10 cm in window | `snowfall` sum |
| 🔥 **Extreme Heat** | Feels-like ≥ 38°C | Feels-like ≥ 42°C | `apparent_temperature` max |
| 🥶 **Extreme Cold** | Feels-like ≤ −12°C | Feels-like ≤ −20°C | `apparent_temperature` min |

**Rain grading logic:** The higher of the two rain grades (window total vs. hourly peak) is used. This catches both prolonged moderate rain and intense bursts.

**Thunderstorms** are always graded as `warning` when present — there is no "mild thunderstorm" advisory.

---

## Output Schema

| Field | Type | Description |
|-------|------|-------------|
| `intent` | string | Always `"STORM_ALERT"` |
| `location` | string | Canonical resolved place name |
| `country` | string | Country |
| `latitude` | number | Latitude |
| `longitude` | number | Longitude |
| `breach` | boolean | `true` if any hazard ≥ advisory level |
| `level` | string | `"none"`, `"advisory"`, or `"warning"` (worst hazard) |
| `hazards` | array | Per-hazard detail objects |
| `window_hours` | integer | Hours evaluated |
| `peak_gust_kmh` | number | Highest gust in the window (km/h) |
| `total_precip_mm` | number | Total precipitation (mm) |
| `total_snowfall_cm` | number | Total snowfall (cm) |
| `max_apparent_c` | number | Highest feels-like temperature (°C) |
| `min_apparent_c` | number | Lowest feels-like temperature (°C) |
| `thunderstorms` | boolean | Whether thunderstorms appear in the window |
| `hours_evaluated` | integer | Actual hourly slots assessed |
| `risk` | number | Confidence: 0.95 (no breach), 0.8 (advisory), 0.95 (warning) |
| `confidence` | number | Always `0.95` |
| `summary` | string | Natural-language verdict |
| `source` | string | `"open-meteo hourly forecast"` |
| `as_of` | string | ISO timestamp |

### Hazard Object

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Hazard type (e.g. "high wind", "thunderstorms") |
| `level` | string | `"advisory"` or `"warning"` |
| `detail` | string | Human-readable detail with numbers |
| `when` | string \| null | Relative timing (e.g. "in about 6 hours") |

---

## Example Responses

### No Severe Weather

```json
{
  "intent": "STORM_ALERT",
  "location": "London",
  "country": "United Kingdom",
  "breach": false,
  "level": "none",
  "hazards": [],
  "window_hours": 24,
  "peak_gust_kmh": 42.3,
  "total_precip_mm": 3.2,
  "total_snowfall_cm": 0,
  "thunderstorms": false,
  "risk": 0.95,
  "summary": "No storm is expected in London, United Kingdom in the next 24 hours. Winds stay around 42 km/h and no thunderstorms are in the forecast.",
  "confidence": 0.95
}
```

### Warning — Thunderstorms + High Wind

```json
{
  "intent": "STORM_ALERT",
  "location": "Miami",
  "country": "United States",
  "breach": true,
  "level": "warning",
  "hazards": [
    {
      "type": "thunderstorms",
      "level": "warning",
      "detail": "thunderstorms in the forecast",
      "when": "in about 6 hours"
    },
    {
      "type": "high wind",
      "level": "advisory",
      "detail": "gusts to 68 km/h",
      "when": "in about 8 hours"
    },
    {
      "type": "heavy rain",
      "level": "advisory",
      "detail": "24.5 mm expected, peak 9.2 mm/h",
      "when": null
    }
  ],
  "window_hours": 24,
  "peak_gust_kmh": 68.4,
  "total_precip_mm": 24.5,
  "total_snowfall_cm": 0,
  "thunderstorms": true,
  "risk": 0.95,
  "summary": "Yes, severe weather is likely in Miami, United States within the next 24 hours: thunderstorms in the forecast in about 6 hours, gusts to 68 km/h in about 8 hours, 24.5 mm expected, peak 9.2 mm/h.",
  "confidence": 0.95
}
```

### Advisory — Extreme Heat

```json
{
  "intent": "STORM_ALERT",
  "location": "Phoenix",
  "country": "United States",
  "breach": true,
  "level": "advisory",
  "hazards": [
    {
      "type": "extreme heat",
      "level": "advisory",
      "detail": "feels-like peaks at 40°C",
      "when": null
    }
  ],
  "window_hours": 24,
  "peak_gust_kmh": 22.1,
  "total_precip_mm": 0,
  "thunderstorms": false,
  "risk": 0.8,
  "summary": "Yes, extreme heat is likely in Phoenix, United States within the next 24 hours: feels-like peaks at 40°C.",
  "confidence": 0.95
}
```

---

## Summary Formatting

### No Breach

```
No storm is expected in {Place}, {Country} in the next {window} hours. Winds stay around {gust} km/h and no thunderstorms are in the forecast.
```

### Breach Detected

```
Yes, {kind} is likely in {Place}, {Country} within the next {window} hours: {hazard1 detail} {timing}, {hazard2 detail}, ...
```

**Kind selection** based on top hazard type:
- "extreme heat" → "extreme heat"
- "extreme cold" → "extreme cold"
- "heavy snow" → "winter storm conditions"
- Anything else → "severe weather"

---

## Timing Descriptions

The `when` field uses relative timing from the current moment:

| Condition | Output |
|-----------|--------|
| Already occurring | `"now"` |
| Within 1 hour | `"within the hour"` |
| N hours away | `"in about N hours"` |

---

## On-Chain Encoding

### Strings
| Index | Name | Source |
|-------|------|--------|
| 0 | `location` | Canonical place name |
| 1 | `level` | `"none"`, `"advisory"`, or `"warning"` |
| 2 | `summary` | Natural-language verdict |

### Integers
| Index | Name | Source | Multiplier |
|-------|------|--------|-----------|
| 0 | `peak_gust_kmh_x10` | `peak_gust_kmh` | ×10 |
| 1 | `window_hours` | Hours evaluated | ×1 |

### Booleans
| Index | Name | Source | Transform |
|-------|------|--------|-----------|
| 0 | `breach` | `breach` | `bool_from_eq:true` |

---

## Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `400` | No location provided | `{ "error": "name a location, for example /storm/Miami" }` |
| `404` | Place not found | `{ "error": "storm outlook unavailable for {place}", "detail": "..." }` |
| `502` | open-meteo API failure | `{ "error": "storm outlook unavailable for {place}", "detail": "..." }` |

---

## Semantic Mapping

```yaml
semantics:
  signal_mapping:
    confidence_field: risk
    label_field: level
    reason_field: summary
  supported_intents:
    - STORM_ALERT
```

Note: The storm alert uses `risk` (not `confidence`) as the signal confidence field. Risk is `0.95` for both clear assessments and confirmed warnings, but `0.8` for advisory-level findings where the situation is less certain.
