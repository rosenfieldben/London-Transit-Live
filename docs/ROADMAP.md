# Development direction

Prepared 19 September 2026. Working name: London Transit Live.

## What to carry over from NYC

The reference review covered the current repository structure, README, backend
composition root, frontend markup and vendored map library. This was a product and
architecture review, not a full audit of the NYC project. The latest main commit observed
was `49c595660365d51de10292407421438b22ccd429`.

| NYC idea | London implementation or next step |
| --- | --- |
| Map as the main working surface | Geographic map with selectable rail lines and stations |
| Click a station for arrivals | Shared map/list selection opens the same board |
| Server fetches once for many clients | Shared cache and in-flight request deduplication |
| GPS versus inferred/scheduled data are distinct | Predictions remain predictions; no invented vehicle coordinates |
| Failed data and successful empty data mean different things | Label stale retained data; successful empty arrivals clear the board |
| Stations have an accessible text surface | Line station search/list alongside the map |
| Multiple operators have different contracts | Separate TfL prediction adapters; National Rail added independently later |

## Stage 1 — Validate and publish the rail foundation

The included starter implements the first functional slice. Next:

1. Create `london-transit-live` under the preferred GitHub account and commit the package.
2. Add the owner's TfL app key as a host secret and connect a Node-capable host.
3. Exercise representative Underground, DLR, Overground and Elizabeth line stations
   during operating hours. Confirm station IDs, branches, terminal departures,
   cancellations, empty boards, disruption reasons and timestamp behavior.
4. Verify outbound and inbound branches on complex routes, especially Northern line,
   DLR and Elizabeth line, rather than assuming a single linear stop order.
5. Review provider terms and attribution for the actual data and tile services used.
6. Run mobile, keyboard and screen-reader checks against the deployed application.

Acceptance: every supported query either presents correctly labelled provider data or
an explicit unavailable/empty state; no stale or simulated values appear current.

## Stage 2 — Make the map a network explorer

Add multiple simultaneous line layers, station interchange grouping, broader station
search, saved stations, step-free information with field-level provenance, and trams.
Keep station/platform identifiers separate; a station complex can contain different
stop IDs for different operators and modes. Do not infer accessibility from a coordinate
or a station name. Maintain an equally capable keyboard path.

Acceptance: one interchange can present the relevant modes without duplicate or
misattributed arrivals, and map density remains usable on a phone.

## Stage 3 — Buses and National Rail

For buses, begin with stop boards and selected routes to control request volume. Audit
the actual location fields before promising GPS vehicle tracking. Add National Rail
through its own official provider/credentials and attribution, with explicit coverage.
Darwin predictions are not a universal vehicle-location feed.

Acceptance: each provider can fail independently; keys remain server-side; station and
vehicle IDs are namespaced; fresh empty data clears only the affected layer.

## Stage 4 — Moving vehicles, if the evidence supports it

Investigate stable train identity across polls, sequence continuity, branch matching,
position quality, gaps and expiry. Compare observed station advances against the route
geometry before adding animation. Label inferred motion as an estimate and honor reduced
motion. Do not convert textual `currentLocation` or `timeToStation` directly into a claimed
GPS position. Start with one supported line and a recorded-data evaluation.

Acceptance: identities do not silently swap at branches, stale trains expire, and every
position exposes whether it is reported or inferred.

## Deliberate early choices

- Greater London rather than only the City of London municipal boundary.
- A separate project with fresh provider adapters, leaving NYC's implementation intact.
- A small Node server and buildless Leaflet frontend; no database until a feature needs one.
- Provider-derived line identifiers, including the named Overground lines.
- No dependency on unofficial train-tracking feeds for the first release.
- One deployed process initially; a shared request budget and cache before horizontal scale.

These are starting decisions, not constraints on where the project can grow.
