// Simple in-memory cache with TTL (Time To Live)
const cache = new Map();

class CacheManager {
  /**
   * Set a cache value with optional TTL in milliseconds
   */
  static set(key, value, ttlMs = 60000) {
    // Default 60 seconds
    if (cache.has(key)) {
      clearTimeout(cache.get(key).timeoutId);
    }

    const timeoutId = setTimeout(() => {
      cache.delete(key);
    }, ttlMs);

    cache.set(key, { value, timeoutId });
  }

  /**
   * Get a cache value
   */
  static get(key) {
    const item = cache.get(key);
    return item ? item.value : null;
  }

  /**
   * Check if key exists
   */
  static has(key) {
    return cache.has(key);
  }

  /**
   * Delete a specific key
   */
  static delete(key) {
    const item = cache.get(key);
    if (item) {
      clearTimeout(item.timeoutId);
      cache.delete(key);
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
