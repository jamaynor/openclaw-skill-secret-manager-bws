# openclaw-skill-secret-manager-bws

An [OpenClaw](https://openclaw.ai) skill that keeps every credential your AI
agent touches out of files, out of version control, and out of plain sight —
stored securely in [Bitwarden Secrets Manager](https://bitwarden.com/products/secrets-manager/)
and fetched at runtime, only when needed.

## The Problem

AI agents need credentials to do useful work — database connection strings, API
keys, tokens. Those credentials have to come from somewhere. The tempting
options all have the same flaw: they end up on disk.

| Where devs put secrets        | What goes wrong                                      |
|-------------------------------|------------------------------------------------------|
| Hardcoded in config files     | Committed to git, shared in backups, leaked in logs  |
| `.env` files                  | Copied between machines, forgotten in project dirs   |
| `CLAUDE.md` / agent context   | Visible to every tool the agent calls                |
| Shell scripts                 | Readable by anyone with filesystem access            |
| Environment variables set inline | Visible in process listings, shell history        |

This skill eliminates all of those patterns. Secrets live in Bitwarden SM.
Everything else just holds a key name.

## How It Works

This skill provides two tools that cover every place an agent or service needs
a secret:

| Tool              | When to use it                                                    |
|-------------------|-------------------------------------------------------------------|
| `secrets-bws`     | Manage secrets: store, update, delete, list, and organize them    |
| `bws-mcp-wrapper` | Launch an MCP server with secrets injected at startup             |

At runtime, both tools authenticate with Bitwarden SM using a machine account
token (`BWS_ACCESS_TOKEN`), fetch the secret value by key name, use it, and
discard it. Nothing is written to disk.

## Use Cases

### Use case 1 — Your agent needs a database

You're using a PostgreSQL MCP server. Without this skill, the connection string
sits in `mcporter.json`:

```json
"command": "npx @henkey/postgres-mcp-server --connection-string postgresql://user:s3cr3t@host/db"
```

That password is now on disk. With this skill:

```bash
# Store the secret once
secrets-bws set STRAT_DB_URL "postgresql://user:s3cr3t@host/db" --project strategy
```

```json
{
  "mcpServers": {
    "postgres": {
      "command": "bws-mcp-wrapper",
      "args": ["--secret", "STRAT_DB_URL", "--arg", "--connection-string", "--", "npx", "@henkey/postgres-mcp-server"]
    }
  }
}
```

`bws-mcp-wrapper` fetches `STRAT_DB_URL` from Bitwarden at startup and passes
the value directly to the server process. The connection string never touches
the filesystem.

### Use case 2 — Your Docker container needs secrets at startup

A gateway service runs in Docker and needs credentials before it can start. The
conventional approach injects them as environment variables in `docker-compose.yml`
or a `.env` file. With this skill, `start.sh` fetches them fresh from Bitwarden
each time the container starts:

```bash
#!/bin/bash
export DATABASE_URL=$(secrets-bws get STRAT_DB_URL)
export OPENAI_API_KEY=$(secrets-bws get OPENAI_API_KEY)
export REDIS_URL=$(secrets-bws get REDIS_URL)

exec node server.js
```

No `.env` file. No secrets in Compose. Rotate a credential in Bitwarden and
the next container restart picks it up automatically.

### Use case 3 — Your agent manages secrets on your behalf

Because this skill is installed and the agent knows to use it, you can give the
agent natural language instructions:

> "Store the new Stripe webhook secret as STRIPE_WEBHOOK_SECRET in the payments project"

> "Move all the lmb-metrics secrets into an lmb-metrics folder"

> "What secrets do we have for the strategy project?"

The agent uses `secrets-bws` to carry out those instructions directly —
no copy-pasting values into files, no manual Bitwarden UI work.

### Use case 4 — Keeping secrets organized as projects grow

As the number of secrets grows, `secrets-bws list` gives a full picture of
what exists and where it lives:

```
KEY                          PROJECT
-------------------------------------
LMB_METRICS_API_KEY          lmb-metrics
LMB_METRICS_DB_URL           lmb-metrics
OPENAI_API_KEY               (none)
STRAT_DB_URL                 strategy
STRIPE_WEBHOOK_SECRET        payments
```

Use wildcard patterns to reorganize in bulk:

```bash
secrets-bws move "LMB_*" lmb-metrics      # moves all LMB_ prefixed secrets
secrets-bws move "*stripe*" payments      # moves anything with 'stripe' in the name
```

Projects are auto-created if they don't exist yet.

## Installation

```bash
npm install -g openclaw-skill-secret-manager-bws
```

Or via clawhub:

```bash
npx clawhub install secret-manager-bws
```

## Prerequisites

Set these environment variables wherever the agent or container runs:

| Variable              | Description                            |
|-----------------------|----------------------------------------|
| `BWS_ACCESS_TOKEN`    | Bitwarden SM machine account token     |
| `BWS_ORGANIZATION_ID` | Bitwarden organization UUID            |

No other CLI tools required. The Bitwarden SDK is bundled as an npm dependency.

## Command Reference

### secrets-bws

```bash
# List all secrets with project assignments
secrets-bws list
secrets-bws list --project lmb-metrics
secrets-bws list --json

# Get a secret value (stdout — safe for use in scripts)
secrets-bws get STRAT_DB_URL

# Create or update a secret (upsert)
secrets-bws set STRAT_DB_URL "postgresql://..."
secrets-bws set STRAT_DB_URL "postgresql://..." --project strategy
secrets-bws set STRAT_DB_URL "postgresql://..." --note "Production DB"

# Move secrets to a project (auto-creates project if needed)
secrets-bws move STRAT_DB_URL strategy
secrets-bws move "LMB_*" lmb-metrics
secrets-bws move "*metrics*" lmb-metrics

# Delete a secret
secrets-bws delete OLD_KEY

# Manage projects
secrets-bws projects
secrets-bws projects create my-project
secrets-bws projects delete my-project
```

### bws-mcp-wrapper

```bash
# Inject as an environment variable
bws-mcp-wrapper --secret STRAT_DB_URL --env DATABASE_URL -- npx @henkey/postgres-mcp-server

# Inject as a CLI argument
bws-mcp-wrapper --secret STRAT_DB_URL --arg --connection-string -- npx @henkey/postgres-mcp-server

# Multiple secrets
bws-mcp-wrapper \
  --secret STRAT_DB_URL --env DATABASE_URL \
  --secret OPENAI_API_KEY --env OPENAI_API_KEY \
  -- npx my-mcp-server
```

See [nyssa-clawd](https://github.com/jamaynor/nyssa-clawd) for a full Docker
Compose example.

## License

MIT
