# knowmind

**Das Agentengehirn aus Deutschland.** Langzeitgedächtnis und Wissensgraph für Ihre KI —
CLI + MCP-Server. Inhalte und Server in Deutschland (Hetzner-Rechenzentrum).

<!-- mcp-name: io.github.Schubeler-Consulting/knowmind -->

[![npm](https://img.shields.io/npm/v/knowmind)](https://www.npmjs.com/package/knowmind) · Apache-2.0 · [knowmind.de](https://knowmind.de)

## Installation

```
npm install -g knowmind
```

Oder ohne Installation direkt als MCP-Server: `npx -y knowmind mcp`

## Setup

1. Token auf knowmind.de anlegen: Dashboard → API-Tokens
2. Lokal speichern:

```
knowmind login --token kmt_xxxxxxxx
```

Alternativ über ENV:

```
export KNOWMIND_TOKEN=kmt_xxxxxxxx
export KNOWMIND_API_URL=https://knowmind.de
```

## Befehle

```
npx -y knowmind install <ide>       MCP-Server im KI-Client verdrahten (claude, cursor, vscode …)
knowmind init                       Automatische Gedächtnis-Pflege im KI-Client einrichten
knowmind search "Wo läuft die OKR-App?"
knowmind upload notizen.md --title "Meeting Notizen 2026-05-12"
knowmind stats
knowmind health
knowmind config
```

## Automatische Pflege einrichten (`knowmind init`)

Damit Ihre KI knowmind selbsttätig pflegt — **Recall vor jeder Aufgabe**, **Sichern nach
jeder sicherungswürdigen Runde** — richtet `knowmind init` die passenden Mechanismen für
Ihren Client ein. Der Befehl erkennt den Client am Projekt- und Home-Verzeichnis
(`.claude/`, `.cursor/`, `~/.codex/`) oder Sie wählen ihn explizit.

```
knowmind init                          # Client automatisch erkennen
knowmind init --client claude-code     # gezielt für Claude Code
knowmind init --client cursor          # gezielt für Cursor
knowmind init --dry-run                # zeigt nur, was geschähe (schreibt nichts)
```

**Was eingerichtet wird:**

- **Claude Code** — projektlokale Hooks in `.claude/`:
  - *UserPromptSubmit* → ruft vor jeder echten Frage `knowmind_recall` auf und reicht die
    Top-Treffer als Kontext nach (Memory-First, automatisch).
  - *Stop* → erinnert die KI daran, mit `knowmind_store_memory` zu sichern, wenn die Runde
    Sicherungswürdiges enthielt (Deploy/Commit, neue Regel, Entscheidung) und noch nichts
    gespeichert wurde.
  - ein **Memory-First-Block** in `./CLAUDE.md` (mit `<!-- BEGIN/END knowmind -->`-Markern).
- **Cursor** — `.cursor/rules/knowmind.mdc` mit der Memory-First-Regel (`alwaysApply`).
- **Claude Desktop / Codex / generisch** — kein automatischer Hook-Mechanismus vorhanden;
  der Befehl zeigt den Memory-First-Text zum manuellen Einfügen (siehe Grenze unten).

**Idempotent & nicht-destruktiv:** Ein zweiter Lauf erzeugt keine Duplikate
(marker-/befehls-basierte Ersetzung); bestehende fremde Dateien und Hooks bleiben
unangetastet. Mit `--dry-run` sehen Sie jede Aktion vorab.

> **Grenze der Automatik:** Eine *harte* Erzwingung der Pflege gibt es nur in Clients mit
> Hook-/Rule-Mechanismus (Claude Code, Cursor). In Clients ohne solchen Mechanismus
> (z. B. Claude Desktop, Codex CLI) greifen die **MCP-instructions** (werden beim
> Verbinden gelesen) und die **MCP-prompts** — eine modellabhängige Steuerung ohne
> technische Garantie.

## MCP-Server einrichten

knowmind ist ein MCP-Server (`npx -y knowmind mcp`, stdio). Token aus dem knowmind.de-Dashboard
(→ API-Tokens) als `KNOWMIND_TOKEN`; optional `KNOWMIND_API_URL` (Standard `https://knowmind.de`).

**Claude Code**
```
claude mcp add knowmind --env KNOWMIND_TOKEN=kmt_xxx --env KNOWMIND_API_URL=https://knowmind.de -- npx -y knowmind mcp
```

**Claude Desktop / Cursor / Windsurf / Cline / Continue / Goose / Zed** (`claude_desktop_config.json`, `~/.cursor/mcp.json`, …)
```json
{
  "mcpServers": {
    "knowmind": {
      "command": "npx",
      "args": ["-y", "knowmind", "mcp"],
      "env": { "KNOWMIND_TOKEN": "kmt_xxx", "KNOWMIND_API_URL": "https://knowmind.de" }
    }
  }
}
```
> Windows-Hinweis: falls `npx` nicht direkt startet, `"command": "cmd"`, `"args": ["/c", "npx", "-y", "knowmind", "mcp"]`.

**VS Code / GitHub Copilot** (`.vscode/mcp.json` — Top-Level `servers` + `inputs`)
```json
{
  "inputs": [{ "id": "knowmind_token", "type": "promptString", "description": "Knowmind API token", "password": true }],
  "servers": {
    "knowmind": {
      "command": "npx",
      "args": ["-y", "knowmind", "mcp"],
      "env": { "KNOWMIND_TOKEN": "${input:knowmind_token}", "KNOWMIND_API_URL": "https://knowmind.de" }
    }
  }
}
```

**Codex CLI** (`~/.codex/config.toml`)
```toml
[mcp_servers.knowmind]
command = "npx"
args = ["-y", "knowmind", "mcp"]
env = { KNOWMIND_TOKEN = "kmt_xxx", KNOWMIND_API_URL = "https://knowmind.de" }
```

**Gemini CLI** (`~/.gemini/settings.json`) — gleiche `mcpServers`-Struktur wie Claude Desktop.

**Remote (ohne lokale Installation)** — für Clients mit HTTP-MCP-Support direkt der gehostete Endpoint:
```json
{ "type": "http", "url": "https://knowmind.de/api/mcp/v1", "headers": { "Authorization": "Bearer kmt_xxx" } }
```

Token kann statt per `env` auch lokal via `knowmind login --token kmt_xxx` (→ `~/.knowmind/config.json`) hinterlegt werden.

## Tools (im MCP-Modus)

Der MCP-Modus ist seit 0.1.18 ein reiner Proxy auf die Plattform: Tool-Namen,
Schemas und Safety-Annotations kommen direkt vom Server und sind damit immer
identisch mit dem Remote-Connector (`https://knowmind.de/api/mcp/v1`).

- `knowmind_recall` — Hybride Suche im Wissensspeicher des Mandanten
- `knowmind_recall_at_time` — Recall mit Zeitfilter (bi-temporal)
- `knowmind_store_memory` — Neue Erinnerung anlegen (Titel + Inhalt)
- `knowmind_upload_document` — Längeren Text als Dokument ingestieren (Upsert-per-Titel: gleicher Titel ersetzt die alte Version)
- `knowmind_update_fact` — Fakt bi-temporal aktualisieren (Historie bleibt)
- `knowmind_link` — Typisierte Beziehung anlegen (Inverse wird automatisch gesetzt)
- `knowmind_unlink` — Beziehung wieder entfernen (samt Inverse)
- `knowmind_list_relations` — Beziehungen einer Erinnerung auflisten
- `knowmind_list_recent` — Zuletzt angelegte Dokumente/Memories des Mandanten auflisten, sortiert nach Anlagedatum absteigend
- `knowmind_stats` — Statistik über gespeicherte Erinnerungen und Beziehungen
- `knowmind_health` — Verfügbarkeits-Status der Plattform

Inverse-Beziehungen (z. B. `IS_EMPLOYEE_OF` zu `HAS_EMPLOYEE`) werden
serverseitig automatisch mit angelegt. Hinweis: `knowmind upload` als
CLI-Befehl läuft über die REST-Schnittstelle (`/api/documents`), nicht über MCP.

## Daten in Deutschland

knowmind ist das Agentengehirn aus Deutschland: Ihre Inhalte (Memories, Account- und Metadaten) werden
ausschließlich auf Servern in Deutschland (Hetzner-Rechenzentrum) gespeichert und verlassen Deutschland nicht.
Auftragsverarbeitung (AVV) nach Art. 28 DSGVO verfügbar: https://knowmind.de/legal/avv

**Hinweis (Bring-your-own-Key):** Wenn Sie eigene Schlüssel externer KI-Anbieter hinterlegen, werden Ihre
Anfragen direkt an den von Ihnen gewählten Anbieter übermittelt. Sitzt dieser außerhalb der EU, kann dabei
ein Drittlandtransfer stattfinden, für den Sie als Verantwortlicher zuständig sind.

## Haftung & Nutzung (Disclaimer)

- **Software:** Dieses Paket steht unter der **Apache-Lizenz 2.0** und wird „AS IS" ohne jegliche
  Gewährleistung bereitgestellt; die Haftung ist im Rahmen der Lizenz (Abschnitte 7 und 8)
  ausgeschlossen bzw. beschränkt. Siehe `LICENSE`.
- **Eigenes Konto, eigener Token:** knowmind bündelt keine Zugangsdaten. Sie nutzen Ihren eigenen
  knowmind.de-Account und API-Token. Anlegen: https://knowmind.de/dashboard/api-tokens
- **Eigene Kosten/Verbrauch:** Jede Nutzung (API-Anfragen, Token-/Kontingentverbrauch, ggf.
  modellbezogene Kosten) erfolgt über Ihren eigenen Account und auf Ihre Verantwortung. Verbrauch
  und Kosten sind im knowmind.de-Dashboard transparent einsehbar.
- **Service-Bedingungen:** Für die Nutzung der gehosteten Plattform gelten die AGB und die
  Datenschutzerklärung von knowmind.de:
  [AGB](https://knowmind.de/legal/agb) · [Datenschutz](https://knowmind.de/legal/datenschutz) ·
  [AVV](https://knowmind.de/legal/avv) · [Impressum](https://knowmind.de/legal/impressum)
- **Kein Einsatz in sicherheitskritischen Bereichen:** knowmind ist ein Gedächtnis-/Recall-Dienst und
  **nicht** für den Betrieb von selbstfahrenden Fahrzeugen, kritischer Infrastruktur, medizinischen oder
  lebenserhaltenden Systemen oder sonstigen Anwendungen bestimmt, bei denen ein Fehler oder Ausfall zu Tod,
  Personen-, Umwelt- oder schweren Sachschäden führen kann. Ein Einsatz in solchen Umgebungen erfolgt auf
  alleiniges Risiko des Nutzers.

Anbieter: Schübeler Consulting — Johann Jörgen Schübeler. Kontakt: info@schuebeler-consulting.de
