#!/usr/bin/env node
/**
 * secrets-bws
 *
 * Responsibility: CLI entry point and command dispatcher for the secrets-bws
 * management tool. Delegates all command logic to lib/secrets-bws-commands.
 *
 * Public Interface:
 * secrets-bws (CLI)
 * ├── list [--project <name>] [--json]
 * ├── get <key>
 * ├── set <key> <value> [--project <name>] [--note <text>]
 * ├── move <key-or-pattern> <project>
 * ├── delete <key>
 * ├── projects [list|create <name>|delete <name>]
 * └── help
 */

'use strict';

const {
  cmdList, cmdGet, cmdSet, cmdMove, cmdDelete,
  cmdProjects, cmdProjectsCreate, cmdProjectsDelete,
  cmdHelp,
} = require('../lib/secrets-bws-commands');
const { parseFlags, die } = require('../lib/secrets-bws-helpers');

const argv = process.argv.slice(2);

const COMMANDS = {
  list:     () => { const { flags } = parseFlags(argv.slice(1)); return cmdList(flags); },
  get:      () => cmdGet(argv[1]),
  set:      () => { const { flags, rest } = parseFlags(argv.slice(1)); return cmdSet(rest[0], rest[1], flags); },
  move:     () => cmdMove(argv[1], argv[2]),
  delete:   () => cmdDelete(argv[1]),
  projects: () => dispatchProjects(),
  help:     () => { cmdHelp(); process.exit(0); },
};

async function dispatchProjects() {
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
}

async function main() {
  const cmd = argv[0];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    cmdHelp();
    process.exit(0);
  }

  const handler = COMMANDS[cmd];
  if (!handler) die(`Unknown command: '${cmd}'. Run 'secrets-bws help' for usage.`);
  await handler();
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
