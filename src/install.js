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

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

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
// family: "mcpServers" | "servers" | "context_servers" | "command"
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

// Server-Eintrag im Schema der Familie.
function serverEntry(ide, { apiUrl, literalToken }) {
  const env = {
    KNOWMIND_TOKEN: tokenRef(ide.secret, literalToken),
    KNOWMIND_API_URL: apiUrl,
  };
  if (ide.family === "servers") {
    // VS Code verlangt einen Transport-Typ.
    return { type: "stdio", command: NPX, args: NPX_ARGS, env };
  }
  return { command: NPX, args: NPX_ARGS, env };
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

function readJsonSafe(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null; // signalisiert: vorhandene Datei ist kaputt → nicht blind überschreiben
  }
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

// Merged knowmind in eine bestehende Config, ohne Fremd-Server zu verlieren.
function mergeInto(existing, ide, opts) {
  const cfg = existing && typeof existing === "object" ? { ...existing } : {};
  const entry = serverEntry(ide, opts);
  if (ide.family === "servers") {
    cfg.servers = { ...(cfg.servers || {}), knowmind: entry };
    const inputs = Array.isArray(cfg.inputs) ? cfg.inputs.slice() : [];
    if (!inputs.some((i) => i && i.id === "knowmind-token")) {
      inputs.push({ type: "promptString", id: "knowmind-token", description: "KNOWMIND_TOKEN", password: true });
    }
    cfg.inputs = inputs;
  } else {
    cfg[ide.family] = { ...(cfg[ide.family] || {}), knowmind: entry };
  }
  return cfg;
}

function printClaudeCodeCommand(opts) {
  const tokenArg = opts.literalToken ? opts.literalToken : "$KNOWMIND_TOKEN";
  console.log("Claude Code (User-Scope, alle Projekte) — diesen Befehl ausführen:\n");
  console.log(
    `  claude mcp add --scope user --transport stdio \\\n` +
      `    --env KNOWMIND_TOKEN=${tokenArg} \\\n` +
      `    --env KNOWMIND_API_URL=${opts.apiUrl} \\\n` +
      `    knowmind -- npx -y knowmind mcp\n`,
  );
  console.log("Für ein einzelnes Projekt stattdessen: knowmind install claude-code --project\n");
}

// ── Hauptbefehl ─────────────────────────────────────────────────────────────
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

  const cwd = process.cwd();
  const entryOpts = { apiUrl: apiUrl || DEFAULT_API, literalToken };

  for (const key of targets) {
    const ide = IDES[key];

    // Reine Snippet-/GUI-Fälle.
    if (printOnly || (key === "jetbrains") || (key === "claude-code" && !project)) {
      if (key === "claude-code" && !project) {
        printClaudeCodeCommand(entryOpts);
        continue;
      }
      console.log(`# ${ide.label} — Snippet (manuell einfügen):`);
      console.log(JSON.stringify(snippet(ide, entryOpts), null, 2));
      console.log("");
      continue;
    }

    const path = project ? (ide.projectPath && ide.projectPath(cwd)) : (ide.globalPath && ide.globalPath());
    if (!path) {
      // Kein Datei-Ziel für diesen Scope → Snippet zeigen.
      console.log(`# ${ide.label}: kein ${project ? "Projekt" : "globaler"}-Dateipfad bekannt — Snippet:`);
      console.log(JSON.stringify(snippet(ide, entryOpts), null, 2));
      console.log("");
      continue;
    }

    const existing = readJsonSafe(path);
    if (existing === null) {
      console.error(`! ${ide.label}: ${path} ist kein gültiges JSON — übersprungen (nicht überschrieben).`);
      continue;
    }
    const merged = mergeInto(existing, ide, entryOpts);

    if (dryRun) {
      console.log(`# ${ide.label} — DRY RUN → ${path}`);
      console.log(JSON.stringify(merged, null, 2));
      console.log("");
      continue;
    }

    writeJson(path, merged);
    console.log(`✓ ${ide.label}: knowmind eingetragen in ${path}`);
    if (ide.secret === "env") {
      console.log(`    → setze KNOWMIND_TOKEN in deiner Umgebung (oder nutze --token).`);
    } else if (ide.secret === "literal-only" && !literalToken) {
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
