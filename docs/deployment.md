# 🚀 Deployment Guide

> Everything you need to deploy, monitor, and operate SkyWire.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| [Cloudflare account](https://dash.cloudflare.com/sign-up) | Free tier is sufficient |
| [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) | `npm i -g wrangler` |
| Node.js 18+ | For Wrangler only (not a runtime dependency) |

**Not required:**
- No API keys
- No database
- No environment variables
- No secrets
- No KV namespaces
- No Durable Objects

---

## Quick Deploy

```bash
# 1. Clone the repository
git clone https://github.com/zkasuran/telegraph-skywire-miner.git
cd telegraph-skywire-miner

# 2. Authenticate with Cloudflare (first time only)
wrangler login

# 3. Deploy
wrangler deploy
```

That's it. The worker will be live at `https://telegraph-sky.<your-subdomain>.workers.dev`.

---

## Configuration

### `wrangler.toml`

```toml
name = "telegraph-sky"
main = "worker.js"
compatibility_date = "2025-06-01"
```

| Field | Purpose | Default |
|-------|---------|---------|
| `name` | Worker name (becomes the subdomain) | `telegraph-sky` |
| `main` | Entry point | `worker.js` |
| `compatibility_date` | CF Workers runtime version | `2025-06-01` |

### Custom Domain (Optional)

```toml
# Add to wrangler.toml
routes = [
  { pattern = "weather.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

Or use a custom domain in the Cloudflare dashboard:
1. Go to Workers & Pages → your worker → Settings → Triggers
2. Add a Custom Domain

### Custom Worker Name

To deploy under a different name:

```toml
name = "my-weather-miner"
```

This changes the default URL to `https://my-weather-miner.<subdomain>.workers.dev`.

---

## Verify Deployment

After deploying, verify all three intents respond:

```bash
# Set your worker URL
export WORKER=https://telegraph-sky.margyn.workers.dev

# Health check
curl -s "$WORKER/health" | jq .
# Expected: { "ok": true, "intents": ["WEATHER_CHECK", "WEATHER_FORECAST", "STORM_ALERT"] }

# Weather check
curl -s "$WORKER/weather/London" | jq .summary
# Expected: "It is currently ...°C and ... in London, United Kingdom, ..."

# Forecast
curl -s "$WORKER/forecast/Tokyo" | jq .summary
# Expected: "Tokyo, Japan: today ...°C ..."

# Storm alert
curl -s "$WORKER/storm/Miami" | jq .summary
# Expected: "No storm is expected..." or "Yes, severe weather..."

# Template probe (should NOT 400)
curl -s "$WORKER/weather/{location}" | jq .location
# Expected: "London"
```

---

## Monitoring

### Built-in: `/__last` Endpoint

The worker maintains a per-isolate ring buffer of the last 25 requests:

```bash
curl -s "$WORKER/__last" | jq '.recent[-5:]'
```

Each entry contains:
```json
{
  "at": "2026-08-26T14:02:31Z",
  "method": "GET",
  "url": "https://telegraph-sky.margyn.workers.dev/weather/London",
  "ua": "telegraph-node/1.2",
  "via": "10.0.0.1"
}
```

Use this to:
- See what queries Telegraph nodes are actually sending
- Verify the miner is receiving traffic
- Debug query parsing issues

### Cloudflare Dashboard

- **Workers & Pages → Analytics** — request counts, error rates, CPU time
- **Workers & Pages → Logs** — real-time log streaming (via `wrangler tail`)

### `wrangler tail`

Stream real-time logs from your worker:

```bash
# All requests
wrangler tail

# Only errors
wrangler tail --format pretty --status error

# Filter to storm endpoint
wrangler tail --search "/storm"
```

---

## Operations

### Updating the Worker

```bash
# Pull latest changes
git pull

# Re-deploy (instant, zero-downtime)
wrangler deploy
```

Deployments are atomic and instant. The old version serves requests until the new one is fully propagated (typically < 1 second globally).

### Rollback

```bash
# List recent deployments
wrangler deployments list

# Rollback to a previous deployment
wrangler rollback
```

### Local Development

```bash
# Run locally with Wrangler dev server
wrangler dev

# Test locally
curl http://localhost:8787/weather/London
```

The dev server runs the exact same Worker runtime locally, hitting the real open-meteo API.

---

## Performance Tuning

### Cache Behaviour

The worker uses a **10-second in-memory memo** per isolate. This means:

- **First request** for a location: ~200–500ms (two API calls to open-meteo)
- **Subsequent requests** within 10s: < 1ms
- **After 10s**: fresh data fetched again

The `Cache-Control: public, max-age=10` header also lets Cloudflare's edge cache serve repeated requests without hitting the Worker.

### Cold Starts

Cold starts are ~5ms because:
- No `node_modules` to load
- No framework initialization
- Single file, ~12 KB
- No database connections to establish

### Rate Limits

| Layer | Limit |
|-------|-------|
| Cloudflare Workers (free) | 100,000 requests/day |
| Cloudflare Workers (paid) | 10M+ requests/month |
| open-meteo | No hard limit (fair use) |
| Telegraph descriptor | 20 req/sec declared |

For high-traffic deployments, the paid Workers plan ($5/month) removes the daily request cap.

---

## Troubleshooting

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `502` responses | open-meteo is down/slow | Wait; the 5s timeout handles gracefully |
| `404` for a valid city | Geocoding doesn't find it | Try alternate spelling or add country |
| Template probe returns `400` | Bug — should never happen | Check `extractPlace()` regex |
| Stale data | Isolate memo | Data is at most 10s old by design |
| Different results per request | Different CF isolates | Expected; each has its own memo |

### open-meteo Geocoding Quirks

- `"Springfield"` → matches the first (most populous) Springfield
- `"New York"` → works; multi-word cities are supported
- `"NYC"` → may not resolve; use "New York"
- Non-Latin characters → supported (open-meteo handles Unicode)

### Debugging Locally

```bash
# Run with verbose logging
wrangler dev --local

# Test extractPlace parsing
node -e "
const { extractPlace } = await import('./worker.js');
console.log(extractPlace('what is the weather in Paris'));
"
```

---

## Telegraph Registration

After deployment, register the miner on-chain:

### Registry Details

| Field | Value |
|-------|-------|
| Chain | Base Sepolia |
| Registry Contract | `0x5a2324aA18613FAd4e44bDF0d6c73Ec1f6D87ff8` |
| Miner Wallet | `0x8b224783FE5b3c52B7DB0cb9B1754f8812b75287` |

### Descriptor Files

Each intent has a YAML descriptor that tells the Telegraph network:
- What the miner does (schema, endpoints)
- How to call it (HTTP method, params)
- How to encode the response on-chain (field mappings)

| Intent | File | ID |
|--------|------|----|
| WEATHER_CHECK | `skywire-weather-check.yaml` | 7304 |
| WEATHER_FORECAST | `skywire-forecast.yaml` | 7305 |
| STORM_ALERT | `skywire-storm-alert.yaml` | 7306 |

### Updating the Base URL

If you deploy to a custom domain, update the `base_url` in each descriptor YAML:

```yaml
base_url: https://your-custom-domain.com
```

Then re-register the descriptors on-chain.

---

## Cost

| Component | Cost |
|-----------|------|
| Cloudflare Workers (free tier) | $0/month (100K req/day) |
| Cloudflare Workers (paid) | $5/month (10M req/month included) |
| open-meteo API | Free (CC BY 4.0) |
| Database | N/A — none used |
| Secrets/Keys | N/A — none needed |
| **Total (free tier)** | **$0/month** |

---

## Security Checklist

- [x] No API keys to rotate or leak
- [x] No database credentials
- [x] No environment secrets
- [x] No user data stored
- [x] No PII collected
- [x] CORS enabled (public weather data)
- [x] Input sanitized via URL encoding
- [x] Timeouts on all external calls (5s)
- [x] Error messages don't leak internals
