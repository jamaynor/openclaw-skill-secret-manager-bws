'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  globMatch,
  buildKeyIndex,
  buildProjectIndex,
  buildProjectIdMap,
} = require('../lib/secrets-bws-helpers');

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

// ---------------------------------------------------------------------------
// parseInjections
// ---------------------------------------------------------------------------
describe('parseInjections', () => {
  const { parseInjections } = require('../lib/secrets-bws-wrapper-commands');

  it('parses single --env injection correctly', () => {
    const result = parseInjections(['--secret', 'MY_KEY', '--env', 'MY_VAR']);
    assert.deepEqual(result, [{ bwsKey: 'MY_KEY', mode: 'env', target: 'MY_VAR' }]);
  });

  it('parses single --arg injection correctly', () => {
    const result = parseInjections(['--secret', 'MY_KEY', '--arg', '--flag']);
    assert.deepEqual(result, [{ bwsKey: 'MY_KEY', mode: 'arg', target: '--flag' }]);
  });

  it('parses multiple injections', () => {
    const result = parseInjections([
      '--secret', 'KEY1', '--env', 'VAR1',
      '--secret', 'KEY2', '--arg', '--flag2',
    ]);
    assert.deepEqual(result, [
      { bwsKey: 'KEY1', mode: 'env', target: 'VAR1' },
      { bwsKey: 'KEY2', mode: 'arg', target: '--flag2' },
    ]);
  });

  it('throws when --secret has no following key', () => {
    assert.throws(
      () => parseInjections(['--secret']),
      /--secret requires a key/
    );
  });

  it('throws when mode flag is neither --env nor --arg', () => {
    assert.throws(
      () => parseInjections(['--secret', 'KEY', '--bad', 'target']),
      /Expected --env or --arg/
    );
  });

  it('throws on unexpected argument', () => {
    assert.throws(
      () => parseInjections(['--unknown']),
      /Unexpected argument/
    );
  });

  it('throws when injections list is empty (empty input)', () => {
    assert.throws(
      () => parseInjections([]),
      /No --secret injections/
    );
  });

  it('throws when --secret is missing its target (bwsKey and modeFlag present, target absent)', () => {
    assert.throws(
      () => parseInjections(['--secret', 'KEY', '--env']),
      /--secret requires a key/
    );
  });
});
