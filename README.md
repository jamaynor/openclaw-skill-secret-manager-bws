# openclaw-skill-secret-manager-bws

An [OpenClaw](https://openclaw.ai) community skill that securely injects secrets from
[Bitwarden Secrets Manager (BWS)](https://bitwarden.com/products/secrets-manager/) into
MCP servers and agent tools at runtime.

**No secrets on disk. No secrets in config files. Just a BWS key name.**

## The Problem

MCP server configurations (like `mcporter.json`) typically require connection strings
and API keys inline:

```json
{
  "mcpServers": {
    "my-db": {
      "command": "npx @henkey/postgres-mcp-server --connection-string postgresql://user:password@host/db"
    }
  }
}
```

That password is now on disk, in version control, and in any config backup.

## The Solution

Store the secret in Bitwarden SM and reference it by key:

```json
{
  "mcpServers": {
    "my-db": {
      "command": "bws-mcp-wrapper",
      "args": ["--secret", "MY_DB_URL", "--arg", "--connection-string", "--", "npx", "@henkey/postgres-mcp-server"]
    }
  }
}
```

At runtime, `bws-mcp-wrapper` fetches `MY_DB_URL` from BWS and passes it to the server.

## Installation

```bash
npm install -g openclaw-skill-secret-manager-bws
```

Or via clawhub:

```bash
npx clawhub install secret-manager-bws
```

## Prerequisites

- `BWS_ACCESS_TOKEN` environment variable set (machine account token)

No additional CLI tools required — the Bitwarden SDK is bundled as an npm dependency.

## Usage

### Inject as an environment variable

```bash
bws-mcp-wrapper --secret MY_DB_URL --env DATABASE_URL -- npx @henkey/postgres-mcp-server
```

### Inject as a CLI argument

```bash
bws-mcp-wrapper --secret MY_DB_URL --arg --connection-string -- npx @henkey/postgres-mcp-server
```

### Multiple secrets

```bash
bws-mcp-wrapper \
  --secret DB_URL --env DATABASE_URL \
  --secret API_KEY --env OPENAI_API_KEY \
  -- npx my-mcp-server
```

### In mcporter.json

```json
{
  "mcpServers": {
    "postgres": {
      "command": "bws-mcp-wrapper",
      "args": ["--secret", "STRAT_DB_URL", "--arg", "--connection-string", "--", "npx", "@henkey/postgres-mcp-server"]
    },
    "asd-metrics": {
      "command": "bws-mcp-wrapper",
      "args": ["--secret", "ASD_METRICS_DB_URL", "--env", "DATABASE_URL", "--", "npx", "@henkey/postgres-mcp-server"]
    }
  }
}
```

## Alternative: start.sh injection

If your gateway uses a `start.sh` that fetches BWS secrets and injects them into a
Docker container as environment variables, you can skip this wrapper entirely and
reference env vars directly in `mcporter.json`:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "sh",
      "args": ["-c", "npx @henkey/postgres-mcp-server --connection-string \"$STRAT_DB_URL\""]
    }
  }
}
```

See [nyssa-clawd](https://github.com/jamaynor/nyssa-clawd) for a full example of this
pattern with Docker Compose.

## License

MIT
