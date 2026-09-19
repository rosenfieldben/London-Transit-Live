# Connect National Rail departure boards

The England map and operator status use TfL. National Rail operators other than
Thameslink need a separate departure-board connection; their TfL board requests are
rejected by the provider. The application already contains the National Rail adapter.

1. Register at [Rail Data Marketplace](https://raildata.org.uk/) and subscribe to the
   public **Live Departure Board** JSON product described by
   [National Rail](https://www.nationalrail.co.uk/developers/darwin-data-feeds/).
2. In the product's Specification, find the subscription's consumer key and request URL.
   Confirm its allowance and terms for the chosen product. The older SOAP free-volume
   threshold must not be assumed to apply to a JSON/RDM subscription.
3. In the existing site's environment settings, add `NATIONAL_RAIL_API_KEY` and mark
   it **secret**. Do not put the key in chat, frontend code or GitHub.
4. Add `NATIONAL_RAIL_API_BASE` with the product URL through `/LDBWS/api/20220120`.
   Remove the operation, station code and query string. It must use HTTPS on
   `api1.raildata.org.uk`; the product path must match the subscription. This setting
   is not secret. Do not substitute the direct Basic Authentication endpoint.
5. Apply the runtime settings to the site, reload, select LNER and York, then check a
   second operator/station. Confirm destinations, platforms, London times and the
   displayed provider timestamp against National Rail.

The adapter calls `GetDepBoardWithDetails/{CRS}` with an `x-apikey` header. It requests
up to 50 train departures within 120 minutes and shares a 30-second station cache.
Boards show **all operators at the selected station**, retaining the provider's
operator name. They are not implicitly filtered to the selected map operator.

The integration is covered by controlled-response tests. It has not been authenticated
against the user's National Rail subscription. An unconfigured feed is shown as
“not connected”, and unmapped stations remain unavailable instead of guessing codes.

## Data handling

- Station codes join on exact NaPTAN stop-area IDs with a coordinate check.
- Three conflicting stop-area-to-CRS mappings are excluded from the bundled reference.
- Estimates, scheduled times, unconfirmed delays and cancellations remain distinct.
- London daylight saving and departures crossing midnight are handled explicitly.
- Old provider timestamps mark even empty boards as saved data.
- The adapter uses manual redirects and an allowlisted host; credentials stay server-side.
- The public board's platform-availability restriction is respected.

[Official JSON schema](https://realtime.nationalrail.co.uk/LDBWS/static/ldbws.json).
[Direct-access documentation](https://realtime.nationalrail.co.uk/LDBWS/docs/documentation.html)
describes Basic Authentication, which is a different access method from an RDM consumer key.
