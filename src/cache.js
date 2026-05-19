const NodeCache = require('node-cache');

const TTL = parseInt(process.env.CACHE_TTL ?? '60');
const c = new NodeCache({ stdTTL: TTL, useClones: false });

module.exports = {
  async getOrFetch(key, fetchFn) {
    const hit = c.get(key);
    if (hit) return hit;
    const value = await fetchFn();
    if (TTL > 0) c.set(key, value);
    return value;
  },
  flush() {
    c.flushAll();
  },
};
