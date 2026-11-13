# Spread — Bahn Express dispatch challenge

Official TypeScript starter and API client, downloaded from
[Spread's kit](https://spread.bahnexpress.com/kit/). No runtime dependencies.

## Run

From this directory, Bun automatically loads `.env`:

```sh
cd /Users/andrew/Work/junction2026/spread
bun run starter --level 1 --seed junction-baseline-1
bun run starter --level 8 --seed spread-1
```

Development tools are pinned in `bun.lock`. Run `bun install` on a new checkout
and `bun run typecheck` to check the kit with the local TypeScript compiler.

The local `.env` contains the team URL and key and is ignored by Git. For a new
checkout, copy `.env.example` to `.env` and supply the team key.

Practice runs create separate simulated weeks. Identical seeds, levels and
actions produce identical results. Completed weeks remain available in the
[run viewer](https://spread.bahnexpress.com/viewer/) and consume no active slot.
Local run logs belong in the ignored `results/` directory.

The official starter also supports `--board` for a limited ranking attempt and
`--final` for the live competition. Ordinary practice needs neither flag.

## Objective

Quote dealers for moving cars, then post driver gigs and choose their fees.
Maximize gross margin while delivering at least 90% of won orders on time.
Winning zero orders does not qualify. The competition runs at level 8, with
driver shortages, dealer trust, unannounced market changes and multilingual
notes that can change operational requirements.

The starter is a connectivity and behavior baseline, not a competitive policy.
It quotes the first option at list price and increases driver fees over time.

## Verified starter baselines

Both practice weeks completed successfully on 13 November 2026:

| Level | Seed | Won orders | On time | Margin | Qualifies |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | `junction-baseline-1` | 987 | 94.0% | −€3,105.03 | Yes |
| 8 | `spread-1` | 949 | 45.5% | −€72,612.51 | No |

Logs: `results/baseline-level-1.log` and `results/baseline-level-8.log`.
The level 8 result matches the handbook's published starter result for this seed.
These runs establish the official starter baseline; no custom policy has been
implemented or evaluated yet.

## Files

- `starter.ts`: official dispatch policy and practice/live run loops.
- `spread.ts`: official HTTP/WebSocket client and rate-limit handling.
- `types.ts`: API types.
- `reveal-csv.ts`: official export tool for completed practice runs.
- `docs/HANDBOOK.md`: start here for simulation mechanics and research ideas.
- `docs/RULES.md`: authoritative rules when the documents disagree.
- `docs/API.md` and `docs/openapi.json`: API contracts.
- `docs/llms.txt`: original agent entry point.

## First strategy improvements to investigate

1. Admission and pricing: avoid winning work that local drivers cannot fulfill.
2. Capacity: use the map and driver roster to estimate lane-level feasibility.
3. Delivery options: compare their slack and potential margin.
4. Notes: handle actual times, licences, plates and release requirements before
   sending a driver, rather than only retrying failed visits.
5. Driver fees and direct offers: measure booking and completion outcomes.

Compare changes on several fixed practice seeds, tracking margin and on-time
share together. Qualifying on one seed is not evidence of a robust strategy.
