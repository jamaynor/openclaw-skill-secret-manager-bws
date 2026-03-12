#!/usr/bin/env node
/**
 * bws-mcp-wrapper
 *
 * Responsibility: CLI entry point for the bws-mcp-wrapper tool. Parses
 * command-line arguments and delegates injection parsing, secret fetching,
 * environment construction, and server launch to lib/secrets-bws-wrapper-commands.
 *
 * Public Interface:
 * bws-mcp-wrapper (CLI)
 * └── [--secret KEY (--env VAR | --arg FLAG)]... -- <command> [args...]
 */

import {
  parseInjections,
  fetchSecretsForKeys,
  buildChildEnvAndArgs,
  launchServer,
} from '../lib/secrets-bws-wrapper-commands.js';
// Local die() — bin/ files own process.exit per error boundary convention.
function die(msg) { console.error(msg); process.exit(1); }

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
function printUsage() {
  console.log();
  console.log('bws-mcp-wrapper - Inject Bitwarden secrets into an MCP server process');
  console.log();
  console.log('Usage:');
  console.log('  bws-mcp-wrapper [--secret KEY (--env VAR | --arg FLAG)]... -- <command> [args...]');
  console.log();
  console.log('Options:');
  console.log('  --secret KEY  Bitwarden SM key to fetch');
  console.log('  --env VAR     Inject secret as environment variable VAR');
  console.log('  --arg FLAG    Inject secret as CLI argument FLAG <value>');
  console.log();
  console.log('Examples:');
  console.log('  bws-mcp-wrapper --secret MY_DB_URL --env DATABASE_URL -- npx my-mcp-server');
  console.log('  bws-mcp-wrapper --secret MY_API_KEY --arg --api-key -- npx my-mcp-server');
  console.log();
  console.log('Required environment variables:');
  console.log('  HAL_BWS_ACCESS_TOKEN      Bitwarden SM machine account token');
  console.log('  HAL_BWS_ORGANIZATION_ID   Bitwarden organization UUID');
  console.log();
}

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
const rawArgs = process.argv.slice(2);

if (rawArgs[0] === '--help' || rawArgs[0] === '-h') {
  printUsage();
  process.exit(0);
}

const separatorIdx = rawArgs.indexOf('--');
if (separatorIdx === -1) {
  die('Missing -- separator before server command.\nUsage: bws-mcp-wrapper [--secret KEY (--env VAR | --arg FLAG)]... -- <command> [args...]');
}

const wrapperArgs = rawArgs.slice(0, separatorIdx);
const serverCmd   = rawArgs.slice(separatorIdx + 1);

if (serverCmd.length === 0) {
  die('No server command specified after --');
}

let injections;
try {
  injections = parseInjections(wrapperArgs);
} catch (err) {
  die(err.message);
}

// Warn about --arg mode before fetching secrets (warning appears early, not buried after network I/O)
const argModeKeys = injections.filter(inj => inj.mode === 'arg').map(inj => inj.bwsKey);
if (argModeKeys.length > 0) {
  console.error(`WARN: --arg mode injects secrets as CLI arguments. These may be visible in process listings (ps, top). Consider --env mode for sensitive values. Keys: ${argModeKeys.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const secretValues       = await fetchSecretsForKeys(injections.map(inj => inj.bwsKey));
  const { env, extraArgs } = buildChildEnvAndArgs(injections, secretValues, process.env);
  launchServer([serverCmd[0], ...serverCmd.slice(1), ...extraArgs], env);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
