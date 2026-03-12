#!/usr/bin/env node
/**
 * secrets-bws
 *
 * Responsibility: CLI entry point for the secrets-bws management tool.
 * Delegates all command logic to lib/secrets-bws-commands via Commander.js.
 *
 * Public Interface:
 * secrets-bws (CLI)
 * ├── list [--project <name>] [--json]
 * ├── get <key>
 * ├── set <key> <value> [--project <name>] [--note <text>]
 * ├── move <pattern> <project>
 * ├── delete <key>
 * └── projects [list|create <name>|delete <name>]
 */

import { Command } from 'commander';
import {
  cmdList, cmdGet, cmdSet, cmdMove, cmdDelete,
  cmdProjects, cmdProjectsCreate, cmdProjectsDelete,
} from '../lib/secrets-bws-commands.js';

const program = new Command();
program
  .name('secrets-bws')
  .description('Manage secrets via Bitwarden Secrets Manager');

program.command('list')
  .description('List all secrets')
  .option('--project <name>', 'Filter by project')
  .option('--json', 'Output as JSON')
  .action(async (opts) => { await cmdList(opts); });

program.command('get')
  .description('Get a secret value by key')
  .argument('<key>', 'Secret key name')
  .action(async (key) => { await cmdGet(key); });

program.command('set')
  .description('Create or update a secret')
  .argument('<key>', 'Secret key name')
  .argument('<value>', 'Secret value')
  .option('--project <name>', 'Project to assign')
  .option('--note <text>', 'Note text')
  .action(async (key, value, opts) => { await cmdSet(key, value, opts); });

program.command('move')
  .description('Move secrets matching pattern to a project')
  .argument('<pattern>', 'Key pattern (supports * wildcard)')
  .argument('<project>', 'Target project name')
  .action(async (pattern, project) => { await cmdMove(pattern, project); });

program.command('delete')
  .description('Delete a secret by key')
  .argument('<key>', 'Secret key name')
  .action(async (key) => { await cmdDelete(key); });

const projectsCmd = program.command('projects').description('Manage BWS projects');
projectsCmd.command('list').description('List all projects')
  .action(async () => { await cmdProjects(); });
projectsCmd.command('create').description('Create a new project')
  .argument('<name>', 'Project name')
  .action(async (name) => { await cmdProjectsCreate(name); });
projectsCmd.command('delete').description('Delete a project')
  .argument('<name>', 'Project name')
  .action(async (name) => { await cmdProjectsDelete(name); });
// Default: bare "projects" with no subcommand = "projects list"
projectsCmd.action(async () => { await cmdProjects(); });

program.parseAsync(process.argv).catch((err) => {
  console.error('ERROR: ' + err.message);
  process.exit(1);
});
