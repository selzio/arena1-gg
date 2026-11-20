// Immutable resource packs are shared by demos and retained across page reloads.
const CACHE_NAME = 'arena1-resource-packs-v1';
const MAX_CACHE_BYTES = 384 * 1024 ** 2;

export class ResourceCache {
  constructor({storage = globalThis.caches, fetcher = (...args) => globalThis.fetch(...args), report = () => {}} = {}) {
    this.storage = storage;
    this.fetcher = fetcher;
    this.report = report;
  }
  async read(url, {size = 0, label = 'game files', progress = () => {}} = {}) {
    let cache;
    try { cache = await this.storage?.open(CACHE_NAME); } catch { /* HTTP cache still applies. */ }
    if (cache) {
      try {
        const saved = await cache.match(url);
        if (saved) {
          const bytes = new Uint8Array(await saved.arrayBuffer());
          if (!size || bytes.length === size) {
            progress('Loading', 100);
            return bytes;
          }
          await cache.delete(url);
        }
      } catch { /* A blocked/evicted cache must not prevent playback. */ }
    }
    progress('Loading', 0);
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`Could not load ${label}: ${response.status}`);
    const total = size || Number(response.headers.get('Content-Length')) || 0;
    const reader = response.body.getReader();
    // Allocate once for known-size packs instead of holding chunks + a second copy.
    const buffer = total ? new Uint8Array(total) : null;
    const chunks = []; let received = 0, lastUpdate = 0;
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      if (buffer) {
        if (received + value.length > total) {
          await reader.cancel();
          throw new Error(`Invalid size for ${label}. Please try again.`);
        }
        buffer.set(value, received);
      } else chunks.push(value);
      received += value.length;
      if (Date.now() - lastUpdate >= 100) {
        progress('Loading', total ? received / total * 100 : null);
        lastUpdate = Date.now();
      }
    }
    if (total && received !== total) throw new Error(`Incomplete download of ${label}. Please try again.`);
    const bytes = buffer || new Uint8Array(received);
    if (!buffer) { let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } }
    if (cache && bytes.length <= MAX_CACHE_BYTES) {
      try {
        // Bound disk usage; new content hashes retire the oldest packs first.
        const keys = await cache.keys();
        let used = 0; const entries = [];
        for (const key of keys) {
          const entry = await cache.match(key);
          const length = Number(entry?.headers.get('Content-Length')) || 0;
          entries.push([key, length]); used += length;
        }
        for (const [key, length] of entries) {
          if (used + bytes.length <= MAX_CACHE_BYTES) break;
          await cache.delete(key); used -= length;
        }
        await cache.put(url, new Response(bytes, {headers: {
          'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length)
        }}));
      } catch { this.report('Browser storage unavailable; using the HTTP cache.'); }
    }
    progress('Loading', 100);
    return bytes;
  }
}
