/**
 * secrets-bws-wrapper-commands
 *
 * Responsibility: Implements injection parsing, secret fetching, environment
 * preparation, and server launch logic for the bws-mcp-wrapper CLI.
 *
 * Public Interface:
 * secrets-bws-wrapper-commands
 * ├── parseInjections(wrapperArgs: string[]): Injection[]   (throws on invalid input)
 * ├── fetchSecretsForKeys(keys: string[]): Promise<Record<string, string>>
 * ├── buildChildEnvAndArgs(injections, secretValues, baseEnv): {env, extraArgs}
 * └── launchServer(serverCmd: string[], env: object): void
 */

import { spawn } from 'node:child_process';
import { buildKeyIndex } from './secrets-bws-helpers.js';
import { createClient, getOrgId } from './secrets-bws-client.js';
import { fetchAllSecrets } from './secrets-bws-commands.js';

/**
 * Parse wrapper-side args into an array of injection descriptors.
 * Throws on invalid input so callers can handle the error rather than hard-exiting.
 * @param {string[]} wrapperArgs
 * @returns {{ bwsKey: string, mode: 'env'|'arg', target: string }[]}
 */
function parseInjections(wrapperArgs) {
  const injections = [];
  let i = 0;
  while (i < wrapperArgs.length) {
    if (wrapperArgs[i] === '--secret') {
      const bwsKey   = wrapperArgs[i + 1];
      const modeFlag = wrapperArgs[i + 2];
      const target   = wrapperArgs[i + 3];
      if (!bwsKey || !modeFlag || !target) {
        throw new Error('--secret requires a key followed by --env <VAR> or --arg <FLAG>');
      }
      if (modeFlag !== '--env' && modeFlag !== '--arg') {
        throw new Error(`Expected --env or --arg after --secret, got: ${modeFlag}`);
      }
      injections.push({ bwsKey, mode: modeFlag === '--env' ? 'env' : 'arg', target });
      i += 4;
    } else {
      throw new Error(`Unexpected argument: ${wrapperArgs[i]}`);
    }
  }
  if (injections.length === 0) {
    throw new Error('No --secret injections specified. At least one --secret KEY (--env VAR | --arg FLAG) is required.');
  }
  return injections;
}

/**
 * Fetch secret values for the given keys from BWS.
 * Reuses fetchAllSecrets (single sync() call) and buildKeyIndex to avoid duplication.
 * Throws if any requested key is not found.
 * @param {string[]} keys
 * @returns {Promise<Record<string, string>>}
 */
async function fetchSecretsForKeys(keys) {
  const orgId  = getOrgId();
  const client = await createClient();

  // fetchAllSecrets uses sync() — a single API call returning key + value + projectId
  const all   = await fetchAllSecrets(client, orgId);
  const index = buildKeyIndex(all);

  for (const key of keys) {
    if (!(key in index)) {
      throw new Error(`Secret '${key}' not found in Bitwarden SM`);
    }
  }

  const result = {};
  for (const key of keys) result[key] = index[key].value;
  return result;
}

/**
 * Build the child process environment and extra CLI arguments from the injections.
 * Pure function — no side effects.
 * @returns {{ env: object, extraArgs: string[] }}
 */
function buildChildEnvAndArgs(injections, secretValues, baseEnv) {
  const env       = { ...baseEnv };
  const extraArgs = [];
  for (const { bwsKey, mode, target } of injections) {
    const value = secretValues[bwsKey];
    if (mode === 'env') {
      env[target] = value;
    } else {
      extraArgs.push(target, value);
    }
  }
  return { env, extraArgs };
}

/**
 * Spawn the server process and forward its exit code to the parent process.
 * @param {string[]} serverCmd  Full command array: [executable, ...args]
 * @param {object}   env        Environment variables for the child process
 */
function launchServer(serverCmd, env) {
  const [cmd, ...args] = serverCmd;
  const child = spawn(cmd, args, {
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

export {
  parseInjections,
  fetchSecretsForKeys,
  buildChildEnvAndArgs,
  launchServer,
};
