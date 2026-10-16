// `knowmind install <ide>` — schreibt die MCP-Server-Konfiguration für knowmind
// in die richtige Datei der jeweiligen IDE. Drei Schema-Familien decken alle
// gängigen Clients ab:
//
//   1. `mcpServers`     → Cursor, Windsurf, Antigravity, Claude Desktop, Claude Code (Projekt)
//   2. `servers`+inputs → VS Code (eigener Secret-Prompt)
//   3. `context_servers`→ Zed
//
// Secret-Politik (R5): das Token wird NICHT im Klartext in Config-Dateien
// geschrieben. Wo die IDE Interpolation kann, verweisen wir auf die Umgebung
// (`${env:KNOWMIND_TOKEN}` / `${input:…}` / `${KNOWMIND_TOKEN}`); wo nicht, steht
// ein Platzhalter mit Warnung. Nur mit ausdrücklichem `--token <wert>` wird ein
// literaler Wert geschrieben (dann mit Klartext-Warnung).
//
// Erneuter Aufruf (seit 0.4.4): install ersetzt nur den eigenen Eintrag und
// lässt jedes andere Byte der Datei stehen (src/konfig-text.js). Ein Token, das
// der Nutzer schon eingetragen hat, bleibt ohne --token erhalten, ebenso eigene
// Umgebungsvariablen, eigene Felder und eigene Argumente nach `mcp`. Ändert sich
// die Datei, liegt vorher eine Sicherung daneben. Ändert sich nichts, wird
// nichts geschrieben.

import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { jsonEintragSetzen, tomlEintragSetzen } from "./konfig-text.js";
import { starterAblegen, starterOrt } from "./starter.js";

const DEFAULT_API = "https://knowmind.de";
const NPX = "npx";
const NPX_ARGS = ["-y", "knowmind", "mcp"];

function home(...p) {
  return join(homedir(), ...p);
}

// OS-abhängiger App-Daten-Pfad (Windows APPDATA, macOS Application Support, sonst ~/.config).
function appData(...p) {
  if (platform() === "win32") {
    return join(process.env.APPDATA || home("AppData", "Roaming"), ...p);
  }
  if (platform() === "darwin") {
    return home("Library", "Application Support", ...p);
  }
  return join(process.env.XDG_CONFIG_HOME || home(".config"), ...p);
}

// ── IDE-Registry ──────────────────────────────────────────────────────────
// family: "mcpServers" | "servers" | "context_servers" | "toml"
// secret: "env" | "input" | "shell" | "literal-only"  (Default-Referenzstil)
const IDES = {
  cursor: {
    label: "Cursor",
    family: "mcpServers",
    secret: "env",
    globalPath: () => home(".cursor", "mcp.json"),
    projectPath: (cwd) => join(cwd, ".cursor", "mcp.json"),
  },
  vscode: {
    label: "VS Code",
    family: "servers",
    secret: "input",
    globalPath: () => appData("Code", "User", "mcp.json"),
    projectPath: (cwd) => join(cwd, ".vscode", "mcp.json"),
  },
  windsurf: {
    label: "Windsurf",
    family: "mcpServers",
    secret: "env",
    globalPath: () => home(".codeium", "windsurf", "mcp_config.json"),
    projectPath: null,
  },
  antigravity: {
    label: "Google Antigravity",
    family: "mcpServers",
    secret: "literal-only",
    globalPath: () => home(".gemini", "config", "mcp_config.json"),
    projectPath: null,
  },
  zed: {
    label: "Zed",
    family: "context_servers",
    secret: "literal-only",
    globalPath: () => (platform() === "win32" ? appData("Zed", "settings.json") : home(".config", "zed", "settings.json")),
    projectPath: (cwd) => join(cwd, ".zed", "settings.json"),
  },
  "claude-desktop": {
    label: "Claude Desktop",
    family: "mcpServers",
    secret: "literal-only",
    globalPath: () => appData("Claude", "claude_desktop_config.json"),
    projectPath: null,
  },
  gemini: {
    label: "Gemini CLI",
    family: "mcpServers",
    secret: "literal-only",
    globalPath: () => home(".gemini", "settings.json"),
    projectPath: (cwd) => join(cwd, ".gemini", "settings.json"),
  },
  codex: {
    label: "Codex CLI",
    family: "toml",
    secret: "literal-only",
    globalPath: () => home(".codex", "config.toml"),
    projectPath: null,
  },
  "claude-code": {
    label: "Claude Code",
    family: "mcpServers",
    secret: "shell",
    globalPath: null, // user-scope: via `claude mcp add` (siehe printClaudeCode)
    projectPath: (cwd) => join(cwd, ".mcp.json"),
  },
  jetbrains: {
    label: "JetBrains (IntelliJ/PyCharm)",
    family: "mcpServers",
    secret: "literal-only",
    globalPath: null, // GUI-basiert: Snippet ausgeben
    projectPath: null,
  },
};

