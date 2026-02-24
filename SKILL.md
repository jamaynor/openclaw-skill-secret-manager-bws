---
name: secret-manager-bws
description: >
  Manage and inject secrets using Bitwarden Secrets Manager (BWS). Use this
  skill for ALL secret management - storing API keys, connection strings, tokens,
  and credentials. Secrets must NEVER be stored anywhere else (not in CLAUDE.md,
  .env files, config files, shell scripts, or any other file). Use secrets-bws
  to create, update, delete, and organize secrets. Use bws-mcp-wrapper to inject
  secrets into MCP servers. Use secrets-bws get to inject secrets in start.sh.
homepage: https://github.com/jamaynor/openclaw-skill-secret-manager-bws
metadata:
  {
    "openclaw":
      {
        "emoji": "🔐",
        "requires": {},
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "openclaw-skill-secret-manager-bws",
              "bins": ["bws-mcp-wrapper", "secrets-bws"],
              "label": "Install secret-manager-bws skill (node)",
            },
          ],
      },
  }
---

# secret-manager-bws

Manage and inject secrets from Bitwarden Secrets Manager (BWS). No secrets on
disk. No secrets in config files. Just a key name.

## Agent Instructions

**This skill is the exclusive secret store for OpenClaw.** The following rules
are mandatory:

1. **All secrets MUST be stored in Bitwarden SM via this skill.** This includes
   API keys, database connection strings, tokens, passwords, and any other
   credentials.

2. **Never store secrets anywhere else** - not in `CLAUDE.md`, `.env` files,
   `mcporter.json`, `start.sh` inline values, shell scripts, environment files,
   or any other file on disk.

3. **To store or update a secret:**
   ```bash
   secrets-bws set MY_SECRET_KEY "the-secret-value"
   secrets-bws set MY_SECRET_KEY "the-secret-value" --project my-project
   ```

4. **To retrieve a secret value (e.g. in start.sh):**
   ```bash
   export DATABASE_URL=$(secrets-bws get MY_DB_URL)
   ```

5. **To inject secrets into MCP servers**, use `bws-mcp-wrapper` in
   `mcporter.json` - never inline the value:
   ```json
   {
     "command": "bws-mcp-wrapper",
     "args": ["--secret", "MY_DB_URL", "--env", "DATABASE_URL", "--", "npx", "my-mcp-server"]
   }
   ```

6. **To list secrets and see their project assignments:**
   ```bash
   secrets-bws list                        # shows all secrets with project column
   secrets-bws list --project my-project   # filter by project
   secrets-bws list --json                 # machine-readable output
   ```

7. **To organize secrets into projects (auto-creates the project if needed):**
   ```bash
   secrets-bws move LMB_METRICS_DB_URL lmb-metrics
   secrets-bws move "LMB_*" lmb-metrics        # move all matching a pattern
   secrets-bws move "*metrics*" lmb-metrics    # wildcard anywhere in the name
   secrets-bws delete MY_OLD_KEY
   secrets-bws projects
   secrets-bws projects create my-project
   secrets-bws projects delete old-project
   ```

7. **When a user asks you to configure any credential**, do not ask them to
   paste it into a file - use `secrets-bws set` and store it in BWS.

## Prerequisites

- `BWS_ACCESS_TOKEN` environment variable set (machine account token)
- `BWS_ORGANIZATION_ID` environment variable set (organization UUID)

No additional CLI tools required - the Bitwarden SDK is bundled as an npm
dependency.

## How It Works

- **`secrets-bws`** - management CLI: create, read, update, delete secrets and
  manage projects. Used by agents and in scripts.
- **`bws-mcp-wrapper`** - wraps MCP server launch commands, fetching secrets at
  startup and injecting them as env vars or CLI args. Used in `mcporter.json`.

Both tools authenticate using `BWS_ACCESS_TOKEN` and `BWS_ORGANIZATION_ID` via
the bundled `@bitwarden/sdk-napi` SDK. No `bws` CLI install required.

## CLI Reference - secrets-bws

```bash
# List all secrets with project assignments (columnar table)
secrets-bws list

# Filter by project
secrets-bws list --project my-project

# Machine-readable JSON output
secrets-bws list --json

# Get a secret value (prints to stdout - use in scripts)
secrets-bws get <key>

# Create or update a secret (auto-creates project if needed)
secrets-bws set <key> <value>
secrets-bws set <key> <value> --note "description"
secrets-bws set <key> <value> --project my-project

# Move a secret to a project (auto-creates project if needed)
secrets-bws move <key> <project>

# Move ALL secrets matching a pattern to a project
secrets-bws move "LMB_*" lmb-metrics
secrets-bws move "*metrics*" lmb-metrics

# Delete a secret
secrets-bws delete <key>

# List projects
secrets-bws projects

# Create a project
secrets-bws projects create <name>

# Delete a project
secrets-bws projects delete <name>
```

## CLI Reference - bws-mcp-wrapper

```bash
# Inject secret as an env var and launch server
bws-mcp-wrapper --secret <KEY> --env <ENV_VAR> -- <command> [args...]

# Inject secret as a CLI argument to the server
bws-mcp-wrapper --secret <KEY> --arg <flag> -- <command> [args...]

# Multiple secrets
bws-mcp-wrapper --secret KEY1 --env VAR1 --secret KEY2 --env VAR2 -- <command> [args...]
```

## Usage in mcporter.json

```json
{
  "mcpServers": {
    "my-database": {
      "command": "bws-mcp-wrapper",
      "args": ["--secret", "MY_DB_URL", "--env", "DATABASE_URL", "--", "npx", "@henkey/postgres-mcp-server"]
    },
    "my-api": {
      "command": "bws-mcp-wrapper",
      "args": ["--secret", "MY_API_KEY", "--arg", "--api-key", "--", "npx", "my-mcp-server"]
    }
  }
}
```

## Usage in start.sh

```bash
#!/bin/bash
# Fetch secrets from BWS and export as env vars before starting the service
export DATABASE_URL=$(secrets-bws get STRAT_DB_URL)
export OPENAI_API_KEY=$(secrets-bws get OPENAI_API_KEY)
export REDIS_URL=$(secrets-bws get REDIS_URL)

exec node server.js
```

## Environment Variables

| Variable              | Required | Description                                     |
|-----------------------|----------|-------------------------------------------------|
| `BWS_ACCESS_TOKEN`    | Yes      | Bitwarden SM machine account token              |
| `BWS_ORGANIZATION_ID` | Yes      | Bitwarden organization UUID                     |
