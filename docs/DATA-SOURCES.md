# Data sources and validation

## First provider: Transport for London

The current release combines London transit with England-wide National Rail route coverage from TfL's Unified API. TfL supplies line/operator status, stations and route geometry; its station boards support London transit and Thameslink. Other National Rail station boards use the separate RDM adapter described below.

Official references:

- [Developer portal and authentication](https://api-portal.tfl.gov.uk/)
- [API reference (Swagger)](https://api.tfl.gov.uk/swagger/docs/v1)
- [Current mode registry](https://api.tfl.gov.uk/Line/Meta/Modes)
- [Subscription limits](https://api-portal.tfl.gov.uk/faq)
- [Transport Data Service terms](https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service)
- [London Overground](https://tfl.gov.uk/modes/london-overground/)

### Endpoint mapping

All paths below are relative to `https://api.tfl.gov.uk`.

| Feature | Endpoint | Handling |
| --- | --- | --- |
| Mode discovery | `/Line/Meta/Modes` | Rail mode IDs include `tube`, `dlr`, `overground`, `elizabeth-line`, `national-rail`, `tram`. The app includes the provider’s National Rail operator registry. |
| Line discovery | `/Line/Mode/{modes}` | Discover provider IDs; mode and line IDs differ. Elizabeth line's mode is `elizabeth-line`, its line ID is `elizabeth`. |
| Network status | `/Line/Mode/{modes}/Status` | Keep every status and disruption description; an unavailable response is not good service. |
| Station search | `/StopPoint/Search?query={query}&modes={modes}` | Results can be interchange hubs requiring resolution to mode-specific stop IDs. |
| Stations serving a line | `/Line/{id}/StopPoints` | Supplies stop IDs, coordinates, hierarchy and served lines. |
| Network geometry | `/Line/{id}/Route/Sequence/all` | Parse each `lineStrings` string; retain branches and separate polylines. |
| Tube/DLR predictions | `/StopPoint/{id}/Arrivals` | Normalize expected arrival, source time, expiry, destination and platform. |
| Overground/Elizabeth/Thameslink board | `/StopPoint/{id}/ArrivalDepartures?lineIds={lineId}` | Separate response shape; preserve scheduled/estimated and arrival/departure distinctions. Thameslink uses line ID `thameslink` and mode `national-rail`. |

The current six Overground line IDs were observed as `liberty`, `lioness`, `mildmay`, `suffragette`, `weaver` and `windrush`, all with mode `overground`. Old examples containing `london-overground` are not the current six-line registry.

### Authentication and request budget

TfL recommends registration. Its standard subscription allows 500 requests per minute. Pass `app_key` server-side; `app_id` is no longer required. Unkeyed requests succeeded during this investigation, but that does not establish a guaranteed anonymous quota or long-term availability.

Cache shared status and geometry requests, deduplicate simultaneous requests, refresh only active station boards and back off on rate limits. Keep keys out of browser bundles, committed files and logs. Preserve source timestamps separately from application fetch time.

## Observed live responses

Direct Node `fetch` checks succeeded on **19 September 2026, approximately 01:44–01:46 UTC**, without an API key. These are point-in-time checks, not a service availability guarantee.

| Request | Observed result |
| --- | --- |
| `/Line/Mode/tube,dlr,overground,elizabeth-line/Status` | HTTP 200, JSON status response. |
| `/Line/Mode/overground` | HTTP 200; six current line IDs listed above. |
| `/Line/victoria/Route/Sequence/all` | HTTP 200; encoded `lineStrings`, station records and two stop-point sequences. |
| `/StopPoint/940GZZLUBNK/Arrivals` | HTTP 200; five Bank predictions with fresh source timestamps. |
| `/StopPoint/910GPADTLL/ArrivalDepartures?lineIds=elizabeth` | HTTP 200; two Paddington records containing departure times only. |
| `/StopPoint/910GHGHI/ArrivalDepartures?lineIds=windrush` | HTTP 200; sixteen Highbury & Islington records, including terminating arrivals and records with scheduled times only. |

The Victoria geometry contained strings in this shape:

```json
"[[[-0.019885,51.582965],[-0.04115,51.586919]]]"
```

The observed order is **longitude, latitude**, with an outer array of line segments. The Green Park geometry coordinate matched the stop record's `lon` and `lat`. This validates the observed payload, not every possible future shape; reject malformed coordinates rather than drawing them.

Tube records included `expectedArrival`, `timestamp` and `timeToLive` with UTC `Z` suffixes, plus `timeToStation` in seconds. Rail-board records used ISO UTC departure/arrival timestamps, omitted unavailable fields and did **not** include line IDs. Retain request context for line identity. `Platform Unknown` is a real provider value. A scheduled-only event must not be presented as a live prediction. Display times using `Europe/London` so daylight saving is handled correctly.

Search returned `HUBPAD` for Paddington and `HUBHHY` for Highbury & Islington; the latter remained a hub with `includeHubs=false`. A line's stop registry identified `910GPADTLL` for Elizabeth line Paddington, `910GPADTON` for mainline Paddington and `910GHGHI` for Highbury & Islington rail. Resolve station families explicitly instead of assuming one interchange ID works for every mode.

Some web-fetch and Python requests returned 403 while Node API requests succeeded. That tool-specific result did not establish a TfL outage. A subsequent application-adapter smoke check also succeeded for DLR route geometry and the Bank arrivals endpoint, which returned an empty list. Tram arrivals, every route branch, disruption edge cases and live rate-limit behavior were not exhaustively checked.

The application smoke check identified and fixed a separate RouteSequence issue:
`stations` can contain interchange hubs while `stopPointSequences` contains the
mode-specific boarding stops. The normalizer now prefers sequence stops, eliminating
hub duplicates and using the actual stop IDs for arrival queries. In that check it
returned Victoria 16 stops, DLR 45, Elizabeth line 43 and Windrush 29. These are
point-in-time provider results, not hard-coded network totals.

## Map truth and attribution

The observed arrivals feeds provide predictions and sometimes textual `currentLocation`, not vehicle latitude/longitude. Any later moving-vehicle feature requires an inference model and visible estimate labelling. A geographic route line also need not reproduce the exact track alignment between stations.

Credit TfL visibly and link its Transport Data Service terms. Use independent project branding; do not imply TfL endorsement. The terms page returned a verification/403 response during the current check, so the exact required attribution wording and any Ordnance Survey notices remain to be rechecked before public release. Do not assume the API licence grants rights to TfL logos or the official diagram artwork.

## Extension sequence

1. Rail status, station search, map, favourites and selected-station boards, with clear stale/unavailable states.
2. Bus stop arrivals and route geometry using the same provider adapter; then river services and cycle-hire availability after endpoint checks.
3. Wider National Rail coverage using [National Rail Darwin](https://www.nationalrail.co.uk/developers/darwin-data-feeds/) through [Rail Data Marketplace](https://raildata.org.uk/). The official page currently lists a JSON public departure-board API and requires National Rail attribution. Confirm product-specific access terms and quotas when subscribing.
4. Journey planning, accessibility and historical reliability once the basic live-data behavior is dependable. Introduce inferred movement only with confidence/freshness rules and honest labelling.

## Thameslink and the combined network map

Verified on 19 September 2026 using the live TfL API:

- `/Line/Mode/tube,dlr,overground,elizabeth-line,national-rail/Status` returned 44 lines.
  The application retains the TfL rail modes and only `thameslink` from National Rail,
  giving 20 supported lines in the observed response.
- `/Line/thameslink/Status` returned a valid service status.
- `/Line/thameslink/Route/Sequence/all` returned 26 path variants and 145 unique
  normalized boarding stops. Coverage extended beyond London to destinations including
  Brighton, Bedford, Peterborough and Cambridge. Variants may overlap and are not a
  statement that every branch operates at the current time.
- Blackfriars (`910GBLFR`) and Farringdon (`910GFRNDNLT`) rail boards returned 66 and 50
  records respectively. Estimates, scheduled-only events, platforms, destinations,
  delays and cancellations were observed. Counts vary over time.

The existing server-side TfL key supports these endpoints; no second provider key is
required for this Thameslink slice. Rail-board responses omit line IDs, so the adapter
preserves the validated requested line. Scheduled-only times remain labelled as schedules.

Network geometry is loaded once per browser cache lifetime, with at most two requests
in flight and selected lines given priority. The shared provider cache remains the
upstream protection. The local burst budget is 32 requests with a 60-per-minute refill,
allowing the initial status plus 20 routes and a selected station board. It is not a
subscription-wide or deployment-wide quota enforcement mechanism.

## England-wide National Rail expansion

On 19 September 2026, 13:15–13:16 UTC, the combined TfL status endpoint returned
44 entries: 19 London transit lines and 25 National Rail operators. All 25 National
Rail Route/Sequence requests succeeded. Observed full-coordinate counts included
Avanti 49 stations, LNER 59, GWR 255, Northern 518 and TransPennine Express 105.
The normalizer now accepts Great Britain coordinates rather than cutting off stations
north of 54° or west of 2°W. Cross-border endpoints remain visible.

**Coverage is incomplete.** CrossCountry's observed feed included only 45 stops and
omitted major northern and south-western corridors. TfL variants may include diversions
or pass-through locations. Neither a successful route fetch nor a station in the
route response proves that a particular train calls there today. The UI states these
limits and does not manufacture missing connections.

TfL ArrivalDepartures rejected Avanti, LNER, CrossCountry, GWR and TransPennine queries
with HTTP 400 invalid-line errors. National Rail boards therefore use a separate,
currently unconfigured RDM adapter; see NATIONAL-RAIL-SETUP.md. Existing Thameslink
boards retain the verified TfL endpoint. National Rail operator status still comes
from TfL and is displayed as reported, with safe links to supplied disruption pages.

### NaPTAN station-code reference

`data/naptan-rail-codes.json` derives from the Department for Transport's official
[NaPTAN rail access nodes XML](https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=xml&atcoAreaCodes=910),
retrieved 19 September 2026. Provider revision: 25 May 2025. Source contains 2,661
active RLY station records, 2,660 with CRS. The compact index retains 2,651 stop-area
IDs; three conflicting mappings are excluded. Only active railway records with CRS
are used, joining each explicit stopAreas member to its CRS and source coordinate.
Duplicate CRS records are not collapsed to a guessed canonical station. Runtime
matching additionally requires nearby coordinates.

Contains public sector information licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
© Crown copyright. The UI credits Department for Transport NaPTAN.

The local upstream burst budget is now 64 requests, retaining a 60-per-minute refill,
so the shared two-request browser queue can load 44 routes without exhausting a cold
process's burst allowance. This still does not coordinate a deployment-wide quota.