// Token-Referenz je Secret-Stil. literalToken überschreibt (nur mit --token).
function tokenRef(secretStyle, literalToken) {
  if (literalToken) return literalToken;
  switch (secretStyle) {
    case "env":
      return "${env:KNOWMIND_TOKEN}";
    case "shell":
      return "${KNOWMIND_TOKEN}";
    case "input":
      return "${input:knowmind-token}";
    default:
      return "<KNOWMIND_TOKEN — siehe `knowmind login`>";
  }
}

/**
 * Startbefehl für den MCP-Server.
 *
 * Unter Windows nicht direkt `npx`: Das ist ein Konsolenprogramm, und hat der
 * KI-Client keine eigene Konsole (Desktop-Anwendung, IDE-Erweiterung), gibt
 * Windows dem Kind bei JEDEM Werkzeugaufruf ein eigenes Fenster. Das blitzt
 * nicht nur, es stiehlt den Tastaturfokus mitten im Tippen. Johann am
 * 10.08.2026: „Viele werden es deshalb deinstallieren." — und er hat recht.
 *
 * Deshalb dazwischen `pythonw.exe` (GUI-Programm, öffnet selbst kein Fenster),
 * das npx in einer versteckten Konsole startet und die Datenströme durchreicht.
 * Ohne Python auf dem Rechner bleibt es beim direkten npx-Aufruf — eine
 * ehrliche Grenze ist besser als eine halbe Lösung.
 *
 * Der Starter liegt seit 0.4.4 unter ~/.knowmind/ (src/starter.js), nicht mehr
 * im Paketverzeichnis: Das liegt nach `npx -y knowmind install` im
 * npx-Zwischenspeicher und verschwindet, wenn der geleert wird.
 *
 * `umgebung` (nur für Prüffälle): plattform, pythonw (Pfad oder null), heim.
 */
function startBefehl(umgebung = {}) {
  const pythonw = "pythonw" in umgebung ? umgebung.pythonw : findePythonwFuerMcp(umgebung.plattform);
  if (!pythonw) return { command: NPX, args: [...NPX_ARGS], starter: false };
  return { command: pythonw, args: [starterOrt(umgebung.heim), NPX, ...NPX_ARGS], starter: true };
}

/** Vollständiger Pfad zu pythonw.exe, oder null. */
function findePythonwFuerMcp(plattform = platform()) {
  if (plattform !== "win32") return null;
  const kandidaten = [];
  const lokal = process.env.LOCALAPPDATA;
  for (const v of ["314", "313", "312", "311", "310"]) {
    if (lokal) kandidaten.push(join(lokal, "Programs", "Python", `Python${v}`, "pythonw.exe"));
    kandidaten.push(join("C:\\", `Python${v}`, "pythonw.exe"));
  }
  return kandidaten.find((p) => existsSync(p)) ?? null;
}

/** Argumente, die der Nutzer hinter `mcp` angehängt hat. */
function eigeneArgumente(alt) {
  const args = Array.isArray(alt?.args) ? alt.args : [];
  const stelle = args.lastIndexOf("mcp");
  return stelle >= 0 ? args.slice(stelle + 1) : [];
}

