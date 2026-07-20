# knowmind — Release & Verteilung (Wartungsleitfaden)

> Eine Quelle der Wahrheit: das npm-Paket **`knowmind`**. Jeder Kanal (Hermes, offizielle
> MCP-Registry, Glama/PulseMCP/mcp.so/Smithery, alle Client-Configs) zeigt auf **dasselbe Paket**,
> gepinnt auf **dieselbe Version**. Diese Datei beschreibt, wie eine neue Version sauber überall ankommt.

## Identität (fix, nie unkoordiniert ändern)

| Feld | Wert |
|---|---|
| npm-Paket | `knowmind` |
| MCP-Registry-Name (`server.json` `name` = `package.json` `mcpName`) | `io.github.Schubeler-Consulting/knowmind` |
| Repository | `https://github.com/Schubeler-Consulting/knowmind` (Org „SC-Repo-Space") |
| Start-Kommando (überall) | `npx -y knowmind mcp` (stdio) |
| Auth | ENV `KNOWMIND_TOKEN` (Pflicht, secret) + `KNOWMIND_API_URL` (Standard `https://knowmind.de`) |
| Remote-Endpoint (optional) | `https://knowmind.de/api/mcp/v1` (streamable-HTTP, Bearer) |

> **Namespace ist case-sensitive.** `io.github.Schubeler-Consulting` muss exakt dem GitHub-Org-Login
> entsprechen, sonst lehnt die Registry den Publish mit 403 ab. `mcpName` (npm) UND `server.json` `name`
> müssen identisch sein — sonst scheitert die npm-Ownership-Validierung der Registry.

## Release-Schritte (neue Version X.Y.Z)

**Der EINZIGE manuelle Schritt mit menschlichem Eingriff ist der npm-Publish (2FA).** Alles Nachgelagerte
(server.json, offizielle Registry, Aggregatoren) hält der Automatismus selbst auf Stand — siehe unten.

1. **Code-Quelle:** `Programmieren/knowmind-cli/` (npm-Source). Repo-Spiegel: `Programmieren/knowmind/`.
2. `package.json`: `version` → X.Y.Z (mcpName unverändert lassen). CHANGELOG-Eintrag schreiben.
3. **npm publish:** `npm publish --access public` (Login `schuebeler_consulting`; bei 2FA `--otp=<code>`).
   Das ist der einzige Schritt, der 2FA braucht.
4. Fertig. Der Rest passiert automatisch (spätestens beim nächsten täglichen Wächter-Lauf, sofort per
   `gh workflow run distribution-consistency.yml`):
   - `scripts/sync-server-json.mjs` setzt `server.json` auf npm-latest (kein Handpflegen mehr).
   - der OIDC-Workflow publiziert in die offizielle MCP-Registry.
   - `scripts/check-distribution.mjs` verifiziert alle Kanäle; bei Drift wird der Lauf rot (GitHub mailt).
5. **Hermes-Pin** angleichen (noch manuell): `knowmind-hermes/hermes-catalog/knowmind/manifest.yaml`
   → `knowmind@X.Y.Z` (args + version).
6. Verifizieren (macht auch der Wächter): `npm view knowmind version` = X.Y.Z ·
   `npx -y knowmind@X.Y.Z mcp` → `serverInfo.version` = X.Y.Z ·
   `curl "https://registry.modelcontextprotocol.io/v0/servers?search=knowmind"` → X.Y.Z, status active, isLatest.

## Strukturelle Absicherung (Drift-Schutz)

- **`scripts/check-distribution.mjs`** — Wächter: vergleicht package.json ↔ npm-latest ↔ server.json ↔
  MCP-Registry. Exit 1 bei Drift (package.json vor npm = Hinweis, kein Fehler). Lokal `node scripts/check-distribution.mjs`.
- **`scripts/sync-server-json.mjs`** — setzt server.json auf npm-latest (Anker = die veröffentlichte Version,
  NICHT package.json, weil die Registry npm-Existenz validiert).
- **`.github/workflows/distribution-consistency.yml`** — täglicher Cron + bei jedem Push auf package.json/
  server.json: prüft, heilt den Registry-Teil selbst (server.json syncen + committen + publizieren), meldet Rest.
- **`.github/workflows/publish-mcp-registry.yml`** — zieht server.json vor jedem Publish auf npm-latest.

Damit ist die frühere Drift (npm 0.3.0, Registry 0.1.15, server.json 0.1.26 gleichzeitig) strukturell ausgeschlossen.

## Wo knowmind gelistet ist / wird

- **npm:** https://www.npmjs.com/package/knowmind
- **Offizielle MCP-Registry:** `io.github.Schubeler-Consulting/knowmind` (Quelle für die Aggregatoren)
- **Auto-Discovery (folgt der Registry, keine Extra-Arbeit):** PulseMCP, GitHub-MCP-Registry (→ VS Code `@mcp`, Cursor), Glama (`glama.json` = Maintainer), mcp.so
- **Hermes:** `knowmind-hermes/hermes-catalog/knowmind/manifest.yaml` (Upstream-PR an NousResearch/hermes-agent offen)
- **Manuell:** awesome-mcp-servers (PR), Smithery (Account), Cline (Logo+Issue), Docker MCP (niedrige Prio)

## Optionale Marken-Aufwertung: `de.knowmind/knowmind`

Statt `io.github.Schubeler-Consulting/…` ginge der noch sauberere Domain-Namespace `de.knowmind/knowmind`
per DNS-Verifizierung. knowmind.de liegt bei All-Inkl/KAS (ns5/ns6.kasserver.com). Schritte:
`mcp-publisher` Keypair erzeugen → DNS-TXT am APEX `knowmind.de` (`v=MCPv1; k=ed25519; p=<pubkey>`) →
`mcp-publisher login dns --domain knowmind.de --private-key <key>` → `mcpName`/`server.json name` auf
`de.knowmind/knowmind` umstellen, neue npm-Version, republish. Erfordert DNS-Zugriff (KAS).
