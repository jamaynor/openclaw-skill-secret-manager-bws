'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseFlags,
  globMatch,
  buildKeyIndex,
  buildProjectIndex,
  buildProjectIdMap,
} = require('../lib/secrets-bws-helpers');

// ---------------------------------------------------------------------------
// parseFlags
// ---------------------------------------------------------------------------
describe('parseFlags', () => {
  it('parses a value flag', () => {
    const { flags, rest } = parseFlags(['--project', 'my-project']);
    assert.equal(flags.project, 'my-project');
    assert.deepEqual(rest, []);
  });

  it('parses a boolean flag (--json)', () => {
    const { flags, rest } = parseFlags(['--json']);
    assert.equal(flags.json, true);
    assert.deepEqual(rest, []);
  });

  it('throws when a value-taking flag has no value', () => {
    assert.throws(
      () => parseFlags(['--note']),
      /--note requires a value/
    );
  });

  it('boolean flags still work with no value (--json)', () => {
    const { flags } = parseFlags(['--json']);
    assert.equal(flags.json, true);
  });

  it('collects positional args into rest', () => {
    const { flags, rest } = parseFlags(['MY_KEY', 'my-value']);
    assert.deepEqual(rest, ['MY_KEY', 'my-value']);
    assert.deepEqual(flags, {});
  });

  it('mixes positional and flag args', () => {
    const { flags, rest } = parseFlags(['MY_KEY', 'my-value', '--project', 'prod', '--json']);
    assert.deepEqual(rest, ['MY_KEY', 'my-value']);
    assert.equal(flags.project, 'prod');
    assert.equal(flags.json, true);
  });

  it('handles flag value that starts with --', () => {
    // --note is not in BOOLEAN_FLAGS so the next arg is always consumed as the value
    const { flags } = parseFlags(['--note', '--looks-like-a-flag']);
    assert.equal(flags.note, '--looks-like-a-flag');
  });

  it('handles multiple value flags', () => {
    const { flags } = parseFlags(['--project', 'prod', '--note', 'a secret']);
    assert.equal(flags.project, 'prod');
    assert.equal(flags.note, 'a secret');
  });

  it('returns empty flags and rest for empty input', () => {
    const { flags, rest } = parseFlags([]);
    assert.deepEqual(flags, {});
    assert.deepEqual(rest, []);
  });
});

// ---------------------------------------------------------------------------
// globMatch
// ---------------------------------------------------------------------------
describe('globMatch', () => {
  it('matches exact key with no wildcard', () => {
    assert.equal(globMatch('MY_KEY', 'MY_KEY'), true);
  });

  it('rejects non-matching exact pattern', () => {
    assert.equal(globMatch('MY_KEY', 'OTHER_KEY'), false);
  });

  it('matches prefix wildcard LMB_*', () => {
    assert.equal(globMatch('LMB_*', 'LMB_DB_URL'), true);
    assert.equal(globMatch('LMB_*', 'LMB_API_KEY'), true);
    assert.equal(globMatch('LMB_*', 'STRAT_DB_URL'), false);
  });

  it('matches suffix wildcard *_URL', () => {
    assert.equal(globMatch('*_URL', 'LMB_DB_URL'), true);
    assert.equal(globMatch('*_URL', 'STRAT_DB_URL'), true);
    assert.equal(globMatch('*_URL', 'LMB_API_KEY'), false);
  });

  it('matches mid-string wildcard *metrics*', () => {
    assert.equal(globMatch('*metrics*', 'LMB_METRICS_DB_URL'), true);
    assert.equal(globMatch('*metrics*', 'SOME_METRICS_KEY'), true);
    assert.equal(globMatch('*metrics*', 'LMB_DB_URL'), false);
  });

  it('is case-insensitive', () => {
    assert.equal(globMatch('lmb_*', 'LMB_DB_URL'), true);
    assert.equal(globMatch('LMB_*', 'lmb_db_url'), true);
    assert.equal(globMatch('*METRICS*', 'lmb_metrics_key'), true);
  });

  it('matches bare * against anything', () => {
    assert.equal(globMatch('*', 'ANYTHING'), true);
    assert.equal(globMatch('*', ''), true);
  });

  it('escapes regex special characters in pattern', () => {
    // A key with dots should not be treated as regex dot (match-any)
    assert.equal(globMatch('MY.KEY', 'MY.KEY'), true);
    assert.equal(globMatch('MY.KEY', 'MYXKEY'), false);
  });
});

// ---------------------------------------------------------------------------
// buildKeyIndex
// ---------------------------------------------------------------------------
describe('buildKeyIndex', () => {
  it('indexes entries by key', () => {
    const data = [
      { key: 'DB_URL', id: '1' },
      { key: 'API_KEY', id: '2' },
    ];
    const index = buildKeyIndex(data);
    assert.equal(index['DB_URL'].id, '1');
    assert.equal(index['API_KEY'].id, '2');
  });

  it('first match wins on duplicate keys', () => {
    const data = [
      { key: 'DB_URL', id: 'first' },
      { key: 'DB_URL', id: 'second' },
    ];
    const index = buildKeyIndex(data);
    assert.equal(index['DB_URL'].id, 'first');
  });

  it('returns empty object for empty input', () => {
    assert.deepEqual(buildKeyIndex([]), {});
  });
});

// ---------------------------------------------------------------------------
// buildProjectIndex
// ---------------------------------------------------------------------------
describe('buildProjectIndex', () => {
  it('indexes projects by name', () => {
    const data = [
      { name: 'strategy', id: 'p1' },
      { name: 'payments', id: 'p2' },
    ];
    const index = buildProjectIndex(data);
    assert.equal(index['strategy'].id, 'p1');
    assert.equal(index['payments'].id, 'p2');
  });

  it('first match wins on duplicate names', () => {
    const data = [
      { name: 'strategy', id: 'first' },
      { name: 'strategy', id: 'second' },
    ];
    const index = buildProjectIndex(data);
    assert.equal(index['strategy'].id, 'first');
  });

  it('returns empty object for empty input', () => {
    assert.deepEqual(buildProjectIndex([]), {});
  });
});

// ---------------------------------------------------------------------------
// buildProjectIdMap
// ---------------------------------------------------------------------------
describe('buildProjectIdMap', () => {
  it('maps project id to name', () => {
    const data = [
      { id: 'p1', name: 'strategy' },
      { id: 'p2', name: 'payments' },
    ];
    const map = buildProjectIdMap(data);
    assert.equal(map['p1'], 'strategy');
    assert.equal(map['p2'], 'payments');
  });

  it('later entries overwrite earlier on duplicate ids', () => {
    const data = [
      { id: 'p1', name: 'first' },
      { id: 'p1', name: 'second' },
    ];
    const map = buildProjectIdMap(data);
    assert.equal(map['p1'], 'second');
  });

  it('returns empty object for empty input', () => {
    assert.deepEqual(buildProjectIdMap([]), {});
  });
});