// Server-Eintrag im Schema der Familie. `alt` ist der bisherige Eintrag (oder
// null): eigene Felder, Umgebungsvariablen, ein eingetragenes Token und eigene
// Argumente nach `mcp` bleiben erhalten.
function serverEntry(ide, { apiUrl, apiGegeben, literalToken, umgebung }, alt = null) {
  // Nur ein lokaler Eintrag (mit command) wird fortgeschrieben. Ein Eintrag
  // anderer Art unter dem Namen knowmind (etwa url für einen Fernzugang) wird
  // ganz ersetzt, sonst entstünde eine Mischung, die kein Client versteht.
  const lokal = alt && typeof alt === "object" && typeof alt.command === "string" ? alt : null;
  const altEnv = lokal && typeof lokal.env === "object" && lokal.env ? lokal.env : {};
  const env = { ...altEnv };
  if (literalToken || !("KNOWMIND_TOKEN" in env)) env.KNOWMIND_TOKEN = tokenRef(ide.secret, literalToken);
  if (apiGegeben || !("KNOWMIND_API_URL" in env)) env.KNOWMIND_API_URL = apiUrl;
  const { command, args } = startBefehl(umgebung);
  const eintrag = { ...(lokal || {}), command, args: [...args, ...eigeneArgumente(lokal)], env };
  if (ide.family === "servers") return { type: "stdio", ...eintrag };
  return eintrag;
}

// Vollständiges Snippet (für --print / GUI-IDEs).
function snippet(ide, opts) {
  const entry = serverEntry(ide, opts);
  if (ide.family === "servers") {
    return {
      inputs: [{ type: "promptString", id: "knowmind-token", description: "KNOWMIND_TOKEN", password: true }],
      servers: { knowmind: entry },
    };
  }
  return { [ide.family]: { knowmind: entry } };
}

// ── TOML (Codex CLI) ────────────────────────────────────────────────────────
// Codex läuft im Terminal und hat eine Konsole: npx direkt, ohne Starter.
function tomlBlock(opts) {
  const token = tokenRef("literal-only", opts.literalToken);
  return [
    "[mcp_servers.knowmind]",
    `command = "${NPX}"`,
    `args = [${NPX_ARGS.map((a) => `"${a}"`).join(", ")}]`,
    "",
    "[mcp_servers.knowmind.env]",
    `KNOWMIND_TOKEN = "${token}"`,
    `KNOWMIND_API_URL = "${opts.apiUrl}"`,
  ].join("\n");
}

function mergeToml(text, opts) {
  const token = tokenRef("literal-only", opts.literalToken);
  const env = {};
  const envFallsFehlt = {};
  (opts.literalToken ? env : envFallsFehlt).KNOWMIND_TOKEN = token;
  (opts.apiGegeben ? env : envFallsFehlt).KNOWMIND_API_URL = opts.apiUrl;
  return tomlEintragSetzen(text, { command: NPX, args: NPX_ARGS, env, envFallsFehlt });
}

// Setzt den knowmind-Eintrag in den JSON-Text, ohne den Rest anzufassen.
function mergeInto(text, ide, opts) {
  const fach = ide.family === "servers" ? "servers" : ide.family;
  const zusatzListe = ide.family === "servers"
    ? {
        fach: "inputs",
        element: { type: "promptString", id: "knowmind-token", description: "KNOWMIND_TOKEN", password: true },
        gleich: (i) => i && i.id === "knowmind-token",
      }
    : undefined;
  return jsonEintragSetzen(text, fach, "knowmind", (alt) => serverEntry(ide, opts, alt), { zusatzListe }).text;
}

