# Verification record

Date: 19 September 2026. Runtime: Node.js 24.19.0.

Final result: all 45 Node tests, two workerd integration tests and application syntax checks passed. The
demonstration HTTP server also served its HTML, JavaScript, CSS and map library
with successful responses and the expected content types.

## Automated checks

`npm test` exercises the provider adapters, cache and HTTP boundaries. Coverage includes:

- Concurrent reads sharing a request, successful empty results replacing old data,
  failed refreshes retaining bounded stale data, and eventual expiry.
- First-request failures remaining errors, with no automatic sample-data fallback.
- Route geometry coordinate order and mode-specific stops replacing interchange hubs.
- Tube line filtering, source timestamps, prediction expiry and arrival sorting.
- The distinct rail-board response, estimated versus scheduled times, departures versus
  arrivals, cancellations and services that do not stop at the station.
- Rate-limit backoff and sanitized errors that do not reveal API keys.
- HTTP method/path validation, static-file boundaries and explicit demo envelopes.

The frontend helper tests cover arrival labelling and timing, stale-data handling,
London time and safe display values. Run `npm test` for the complete current result.
`npm run check` parses the application modules for syntax errors.

## Live provider checks

The application provider adapter successfully contacted TfL without an API key during
this session. The API returned 19 supported rail lines. Actual route and board checks:

| Line | Route result | Board result |
| --- | --- | --- |
| Victoria | 16 stops; 2 paths | 4 predictions at the sampled station |
| DLR | 45 stops; 10 paths | Successful empty response for Bank |
| Elizabeth line | 43 stops; 19 paths | 4 departure predictions at Paddington |
| Windrush | 29 stops; 8 paths | 16 records at Highbury & Islington |

Counts reflect the feed at the time of testing. Empty boards are valid outcomes, not
proof that a line is closed. The checks use IDs validated against each line's route.
Separate endpoint investigation is recorded in [DATA-SOURCES.md](DATA-SOURCES.md).

## Hosting and browser checks

The Worker build completed successfully with eight explicitly bundled public assets.
Four additional tests cover the Worker static-file boundary, demo API flow, runtime
configuration changes, secret isolation, failure responses and request completion.
The GitHub workflow runs the test suite, syntax checks and Worker build on pushes
and pull requests.

The supervised browser preview rendered correctly at 1363 × 936 without horizontal
overflow. In explicit, visibly labelled demo mode, station search, station selection,
arrival cards, route geometry, map tiles, line switching and disruption details were
checked. The browser also displayed the live-feed error and retry state correctly.
The temporary demo configuration was removed before committing; hosting defaults to
live TfL access.

Live requests from the supervised preview returned 502, while direct application
adapter checks in the development environment returned all 19 rail lines. This does
not establish a provider outage or successful hosted live-feed access.

## Deployed 502 correction

The initial deployment returned 502 for `/api/lines` in 0–1 milliseconds. The
provider stored the global `fetch` function without binding its receiver, then
called it as `this.fetch(...)`. Node accepted this, while workerd threw
`TypeError: Illegal invocation` before making an outbound request.

A separate Miniflare/workerd reproduction confirmed the original call fails;
direct global calls and `fetch.bind(globalThis)` succeed with the same
`AbortSignal.timeout(9000)` options. The provider now binds its default fetch to
`globalThis`. A new regression test failed before the fix and passed after it.
Testing the full built bundle also revealed that workerd rejects
`redirect: 'error'` synchronously. The provider now uses `redirect: 'manual'` and
rejects non-success statuses, so redirects cannot forward credentials. A regression
test confirms a 302 response is rejected after one request without following it.
The actual bundle in workerd returned 502 with no outbound requests before both
fixes, then 200 with one outbound request and a normalized TfL fixture after them.

The committed `npm run test:runtime` check executes the built bundle in Miniflare's
workerd runtime with a controlled TfL response; CI runs it after building. It checks
that the native fetch reaches the expected TfL endpoint and returns normalized live
provider data. It requires neither a TfL key nor network access to TfL.

Another test checks that diagnostic records include failure category and upstream
status without URLs, raw exception messages, response bodies or API keys.

Reference: [Cloudflare runtime invocation errors](https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors).

## Not verified

- Mobile layout, keyboard-only navigation and screen-reader behavior. The desktop
  browser checks do not establish visual or accessibility conformance.
- Every station, branch, time of day, service disruption or cancellation in the live feed.
- Production-wide quotas, long-running recovery, multiple processes, or load behavior.
- End-to-end Thameslink station boards on the private deployment after this update.
- The exact current TfL licence notice text, because the terms page could not be read.

The project is a tested first implementation, not a production certification. Full station-board
validation, long-running hosted recovery and mobile/accessibility checks remain.

## Thameslink and combined-map update

The keyed private deployment returned 200 for status and representative route requests
before this update. Live provider research then verified Thameslink status, 145 stops,
26 path variants and successful Blackfriars/Farringdon rail boards; see DATA-SOURCES.md.
This is distinct from the controlled browser demonstration below.

Added tests cover National Rail filtering, Thameslink's rail-board endpoint and line
context, cancellations and schedules, the complete cold-network request budget,
concurrent route loading, selected-line queue priority, cache sharing/expiry, partial
failures, retry, mode filtering and partial progress reporting.

