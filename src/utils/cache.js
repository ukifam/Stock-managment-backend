// Simple in-memory cache with TTL (Time To Live)
const cache = new Map();
const { currentTenant } = require('./tenantContext')

function scopedKey(key) {
  return `${currentTenant().ownerKey}:${key}`
}

class CacheManager {
  /**
   * Set a cache value with optional TTL in milliseconds
   */
  static set(key, value, ttlMs = 60000) {
    const keyToStore = scopedKey(key)
    // Default 60 seconds
    if (cache.has(keyToStore)) {
      clearTimeout(cache.get(keyToStore).timeoutId);
    }

    const timeoutId = setTimeout(() => {
      cache.delete(keyToStore);
    }, ttlMs);

    cache.set(keyToStore, { value, timeoutId });
  }

  /**
   * Get a cache value
   */
  static get(key) {
    const item = cache.get(scopedKey(key));
    return item ? item.value : null;
  }

  /**
   * Check if key exists
   */
  static has(key) {
    return cache.has(scopedKey(key));
  }

  /**
   * Delete a specific key
   */
  static delete(key) {
    const keyToDelete = scopedKey(key)
    const item = cache.get(keyToDelete);
    if (item) {
      clearTimeout(item.timeoutId);
      cache.delete(keyToDelete);
    }
  }

  /**
   * Clear all cache
   */
  static clear() {
    cache.forEach((item) => clearTimeout(item.timeoutId));
    cache.clear();
  }

  /**
   * Get cache size
   */
  static size() {
    return cache.size;
  }
}

module.exports = CacheManager;
