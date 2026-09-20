const validPoint = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[0] >= 49 && point[0] <= 61 && point[1] >= -9 && point[1] <= 3;

// Bounds always use full route geometry, never the decluttered station layer.
export function routeBounds(routes) {
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  const include = point => { south = Math.min(south, point[0]); north = Math.max(north, point[0]); west = Math.min(west, point[1]); east = Math.max(east, point[1]); };
  for (const route of routes) {
    let hasGeometry = false;
    for (const path of route?.paths || []) for (const point of path) if (validPoint(point)) { include(point); hasGeometry = true; }
    if (!hasGeometry) for (const stop of route?.stations || []) if (validPoint([stop.lat, stop.lon])) include([stop.lat, stop.lon]);
  }
  return Number.isFinite(south) ? [[south, west], [north, east]] : null;
}

// TfL repeats shared branch segments in both directions. Paint each exact edge
// once per service, without simplifying coordinates or joining separate branches.
export function distinctPaths(paths) {
  const seen = new Set(), result = [];
  const key = point => `${point[0]},${point[1]}`;
  for (const path of paths || []) {
    let previous = null, run = [];
    const flush = () => { if (run.length > 1) result.push(run); run = []; };
    for (const point of path) {
      if (!validPoint(point)) { flush(); previous = null; continue; }
      if (previous) {
        const a = key(previous), b = key(point), edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (a !== b && !seen.has(edge)) { if (!run.length) run.push(previous); run.push(point); seen.add(edge); }
        else flush();
      }
      previous = point;
    }
    flush();
  }
  return result;
}

// At most an initial fit and a settled fit for one explicit user intent.
// Polling cannot start a new intent; manual exploration cancels it.
export class AutoFrame {
  request(key) { this.intent = { key, bounds: null }; }
  cancel() { this.intent = null; }
  take(key, bounds, pending) {
    const intent = this.intent;
    if (!intent || intent.key !== key) return null;
    if (!bounds) { if (!pending) this.cancel(); return null; }
    if (pending && intent.bounds) return null;
    const changed = JSON.stringify(bounds) !== intent.bounds;
    intent.bounds = JSON.stringify(bounds);
    if (!pending) this.cancel();
    return changed ? bounds : null;
  }
}

export function spacedStations(points, selectedId, { width, height, gap = 22 }) {
  const cells = new Map(), chosen = [];
  const candidates = [...points].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId));
  for (const point of candidates) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < -15 || point.y < -15 || point.x > width + 15 || point.y > height + 15) continue;
    const cx = Math.floor(point.x / gap), cy = Math.floor(point.y / gap);
    let overlaps = false;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (const other of cells.get(`${x}:${y}`) || []) {
      if (Math.hypot(point.x - other.x, point.y - other.y) < gap) overlaps = true;
    }
    if (overlaps && point.id !== selectedId) continue;
    const cell = `${cx}:${cy}`;
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell).push(point); chosen.push(point);
  }
  return chosen;
}

export function stationLabels(points, selectedId, { width, height, zoom }) {
  const labels = new Map(), boxes = [[0, 0, 52, 100], [0, height - 65, width, height]];
  for (const point of points) {
    const selected = point.id === selectedId;
    if (!selected && (zoom < 10 || labels.size >= 18)) continue;
    const labelWidth = Math.min(205, point.name.length * 6.8 + 16);
    for (const direction of ['right', 'left']) {
      const left = direction === 'right' ? point.x + 11 : point.x - 11 - labelWidth;
      const box = [left, point.y - 14, left + labelWidth, point.y + 14];
      if (box[0] < 8 || box[2] > width - 8 || box[1] < 8 || box[3] > height - 8) continue;
      if (!selected && boxes.some(other => box[0] < other[2] + 8 && box[2] > other[0] - 8 && box[1] < other[3] + 5 && box[3] > other[1] - 5)) continue;
      labels.set(point.id, direction); boxes.push(box); break;
    }
  }
  return labels;
}
