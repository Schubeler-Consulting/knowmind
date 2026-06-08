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

1. **Code-Quelle:** `Programmieren/knowmind-cli/` (npm-Source). Repo-Spiegel: `Programmieren/knowmind/`.
2. `package.json`: `version` → X.Y.Z (mcpName unverändert lassen). CHANGELOG-Eintrag schreiben.
3. **npm publish:** `cd knowmind-cli && npm publish --access public` (Login `schuebeler_consulting`; bei 2FA `--otp=<code>`).
4. `server.json`: `version` (oben + `packages[].version`) → X.Y.Z. `mcp-publisher validate` (CLI) → muss „valid" sein.
   - Achtung: `description` ≤ 100 Zeichen (Registry-Limit).
5. Repo-Spiegel synchronisieren (README/CHANGELOG/package.json/server.json kopieren), commit + push.
6. **Offizielle Registry:** automatisch über GitHub-Actions-OIDC — `.github/workflows/publish-mcp-registry.yml`
   per Tag `v*` ODER `gh workflow run publish-mcp-registry.yml`. Kein Device-Code, kein Secret nötig
   (die Org-OIDC-Identität autorisiert `io.github.Schubeler-Consulting/*`).
7. **Hermes-Pin** angleichen: `knowmind-hermes/hermes-catalog/knowmind/manifest.yaml` → `knowmind@X.Y.Z` (args + version).
8. Verifizieren:
   - `npm view knowmind version` = X.Y.Z
   - `npx -y knowmind@X.Y.Z mcp` → `serverInfo.version` = X.Y.Z
   - `curl "https://registry.modelcontextprotocol.io/v0/servers?search=knowmind"` → Eintrag mit X.Y.Z, status active

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