The supervised browser at 1363 × 936 loaded all six explicitly labelled sample routes
on the same map without horizontal overflow. Checks covered Thameslink selection,
Blackfriars sample arrivals, switching network/selected-line views, filtering the map
to Underground (2 of 2 routes), clearing an incompatible station selection, restoring
all supported modes, and rapid Central-to-Thameslink selection. No application console
errors were observed. The temporary local demo setting was removed before publishing.
Mobile and screen-reader validation remain outstanding.

## England and National Rail expansion

The live public TfL snapshot captured 19 September 2026 at 13:15–13:16 UTC contained
44 status records and successful Route/Sequence responses for all 25 National Rail
operators. The expanded coordinate normalizer preserved all of their route extents,
including Cornwall, northern England and cross-border endpoints. A separate direct
keyless application request timed out; the successful research capture does not prove
availability from every execution environment or a deployed end-to-end board.

Controlled tests cover the 44-route cold-load budget, exact CRS mapping and coordinate
checks, ambiguous CRS exclusions, RDM endpoint restriction, secret isolation, redirects,
shared station caching, stale provider timestamps, cancellation/delay semantics, withheld
platforms, midnight and repeated autumn clock hours. The actual deployment bundle was
also exercised in workerd with mocked outbound TfL and authenticated National Rail
responses, checking its combined provider path and credential separation.

Desktop browser QA replayed the observed 25-operator route snapshot alongside five
explicit London sample lines in visibly labelled demo mode. All 25 National Rail maps
loaded; checks covered the National Rail filter, England/London framing, LNER's 59 stops,
York station search/selection, the NOT CONNECTED message and verified YRK code, the
National Rail external board link, and network/selected-line switching. No application
console errors or horizontal overflow were observed at 1363 × 936. A fractional map
zoom makes the England extent fill the available map height. Mobile layout uses an
unclipped auto-height panel, but no mobile browser or screen-reader conformance test
has been performed. Snapshot replay code/data were removed before committing.

**Still pending:** the user's National Rail subscription and authenticated live checks.
The RDM adapter has only controlled-response verification, not production authentication.
TfL operator geometry is incomplete for some operators (notably CrossCountry); do not
claim complete nationwide track/service coverage from this dataset.


## Station explorer update — 20 September 2026

- Added automated coverage for exact-ID station grouping, route-derived operator
  membership, distinct high/low-level stops, search aliases and prefix matching,
  bounded/corrupt favourites, fragment validation and view-state round trips.
- The built Worker integration check now requests the new public explorer module,
  in addition to exercising the TfL and National Rail contracts in workerd.
- Browser QA used a visibly labelled local DEMO harness with the previously observed
  25 national route geometries and five London sample routes. It loaded 30/30 routes
  and indexed 2,493 distinct station IDs. This is not evidence of current live boards.
- Exercised global York/Newcastle search, exact LNER boards, explicit National Rail
  not-connected states, saving/reloading York, back/forward between stations, custom
  LNER + Thameslink visibility, hide/reopen of the selected service, focused-line view
  and copying the view link.
- Reviewed the 390px responsive layout in a same-origin preview frame and selected
  London Bridge/Jubilee using the keyboard. The Board panel opened with labelled
  demo predictions. This is a responsive browser check, not a physical-device or
  assistive-technology audit. No preview fixture or relaxed preview frame policy is
  included in production.
- Real National Rail credentials, broader licensed timetable coverage, a full screen
  reader audit and representative live-service checks remain outstanding.

Final verification: 50 unit/API tests and 2 built-Worker integration tests passed,
along with the JavaScript syntax checks and production build.


## Automatic map framing and clarity — 20 September 2026

- Service-name and map-route selection enter Focus line and fit that route. Mode and
  visibility changes return to Network map and fit the current visible route set.
- Camera intents allow an initial fit and a final fit as relevant routes settle.
  Manual pointer, pan and keyboard zoom cancel pending fitting; saved cameras are
  restored without background loads or status polls overriding them. Hidden map
  panels defer fitting until they have a real display size.
- Bounds use full route geometry, with station coordinates as a geometry-empty
  fallback. Marker thinning never changes bounds or the searchable station list.
- Added six tests covering bounds expansion/contraction, empty geometry, cancellation
  and stale camera intents, exact repeated-edge removal, station spacing and labels.
- Desktop preview: DLR focused at zoom 13.25; Northern at zoom 6.5. DLR-only network
  zoom 13 expanded to 6 when Northern was shown, then returned to 13 when hidden.
  Hiding all produced an explicit empty state. Northern displayed 28 spaced station
  dots at national scale while its full 518-stop list remained available.
- A manually chosen 13.5 zoom survived reload and completion of route requests,
  including one explicitly unavailable route. Copying the view after restoration
  reproduced the saved camera. A 390px same-origin frame check confirmed service
  selection returns to Map with the DLR fitted and readable station labels.
- Preview used clearly labelled demonstration boards and recorded national geometry;
  it did not validate live National Rail credentials or complete operator coverage.
  All temporary fixtures and the local-only iframe allowance were removed.
