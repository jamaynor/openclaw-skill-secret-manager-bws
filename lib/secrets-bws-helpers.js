/**
 * secrets-bws-helpers
 *
 * Responsibility: Provides pure utility functions for glob pattern matching
 * and index construction shared across all secrets-bws command modules.
 *
 * Public Interface:
 * secrets-bws-helpers
 * ├── globMatch(pattern: string, str: string): boolean
 * ├── buildKeyIndex(listData: object[]): Record<string, object>
 * ├── buildProjectIndex(listData: object[]): Record<string, object>
 * └── buildProjectIdMap(listData: object[]): Record<string, string>
 */

/**
 * Match a string against a glob pattern. Supports * as wildcard.
 * Case-insensitive.
 */
function globMatch(pattern, str) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(str);
}

/** Build a key → entry index from a secrets list response (first match wins). */
function buildKeyIndex(listData) {
  const index = {};
  for (const entry of listData) {
    if (!(entry.key in index)) index[entry.key] = entry;
  }
  return index;
}

/** Build a name → entry index from a projects list response (first match wins). */
function buildProjectIndex(listData) {
  const index = {};
  for (const entry of listData) {
    if (!(entry.name in index)) index[entry.name] = entry;
  }
  return index;
}

/** Build a projectId → name map. */
function buildProjectIdMap(listData) {
  const map = {};
  for (const entry of listData) map[entry.id] = entry.name;
  return map;
}

export {
  globMatch,
  buildKeyIndex,
  buildProjectIndex,
  buildProjectIdMap,
};
