#!/usr/bin/env node
/**
 * bws-mcp-wrapper
 *
 * Fetches secrets from Bitwarden Secrets Manager at runtime and injects them
 * into an MCP server process — as env vars or CLI arguments.
 *
 * Usage:
 *   bws-mcp-wrapper --secret KEY --env VAR_NAME -- npx some-mcp-server
 *   bws-mcp-wrapper --secret KEY --arg --connection-string -- npx some-mcp-server
 *   bws-mcp-wrapper --secret K1 --env V1 --secret K2 --env V2 -- npx some-mcp-server
 */

'use strict';

const { execFileSync, spawn } = require('child_process');

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

// Parse injections: pairs of (--secret KEY) followed by (--env VAR) or (--arg FLAG)
const injections = []; // [{ bwsKey, mode: 'env'|'arg', target }]
let i = 0;
while (i < wrapperArgs.length) {
  if (wrapperArgs[i] === '--secret') {
    const bwsKey = wrapperArgs[i + 1];
    const modeFlag = wrapperArgs[i + 2];
    const target = wrapperArgs[i + 3];
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

// ---------------------------------------------------------------------------
// Fetch secrets from BWS
// ---------------------------------------------------------------------------
const BWS_ACCESS_TOKEN = process.env.BWS_ACCESS_TOKEN;
if (!BWS_ACCESS_TOKEN) {
  console.error('ERROR: BWS_ACCESS_TOKEN is not set');
  process.exit(1);
}

let secretsJson;
try {
  secretsJson = execFileSync('bws', ['secret', 'list', '--access-token', BWS_ACCESS_TOKEN, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  console.error('ERROR: Failed to fetch secrets from BWS:', err.message);
  process.exit(1);
}

let secrets;
try {
  secrets = JSON.parse(secretsJson);
} catch (err) {
  console.error('ERROR: Failed to parse BWS output as JSON');
  process.exit(1);
}

function getSecret(key) {
  const entry = secrets.find(s => s.key === key);
  if (!entry || !entry.value) {
    console.error(`ERROR: Secret '${key}' not found in Bitwarden SM`);
    process.exit(1);
  }
  return entry.value;
}

// ---------------------------------------------------------------------------
// Build env and extra args
// ---------------------------------------------------------------------------
const env = { ...process.env };
const extraArgs = [];

for (const { bwsKey, mode, target } of injections) {
  const value = getSecret(bwsKey);
  if (mode === 'env') {
    env[target] = value;
  } else {
    extraArgs.push(target, value);
  }
}

// ---------------------------------------------------------------------------
// Launch the MCP server
// ---------------------------------------------------------------------------
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
