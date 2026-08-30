# Licence history

This repository changed licence on 2026-08-30. Nothing was withdrawn. This file
records exactly what is covered by which grant, so anyone holding a copy knows where
they stand.

## The two periods

| Period | Commits | Licence |
| --- | --- | --- |
| until 2026-08-30 | up to and including `f5ce86e55d5f1c829f2d4d99cfd6630d43e38814` | MIT |
| 2026-08-30 onward | after that commit | Source-Available No-Derivatives 1.0, see [`LICENSE`](LICENSE) |

Every file as it stood at or before `f5ce86e55d5f1c829f2d4d99cfd6630d43e38814` was published under MIT, and that grant
is irrevocable for whoever obtained a copy under it. Nobody who forked or built on
those bytes needs to do anything.

## Why it changed

This worker is a competition entry. It is registered on the Telegraph network as a
miner for its intents, and the network ranks miners against each other. MIT let anyone
copy the worker, point it at the same free upstream API, keep the answer shape that the
scoring modules reward, and register the result as a separate competing entry. That is
exactly what MIT permits, so this is a correction of our own licence choice and not a
complaint about anyone's conduct.

The new licence keeps everything a reviewer or a judge needs:

- reading, auditing, load testing and benchmarking the code is permitted, and so is
  publishing what you find.
- deploying your own instance to check that the code does what it claims is permitted.
- calling our live endpoints is not restricted by the licence at all. They are a public
  service.

What it withholds is redistribution, modified copies and redeploying it as a competing
miner.

## What did not change

- **The live endpoints keep serving.** Nothing about the deployment changes.
- **Third-party data keeps its own terms.** The upstream providers' licences and limits
  are in [`NOTICE`](NOTICE) and [`DATA-SOURCES.md`](DATA-SOURCES.md). Our licence does
  not, and could not, restrict anyone's rights in their data.
- **MIT copies already taken stay valid.** If someone forked this before the boundary
  commit, that copy is lawful and stays lawful.

## Checking which grant covers a copy you hold

```bash
git merge-base --is-ancestor <the commit you have> f5ce86e55d5f1c829f2d4d99cfd6630d43e38814 \
  && echo "MIT" || echo "SAND-1.0"
```
