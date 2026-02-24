#!/usr/bin/env node
/**
 * secrets-bws-mcp-wrapper
 *
 * Fetches secrets from Bitwarden Secrets Manager at runtime and injects them
 * into an MCP server process — as env vars or CLI arguments.
 *
 * Usage:
 *   bws-mcp-wrapper --secret KEY --env VAR_NAME -- npx some-mcp-server
 *   bws-mcp-wrapper --secret KEY --arg --connection-string -- npx some-mcp-server
 *   bws-mcp-wrapper --secret K1 --env V1 --secret K2 --env V2 -- npx some-mcp-server
 *
 * Required environment variables:
 *   BWS_ACCESS_TOKEN      Bitwarden SM machine account token
 *   BWS_ORGANIZATION_ID   Bitwarden organization UUID
 */

'use strict';

const { spawn } = require('child_process');
const { createClient, getOrgId } = require('../lib/secrets-bws-client');

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
const rawArgs = process.argv.slice(2);
const separatorIdx = rawArgs.indexOf('--');

if (separatorIdx === -1) {
  console.error('ERROR: Missing -- separator before server command');
  console.error('Usage: bws-mcp-wrapper [--secret KEY (--env VAR | --arg FLAG)]... -- <command> [args...]');
  process.exit(1);
}

const wrapperArgs = rawArgs.slice(0, separatorIdx);
const serverCmd   = rawArgs.slice(separatorIdx + 1);

if (serverCmd.length === 0) {
  console.error('ERROR: No server command specified after --');
  process.exit(1);
}

// Parse injections: one or more (--secret KEY --env VAR | --secret KEY --arg FLAG)
const injections = []; // [{ bwsKey, mode: 'env'|'arg', target }]
let i = 0;
while (i < wrapperArgs.length) {
  if (wrapperArgs[i] === '--secret') {
    const bwsKey   = wrapperArgs[i + 1];
    const modeFlag = wrapperArgs[i + 2];
    const target   = wrapperArgs[i + 3];
    if (!bwsKey || !modeFlag || !target) {
      console.error('ERROR: --secret requires a key followed by --env <VAR> or --arg <FLAG>');
      process.exit(1);
    }
    if (modeFlag !== '--env' && modeFlag !== '--arg') {
      console.error(`ERROR: Expected --env or --arg after --secret, got: ${modeFlag}`);
      process.exit(1);
    }
    injections.push({ bwsKey, mode: modeFlag === '--env' ? 'env' : 'arg', target });
    i += 4;
  } else {
    console.error(`ERROR: Unexpected argument: ${wrapperArgs[i]}`);
    process.exit(1);
  }
}

if (injections.length === 0) {
  console.error('ERROR: No --secret injections specified. At least one --secret KEY (--env VAR | --arg FLAG) is required.');
  console.error('Usage: bws-mcp-wrapper [--secret KEY (--env VAR | --arg FLAG)]... -- <command> [args...]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fetch secrets from BWS via SDK
// ---------------------------------------------------------------------------
async function fetchSecrets(keys) {
  const orgId  = getOrgId();
  const client = await createClient();

  // sync() returns full secret detail (key + value) in a single API call
  const synced = await client.secrets().sync(orgId);
  const all    = synced.secrets ?? [];

  // Build key → value index (first match wins on duplicate keys)
  const index = {};
  for (const s of all) {
    if (!(s.key in index)) index[s.key] = s.value;
  }

  // Validate all requested keys exist
  for (const key of keys) {
    if (!(key in index)) {
      console.error(`ERROR: Secret '${key}' not found in Bitwarden SM`);
      process.exit(1);
    }
  }

  const result = {};
  for (const key of keys) result[key] = index[key];
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const neededKeys  = injections.map(inj => inj.bwsKey);
  const secretValues = await fetchSecrets(neededKeys);

  const env       = { ...process.env };
  const extraArgs = [];

  for (const { bwsKey, mode, target } of injections) {
    const value = secretValues[bwsKey];
    if (mode === 'env') {
      env[target] = value;
    } else {
      extraArgs.push(target, value);
    }
  }

  const [cmd, ...args] = serverCmd;
  const finalArgs = [...args, ...extraArgs];

  const child = spawn(cmd, finalArgs, {
    env,
    stdio: 'inherit',
    shell: false,
  });

  child.on('error', err => {
    console.error(`ERROR: Failed to launch '${cmd}':`, err.message);
    process.exit(1);
  });

  child.on('close', code => {
    process.exit(code ?? 0);
  });
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
