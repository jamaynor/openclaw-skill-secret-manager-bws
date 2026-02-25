#!/usr/bin/env node
/**
 * secrets-bws
 *
 * Manage Bitwarden Secrets Manager secrets from the command line.
 * Intended for use by OpenClaw agents and in start.sh scripts.
 *
 * Commands:
 *   secrets-bws list [--project <name>] [--json]   List secrets with project assignments
 *   secrets-bws get <key>                           Print secret value to stdout
 *   secrets-bws set <key> <value> [options]         Create or update a secret
 *   secrets-bws move <key-or-pattern> <project>     Move matching secret(s) to a project (auto-creates project)
 *   secrets-bws delete <key>                        Delete a secret
 *   secrets-bws projects                            List all projects
 *   secrets-bws projects create <name>              Create a project
 *   secrets-bws projects delete <name>              Delete a project
 *   secrets-bws help                                Show this help
 *
 * Options for set:
 *   --note <text>       Note/description for the secret (preserved on update if omitted)
 *   --project <name>    Assign secret to this project (auto-creates project if needed)
 *
 * Pattern matching:
 *   move supports * as a wildcard, e.g. LMB_* or *metrics*
 *   Matching is case-insensitive.
 *
 * Required environment variables:
 *   HAL_BWS_ACCESS_TOKEN      Bitwarden SM machine account token
 *   HAL_BWS_ORGANIZATION_ID   Bitwarden organization UUID
 */

'use strict';

const { createClient, getOrgId } = require('../lib/secrets-bws-client');
const {
  parseFlags,
  globMatch,
  buildKeyIndex,
  buildProjectIndex,
  buildProjectIdMap,
} = require('../lib/secrets-bws-helpers');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

/**
 * Fetch all secrets with full detail (key, value, projectId, note) in one API call
 * using sync(). This replaces the previous two-step list() + getByIds() approach.
 * Returns SecretResponse[].
 */
async function fetchAllSecrets(client, orgId) {
  const result = await client.secrets().sync(orgId);
  return result.secrets ?? [];
}

/**
 * Find a project by name. If not found, create it and return the new id.
 * Logs to stderr when auto-creating so it doesn't pollute stdout.
 */
