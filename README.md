# London Transit Live

A first, runnable foundation for a London counterpart to
[NYC Transit Live](https://github.com/rosenfieldben/nyc-transit-live).
Scope includes London transit and TfL-supplied National Rail routes across England,
with cross-border connections retained. This is an independent project, not a TfL product.

## What the first version does

- Lists TfL rail lines and their reported service conditions.
- Filters Underground, DLR, London Overground, Elizabeth line and National Rail operators.
- Switches between London and England map areas, with 44 lines/operators observed in the provider registry.
- Opens with all supported rail routes together on one geographic network map.
- Lets you select a line for its stations and boards, or switch to a focused line view.
- Loads routes with a shared browser cache and two concurrent requests; a missing route can be retried without losing the others.
- Opens a station arrival board from either the map or a keyboard-accessible list.
- Shows source, freshness, stale-data and unavailable states explicitly.
- Offers a separate, clearly labelled demonstration mode for development.

Live mode fetches TfL data on demand through a shared server cache. It never substitutes
sample data when a request fails. The demonstration dataset covers short sample sections;
its geometry and predictions are illustrative and must not be used for travel.

This starter does not yet include bus tracking, complete coverage of every rail operator/branch, trams, boats, journey
planning, favourites or moving train markers. It is a first product slice, not feature
parity with the mature NYC application.

## Run locally

Install Node.js 24 LTS. No npm packages or build step are required.

```sh
npm run demo
```

Open http://localhost:3000. Demo mode is an explicit choice. The map's street tiles still
need internet access; station lists, sample lines and sample boards work without tiles.

For real TfL data, copy `.env.example` to `.env`, add your `TFL_APP_KEY`, and run:

```sh
npm start
```

[TfL's developer portal](https://api-portal.tfl.gov.uk/) explains registration and obtaining
an API key. The key stays on the server. Keyless requests can work, but should not be relied
on for an ongoing deployment. Use only `app_key`; TfL says `app_id` is no longer required.
Never put the key in frontend JavaScript, a repository, or a public URL.

For **nationwide live departure boards**, a separate National Rail public Live Departure
Board subscription through Rail Data Marketplace is required. Routes and TfL status
work with the existing TfL connection. New National Rail boards explicitly show
“not connected” until the National Rail key and product URL are configured; Thameslink
continues to use its working TfL board. See [National Rail setup](docs/NATIONAL-RAIL-SETUP.md).

Run the automated checks with:

```sh
npm test
```

## Structure

```text
server/      Shared API handler, Node server, TfL adapters, cache, demo fixtures
frontend/    Vanilla JavaScript interface and locally bundled Leaflet
worker/      Fetch adapter for the hosted preview
scripts/     Hosting build and supervised local preview
test/        Node's built-in test runner
docs/        Architecture, provider research, roadmap and verification notes
```

The NYC project uses Python/FastAPI plus a buildless Leaflet frontend. This starter
keeps the small server plus buildless-map approach and uses Node for the new adapter,
so the first version needs just one installed runtime and no package installation.
The provider logic is separate from the interface; keeping or changing this choice
later does not require importing the NYC feed-specific code.

## Deployment

This is a server application, so GitHub Pages alone cannot host it. The project now
includes a Sites-compatible Worker build for a private hosted preview. The Worker
serves the same frontend and shared API logic as the local Node server. A Node-capable
host such as the NYC project's existing Railway arrangement can also run `npm start`.
Set `HOST=0.0.0.0` on the host, its assigned `PORT`, `TFL_APP_KEY`, and `DEMO_MODE=false`.
Use HTTPS at the hosting layer. The health endpoint is `/api/health`.

For the hosting build, install the pinned development tool with `npm ci`, then run
`npm run build`. It produces `dist/server/index.js` and the hosting manifest.
Only an explicit allowlist of public frontend assets is embedded. No secret is read
at build time. On Sites, `TFL_APP_KEY` is configured as a runtime secret.
The private preview stays in live mode; development demo settings are separate.

The initial cache and upstream request budget are process-local on Node and
isolate-local on Workers. They do not enforce a deployment-wide TfL quota.
Before increasing traffic, add coordinated upstream caching and rate limiting.
Before a public launch, perform the live-feed and operating checks in
[docs/ROADMAP.md](docs/ROADMAP.md), confirm the current TfL terms, and choose a basemap
provider suitable for expected traffic. The default OSM tiles are a best-effort service;
do not bulk-download or prefetch tiles.

The NYC repository was used as reference and was not changed. The London project has
its own source history and hosting configuration. GitHub Actions runs the test,
syntax-check and build steps on pushes and pull requests.

## Data and attribution

Powered by TfL Open Data. See [TfL's transport-data terms](https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service).
Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
Leaflet is included under its BSD-2-Clause licence in `frontend/vendor/leaflet/LICENSE`.

The combined map includes 25 TfL-listed National Rail operators alongside London transit.
It is an England-wide geographic view, not a claim of complete operator coverage.
For example, the observed CrossCountry route feed omits several major corridors.
Routes describe network coverage, not a guarantee of service on every branch at the
current time; they do not locate a vehicle or reproduce precise track alignment. Arrival boards contain
provider predictions or clearly labelled scheduled times. Empty predictions mean TfL
returned none for that query, not proof that no services operate.

Read [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) for endpoint differences and
[docs/VERIFICATION.md](docs/VERIFICATION.md) for what was actually tested.

No open-source licence has been selected for the new project code yet; choose one
before inviting outside reuse. Third-party data and Leaflet retain their own terms.
