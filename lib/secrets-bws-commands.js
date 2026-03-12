/**
 * secrets-bws-commands
 *
 * Responsibility: Implements all secrets-bws command handler functions and
 * shared data-access helpers used by the CLI dispatcher.
 *
 * Public Interface:
 * secrets-bws-commands
 * ├── fetchAllSecrets(client, orgId): Promise<SecretResponse[]>
 * ├── resolveOrCreateProject(client, orgId, name): Promise<{id, created}>
 * ├── cmdList(flags): Promise<void>
 * ├── cmdGet(key): Promise<void>
 * ├── cmdSet(key, value, flags): Promise<void>
 * ├── cmdMove(pattern, projectName): Promise<void>
 * ├── cmdDelete(key): Promise<void>
 * ├── cmdProjects(): Promise<void>
 * ├── cmdProjectsCreate(name): Promise<void>
 * └── cmdProjectsDelete(name): Promise<void>
 */

import { createClient, getOrgId } from './secrets-bws-client.js';
import {
  globMatch,
  buildKeyIndex,
  buildProjectIndex,
  buildProjectIdMap,
} from './secrets-bws-helpers.js';

// ---------------------------------------------------------------------------
// Shared data-access helpers
// ---------------------------------------------------------------------------

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

  // fetchAllSecrets uses sync() to get projectId — SDK list() stub omits it
  let secrets = await fetchAllSecrets(client, orgId);

  if (flags.project) {
    const pIndex = buildProjectIndex(projectList.data);
    if (!pIndex[flags.project]) throw new Error(`Project '${flags.project}' not found`);
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
  if (!key) throw new Error('get requires a key name');
  const orgId   = getOrgId();
  const client  = await createClient();
  // fetchAllSecrets uses sync() — a single API call that returns key + value.
  // This avoids the TOCTOU window of a two-step list()+getByIds() approach.
  const secrets = await fetchAllSecrets(client, orgId);
  const secret  = secrets.find(s => s.key === key);
  if (!secret) throw new Error(`Secret '${key}' not found`);
  if (secret.value === undefined || secret.value === null) throw new Error(`Secret '${key}' returned no value`);
  // stdout.write intentionally omits trailing newline — callers capturing with $() get the exact value
  process.stdout.write(secret.value);
}

async function cmdSet(key, value, flags) {
  if (!key)            throw new Error('set requires a key name');
  if (value === undefined) throw new Error('set requires a value');

  const noteProvided = flags.note !== undefined;
  const orgId        = getOrgId();
  const client       = await createClient();

  let projectIds = [];
  if (flags.project) {
    const { id, created } = await resolveOrCreateProject(client, orgId, flags.project);
    if (created) console.error(`Created project '${flags.project}'`);
    projectIds = [id];
  }

  // fetchAllSecrets uses sync() — returns full detail (key, value, note, projectId) in one call,
  // avoiding the TOCTOU window of list() + getByIds() and the need for a second fetch on update.
  const secrets    = await fetchAllSecrets(client, orgId);
  const index      = buildKeyIndex(secrets);
  const existing   = index[key];

  // Warn if multiple secrets share the same key (different projects) — first match will be updated
  const allWithKey = secrets.filter(s => s.key === key);
  if (allWithKey.length > 1) {
    console.error(`WARN: ${allWithKey.length} secrets named '${key}' found across projects — updating the first match`);
  }

  if (existing) {
    // existing already has .note and .projectId from sync() — no extra getByIds needed
    const finalNote    = noteProvided ? flags.note : existing.note;
    const finalProject = projectIds.length > 0 ? projectIds : (existing.projectId ? [existing.projectId] : []);
    await client.secrets().update(orgId, existing.id, key, value, finalNote, finalProject);
    console.log(`Updated secret '${key}'`);
  } else {
    await client.secrets().create(orgId, key, value, flags.note ?? '', projectIds);
    console.log(`Created secret '${key}'`);
  }
}

async function cmdMove(pattern, projectName) {
  if (!pattern)     throw new Error('move requires a key name or pattern');
  if (!projectName) throw new Error('move requires a project name');

  const orgId  = getOrgId();
  const client = await createClient();

  const { id: projectId, created } = await resolveOrCreateProject(client, orgId, projectName);
  if (created) console.error(`Created project '${projectName}'`);

  const secrets = await fetchAllSecrets(client, orgId);
  const matches = secrets.filter(s => globMatch(pattern, s.key));

  if (matches.length === 0) throw new Error(`No secrets found matching '${pattern}'`);

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
  if (moved < matches.length) {
    throw new Error(`Partial failure: moved ${moved} of ${matches.length} secrets to '${projectName}'`);
  }
}

async function cmdDelete(key) {
  if (!key) throw new Error('delete requires a key name');
  const orgId    = getOrgId();
  const client   = await createClient();
  const secrets  = await fetchAllSecrets(client, orgId);
  const index    = buildKeyIndex(secrets);
  if (!index[key]) throw new Error(`Secret '${key}' not found`);

  // Warn if multiple secrets share the same key — only the first match will be deleted
  const allWithKey = secrets.filter(s => s.key === key);
  if (allWithKey.length > 1) {
    console.error(`WARN: ${allWithKey.length} secrets named '${key}' found across projects — deleting the first match only`);
  }

  const result = await client.secrets().delete([index[key].id]);
  const item   = result.data && result.data[0];
  if (!item)        throw new Error(`Failed to delete '${key}': no confirmation from server`);
  if (item.error)   throw new Error(`Failed to delete '${key}': ${item.error}`);
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
  if (!name) throw new Error('projects create requires a project name');
  const orgId  = getOrgId();
  const client = await createClient();
  await client.projects().create(orgId, name);
  console.log(`Created project '${name}'`);
}

async function cmdProjectsDelete(name) {
  if (!name) throw new Error('projects delete requires a project name');
  const orgId  = getOrgId();
  const client = await createClient();
  const list   = await client.projects().list(orgId);
  const pIndex = buildProjectIndex(list.data);
  if (!pIndex[name]) throw new Error(`Project '${name}' not found`);
  const projectId = pIndex[name].id;

  // sync() call is intentional here despite the added latency: it lets us enumerate
  // and warn about secrets that will become unassigned after the project is deleted.
  const secrets     = await fetchAllSecrets(client, orgId);
  const assigned    = secrets.filter(s => s.projectId === projectId);
  if (assigned.length > 0) {
    console.error(`WARN: ${assigned.length} secret(s) are assigned to '${name}' and will become unassigned after deletion:`);
    for (const s of assigned) console.error(`  ${s.key}`);
  }

  const result = await client.projects().delete([projectId]);
  const item   = result.data && result.data[0];
  if (!item)      throw new Error(`Failed to delete project '${name}': no confirmation from server`);
  if (item.error) throw new Error(`Failed to delete project '${name}': ${item.error}`);
  console.log(`Deleted project '${name}'`);
}

export {
  fetchAllSecrets,
  resolveOrCreateProject,
  cmdList,
  cmdGet,
  cmdSet,
  cmdMove,
  cmdDelete,
  cmdProjects,
  cmdProjectsCreate,
  cmdProjectsDelete,
};
