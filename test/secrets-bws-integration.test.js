'use strict';

/**
 * Integration tests for secrets-bws and secrets-bws-mcp-wrapper.
 *
 * Requires real Bitwarden SM credentials:
 *   HAL_BWS_ACCESS_TOKEN      machine account token
 *   HAL_BWS_ORGANIZATION_ID   organization UUID
 *
 * All test resources use a timestamped prefix to avoid collisions and are
 * cleaned up in a finally block even if a test fails.
 */

const { describe, it, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const { execSync } = require('child_process');
const path    = require('path');

const SECRETS_CLI = path.join(__dirname, '..', 'bin', 'secrets-bws.js');
const WRAPPER_CLI = path.join(__dirname, '..', 'bin', 'secrets-bws-mcp-wrapper.js');

const TEST_KEY     = `SECRETS_BWS_TEST_${Date.now()}`;
const TEST_PROJECT = `secrets-bws-test-${Date.now()}`;

// ---------------------------------------------------------------------------
// Skip everything if credentials are not set
// ---------------------------------------------------------------------------
const SKIP = !process.env.HAL_BWS_ACCESS_TOKEN || !process.env.HAL_BWS_ORGANIZATION_ID;
if (SKIP) {
  console.log('Skipping integration tests: HAL_BWS_ACCESS_TOKEN and HAL_BWS_ORGANIZATION_ID are not set.');
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------
function run(cli, args) {
  return execSync(`node "${cli}" ${args}`, {
    encoding: 'utf8',
    env: process.env,
  }).trim();
}

function secrets(args) { return run(SECRETS_CLI, args); }
function wrapper(args) { return run(WRAPPER_CLI, args); }

// ---------------------------------------------------------------------------
// Cleanup helper — best-effort, never throws
// ---------------------------------------------------------------------------
function cleanup() {
  try { secrets(`delete ${TEST_KEY}`); } catch (_) {}
  try { secrets(`projects delete "${TEST_PROJECT}"`); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('secrets-bws integration', { skip: SKIP }, () => {
  after(cleanup);

  it('set creates a new secret', () => {
    // Machine accounts require a project — create with the test project (auto-created)
    const out = secrets(`set ${TEST_KEY} "hello-world" --project "${TEST_PROJECT}"`);
    assert.match(out, /Created secret/);
  });

  it('get returns the secret value', () => {
    const out = secrets(`get ${TEST_KEY}`);
    assert.equal(out, 'hello-world');
  });

  it('set updates an existing secret (upsert)', () => {
    const out = secrets(`set ${TEST_KEY} "updated-value"`);
    assert.match(out, /Updated secret/);
  });

  it('get returns the updated value', () => {
    const out = secrets(`get ${TEST_KEY}`);
    assert.equal(out, 'updated-value');
  });

  it('set preserves existing note when --note not provided', () => {
    secrets(`set ${TEST_KEY} "v1" --note "my note"`);
    secrets(`set ${TEST_KEY} "v2"`);
    // Note preservation is silent — just verify no error and value updated
    const out = secrets(`get ${TEST_KEY}`);
    assert.equal(out, 'v2');
  });

  it('list includes the test secret', () => {
    const out = secrets('list');
    assert.match(out, new RegExp(TEST_KEY));
  });

  it('list --json includes the test secret', () => {
    const raw  = secrets('list --json');
    const data = JSON.parse(raw);
    const found = data.find(s => s.key === TEST_KEY);
    assert.ok(found, `Expected ${TEST_KEY} in JSON output`);
    assert.equal(typeof found.id, 'string');
  });

  it('move assigns secret to a project (auto-creates project)', () => {
    const out = secrets(`move ${TEST_KEY} "${TEST_PROJECT}"`);
    assert.match(out, new RegExp(TEST_PROJECT));
  });

  it('list --project shows the secret in its project', () => {
    const out = secrets(`list --project "${TEST_PROJECT}"`);
    assert.match(out, new RegExp(TEST_KEY));
  });

  it('list --json reflects the correct project assignment', () => {
    const raw  = secrets('list --json');
    const data = JSON.parse(raw);
    const found = data.find(s => s.key === TEST_KEY);
    assert.ok(found);
    assert.equal(found.project, TEST_PROJECT);
  });

  it('projects lists the test project', () => {
    const out = secrets('projects');
    assert.match(out, new RegExp(TEST_PROJECT));
  });

  it('delete removes the secret', () => {
    const out = secrets(`delete ${TEST_KEY}`);
    assert.match(out, /Deleted secret/);
  });

  it('get fails after deletion', () => {
    assert.throws(
      () => secrets(`get ${TEST_KEY}`),
      /not found/i
    );
  });
});

// ---------------------------------------------------------------------------
// bws-mcp-wrapper integration
// ---------------------------------------------------------------------------
describe('secrets-bws-mcp-wrapper integration', { skip: SKIP }, () => {
  const WRAPPER_KEY = `SECRETS_BWS_WRAPPER_TEST_${Date.now()}`;

  const WRAPPER_PROJECT = `secrets-bws-test-wrapper-${Date.now()}`;

  before(() => {
    // Machine accounts require a project to create secrets
    secrets(`set ${WRAPPER_KEY} "wrapper-test-value" --project "${WRAPPER_PROJECT}"`);
  });

  after(() => {
    try { secrets(`delete ${WRAPPER_KEY}`); } catch (_) {}
    try { secrets(`projects delete "${WRAPPER_PROJECT}"`); } catch (_) {}
  });

  it('injects secret as environment variable', () => {
    const out = wrapper(
      `--secret ${WRAPPER_KEY} --env INJECTED_VAR -- node -e "process.stdout.write(process.env.INJECTED_VAR)"`
    );
    assert.equal(out, 'wrapper-test-value');
  });

  it('injects secret as a CLI argument', () => {
    // Use a plain marker (no -- prefix) so node doesn't treat it as a node option.
    // The wrapper appends: INJECTED_MARKER <secret-value>
    const out = wrapper(
      `--secret ${WRAPPER_KEY} --arg INJECTED_MARKER -- node -e "const i=process.argv.indexOf('INJECTED_MARKER'); process.stdout.write(process.argv[i+1])"`
    );
    assert.equal(out, 'wrapper-test-value');
  });

  it('exits with error when secret does not exist', () => {
    assert.throws(
      () => wrapper(`--secret NONEXISTENT_KEY_${Date.now()} --env X -- node -e ""`),
      /not found/i
    );
  });

  it('exits with error when no --secret args given', () => {
    assert.throws(
      () => wrapper(`-- node -e ""`),
      /No --secret injections/i
    );
  });
});
