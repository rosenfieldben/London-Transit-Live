// Each cache entry has a finite fresh lifetime and a finite stale lifetime.
// Failures are briefly remembered, so an outage cannot turn every browser poll
// into another upstream request. Concurrent reads share the same promise.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class BoundedCache {
  constructor({ now = Date.now, maxEntries = 300, failureTtl = 10_000 } = {}) {
    this.now = now;
    this.maxEntries = maxEntries;
    this.failureTtl = failureTtl;
    this.entries = new Map();
    this.inflight = new Map();
  }

  remember(key, entry) {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  async get(key, { ttl, maxStale, source = 'tfl', load }) {
    const now = this.now();
    const entry = this.entries.get(key);
    const envelope = (value, stale, error) => ({
      source, fetchedAt: new Date(value.fetchedAt).toISOString(), stale,
      ...(error ? { error } : {}), data: value.data,
    });
    if (entry?.hasData && now < entry.expiresAt) return envelope(entry, false);
    if (entry && now < entry.retryAt) {
      if (entry.hasData && now < entry.staleUntil) return envelope(entry, true, entry.error.message);
      throw entry.error;
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (this.inflight.size >= 40) throw new HttpError(503, 'Service is busy. Please try again shortly.');
    const promise = (async () => {
      try {
        // Defer invocation so even a synchronous loader failure happens after
        // the in-flight promise is registered and can be removed in finally.
        const data = await Promise.resolve().then(load);
        const fetchedAt = this.now();
        const next = { hasData: true, data, fetchedAt, expiresAt: fetchedAt + ttl, staleUntil: fetchedAt + ttl + maxStale };
        this.remember(key, next);
        return envelope(next, false);
      } catch (cause) {
        // Never expose arbitrary fetch errors, which can contain credentials.
        const error = cause instanceof HttpError ? cause : new HttpError(502, 'TfL data is temporarily unavailable.');
        const next = { ...entry, error, retryAt: this.now() + this.failureTtl };
        if (next.staleUntil <= this.now()) {
          delete next.data;
          next.hasData = false;
        }
        this.remember(key, next);
        if (next.hasData && this.now() < next.staleUntil) return envelope(next, true, error.message);
        throw error;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }
}

export class TokenBucket {
  constructor({ capacity = 40, perMinute = 60, now = Date.now } = {}) {
    this.capacity = capacity;
    this.perMs = perMinute / 60_000;
    this.tokens = capacity;
    this.now = now;
    this.updated = now();
  }
  take() {
    const now = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.updated) * this.perMs);
    this.updated = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
