import { HttpError } from './cache.mjs';
import { COLORS, safeId } from './tfl.mjs';

// Handwritten illustrative samples. These are deliberately separate from TfL
// adapters and are served only when DEMO_MODE=true or --demo is explicit.
const definitions = [
  ['thameslink', 'Thameslink', 'national-rail', [
    ['910GSTPXBOX', 'St Pancras International (low level)', 51.532168, -0.127343],
    ['910GFRNDNLT', 'Farringdon', 51.520167, -0.105205],
    ['910GCTMSLNK', 'City Thameslink', 51.513936, -0.10359],
    ['910GBLFR', 'Blackfriars', 51.51181, -0.103332],
    ['910GLNDNBDC', 'London Bridge', 51.505019, -0.086092],
  ]],
  ['central', 'Central', 'tube', [
    ['940GZZLUOXC', 'Oxford Circus', 51.5152, -0.1419],
    ['940GZZLUTCR', 'Tottenham Court Road', 51.5164, -0.1303],
    ['940GZZLUHBN', 'Holborn', 51.5174, -0.12],
    ['940GZZLUCHL', 'Chancery Lane', 51.5181, -0.1111],
    ['940GZZLUSPU', "St. Paul's", 51.5146, -0.0973],
    ['940GZZLUBNK', 'Bank', 51.5133, -0.0886],
    ['940GZZLULVT', 'Liverpool Street', 51.5178, -0.0824],
    ['940GZZLUBLG', 'Bethnal Green', 51.5272, -0.0555],
    ['940GZZLUSTD', 'Stratford', 51.5413, -0.0033],
  ]],
  ['jubilee', 'Jubilee', 'tube', [
    ['940GZZLUWSM', 'Westminster', 51.501, -0.1254],
    ['940GZZLUWLO', 'Waterloo', 51.5033, -0.1147],
    ['940GZZLUSWK', 'Southwark', 51.5038, -0.1058],
    ['940GZZLULNB', 'London Bridge', 51.5055, -0.0868],
    ['940GZZLUBMY', 'Bermondsey', 51.498, -0.0637],
    ['940GZZLUCWR', 'Canada Water', 51.4982, -0.05],
    ['940GZZLUCYF', 'Canary Wharf', 51.5035, -0.018],
    ['940GZZLUNGW', 'North Greenwich', 51.5005, 0.0039],
    ['940GZZLUSTD', 'Stratford', 51.5413, -0.0033],
  ]],
  ['dlr', 'DLR', 'dlr', [
    ['940GZZDLBNK', 'Bank', 51.5133, -0.0886],
    ['940GZZDLSHA', 'Shadwell', 51.5117, -0.0569],
    ['940GZZDLLIM', 'Limehouse', 51.5126, -0.0398],
    ['940GZZDLWFE', 'Westferry', 51.5093, -0.0258],
    ['940GZZDLCAN', 'Canary Wharf', 51.5052, -0.0209],
    ['940GZZDLCUT', 'Cutty Sark', 51.4816, -0.0107],
  ]],
  ['mildmay', 'Mildmay', 'overground', [
    ['910GCMDNRD', 'Camden Road', 51.5419, -0.1386],
    ['910GHGHI', 'Highbury & Islington', 51.546, -0.104],
    ['910GDALS', 'Dalston Kingsland', 51.5482, -0.0757],
    ['910GHACKNYC', 'Hackney Central', 51.5473, -0.0556],
    ['910GSTFD', 'Stratford', 51.5413, -0.0033],
  ]],
  ['elizabeth', 'Elizabeth line', 'elizabeth-line', [
    ['910GPADTLL', 'Paddington', 51.5157, -0.1765],
    ['910GBONDST', 'Bond Street', 51.5142, -0.1494],
    ['910GTOTCTRD', 'Tottenham Court Road', 51.5164, -0.1303],
    ['910GFRNDXR', 'Farringdon', 51.5203, -0.105],
    ['910GLIVSTLL', 'Liverpool Street', 51.5178, -0.0824],
    ['910GWCHAPXR', 'Whitechapel', 51.5194, -0.0599],
    ['910GCANWHRF', 'Canary Wharf', 51.506, -0.0158],
  ]],
];

export class DemoService {
  constructor({ now = Date.now } = {}) { this.now = now; }
  envelope(data) { return { source: 'demo', fetchedAt: new Date(this.now()).toISOString(), stale: false, data }; }
  async lines() {
    return this.envelope(definitions.map(([id, name, mode]) => ({
      id, name, mode, color: COLORS[id],
      statuses: id === 'central'
        ? [{ description: 'Minor Delays', reason: 'Illustrative demo disruption. This is not live service information.', severity: 9 }]
        : [{ description: 'Good Service', reason: 'Illustrative demo status.', severity: 10 }],
    })));
  }
  definition(id, mode) {
    if (!safeId(id)) throw new HttpError(400, 'A valid lineId is required.');
    const line = definitions.find(item => item[0] === id);
    if (!line) throw new HttpError(404, 'Line is not included in the demo.');
    if (mode && line[2] !== mode) throw new HttpError(400, 'The selected mode does not match this line.');
    return line;
  }
  async route(id) {
    const [lineId, name, mode, stops] = this.definition(id);
    return this.envelope({
      lineId, name,
      paths: [stops.map(([, , lat, lon]) => [lat, lon])],
      stations: stops.map(([id, name, lat, lon]) => ({ id, name, lat, lon, modes: [mode], lines: [lineId] })),
    });
  }
  async arrivals(stationId, lineId, mode) {
    if (!safeId(stationId)) throw new HttpError(400, 'A valid station id is required.');
    const [id, lineName, , stops] = this.definition(lineId, mode);
    if (!stops.some(stop => stop[0] === stationId)) throw new HttpError(404, 'Station is not on the selected demo line.');
    const minute = Math.floor(this.now() / 60_000) * 60_000;
    return this.envelope([2, 5, 8, 13].map((minutes, index) => ({
      id: `demo:${id}:${stationId}:${index}`, lineId: id, lineName,
      destination: index % 2 ? stops[0][1] : stops.at(-1)[1],
      platform: `Platform ${index % 2 + 1}`, expectedArrival: new Date(minute + minutes * 60_000).toISOString(),
      scheduled: false, cancelled: false, eventType: 'arrival',
    })));
  }
}
