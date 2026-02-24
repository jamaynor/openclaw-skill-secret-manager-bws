'use strict';

// Flags that take no value — everything else consumes the next arg as its value.
const BOOLEAN_FLAGS = new Set(['json']);

/**
 * Parse --flag value pairs out of an args array, returning { flags, rest }.
 * Flags in BOOLEAN_FLAGS are treated as boolean switches.
 * All other flags consume the next arg as their value.
 */
function parseFlags(args) {
  const flags = {};
  const rest  = [];
  let i = 0;
  while (i < args.length) {
    if (args[i].startsWith('--')) {
      const flag = args[i].slice(2);
      if (BOOLEAN_FLAGS.has(flag) || args[i + 1] === undefined) {
        flags[flag] = true;
        i += 1;
      } else {
        flags[flag] = args[i + 1];
        i += 2;
      }
    } else {
      rest.push(args[i]);
      i++;
    }
  }
  return { flags, rest };
}

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

module.exports = {
  BOOLEAN_FLAGS,
  parseFlags,
  globMatch,
  buildKeyIndex,
  buildProjectIndex,
  buildProjectIdMap,
};
