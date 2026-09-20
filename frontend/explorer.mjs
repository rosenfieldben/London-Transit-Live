const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/.test(value);
const textKey = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const favouriteKey = value => `${value.lineId}:${value.stationId}`;

// Only exact provider stop IDs are grouped. Names, coordinates and advertised
// stop.lines are not evidence that two boards or service memberships coincide.
export function stationIndex(lines, routes) {
  const stations = new Map();
  for (const line of lines) for (const stop of routes.get(line.id)?.data?.stations || []) {
    if (!validId(stop.id)) continue;
    if (!stations.has(stop.id)) stations.set(stop.id, { ...stop, aliases: new Set(), services: [] });
    const entry = stations.get(stop.id);
    entry.aliases.add(stop.name);
    if (!entry.services.some(service => service.lineId === line.id)) entry.services.push({ lineId: line.id, stationId: stop.id, lineName: line.name, name: stop.name, mode: line.mode, boardProvider: line.boardProvider || 'tfl' });
  }
  return [...stations.values()].map(entry => ({ ...entry, search: textKey([...entry.aliases].join(' ')), services: entry.services.sort((a, b) => a.lineName.localeCompare(b.lineName)) })).sort((a, b) => a.name.localeCompare(b.name));
}

export function searchStations(index, query) {
  const words = textKey(query).split(' ').filter(Boolean);
  return index.filter(stop => words.every(word => stop.search.split(' ').some(token => token.startsWith(word))));
}

export function readFavourites(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) return [];
    const unique = new Map();
    for (const item of parsed.items.slice(0, 200)) {
      if (!validId(item?.lineId) || !validId(item?.stationId) || typeof item.name !== 'string' || typeof item.lineName !== 'string') continue;
      unique.set(favouriteKey(item), { lineId: item.lineId, stationId: item.stationId, name: item.name.slice(0, 160), lineName: item.lineName.slice(0, 100) });
      if (unique.size === 50) break;
    }
    return [...unique.values()];
  } catch { return []; }
}

export function parseView(hash) {
  const params = new URLSearchParams(String(hash).replace(/^#/, '').slice(0, 12000));
  const modes = ['all', 'tube', 'dlr', 'overground', 'elizabeth-line', 'national-rail'];
  const lineId = validId(params.get('line')) ? params.get('line') : null;
  const lat = Number(params.get('lat')), lon = Number(params.get('lon')), zoom = Number(params.get('zoom'));
  return {
    mode: modes.includes(params.get('mode')) ? params.get('mode') : 'all',
    mapView: params.get('view') === 'line' ? 'line' : 'network',
    mapArea: params.get('area') === 'london' ? 'london' : 'england',
    lineId, stationId: lineId && validId(params.get('station')) ? params.get('station') : null,
    hiddenLines: new Set((params.get('hidden') || '').split(',').filter(validId).slice(0, 100)),
    camera: params.has('lat') && params.has('lon') && params.has('zoom') && lat >= 49 && lat <= 61 && lon >= -9 && lon <= 3 && zoom >= 4 && zoom <= 19 ? { lat, lon, zoom } : null,
  };
}

export function viewHash(state, camera) {
  const params = new URLSearchParams({ area: state.mapArea, view: state.mapView, mode: state.mode });
  if (validId(state.lineId)) { params.set('line', state.lineId); if (validId(state.stationId)) params.set('station', state.stationId); }
  const hidden = [...state.hiddenLines].filter(validId).sort();
  if (hidden.length) params.set('hidden', hidden.join(','));
  if (camera) { params.set('lat', camera.lat.toFixed(5)); params.set('lon', camera.lon.toFixed(5)); params.set('zoom', String(camera.zoom)); }
  return '#' + params;
}
