# Verification record

Date: 19 September 2026. Runtime: Node.js 24.19.0.

Final result: all 26 automated tests and application syntax checks passed. The
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

The Worker build completed successfully with seven explicitly bundled public assets.
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
Another test checks that diagnostic records include failure category and upstream
status without URLs, raw exception messages, response bodies or API keys.

Reference: [Cloudflare runtime invocation errors](https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors).

## Not verified

- Mobile layout, keyboard-only navigation and screen-reader behavior. The desktop
  browser checks do not establish visual or accessibility conformance.
- Every station, branch, time of day, service disruption or cancellation in the live feed.
- API-key authentication on the user's own TfL account, production quotas, deployed live-feed access,
  long-running recovery, multiple processes, or load behavior.
- The exact current TfL licence notice text, because the terms page could not be read.

The project is a tested first implementation, not a production certification. Account-key
validation, hosted live-feed verification and mobile/accessibility checks remain.
