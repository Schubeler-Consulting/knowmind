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

**Cursor** (`~/.cursor/mcp.json`) — the same `mcpServers` block works for Claude Desktop, Windsurf and Gemini CLI in their config files; Zed expects it under `context_servers`:
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

**Any other MCP client**: knowmind is a standard MCP server over stdio (`npx -y knowmind mcp`). On Windows, `npx -y knowmind install <ide>` is the better way: if `pythonw.exe` from Python 3.10 to 3.14 sits in its default location (`%LOCALAPPDATA%\Programs\Python\Python3…` or `C:\Python3…`), the entries it writes start the server without a console window; Codex and the printed Claude Code command use `npx` directly. If you configure by hand and `npx` does not start directly, use `"command": "cmd"`, `"args": ["/c", "npx", "-y", "knowmind", "mcp"]`; clients without a console of their own then open a window with each tool call.

`npx -y knowmind install <ide>` writes this configuration for you, for example `cursor`, `vscode`, `windsurf`, `zed`, `claude-desktop`, `gemini` or `codex`; `npx -y knowmind install list` shows all clients. For Claude Code it prints the `claude mcp add` command instead, and `--project` writes `.mcp.json` in the current folder.

Clients that cannot read the token from the environment get a placeholder to replace with your token. Running `install` again updates only the knowmind entry and keeps a token you entered; before it changes a file, it saves a copy next to it.

