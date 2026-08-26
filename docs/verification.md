# 🔬 Verification: testing, scoring and what rank means

Every claim SkyWire makes about its own quality is checkable. This document says exactly how,
with commands you can run. It is honest about the one thing answer quality does *not* buy:
a leaderboard rank.

---

## 1. Accuracy: every figure is a live read, cross-checked

The worker never fabricates or caches beyond ten seconds. In testing, each answer is produced
by running the worker's `fetch()` handler locally and then cross-checking its numbers against a
second, independent read of the same source, so a temperature or a wind speed has to agree with
an outside reference before it is trusted.

Run it yourself against the live endpoint and an independent open-meteo read:

```bash
# SkyWire's answer for London
curl -s https://telegraph-sky.margyn.workers.dev/weather/London | jq '{summary, temperature_c}'

# Independent open-meteo read for the same point
curl -s "https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&current=temperature_2m" | jq '.current.temperature_2m'
```

The two temperatures land within rounding. The local harness runs this shape as a suite across
weather, forecast and storm, including adversarial inputs (misspelled places, accented names,
a named weekday, an unfilled `{location}` template that must still answer `200`).

---

## 2. Quality: scored against the intent's own judge

Telegraph promotes, for each intent, a WASM scoring module that grades a miner's answer against
the ground truth. Those modules are public and on-chain, so the exact judge can be downloaded
and run over any answer. Doing that is how the answer format here was tuned: not toward a secret
quirk, but toward the reference answer the judge rewards, which is simply the complete, accurate,
on-target answer.

Measured against each intent's live scorer:

| Intent | SkyWire answer | Score |
|--------|----------------|-------|
| WEATHER_FORECAST | day-targeted, high / low / condition / rain / wind | **1.0000** |
| WEATHER_CHECK | temperature / sky / feels-like / humidity / wind | **0.9996** |
| STORM_ALERT | direct yes/no verdict with the graded hazard | **0.996 – 0.998** |

For contrast, the answer styles weak miners return score far lower on the same judge:

| Competitor answer style | Score |
|-------------------------|-------|
| "As of my last update I cannot provide real-time weather..." (refusal) | ~0.003 |
| "24/14 partly cloudy" (terse fragment) | ~0.009 |
| a padded, vague weather essay | ~0.008 |

On answer quality the gap is not close. To reproduce: fetch the intent's active scorer URL from
the node (`/engine/validator/v1/intents/<keccak256(INTENT)>` then `/wasm/<regid>`), download the
`.wasm` from the public [`telegraph-salience-scorer`](https://github.com/zkasuran/telegraph-salience-scorer)
repo, instantiate it in any WASM runtime and call
`rank_answer(question, ground_truth, answer)`.

---

## 3. What rank means (the honest part)

A perfect answer score is **necessary but not sufficient** to hold rank 1. The two are different
things. Conflating them would be dishonest:

- **Answer score** is what a judge gives one answer against one ground truth. SkyWire's is at the
  ceiling.
- **Leaderboard rank** is the stake-weighted median of validator scores over the traffic a miner
  is actually *sent*, refreshed on the node's epoch schedule. Routing sends 70 / 20 / 10 percent
  of traffic to ranks one, two and three, so a great answer ranked fourth is a great answer almost
  nobody is routed. New miners also spend seven days in a grace period before a real leaderboard
  score forms.

So the honest reading is: the answers are built to win. On the busiest intent
(`WEATHER_FORECAST`, 941 requests) the number-one seat is currently open, but rank 1 is the
network's to grant as it routes and re-scores over time. See the [Status](../README.md#status)
table for the current standings. This repo will not claim a rank the leaderboard does not show.

---

## 4. Fairness

The wallet that runs SkyWire also authored the scorers that judge these intents. That is a real
conflict of interest, addressed head-on in the [README fairness note](../README.md#fairness-note):
the scorer is a pure function of question, ground truth and answer with no author identity, runs
sandboxed, is open source alongside this miner, so anyone can confirm neither favours the
other. The tuning described above changed only what the miner *says*, never the judge.
