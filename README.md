# knowmind


<!-- mcp-name: io.github.Schubeler-Consulting/knowmind -->

**Persistent memory for your AI tools.** Store something once, and it is available in Claude Code, Cursor, and any other MCP client that runs a local (stdio) server — as a typed knowledge graph with provenance, confidence, and a bitemporal history for every fact. Hosted in Germany (Hetzner, Nuremberg data center); the CLI and MCP server in this repository are Apache-2.0.

**The free tier is permanently free and requires no payment details.** The API, CLI, and MCP server are included in every tier.

[![npm](https://img.shields.io/npm/v/knowmind)](https://www.npmjs.com/package/knowmind) · [knowmind.de](https://knowmind.de)

## Connect your AI tool in three steps

1. Create a free account at [knowmind.de](https://knowmind.de) and generate an access token: Dashboard → API tokens.
2. Store the token locally:

```
npx -y knowmind login --token kmt_xxxxxxxx
```

3. Wire up your client:

**Claude Code** (one command)
```
claude mcp add knowmind --env KNOWMIND_TOKEN=kmt_xxx -- npx -y knowmind mcp
```

**Cursor** (`~/.cursor/mcp.json`) — also works for Claude Desktop, Windsurf, Cline, Continue, Goose, and Zed with their respective config files:
```json
{
  "mcpServers": {
    "knowmind": {
      "command": "npx",
      "args": ["-y", "knowmind", "mcp"],
      "env": { "KNOWMIND_TOKEN": "kmt_xxx" }
    }
  }
}
```

**Any other MCP client**: knowmind is a standard MCP server over stdio (`npx -y knowmind mcp`). On Windows, if `npx` does not start directly, use `"command": "cmd"`, `"args": ["/c", "npx", "-y", "knowmind", "mcp"]`.

`npx -y knowmind install <ide>` writes this configuration for you (e.g. `claude`, `cursor`, `vscode`), and `npx -y knowmind init` sets up automatic memory hygiene — recall before each task, store after each meaningful change — for clients with a hook or rule mechanism (Claude Code, Cursor).

## How knowmind stores facts

- **Bitemporal history.** Every fact carries two time axes: when it was true and when it was recorded. Corrections never overwrite the original; the old statement stays queryable with the date it stopped being valid, so you can reconstruct what the system knew on any given day.
- **Provenance and confidence per fact.** New facts require a confidence level and keep a link to their source. Older facts without a confidence level are marked as such.
- **Typed knowledge graph.** Entities and relations use a restricted set of edge types; catch-all relations are rejected at write time.
- **Operated in the EU, isolated per tenant.** The service runs on Hetzner in Nuremberg, Germany, with tenant isolation, a public data processing agreement, and a subprocessor list at [knowmind.de/legal/avv](https://knowmind.de/legal/avv). Access logs are hash-chained and externally timestamped (RFC 3161).

knowmind is a hosted service; there is no self-hosted community edition. If you need self-hosting, one of the projects below will serve you better. knowmind is built for the people and teams that need an operated memory service with an audit trail in the EU.

## Pricing

| Tier | Price | For whom |
|---|---|---|
| Free | €0 | individuals and evaluation |
| Pro | €15/month or €150/year | individual professionals |
| Team | €99/month | teams with shared memory |
| Business | €349/month | larger teams |
| Enterprise | from €1,000/month | organizations with on-premise requirements |

The free tier includes 2,500 memories, 1 user, and a 30-day access log.

How that compares (vendor pricing pages, checked 2026-09-05):

| Product | Free tier | First paid tier | Self-hosting |
|---|---|---|---|
| knowmind | 2,500 memories | €15/month | no (Enterprise on-premise option) |
| Mem0 | 10,000 entries, 1,000 retrievals/month | $19/month | yes (Apache-2.0) |
| Zep | 10,000 credits/month | $125/month | Graphiti open source; Zep as BYOC |
| cognee | 1M tokens, 1 workspace | $2.50 per 1M tokens | yes |
| Letta | limited agents, own keys | $20/month | yes (per vendor) |
| Supermemory | ~$5 usage included | $19/month | from Scale tier |

Details and current prices: [knowmind.de/pricing](https://knowmind.de/pricing).

## Commands

```
npx -y knowmind search "Where does the staging deploy run?"
npx -y knowmind upload notes.md --title "Meeting notes 2026-05-12"
npx -y knowmind stats
npx -y knowmind health
npx -y knowmind status --line   # one-line status for your AI tool's statusline
```

## Links

[Documentation](https://knowmind.de/docs) · [Pricing](https://knowmind.de/pricing) · [Data processing agreement](https://knowmind.de/legal/avv) · [Privacy](https://knowmind.de/legal/datenschutz)

---

Die deutsche Fassung steht in [README.de.md](README.de.md).
