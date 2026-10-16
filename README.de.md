# knowmind

**Ihr KI-Assistent kennt Ihr Unternehmen nicht.** Er beginnt jedes Gespräch bei null, und Sie
erklären ihm zum wiederholten Mal dieselben Zusammenhänge. knowmind ist das Gedächtnis darunter:
Was Sie einmal ablegen, steht in Claude, ChatGPT, Cursor und Ihren eigenen Anwendungen zur
Verfügung. Betrieben in Deutschland, im Rechenzentrum Nürnberg.

**Der Privat-Tarif kostet dauerhaft nichts und verlangt keine Zahlungsdaten.** Schnittstelle,
Kommandozeile und MCP-Server sind in jedem Tarif enthalten, auch dort.

<!-- mcp-name: io.github.Schubeler-Consulting/knowmind -->

[![npm](https://img.shields.io/npm/v/knowmind)](https://www.npmjs.com/package/knowmind) · [knowmind.de](https://knowmind.de) · dieses Paket unter Apache-2.0

## Installation

```
npm install -g knowmind
```

Oder ohne Installation direkt als MCP-Server: `npx -y knowmind mcp`

## Einrichtung

1. Kostenloses Konto auf [knowmind.de](https://knowmind.de) anlegen und dort einen Zugangsschlüssel
   erzeugen: Dashboard → API-Tokens
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
npx -y knowmind install <ide>       # MCP-Server im KI-Client eintragen (install list zeigt alle Clients)
knowmind init                       # automatische Gedächtnis-Pflege im KI-Client einrichten
knowmind search "Wo läuft die OKR-App?"
knowmind upload notizen.md --title "Meeting Notizen 2026-05-12"
knowmind sync ./openwiki            # Ordner abgleichen, auch im Open Knowledge Format
knowmind stats
knowmind health
knowmind status                     # Lebenszeichen des Gedächtnisses als Bericht
knowmind status --line              # einzeilige Statusline für Ihr KI-Werkzeug
knowmind config
```

Die Statusline (`knowmind status --line`) zeigt knowmind als grüne Lampe direkt in Ihrem
KI-Werkzeug: ruhig grün, wenn erreichbar, grünes Flackern wie eine Festplatten-LED, während
knowmind arbeitet, rot bei Ausfall. `knowmind init --client claude-code` bindet sie
automatisch ein (eine bereits vorhandene eigene Statusline bleibt unangetastet).

## Automatische Pflege einrichten (`knowmind init`)

Damit Ihre KI knowmind selbsttätig pflegt — in Claude Code **Recall vor jeder Aufgabe** und
**Sichern nach jeder sicherungswürdigen Runde**, in Cursor und Codex als Regel für das Modell —
richtet `knowmind init` die passenden Mechanismen für
Ihren Client ein. Der Befehl erkennt den Client an `.claude/` im Projekt, `~/.claude.json` oder
`~/.claude` (Claude Code), an `.cursor/` im Projekt oder `~/.cursor` (Cursor) und an
`~/.codex/config.toml` (Codex), oder Sie wählen ihn explizit.

```
knowmind init                          # Client automatisch erkennen
knowmind init --client claude-code     # gezielt für Claude Code
knowmind init --client cursor          # gezielt für Cursor
knowmind init --client codex           # gezielt für Codex
knowmind init --dry-run                # zeigt nur, was geschähe (schreibt nichts)
```

**Was eingerichtet wird:**

- **Claude Code** — projektlokale Hooks in `.claude/`:
  - *UserPromptSubmit* → fragt vor jeder inhaltlichen Frage knowmind ab und reicht die
    besten Treffer als Kontext nach (Memory-First, automatisch).
  - *Stop* → hält das Ende der Runde an und fordert die KI auf, mit `knowmind_store_memory` zu
    sichern, wenn die Runde Sicherungswürdiges enthielt und noch nichts gespeichert wurde. Als
    sicherungswürdig gelten Deploy oder Commit, eine neue Regel, eine Architekturentscheidung und
    geänderter Code oder geänderte Konfiguration.
  - ein **Memory-First-Block** in `./CLAUDE.md` (mit `<!-- BEGIN/END knowmind -->`-Markern).
- **Cursor** — `.cursor/rules/knowmind.mdc` mit der Memory-First-Regel (`alwaysApply`).
- **Codex** — ein Block in `AGENTS.md` (mit Markern wie bei `CLAUDE.md`): knowmind fragen, wenn
  eine Aufgabe von Entscheidungen, Absprachen oder Wissen außerhalb des Codes abhängt; Quellcode
  und Tests bleiben maßgeblich; was über die Sitzung hinaus gilt, mit `knowmind_store_memory`
  festhalten.
- **Claude Desktop / generisch** — kein Hook-Mechanismus, der die Pflege erzwingt; es wirken die
  MCP-instructions und die MCP-prompts, und der Befehl zeigt den Memory-First-Text zum manuellen
  Einfügen (siehe Grenze unten).

**Idempotent & nicht-destruktiv:** Ein zweiter Lauf erzeugt keine Duplikate
(marker-/befehls-basierte Ersetzung). Vorhandene fremde Hooks ändert init nicht. Eine vorhandene
`CLAUDE.md` oder `AGENTS.md` bekommt den markierten Block angehängt, eine vorhandene
`.claude/settings.json` die Hooks und die Statusline dazu. Trägt eine Datei den Namen einer
knowmind-Datei, aber keinen Marker, wird sie übersprungen. Mit `--dry-run` sehen Sie jede Aktion vorab.

> **Grenze der Automatik:** Eine *harte* Erzwingung der Pflege gibt es nur in Claude Code,
> dessen Hooks unabhängig vom Modell laufen. Die Regeldatei in Cursor und der Block in
> `AGENTS.md` für Codex sind Anweisungen an das Modell, ebenso in allen übrigen Clients die
> **MCP-instructions** (werden beim Verbinden gelesen) und die **MCP-prompts** — eine
> modellabhängige Steuerung ohne technische Garantie.

## MCP-Server einrichten

knowmind ist ein MCP-Server (`npx -y knowmind mcp`, stdio). Token aus dem knowmind.de-Dashboard
(→ API-Tokens) als `KNOWMIND_TOKEN`; optional `KNOWMIND_API_URL` (Standard `https://knowmind.de`).

**Claude Code**
```
claude mcp add knowmind --env KNOWMIND_TOKEN=kmt_xxx --env KNOWMIND_API_URL=https://knowmind.de -- npx -y knowmind mcp
```

**Claude Desktop / Cursor / Windsurf / Gemini CLI** (`claude_desktop_config.json`, `~/.cursor/mcp.json`, …; Zed erwartet denselben Eintrag unter `context_servers`)
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
> Windows-Hinweis: Besser `npx -y knowmind install <ide>`. Liegt `pythonw.exe` von Python 3.10 bis
> 3.14 am üblichen Ort (`%LOCALAPPDATA%\Programs\Python\Python3…` oder `C:\Python3…`), starten die
> eingetragenen Server ohne Konsolenfenster; Codex und der ausgegebene Befehl für Claude Code
> nutzen `npx` direkt. Wer von Hand einträgt und `npx` nicht direkt startet,
> nimmt `"command": "cmd"`, `"args": ["/c", "npx", "-y", "knowmind", "mcp"]`; Clients ohne eigene
> Konsole öffnen dann bei jedem Werkzeugaufruf ein Fenster.

**VS Code / GitHub Copilot** (`.vscode/mcp.json` — Top-Level `servers` + `inputs`)
```json
{
  "inputs": [{ "type": "promptString", "id": "knowmind-token", "description": "KNOWMIND_TOKEN", "password": true }],
  "servers": {
    "knowmind": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "knowmind", "mcp"],
      "env": { "KNOWMIND_TOKEN": "${input:knowmind-token}", "KNOWMIND_API_URL": "https://knowmind.de" }
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

- `knowmind_recall_memories` — Hybride Suche im Wissensspeicher des Mandanten
- `knowmind_recall_at_time` — Recall mit Zeitfilter (bi-temporal)
- `knowmind_store_memory` — Neue Erinnerung anlegen (Titel + Inhalt)
- `knowmind_upload_document` — Längeren Text als Dokument ingestieren (Upsert-per-Titel: gleicher Titel ersetzt die alte Version)
- `knowmind_update_fact` — Fakt bi-temporal aktualisieren (Historie bleibt)
- `knowmind_link_entities` — Typisierte Beziehung anlegen (Inverse wird automatisch gesetzt)
- `knowmind_unlink_entities` — Beziehung wieder entfernen (samt Inverse)
- `knowmind_list_relations` — Beziehungen einer Erinnerung auflisten
- `knowmind_list_recent` — Zuletzt angelegte Dokumente/Memories des Mandanten auflisten, sortiert nach Anlagedatum absteigend
- `knowmind_get_stats` — Statistik über gespeicherte Erinnerungen und Beziehungen
- `knowmind_get_health` — Verfügbarkeits-Status der Plattform
- `knowmind_upsert_entity` — Knoten für eine Sache anlegen (Person, Firma, Anwendung, Rechner, Technik) oder den vorhandenen zurückgeben
- `knowmind_get_schema` — Welche Entitätsklassen und Beziehungstypen dieser Arbeitsbereich kennt
- `knowmind_list_inferred` — Beziehungen, die auf eine Entscheidung warten (aus Text erschlossen oder von einem Dokument ausgehend), mit Prüfstand, Herkunft und Beleg
- `knowmind_review_inferred` — Entscheidung zu einer solchen Beziehung festhalten: bestätigen, verwerfen (`valid_to` wird gesetzt, nichts gelöscht) oder Verwerfen zurücknehmen

Inverse-Beziehungen (z. B. `IS_EMPLOYEE_OF` zu `HAS_EMPLOYEE`) werden
serverseitig automatisch mit angelegt. Hinweis: `knowmind upload` als
CLI-Befehl läuft über die REST-Schnittstelle (`/api/documents`), nicht über MCP.


### Die bisherigen Werkzeugnamen

Sieben Werkzeuge haben am 12. September 2026 neue Namen bekommen, damit jeder
Name dem Muster `knowmind_<verb>_<objekt>` folgt und sagt, ob er liest oder
schreibt. Die bisherigen Namen antworten bis zum 31. März 2027 unverändert
weiter und stehen weiter in der Discovery, als veraltet gekennzeichnet:

| bisher | ab jetzt |
| --- | --- |
| `knowmind_recall` | `knowmind_recall_memories` |
| `knowmind_health` | `knowmind_get_health` |
| `knowmind_stats` | `knowmind_get_stats` |
| `knowmind_schema` | `knowmind_get_schema` |
| `knowmind_entity` | `knowmind_upsert_entity` |
| `knowmind_link` | `knowmind_link_entities` |
| `knowmind_unlink` | `knowmind_unlink_entities` |

Aus `knowmind_entity` wurde `upsert` und nicht `get`: Das Werkzeug legt den
Knoten an oder gibt den vorhandenen zurück. Sonst ändert sich nichts —
dieselben Parameter, dasselbe Verhalten.

## Daten in Deutschland

knowmind wird in Deutschland betrieben: Ihre Inhalte (Memories, Account- und Metadaten) werden
ausschließlich auf Servern in Deutschland (Hetzner-Rechenzentrum) gespeichert und verlassen Deutschland nicht.
Auftragsverarbeitung (AVV) nach Art. 28 DSGVO verfügbar: https://knowmind.de/legal/avv

**Hinweis (Bring-your-own-Key):** Wenn Sie eigene Schlüssel externer KI-Anbieter hinterlegen, werden Ihre
Anfragen direkt an den von Ihnen gewählten Anbieter übermittelt. Sitzt dieser außerhalb der EU, kann dabei
ein Drittlandtransfer stattfinden, für den Sie als Verantwortlicher zuständig sind.

## Haftung & Nutzung (Disclaimer)

- **Software:** Dieses Paket steht unter der **Apache-Lizenz 2.0** und wird „AS IS“ ohne jegliche
  Gewährleistung bereitgestellt; die Haftung ist im Rahmen der Lizenz (Abschnitte 7 und 8)
  ausgeschlossen bzw. beschränkt. Siehe `LICENSE`.
- **Eigenes Konto, eigener Token:** knowmind bündelt keine Zugangsdaten. Sie nutzen Ihren eigenen
  knowmind.de-Account und API-Token. Anlegen: https://knowmind.de/dashboard/tokens
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

---

Die englische Fassung steht in [README.md](README.md).
