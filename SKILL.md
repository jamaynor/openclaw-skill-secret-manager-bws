---
name: secret-manager-bws
description: >
  Use Bitwarden Secrets Manager (BWS) to securely inject secrets into MCP servers
  and agent tools at runtime. Fetches connection strings, API keys, and credentials
  from BWS by key name — nothing stored on disk. Use when launching MCP servers that
  need credentials (databases, APIs, etc.) without hardcoding secrets in config files.
homepage: https://github.com/jamaynor/openclaw-skill-secret-manager-bws
metadata:
  {
    "openclaw":
      {
        "emoji": "🔐",
        "requires": { "bins": ["bws", "jq"] },
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "openclaw-skill-secret-manager-bws",
              "bins": ["bws-mcp-wrapper"],
              "label": "Install secret-manager-bws skill (node)",
            },
          ],
      },
  }
---

# secret-manager-bws

Use this skill to launch MCP servers with credentials fetched securely from
Bitwarden Secrets Manager at runtime. Secrets are never written to disk or stored
in config files.

## Prerequisites

- `bws` CLI installed and `BWS_ACCESS_TOKEN` available in the environment
- `jq` installed

## How It Works

The `bws-mcp-wrapper` binary:
1. Fetches the named secret from BWS using `BWS_ACCESS_TOKEN`
2. Injects it as an environment variable
3. Launches the target MCP server process

## Usage in mcporter.json

### PostgreSQL via Henkey

```json
{
  "mcpServers": {
    "my-database": {
      "command": "bws-mcp-wrapper",
      "args": ["--secret", "MY_DB_URL", "--env", "DATABASE_URL", "--", "npx", "@henkey/postgres-mcp-server"]
    }
  }
}
```

### Generic MCP server with a secret injected

```json
{
  "mcpServers": {
    "my-server": {
      "command": "bws-mcp-wrapper",
      "args": ["--secret", "MY_API_KEY", "--env", "API_KEY", "--", "npx", "my-mcp-server"]
    }
  }
}
```

### Pass secret as a CLI argument

```json
{
  "mcpServers": {
    "my-server": {
      "command": "bws-mcp-wrapper",
      "args": ["--secret", "MY_DB_URL", "--arg", "--connection-string", "--", "npx", "@henkey/postgres-mcp-server"]
    }
  }
}
```

## Environment Variables

| Variable          | Required | Description                                      |
|-------------------|----------|--------------------------------------------------|
| `BWS_ACCESS_TOKEN`| Yes      | Bitwarden Secrets Manager machine account token  |

## CLI Reference

```bash
# Inject secret as env var and launch server
bws-mcp-wrapper --secret <BWS_KEY> --env <ENV_VAR_NAME> -- <command> [args...]

# Inject secret as a CLI argument to the server
bws-mcp-wrapper --secret <BWS_KEY> --arg <flag> -- <command> [args...]

# Multiple secrets
bws-mcp-wrapper --secret KEY1 --env VAR1 --secret KEY2 --env VAR2 -- <command> [args...]
```

## Integration with start.sh

If your gateway uses a `start.sh` that fetches secrets from BWS and injects them
as environment variables into the container, you can also reference them directly
without this wrapper:

```json
{
  "mcpServers": {
    "my-database": {
      "command": "sh",
      "args": ["-c", "DATABASE_URL=\"$MY_DB_URL\" npx @henkey/postgres-mcp-server"]
    }
  }
}
```

This is simpler when secrets are already present as env vars (e.g. injected by
Docker Compose from a secrets manager at startup).