async function resolveOrCreateProject(client, orgId, projectName) {
  const projectList = await client.projects().list(orgId);
  const pIndex      = buildProjectIndex(projectList.data);
  if (pIndex[projectName]) return { id: pIndex[projectName].id, created: false };
  const created = await client.projects().create(orgId, projectName);
  return { id: created.id, created: true };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdList(flags) {
  const orgId  = getOrgId();
  const client = await createClient();

  const projectList  = await client.projects().list(orgId);
  const projectIdMap = buildProjectIdMap(projectList.data);

  // fetchAllSecrets uses getByIds to get projectId - SDK list() stub omits it
  let secrets = await fetchAllSecrets(client, orgId);

  if (flags.project) {
    const pIndex = buildProjectIndex(projectList.data);
    if (!pIndex[flags.project]) die(`Project '${flags.project}' not found`);
    const projectId = pIndex[flags.project].id;
    secrets = secrets.filter(s => s.projectId === projectId);
  }

  if (secrets.length === 0) {
    if (flags.json) {
      console.log('[]');
    } else {
      console.log('(no secrets found)');
    }
    return;
  }

  secrets.sort((a, b) => {
    const pa = projectIdMap[a.projectId] ?? '';
    const pb = projectIdMap[b.projectId] ?? '';
    return pa.localeCompare(pb) || a.key.localeCompare(b.key);
  });

  if (flags.json) {
    const output = secrets.map(s => ({
      key:     s.key,
      project: projectIdMap[s.projectId] ?? null,
      id:      s.id,
    }));
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const keyWidth = Math.max(3, ...secrets.map(s => s.key.length));
  const header   = `${'KEY'.padEnd(keyWidth)}  PROJECT`;
  const divider  = '-'.repeat(header.length);
  console.log(header);
  console.log(divider);
  for (const s of secrets) {
    const project = projectIdMap[s.projectId] ?? '(none)';
    console.log(`${s.key.padEnd(keyWidth)}  ${project}`);
  }
}

async function cmdGet(key) {
  if (!key) die('get requires a key name');
  const orgId   = getOrgId();
  const client  = await createClient();
  // fetchAllSecrets uses sync() — a single API call that returns key + value.
  // This avoids the TOCTOU window of a two-step list()+getByIds() approach.
  const secrets = await fetchAllSecrets(client, orgId);
  const secret  = secrets.find(s => s.key === key);
  if (!secret) die(`Secret '${key}' not found`);
  if (secret.value === undefined || secret.value === null) die(`Secret '${key}' returned no value`);
  process.stdout.write(secret.value);
}

async function cmdSet(key, value, flags) {
  if (!key)            die('set requires a key name');
  if (value === undefined) die('set requires a value');

  const noteProvided = flags.note !== undefined;
  const orgId        = getOrgId();
  const client       = await createClient();

  let projectIds = [];
  if (flags.project) {
    const { id, created } = await resolveOrCreateProject(client, orgId, flags.project);
    if (created) console.error(`Created project '${flags.project}'`);
    projectIds = [id];
  }

  const list     = await client.secrets().list(orgId);
  const index    = buildKeyIndex(list.data);
  const existing = index[key];

  // Warn if multiple secrets share the same key (different projects) — first match will be updated
  const allWithKey = list.data.filter(s => s.key === key);
  if (allWithKey.length > 1) {
    console.error(`WARN: ${allWithKey.length} secrets named '${key}' found across projects — updating the first match`);
  }

  if (existing) {
    // Fetch current to preserve note and projectId if not explicitly overridden
    const fetched = await client.secrets().getByIds([existing.id]);
    const current = fetched.data && fetched.data[0];
    if (!current) die(`Secret '${key}' could not be fetched for update`);
    const finalNote    = noteProvided ? flags.note : current.note;
    const finalProject = projectIds.length > 0 ? projectIds : (current.projectId ? [current.projectId] : []);
    await client.secrets().update(orgId, existing.id, key, value, finalNote, finalProject);
    console.log(`Updated secret '${key}'`);
  } else {
    await client.secrets().create(orgId, key, value, flags.note ?? '', projectIds);
    console.log(`Created secret '${key}'`);
  }
}

async function cmdMove(pattern, projectName) {
  if (!pattern)     die('move requires a key name or pattern');
  if (!projectName) die('move requires a project name');

  const orgId  = getOrgId();
  const client = await createClient();

  const { id: projectId, created } = await resolveOrCreateProject(client, orgId, projectName);
  if (created) console.error(`Created project '${projectName}'`);

  const secrets = await fetchAllSecrets(client, orgId);
  const matches = secrets.filter(s => globMatch(pattern, s.key));

  if (matches.length === 0) die(`No secrets found matching '${pattern}'`);

  // Run updates in batches of 5 to avoid overwhelming the BWS rate limit.
  const BATCH = 5;
  const results = [];
  for (let i = 0; i < matches.length; i += BATCH) {
    const batch = matches.slice(i, i + BATCH);
    results.push(...await Promise.allSettled(
      batch.map(secret =>
        client.secrets().update(orgId, secret.id, secret.key, secret.value, secret.note, [projectId])
      )
    ));
  }

  let moved = 0;
  for (let i = 0; i < matches.length; i++) {
    if (results[i].status === 'fulfilled') {
      console.log(`Moved '${matches[i].key}' -> '${projectName}'`);
      moved++;
    } else {
      console.error(`ERROR: Failed to move '${matches[i].key}': ${results[i].reason?.message || results[i].reason}`);
    }
  }

  if (matches.length > 1) {
    console.log(`\nMoved ${moved} of ${matches.length} secrets to '${projectName}'`);
  }
  if (moved < matches.length) process.exit(1);
}

async function cmdDelete(key) {
  if (!key) die('delete requires a key name');
  const orgId  = getOrgId();
  const client = await createClient();
  const list   = await client.secrets().list(orgId);
  const index  = buildKeyIndex(list.data);
  if (!index[key]) die(`Secret '${key}' not found`);
  const result = await client.secrets().delete([index[key].id]);
  const item   = result.data && result.data[0];
  if (!item)        die(`Failed to delete '${key}': no confirmation from server`);
  if (item.error)   die(`Failed to delete '${key}': ${item.error}`);
  console.log(`Deleted secret '${key}'`);
}

async function cmdProjects() {
  const orgId  = getOrgId();
  const client = await createClient();
  const list   = await client.projects().list(orgId);
  if (list.data.length === 0) {
    console.log('(no projects found)');
    return;
  }
  const names = list.data.map(p => p.name).sort();
  for (const name of names) console.log(name);
}

async function cmdProjectsCreate(name) {
  if (!name) die('projects create requires a project name');
  const orgId  = getOrgId();
  const client = await createClient();
  await client.projects().create(orgId, name);
  console.log(`Created project '${name}'`);
}

async function cmdProjectsDelete(name) {
  if (!name) die('projects delete requires a project name');
  const orgId  = getOrgId();
  const client = await createClient();
  const list   = await client.projects().list(orgId);
  const pIndex = buildProjectIndex(list.data);
  if (!pIndex[name]) die(`Project '${name}' not found`);
  const result = await client.projects().delete([pIndex[name].id]);
  const item   = result.data && result.data[0];
  if (!item)      die(`Failed to delete project '${name}': no confirmation from server`);
  if (item.error) die(`Failed to delete project '${name}': ${item.error}`);
  console.log(`Deleted project '${name}'`);
}

function cmdHelp() {
  const C   = (s, n) => s.padEnd(n);
  const W   = { cmd: 44, desc: 52 };
  const div = '-'.repeat(W.cmd + W.desc + 2);
  const row = (cmd, desc) => console.log(`${C(cmd, W.cmd)}  ${desc}`);

  console.log();
  console.log('secrets-bws - Bitwarden Secrets Manager CLI for OpenClaw');
  console.log();
  console.log(`${C('COMMAND', W.cmd)}  DESCRIPTION`);
  console.log(div);

  console.log();
  console.log('  -- Secrets --');
  row('  secrets-bws list',                               'List all secrets with project assignments');
  row('  secrets-bws list --project <name>',              'Filter list to a specific project');
  row('  secrets-bws list --json',                        'Output as JSON (key, project, id)');
  row('  secrets-bws get <key>',                          'Print secret value to stdout');
  row('  secrets-bws set <key> <value>',                  'Create or update a secret (upsert)');
  row('  secrets-bws set <key> <value> --project <name>', 'Assign to project (auto-creates project)');
  row('  secrets-bws set <key> <value> --note <text>',    'Add or update description');
  row('  secrets-bws delete <key>',                       'Delete a secret');

  console.log();
  console.log('  -- Organization --');
  row('  secrets-bws move <key> <project>',               'Move one secret to a project (auto-creates project)');
  row('  secrets-bws move "<pattern>" <project>',         'Move all matching secrets, e.g. "LMB_*" or "*metrics*"');

  console.log();
  console.log('  -- Projects --');
  row('  secrets-bws projects',                           'List all projects');
  row('  secrets-bws projects create <name>',             'Create a project');
  row('  secrets-bws projects delete <name>',             'Delete a project');

  console.log();
  console.log('  -- bws-mcp-wrapper (use in mcporter.json) --');
  row('  bws-mcp-wrapper --secret <key> --env <VAR> -- <cmd>',  'Launch MCP server, inject secret as env var');
  row('  bws-mcp-wrapper --secret <key> --arg <flag> -- <cmd>', 'Launch MCP server, inject secret as CLI arg');

  console.log();
  console.log('Pattern matching: * is a wildcard, matching is case-insensitive.');
  console.log('  Examples: "LMB_*"  "*metrics*"  "*db*"');

  console.log();
  console.log('Required environment variables:');
  console.log('  HAL_BWS_ACCESS_TOKEN      Bitwarden SM machine account token');
  console.log('  HAL_BWS_ORGANIZATION_ID   Bitwarden organization UUID');
  console.log();
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);

async function main() {
  const cmd = argv[0];

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    cmdHelp();
    process.exit(0);
  }

  if (cmd === 'list') {
    const { flags } = parseFlags(argv.slice(1));
    await cmdList(flags);

  } else if (cmd === 'get') {
    await cmdGet(argv[1]);

  } else if (cmd === 'set') {
    const { flags, rest } = parseFlags(argv.slice(1));
    await cmdSet(rest[0], rest[1], flags);

  } else if (cmd === 'move') {
    await cmdMove(argv[1], argv[2]);

  } else if (cmd === 'delete') {
    await cmdDelete(argv[1]);

  } else if (cmd === 'projects') {
    const sub = argv[1];
    if (!sub || sub === 'list') {
      await cmdProjects();
    } else if (sub === 'create') {
      await cmdProjectsCreate(argv[2]);
    } else if (sub === 'delete') {
      await cmdProjectsDelete(argv[2]);
    } else {
      die(`Unknown projects subcommand: '${sub}'. Run 'secrets-bws help' for usage.`);
    }

  } else {
    die(`Unknown command: '${cmd}'. Run 'secrets-bws help' for usage.`);
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