`npx -y knowmind init` sets up memory hygiene in your client: hooks in Claude Code that recall before each task and, when a turn contained something worth keeping (a deploy or commit, a new rule, an architecture decision, changed code or configuration) and nothing was stored yet, ask the model to store it before the turn ends, a rule file in Cursor, and a block in `AGENTS.md` that tells Codex when to ask knowmind and what to keep.

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
npx -y knowmind sync ./openwiki  # pages in Open Knowledge Format keep their review data
```

### Knowledge in Open Knowledge Format

`knowmind sync` reads folders in the Open Knowledge Format (OKF 0.1 and 0.2),
such as the `openwiki/` folder that OpenWiki creates in a repository.

Every search hit then carries the page's `status` (`stable` if the page sets
none), its trust tier as defined by OKF (`trust`: `unverified`,
`machine-confirmed` or `human-reviewed`) and how many sources it lists. If the
page provides them, the hit also carries who or what generated the page
(`generated`), its last five verifications (`verified`), the time after which
it counts as stale (`stale_after`) and its first ten sources (`sources`). The
full header stays part of the document.

Inside a bundle, directory listings (`index.md`) and logs (`log.md`) are not
imported. knowmind recognizes a bundle by `okf_version` in its root `index.md` or by the
files OpenWiki keeps there. If it finds neither, `--okf` treats the folder you
sync as a bundle.

## Available Tools

Fifteen tools over MCP. Every one works against your own workspace; the server
never sees another tenant's data.

### Reading

**`knowmind_recall_memories`** — Search your memory and get the passages that answer a
question, ranked. Combines keyword search, vector similarity and the knowledge
graph, then reranks with a cross-encoder.
`query` (string, required) · `k` (integer, default 5, max 20) · `hops` (integer,
default 2 — how far to follow graph edges from a hit)
*Usage:* your AI tool asks "Which database does the billing service use?" before
answering, instead of guessing.
*Errors:* returns an empty result set when nothing matches — never an invented
answer.

**`knowmind_recall_at_time`** — The same search, but as your memory stood on a
given date. Facts superseded after that date are excluded; facts that were valid
then are returned even if they are no longer true.
`query` (string, required) · `as_of` (ISO date or timestamp, required in
practice) · `k` (integer, default 5)
*Usage:* "What was our pricing in March?" — answers from the state of that day,
not today's.
*Difference from `knowmind_recall_memories`:* use `recall` for what is true now, and
`recall_at_time` for what was true then. Asking `recall` about the past returns
today's facts.

**`knowmind_list_recent`** — The most recently added entries, newest first.
`k` (integer, default 10)
*Usage:* a quick look at what landed in memory during this session.

**`knowmind_list_relations`** — All typed edges attached to one entry, in both
directions.
`memory_id` (string, required)
*Usage:* "What does this contract connect to?" before changing or superseding it.
*Errors:* unknown id returns an error, not an empty list.

**`knowmind_get_schema`** — The entity classes and relation types this workspace
accepts. No parameters.
*Usage:* call it before `knowmind_upsert_entity` or `knowmind_link_entities` to use a type the
server will accept, rather than inventing one.

**`knowmind_list_inferred`** — Relations that wait for a human decision: relations knowmind
inferred from a text, and relations that start from a document although their type needs a
person, organisation or similar. Each comes with its review state, both connected entries, its
source and the entry that supports it.
`status` (`open`, `confirmed` or `rejected`, optional) · `limit` (integer, default 50, max 200) ·
`offset` (integer, default 0)
*Usage:* review what the graph learned on its own. Open relations do not feed the derivation
rules until someone confirms them.

**`knowmind_get_stats`** — Size of the corpus: documents, chunks, entities, edges.
No parameters.

**`knowmind_get_health`** — Whether the service and its stores are reachable. No
parameters.
*Usage:* a status line, or a check before a long ingest.

### Writing

**`knowmind_store_memory`** — Store a short fact, decision or note. Stays as one
unit; it is not split.
`content` (string, required) · `title` (string) · `memory_type` (string, e.g.
`semantic`, `episodic`) · `tags` (array of strings) · `source` (string) ·
`domain` (string) · `relations` (array — edges to create along with the entry)
*Usage:* "We decided to keep the monolith until Q3" after a meeting.
*Errors:* rejected with 422 when the text contains what looks like a password or
an access key. Store a pointer instead, not the secret.

**`knowmind_upload_document`** — Store a longer text as a document. It is split
into passages, embedded, and becomes searchable through `knowmind_recall_memories`.
`content` (string, required) · `title` (string) · `source` (string) ·
`relations` (array)
*Usage:* meeting minutes, a specification, a handbook chapter.
*Difference from `knowmind_store_memory`:* one sentence you want back verbatim is
a memory; a page you want searched is a document. A long text stored as a memory
is retrieved as one block, which crowds out other results.

**`knowmind_update_fact`** — Supersede a fact that has changed. The old version
keeps its validity window and stays auditable; nothing is deleted.
`target_id` (string, required) · `new_title` (string, required) · `new_content`
(string, required) · `update_reason` (string)
*Usage:* a price, a deadline or a responsibility changed. Never overwrite —
supersede, so "what did we believe in July" stays answerable.
*Errors:* unknown `target_id` is rejected.

**`knowmind_upsert_entity`** — Create or update a typed entity (a person, a company, a
product) with aliases.
`name` (string, required) · `entity_class` (string, required — see
`knowmind_get_schema`) · `description` (string) · `aliases` (array of strings)
*Usage:* give "ACME Ltd." its aliases so a question about "ACME" finds it.
*Errors:* a class outside the schema is rejected.

**`knowmind_link_entities`** — Create a typed edge between two entries, with a confidence
value.
`from_id` (string, required) · `to_id` (string, required) · `rel_type` (string,
required — see `knowmind_get_schema`) · `confidence` (number 0–1)
*Usage:* connect a contract to the client it belongs to. The inverse edge is
created for you.

**`knowmind_unlink_entities`** — Remove a typed edge.
`from_id`, `to_id`, `rel_type` (all required)
*Usage:* an edge created in error. The entries themselves stay.

**`knowmind_review_inferred`** — Record a decision on one relation from
`knowmind_list_inferred`. `confirm` lets it feed the derivation rules; `reject` ends the
relation, its reverse and every relation derived from it (`valid_to` is set, nothing is
deleted); `undo` takes a rejection back.
`edge_id` (string, required) · `decision` (`confirm`, `reject` or `undo`, required) ·
`evidence` (string, optional — id of the entry that supports the decision)
*Usage:* after reviewing the list. Returns the state before and after and how many reverse and
derived relations were affected.

### On deleting

There is no delete tool, and that is deliberate. Facts are superseded
(`knowmind_update_fact`), edges are removed (`knowmind_unlink_entities`), and the history
stays auditable. Deleting an entire workspace including its data is a
self-service action in the web interface at
[knowmind.de](https://knowmind.de) — it is not something an agent should be able
to do by calling a tool.


### Older tool names

Seven tools were renamed on 12 September 2026 so that every name follows
`knowmind_<verb>_<object>` and says whether it reads or writes. The previous
names keep answering unchanged until 31 March 2027 and still appear in
discovery, marked as deprecated:

| until now | from now on |
| --- | --- |
| `knowmind_recall` | `knowmind_recall_memories` |
| `knowmind_health` | `knowmind_get_health` |
| `knowmind_stats` | `knowmind_get_stats` |
| `knowmind_schema` | `knowmind_get_schema` |
| `knowmind_entity` | `knowmind_upsert_entity` |
| `knowmind_link` | `knowmind_link_entities` |
| `knowmind_unlink` | `knowmind_unlink_entities` |

`knowmind_entity` became `upsert`, not `get`: it creates the node or returns
the existing one. Nothing else about the tools changed — same parameters,
same behaviour.

### Discovery

`GET https://knowmind.de/api/mcp/v1` returns name, version, protocol version and
the full tool list with input schemas — without a token. Directory crawlers and
inspectors can read the complete surface anonymously; only `tools/call` requires
a key.

## Links

[Documentation](https://knowmind.de/docs) · [Pricing](https://knowmind.de/pricing) · [Data processing agreement](https://knowmind.de/legal/avv) · [Privacy](https://knowmind.de/legal/datenschutz)

---

Die deutsche Fassung steht in [README.de.md](README.de.md).
