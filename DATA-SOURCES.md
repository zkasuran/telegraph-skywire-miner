# Data sources

Every figure this miner serves is a live read at request time. This file records, per source,
what it provides, what its own terms say about commercial use and redistribution, what credit it
requires and what its real rate limit is.

Two rules were followed in writing it. A licence is only recorded when the provider's own terms
page was read; where a page could not be read, that is stated as unverified rather than guessed.
And every source was called from a Cloudflare Worker before it went in, because several hosts
answer differently from a worker than from a laptop.

| Host | Provides | Licence | Commercial use | Attribution | Rate limit |
| --- | --- | --- | --- | --- | --- |
| api.met.no | Global hourly weather forecast (locationforecast 2.0) | CC BY 4.0 and Norwegian Licence for Open Government Data (NLOD) 2.0 | Permitted. The licence page states no restriction on commercial use, and CC BY 4.0 permits it. | Required. "Credit should be given to The Norwegian Meteorological Institute, shortened MET Norway, as the source of data." Suggested wording: "Data from MET Norway". | "Anything over 20 requests/second per application (total, not per client) requires special agreement." |
| api.weather.gov | US wind gusts, precipitation probability, snowfall and active alerts | No licence needed: a work of the United States Government. | Permitted. "free to use for any purpose" and "we do not charge any fees for the usage of this service". | Not required. Credited anyway so a reader can check the figure. | "The rate limit is not public information, but allows a generous amount for typical use." |
| www.wikidata.org | Place coordinates, canonical label and country | CC0 1.0 (public domain) | Permitted without condition. | Not required by CC0. Credited anyway. | No published limit for wbgetentities. One or two calls per uncached place, memoised for ten seconds. |

## Per source

### api.met.no

Global hourly weather forecast (locationforecast 2.0).

What the terms say: "Norwegian Licence for Open Government Data (NLOD) 2.0" and "Creative Commons 4.0 BY International"

Commercial use: Permitted. The licence page states no restriction on commercial use, and CC BY 4.0 permits it.

Attribution: Required. "Credit should be given to The Norwegian Meteorological Institute, shortened MET Norway, as the source of data." Suggested wording: "Data from MET Norway".

Credit line published in every answer:

    Data from MET Norway, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Values converted from SI units and summarised by SkyWire.

Rate limit: "Anything over 20 requests/second per application (total, not per client) requires special agreement."

A User-Agent naming the application with a contact is mandatory and a fabricated one is treated as abuse. Coordinates are capped at four decimals: five or more returns 403. Wind gusts, precipitation probability and thunder probability are published over the Nordics only, which is why the answer states a sustained wind elsewhere.

### api.weather.gov

US wind gusts, precipitation probability, snowfall and active alerts.

What the terms say: "All of the information presented via the API is intended to be open data, free to use for any purpose."

Commercial use: Permitted. "free to use for any purpose" and "we do not charge any fees for the usage of this service".

Attribution: Not required. Credited anyway so a reader can check the figure.

Credit line published in every answer:

    Data from the US National Weather Service (api.weather.gov), a public service of the United States Government.

Rate limit: "The rate limit is not public information, but allows a generous amount for typical use."

A User-Agent is required and the docs ask for contact information in it. Read only for a place the caller named, in the United States, where MET Norway lacks the gust and probability fields.

### www.wikidata.org

Place coordinates, canonical label and country.

What the terms say: "Creative Commons CC0 License", described as equivalent to "Public domain"

Commercial use: Permitted without condition.

Attribution: Not required by CC0. Credited anyway.

Credit line published in every answer:

    Place coordinates from Wikidata, CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/).

Rate limit: No published limit for wbgetentities. One or two calls per uncached place, memoised for ten seconds.

Wikipedia's search index resolves a name to a page title, which handles typos and disambiguation, and Wikidata supplies the published coordinate. Only the CC0 value is served; Wikipedia is the index, not the data.

## Compliance

Met:

- api.met.no: the required credit line travels in every answer and in NOTICE.
- api.weather.gov: the required credit line travels in every answer and in NOTICE.
- www.wikidata.org: the required credit line travels in every answer and in NOTICE.

No open items: every source this miner calls permits the use, and every required credit line is published.