function stempel(d = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

/**
 * Schreibt `neu` nach `path`, wenn es sich vom Bestand unterscheidet. Vorher
 * liegt eine Sicherung daneben. Rückgabe: "neu", "geändert" oder "unverändert".
 */
function schreibenMitSicherung(path, alt, neu) {
  if (alt === neu) return { ergebnis: "unverändert" };
  mkdirSync(dirname(path), { recursive: true });
  let sicherung = null;
  if (alt !== null) {
    sicherung = `${path}.knowmind-sicherung-${stempel()}`;
    copyFileSync(path, sicherung);
  }
  writeFileSync(path, neu, "utf-8");
  return { ergebnis: alt === null ? "neu" : "geändert", sicherung };
}

function meldung(ide, path, { ergebnis, sicherung }) {
  if (ergebnis === "unverändert") return `✓ ${ide.label}: Eintrag in ${path} ist aktuell, nichts geschrieben`;
  if (ergebnis === "neu") return `✓ ${ide.label}: knowmind eingetragen in ${path}`;
  return `✓ ${ide.label}: knowmind-Eintrag in ${path} aktualisiert (Sicherung: ${sicherung})`;
}

// Der Name steht vor den --env-Angaben. `-e, --env <env...>` nimmt beliebig
// viele Werte; stand der Name dahinter (bis 0.4.4), las Claude Code ihn als
// weitere Variable und brach ab: „Invalid environment variable format:
// knowmind“ (gemessen 16.10.2026 mit Claude Code 2.1.301). So steht es auch im
// Beispiel von `claude mcp add --help`: Name, dann -e, dann `--` und der Befehl.
function claudeCodeBefehl(opts) {
  const tokenArg = opts.literalToken ? opts.literalToken : "$KNOWMIND_TOKEN";
  return (
    `  claude mcp add --scope user --transport stdio knowmind \\\n` +
    `    --env KNOWMIND_TOKEN=${tokenArg} \\\n` +
    `    --env KNOWMIND_API_URL=${opts.apiUrl} \\\n` +
    `    -- npx -y knowmind mcp\n`
  );
}

function printClaudeCodeCommand(opts) {
  console.log("Claude Code (User-Scope, alle Projekte) — diesen Befehl ausführen:\n");
  console.log(claudeCodeBefehl(opts));
  console.log("Für ein einzelnes Projekt stattdessen: knowmind install claude-code --project\n");
}

// Für die Prüffälle (src/starterpfad.test.js, src/install.test.js): Sie decken
// jeden Client ab, den diese Liste kennt, auch einen, der später dazukommt.
export const _internals = { IDES, serverEntry, mergeInto, mergeToml, startBefehl, findePythonwFuerMcp, claudeCodeBefehl };

// ── Hauptbefehl ─────────────────────────────────────────────────────────────
// `cwd` und `umgebung` nur für Prüffälle.
export function runInstall(opts) {
  const { ideKey, project, dryRun, printOnly, apiUrl, literalToken } = opts;

  if (!ideKey || ideKey === "list") {
    console.log("knowmind install <ide> [--project] [--print] [--token <wert>] [--api <url>]\n");
    console.log("Unterstützte IDEs:");
    for (const [key, ide] of Object.entries(IDES)) console.log(`  ${key.padEnd(16)} ${ide.label}`);
    console.log("  all              alle dateibasierten IDEs auf einmal");
    console.log("\nStandard: globale Config, Token als Referenz (kein Klartext). --project schreibt projektlokal.");
    return;
  }

  const targets = ideKey === "all" ? Object.keys(IDES) : [ideKey];
  if (ideKey !== "all" && !IDES[ideKey]) {
    throw new Error(`Unbekannte IDE: ${ideKey}. \`knowmind install list\` zeigt alle.`);
  }
  if (literalToken) {
    console.warn("WARNUNG: --token schreibt das Token im KLARTEXT in die Config-Datei(en).\n");
  }

  const cwd = opts.cwd || process.cwd();
  const entryOpts = { apiUrl: apiUrl || DEFAULT_API, apiGegeben: Boolean(apiUrl), literalToken, umgebung: opts.umgebung };
  let starterBereit = false;
  const starterSicherstellen = () => {
    if (starterBereit || dryRun || !startBefehl(opts.umgebung).starter) return;
    const ergebnis = starterAblegen({ ziel: starterOrt(opts.umgebung?.heim) });
    if (ergebnis !== "aktuell") console.log(`✓ Starter ${ergebnis}: ${starterOrt(opts.umgebung?.heim)}`);
    starterBereit = true;
  };

  for (const key of targets) {
    const ide = IDES[key];

    // Reine Snippet-/GUI-Fälle.
    if (printOnly || (key === "jetbrains") || (key === "claude-code" && !project)) {
      if (key === "claude-code" && !project) {
        printClaudeCodeCommand(entryOpts);
        continue;
      }
      if (!printOnly && ide.family !== "toml") starterSicherstellen();
      console.log(`# ${ide.label} — Snippet (manuell einfügen):`);
      console.log(ide.family === "toml" ? tomlBlock(entryOpts) : JSON.stringify(snippet(ide, entryOpts), null, 2));
      if (printOnly && ide.family !== "toml" && startBefehl(opts.umgebung).starter && !existsSync(starterOrt(opts.umgebung?.heim))) {
        console.log(`# Der Eintrag startet über ${starterOrt(opts.umgebung?.heim)}; die Datei fehlt noch.`);
        console.log(`# \`knowmind install ${key}\` ohne --print legt sie ab.`);
      }
      console.log("");
      continue;
    }

    // TOML-Ziel (Codex): Text mergen statt JSON.
    if (ide.family === "toml") {
      const tomlPath = project ? (ide.projectPath && ide.projectPath(cwd)) : ide.globalPath();
      if (!tomlPath) {
        console.log(`# ${ide.label}: kein ${project ? "Projekt" : "globaler"}-Dateipfad — Snippet:`);
        console.log(tomlBlock(entryOpts));
        continue;
      }
      const alterText = existsSync(tomlPath) ? readFileSync(tomlPath, "utf-8") : null;
      let neuerText;
      try {
        neuerText = mergeToml(alterText ?? "", entryOpts);
      } catch (fehler) {
        console.error(`! ${ide.label}: ${tomlPath} — ${fehler.message}. Übersprungen, nichts geschrieben.`);
        continue;
      }
      if (dryRun) {
        console.log(`# ${ide.label} — DRY RUN → ${tomlPath}`);
        console.log(neuerText);
        continue;
      }
      const ergebnis = schreibenMitSicherung(tomlPath, alterText, neuerText);
      console.log(meldung(ide, tomlPath, ergebnis));
      if (!literalToken && ergebnis.ergebnis === "neu") {
        console.log(`    → Platzhalter gesetzt: KNOWMIND_TOKEN in ${tomlPath} durch dein Token ersetzen.`);
      }
      continue;
    }

    const path = project ? (ide.projectPath && ide.projectPath(cwd)) : (ide.globalPath && ide.globalPath());
    if (!path) {
      // Kein Datei-Ziel für diesen Scope → Snippet zeigen.
      starterSicherstellen();
      console.log(`# ${ide.label}: kein ${project ? "Projekt" : "globaler"}-Dateipfad bekannt — Snippet:`);
      console.log(JSON.stringify(snippet(ide, entryOpts), null, 2));
      console.log("");
      continue;
    }

    const alterText = existsSync(path) ? readFileSync(path, "utf-8") : null;
    let neuerText;
    try {
      neuerText = mergeInto(alterText ?? "", ide, entryOpts);
    } catch (fehler) {
      console.error(`! ${ide.label}: ${path} ist nicht lesbar (${fehler.message}) — übersprungen, nicht überschrieben.`);
      continue;
    }

    if (dryRun) {
      console.log(`# ${ide.label} — DRY RUN → ${path}`);
      console.log(neuerText);
      console.log("");
      continue;
    }

    starterSicherstellen();
    const ergebnis = schreibenMitSicherung(path, alterText, neuerText);
    console.log(meldung(ide, path, ergebnis));
    if (ergebnis.ergebnis === "unverändert") continue;
    if (literalToken) {
      console.log(`    → ${ide.label} neu starten — fertig.`);
    } else if (ide.secret === "env") {
      console.log(`    → setze KNOWMIND_TOKEN in deiner Umgebung (oder nutze --token).`);
    } else if (ide.secret === "literal-only" && ergebnis.ergebnis === "neu") {
      console.log(`    → Platzhalter gesetzt: KNOWMIND_TOKEN in ${path} durch dein Token ersetzen.`);
    } else if (ide.secret === "shell") {
      console.log(`    → ${path} nutzt \${KNOWMIND_TOKEN} aus der Umgebung (git-sicher).`);
    }
  }

  // Wer ohne --token installiert, braucht noch einen Token aus einem (kostenlosen)
  // Konto — genau hier scheitern Erstnutzer. Daher der klare Weg zum Abschluss.
  if (!literalToken && !dryRun && !printOnly) {
    const base = apiUrl || DEFAULT_API;
    console.log(
      "\nNoch kein Token? knowmind ist im kostenlosen Tarif voll nutzbar (bis 2.500 Erinnerungen):\n" +
        `  1. Konto anlegen:  ${base}/signin?mode=register\n` +
        `  2. Token erzeugen: ${base}/dashboard/tokens\n` +
        "  3. knowmind login --token kmt_...   (oder KNOWMIND_TOKEN setzen)\n",
    );
  }
}
