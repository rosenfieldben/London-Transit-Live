# National route coverage assessment

Reviewed 20 September 2026. This is a source-selection note, not a new data integration.

The existing TfL map has incomplete operator coverage, notably CrossCountry. Do not
invent missing connections or infer an operator’s routes from track geometry alone.
Complete service patterns need a licensed timetable feed; geographic alignment is a
separate concern. Live departure-board access does not automatically include timetables.

| Source | Useful contribution | Access and limits |
| --- | --- | --- |
| [RDG timetable data](https://www.raildeliverygroup.com/our-services/essential-services/rail-data/timetable-data.html) | Passenger schedules and ordered calling points, including operator identity | Appropriate subscription and licence required. Verify the current product separately from departure boards. Public development-feed download entitlement was not verified. |
| [Network Rail open data](https://www.networkrail.co.uk/who-we-are/transparency-and-ethics/transparency/open-data-feeds/) | Alternative schedule/reference feeds | Separate account; the current official page describes restricted, first-come access. Passenger filtering and reference joins are needed. |
| [DfT NaPTAN](https://www.gov.uk/government/publications/national-public-transport-access-node-schema) | Public station identifiers, names, coordinates and stop-area relationships | Already used for conservative CRS matching. Not a timetable or operator route feed. |
| [OS OpenMap Local](https://www.ordnancesurvey.co.uk/products/os-open-map-local) | Candidate for improved geographic railway alignment | Free OS OpenData; inspect railway layer, applicable licence/attribution and generalisation before incorporating. No service patterns. |

CrossCountry’s [official route maps](https://www.crosscountrytrains.co.uk/routes-destinations/route-map)
are a useful validation reference. No reusable machine-readable licence was established
for those PDFs, so they are not being treated as an open route feed.

After timetable access is approved: build dated operator/service-pattern records,
resolve exact station identities, validate coverage against official operator references,
and only then evaluate track-aligned geometry. Retain a visible distinction between
mapped service patterns, currently running services and prediction boards. No feed
application, external registration or licence acceptance was made for this assessment.
