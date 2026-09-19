// One queue shared by network loading and line selection. Geometry is requested
// at most twice concurrently and never refetched by the service-status timer.
export class RouteStore {
  constructor(load, { concurrency = 2, now = Date.now, ttl = 86400000 } = {}) {
    this.load = load; this.concurrency = concurrency; this.now = now; this.ttl = ttl;
    this.cache = new Map(); this.pending = new Map(); this.queue = []; this.active = 0;
  }
  peek(id) {
    const entry = this.cache.get(id);
    return entry && entry.expiresAt > this.now() ? entry.value : null;
  }
  get(id, { priority = false, force = false } = {}) {
    const cached = this.peek(id);
    if (cached && !force) return Promise.resolve(cached);
    if (this.pending.has(id)) {
      if (priority) {
        const index = this.queue.findIndex(job => job.id === id);
        if (index > 0) this.queue.unshift(...this.queue.splice(index, 1));
      }
      return this.pending.get(id);
    }
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    this.pending.set(id, promise);
    const job = { id, resolve, reject };
    priority ? this.queue.unshift(job) : this.queue.push(job);
    this.drain();
    return promise;
  }
  drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift(); this.active++;
      Promise.resolve().then(() => this.load(job.id)).then(value => {
        this.cache.set(job.id, { value, expiresAt: this.now() + (value.stale ? 60000 : this.ttl) });
        job.resolve(value);
      }, job.reject).finally(() => {
        this.active--; this.pending.delete(job.id); this.drain();
      });
    }
  }
}

export function visibleLines(lines, mode) {
  return lines.filter(line => mode === 'all' || line.mode === mode);
}

export function networkSummary(lines, routes, errors) {
  const loaded = lines.filter(line => routes.has(line.id));
  return { total: lines.length, loaded: loaded.length,
    failed: lines.filter(line => errors.has(line.id)).length,
    stale: loaded.filter(line => routes.get(line.id).stale).length };
}
