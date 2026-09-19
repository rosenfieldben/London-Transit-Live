import { TflService, safeId } from './tfl.mjs';
import { NationalRailService } from './national-rail.mjs';
import { HttpError } from './cache.mjs';

export class TransitService extends TflService {
  constructor({ nationalRailKey = '', nationalRailBase = '', nationalRail, ...options } = {}) {
    super(options);
    this.nationalRail = nationalRail || new NationalRailService({ apiKey: nationalRailKey, apiBase: nationalRailBase, now: options.now, fetchImpl: options.fetchImpl });
  }
  get nationalRailConfigured() { return this.nationalRail.configured; }
  async arrivals(stationId, lineId, mode) {
    if (!safeId(stationId)) throw new HttpError(400, 'A valid station id is required.');
    const line = await this.line(lineId, mode);
    if (line.boardProvider !== 'national-rail') return super.arrivals(stationId, lineId, mode);
    const route = await this.route(lineId);
    const station = route.data.stations.find(item => item.id === stationId);
    if (!station) throw new HttpError(404, 'Station is not on the selected line.');
    try { return await this.nationalRail.board(station); }
    catch (error) { error.source = 'national-rail'; throw error; }
  }
}
