export const londonTime = (date = new Date(), options = {}) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', ...options }).format(new Date(date));

export function isStale(envelope, now = Date.now(), maxAge = 90000) {
  const fetched = Date.parse(envelope?.fetchedAt);
  return Boolean(envelope?.stale) || !Number.isFinite(fetched) || now - fetched > maxAge;
}

export function arrivalTiming(arrival, envelope, now = Date.now()) {
  if (arrival.cancelled) return { value: 'Cancelled', label: 'Service update', small: true };
  const expected = Date.parse(arrival.expectedArrival);
  if (!Number.isFinite(expected)) return { value: '—', label: 'Time unavailable', small: false };
  if (isPredictionStale(arrival, envelope, now)) return { value: londonTime(expected), label: arrival.scheduled ? 'Saved schedule' : 'Saved prediction', small: true };
  if (arrival.scheduled) return { value: londonTime(expected), label: 'Scheduled', small: true };
  const seconds = (expected - now) / 1000;
  if (seconds < -60) return { value: londonTime(expected), label: 'Time passed', small: true };
  if (seconds <= 30) return { value: 'Due', label: 'Expected', small: false };
  return { value: String(Math.max(1, Math.round(seconds / 60))), label: 'min', small: false };
}

export function isPredictionStale(arrival, envelope, now = Date.now()) {
  const sourceTime = Date.parse(arrival.sourceTimestamp);
  return isStale(envelope, now) || (Number.isFinite(sourceTime) && now - sourceTime > 90000);
}

export function currentPredictions(arrivals, now = Date.now()) {
  return arrivals.filter(arrival => {
    const expected = Date.parse(arrival.expectedArrival);
    const validUntil = Date.parse(arrival.validUntil);
    return Number.isFinite(expected) && expected >= now - 60000 && (!Number.isFinite(validUntil) || validUntil > now);
  });
}

export function lineCondition(line) {
  const statuses = line?.statuses || [];
  const disruption = statuses.find(s => s.description && !/^(good service|normal service)$/i.test(s.description));
  if (disruption) return { text: disruption.description, type: 'disrupted' };
  if (statuses.length) return { text: statuses[0].description || 'Status unavailable', type: statuses[0].description ? 'good' : 'unknown' };
  return { text: 'Status unavailable', type: 'unknown' };
}

export function safeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#566b84';
}

export function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
