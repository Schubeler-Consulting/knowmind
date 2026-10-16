#!/usr/bin/env node
/**
 * Durchgang am echten Paket: alte Fassung von npm, Einrichtung aller Clients,
 * Update, zweites Update, und nach jedem Update startet jeder Eintrag und
 * beantwortet tools/list.
 *
 *   node test/update-durchgang.mjs --alt 0.3.9 --neu 0.4.3
 *   node test/update-durchgang.mjs --alt 0.3.9 --neu ./knowmind-0.4.3.tgz
 *
 * Alles läuft in einem eigenen Verzeichnis: eigenes Heimverzeichnis (HOME,
 * USERPROFILE, APPDATA, XDG_CONFIG_HOME), eigener npm-Präfix. Keine Datei des
 * Rechners wird angefasst. Ein Token wird nicht gebraucht: Ohne Token beantwortet
 * der Server initialize und tools/list über die öffentliche Auskunft.
 *
 * Eingerichtet wird wie beim Nutzer: `knowmind install all` der alten Fassung
 * (schreibt jede Client-Datei, die install kennt), `install claude-code
 * --project` im Projektordner, dazu die Handeinrichtung vom 13.10.2026 in
 * ~/.claude.json (Starter unter bin/, von Hand kopiert).
 *
 * Rückgabe 0, wenn jeder Eintrag nach beiden Updates antwortet und keine Datei
 * verändert wurde; sonst 1.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ALT = arg("--alt") || "0.3.9";
const NEU = arg("--neu");
if (!NEU) {
  console.error("Aufruf: node test/update-durchgang.mjs --alt <fassung> --neu <fassung|datei.tgz>");
  process.exit(64);
}
const neuSpez = NEU.endsWith(".tgz") ? resolve(NEU) : `knowmind@${NEU}`;
const WIN = platform() === "win32";

const ort = mkdtempSync(join(tmpdir(), "knowmind-durchgang-"));
const heim = join(ort, "heim");
const projekt = join(heim, "projekt");
const prefix = join(ort, "prefix");
mkdirSync(projekt, { recursive: true });
const env = {
  ...process.env,
  HOME: heim,
  USERPROFILE: heim,
  APPDATA: join(heim, "AppData", "Roaming"),
  XDG_CONFIG_HOME: join(heim, ".config"),
};
delete env.KNOWMIND_TOKEN;
delete env.KNOWMIND_API_URL;
const paket = WIN ? join(prefix, "node_modules", "knowmind") : join(prefix, "lib", "node_modules", "knowmind");
const cli = join(paket, "bin", "knowmind.js");

function laufen(befehl, args, opts = {}) {
  const r = spawnSync(befehl, args, { env, encoding: "utf-8", shell: WIN, ...opts });
  if (r.status !== 0) throw new Error(`${befehl} ${args.join(" ")} scheiterte (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
}

function npmInstall(spez) {
  // Ohne Installationsskripte der Abhängigkeiten: Das Einbettungsmodell braucht
  // der MCP-Start nicht, knowmind selbst hat keine.
  laufen("npm", ["install", "-g", "--prefix", JSON.stringify(prefix), JSON.stringify(spez),
    "--ignore-scripts", "--no-audit", "--no-fund"]);
  return JSON.parse(readFileSync(join(paket, "package.json"), "utf-8")).version;
}

// ── Lesen der Einträge in den Formaten der Clients ─────────────────────────
const vorwaerts = (p) => p.replace(/\\/g, "/");
const DATEIEN = {
  cursor: [join(heim, ".cursor", "mcp.json"), "mcpServers"],
  vscode: [join(env.APPDATA, "Code", "User", "mcp.json"), "servers"],
  windsurf: [join(heim, ".codeium", "windsurf", "mcp_config.json"), "mcpServers"],
  antigravity: [join(heim, ".gemini", "config", "mcp_config.json"), "mcpServers"],
  zed: [WIN ? join(env.APPDATA, "Zed", "settings.json") : join(heim, ".config", "zed", "settings.json"), "context_servers"],
  "claude-desktop": [WIN ? join(env.APPDATA, "Claude", "claude_desktop_config.json")
    : platform() === "darwin" ? join(heim, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : join(heim, ".config", "Claude", "claude_desktop_config.json"), "mcpServers"],
  gemini: [join(heim, ".gemini", "settings.json"), "mcpServers"],
  codex: [join(heim, ".codex", "config.toml"), "toml"],
  "claude-code (Projekt)": [join(projekt, ".mcp.json"), "mcpServers"],
  "claude-code (Benutzer, von Hand)": [join(heim, ".claude.json"), "mcpServers"],
};

function lesen(datei, fach) {
  const text = readFileSync(datei, "utf-8");
  if (fach === "toml") {
    // TOML-Grundstrings mit Backslash sind Fluchtfolgen; install.js schreibt für
    // Codex nur npx ohne Pfad. Hier genügt das Lesen der beiden Zeilen.
    const block = text.split(/\n(?=\[)/).find((b) => b.startsWith("[mcp_servers.knowmind]"));
    return { command: JSON.parse(block.match(/^command = (.*)$/m)[1]), args: JSON.parse(block.match(/^args = (.*)$/m)[1]) };
  }
  return JSON.parse(text)[fach].knowmind;
}

const summe = (datei) => createHash("sha256").update(readFileSync(datei)).digest("hex");

function mcpFragen(e, frist = 120000) {
  return new Promise((ja, nein) => {
    const eigen = { ...env, ...Object.fromEntries(Object.entries(e.env || {}).filter(([k]) => k === "KNOWMIND_API_URL")) };
    // Unter Windows ist npx eine .cmd-Datei; Node startet sie nur über die Shell.
    const shell = WIN && /^npx(\.cmd)?$/i.test(e.command);
    const args = shell ? e.args.map((a) => JSON.stringify(a)) : e.args;
    const kind = spawn(e.command, args, { env: eigen, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell });
    let aus = "";
    let fehler = "";
    const uhr = setTimeout(() => { kind.kill(); nein(new Error(`keine Antwort: ${fehler.slice(-300)}`)); }, frist);
    kind.on("error", (f) => { clearTimeout(uhr); nein(f); });
    kind.on("exit", (code) => { clearTimeout(uhr); nein(new Error(`endete mit ${code}: ${fehler.slice(-300)}`)); });
    kind.stderr.on("data", (d) => { fehler += d; });
    kind.stdout.on("data", (d) => {
      aus += d;
      for (const z of aus.split("\n")) {
        let a;
        try { a = JSON.parse(z); } catch { continue; }
        if (a.id === 2) {
          clearTimeout(uhr);
          kind.removeAllListeners("exit");
          kind.stdin.end();
          kind.kill();
          ja(a.result?.tools?.length ?? 0);
        }
      }
    });
    const senden = (n) => kind.stdin.write(JSON.stringify(n) + "\n");
    senden({ jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "update-durchgang", version: "0" } } });
    senden({ jsonrpc: "2.0", method: "notifications/initialized" });
    senden({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  });
}

// ── Ablauf ───────────────────────────────────────────────────────────────
console.log(`Ort: ${ort}`);
const altFassung = npmInstall(`knowmind@${ALT}`);
console.log(`alt installiert: ${altFassung}`);
laufen(process.execPath, [cli, "install", "all"], { shell: false, cwd: projekt });
laufen(process.execPath, [cli, "install", "claude-code", "--project"], { shell: false, cwd: projekt });

// Handeinrichtung vom 13.10.2026: Starter nach bin/ kopiert, Eintrag in ~/.claude.json.
cpSync(join(paket, "src", "mcp-starter.py"), join(paket, "bin", "mcp-starter.py"));
const vorbild = lesen(DATEIEN.cursor[0], "mcpServers");
writeFileSync(DATEIEN["claude-code (Benutzer, von Hand)"][0], JSON.stringify({
  mcpServers: {
    knowmind: {
      type: "stdio",
      command: vorbild.command === "npx" ? "npx" : vorbild.command,
      args: vorbild.command === "npx" ? ["-y", "knowmind", "mcp"]
        : [vorwaerts(join(paket, "bin", "mcp-starter.py")), vorwaerts(process.execPath), vorwaerts(cli), "mcp"],
      env: {},
    },
  },
}, null, 2));

const vorhanden = Object.entries(DATEIEN).filter(([, [datei]]) => existsSync(datei));
const fehlend = Object.keys(DATEIEN).filter((k) => !vorhanden.some(([n]) => n === k));
if (fehlend.length) console.log(`nicht eingerichtet: ${fehlend.join(", ")}`);
const summen = Object.fromEntries(vorhanden.map(([n, [datei]]) => [n, summe(datei)]));
for (const [n, [datei, fach]] of vorhanden) {
  const e = lesen(datei, fach);
  console.log(`  ${n}: ${e.command} ${e.args.join(" ")}`);
}

let gut = fehlend.length === 0;
for (const runde of ["erstes Update", "zweites Update"]) {
  const fassung = npmInstall(neuSpez);
  console.log(`\n${runde}: ${fassung}`);
  for (const [n, [datei, fach]] of vorhanden) {
    const gleich = summe(datei) === summen[n];
    let ergebnis;
    try {
      ergebnis = `${await mcpFragen(lesen(datei, fach))} Werkzeuge`;
    } catch (f) {
      ergebnis = `FEHLER ${f.message}`;
      gut = false;
    }
    if (!gleich) gut = false;
    console.log(`  ${n.padEnd(34)} Datei ${gleich ? "unverändert" : "VERÄNDERT"}  ${ergebnis}`);
  }
}
console.log(gut ? "\nalle Einträge laufen" : "\nnicht bestanden");
process.exit(gut ? 0 : 1);
