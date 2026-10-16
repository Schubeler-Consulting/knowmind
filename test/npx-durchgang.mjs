#!/usr/bin/env node
/**
 * Durchgang am echten Paket: Einrichtung nach README (`npx -y knowmind install
 * all`), dann den npm-Zwischenspeicher leeren, dann startet jeder Eintrag und
 * beantwortet tools/list.
 *
 *   node test/npx-durchgang.mjs --fassung 0.4.4
 *   node test/npx-durchgang.mjs --fassung ./knowmind-0.4.4.tgz
 *
 * Geleert wird zweimal: `npm cache clean --force` räumt nur den Paketspeicher
 * (_cacache), nicht die npx-Installationen (gemessen 16.10.2026 mit npm 11.4.2
 * und 12.2.1). Die liegen unter _npx und verschwinden mit `npm cache npx rm --force`
 * oder wenn jemand den Ordner npm-cache löscht. Beides wird hier gemacht, und
 * danach muss _npx leer sein.
 *
 * Alles läuft in einem eigenen Verzeichnis: eigenes Heimverzeichnis (HOME,
 * USERPROFILE, APPDATA, XDG_CONFIG_HOME) und eigener npm-Zwischenspeicher
 * (npm_config_cache). Der Zwischenspeicher des Rechners bleibt unberührt.
 * Rückgabe 0, wenn jeder Eintrag antwortet und keiner auf den
 * Zwischenspeicher zeigt; sonst 1.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { jsoncLesen, knotenWert, tomlEintragLesen } from "../src/konfig-text.js";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const FASSUNG = arg("--fassung");
if (!FASSUNG) {
  console.error("Aufruf: node test/npx-durchgang.mjs --fassung <fassung|datei.tgz>");
  process.exit(64);
}
const paketSpez = FASSUNG.endsWith(".tgz") ? resolve(FASSUNG) : `knowmind@${FASSUNG}`;
const WIN = platform() === "win32";

const ort = mkdtempSync(join(tmpdir(), "knowmind-npx-durchgang-"));
const heim = join(ort, "heim");
const projekt = join(heim, "projekt");
const cache = join(ort, "npm-cache");
mkdirSync(projekt, { recursive: true });
const env = {
  ...process.env,
  HOME: heim,
  USERPROFILE: heim,
  APPDATA: join(heim, "AppData", "Roaming"),
  XDG_CONFIG_HOME: join(heim, ".config"),
  npm_config_cache: cache,
};
delete env.KNOWMIND_TOKEN;
delete env.KNOWMIND_API_URL;

function laufen(befehl, args, opts = {}) {
  const r = spawnSync(befehl, args, { env, encoding: "utf-8", shell: WIN, cwd: projekt, ...opts });
  if (r.status !== 0) throw new Error(`${befehl} ${args.join(" ")} scheiterte (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
}

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
};

function lesen(datei, fach) {
  const text = readFileSync(datei, "utf-8");
  if (fach === "toml") return tomlEintragLesen(text);
  return knotenWert(text, jsoncLesen(text))[fach].knowmind;
}

function mcpFragen(e, frist = 300000) {
  return new Promise((ja, nein) => {
    const eigen = { ...env, ...Object.fromEntries(Object.entries(e.env || {}).filter(([k]) => k === "KNOWMIND_API_URL")) };
    const shell = WIN && /^npx(\.cmd)?$/i.test(e.command);
    const args = shell ? e.args.map((a) => JSON.stringify(a)) : e.args;
    const kind = spawn(e.command, args, { env: eigen, cwd: heim, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell });
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
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "npx-durchgang", version: "0" } } });
    senden({ jsonrpc: "2.0", method: "notifications/initialized" });
    senden({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  });
}

const vorwaerts = (p) => String(p).replace(/\\/g, "/").toLowerCase();
const npxInhalt = () => (existsSync(join(cache, "_npx")) ? readdirSync(join(cache, "_npx")) : []);

console.log(`Ort: ${ort}`);
laufen("npx", ["-y", `--package=${JSON.stringify(paketSpez)}`, "knowmind", "install", "all"]);
laufen("npx", ["-y", `--package=${JSON.stringify(paketSpez)}`, "knowmind", "install", "claude-code", "--project"]);
const eintraege = Object.entries(DATEIEN).filter(([, [d]]) => existsSync(d)).map(([n, [d, f]]) => [n, lesen(d, f)]);
const fehlend = Object.keys(DATEIEN).filter((k) => !eintraege.some(([n]) => n === k));
let gut = fehlend.length === 0;
if (fehlend.length) console.log(`nicht eingerichtet: ${fehlend.join(", ")}`);
for (const [n, e] of eintraege) {
  const imCache = [e.command, ...e.args].some((a) => vorwaerts(a).includes(vorwaerts(cache)));
  if (imCache) gut = false;
  console.log(`  ${n}: ${e.command} ${e.args.join(" ")}${imCache ? "   <- im Zwischenspeicher" : ""}`);
}
const starter = join(heim, ".knowmind", "mcp-starter.py");
console.log(`Starter unter ~/.knowmind: ${existsSync(starter) ? "vorhanden" : "fehlt"}`);

console.log(`\nnpx-Installationen vorher: ${npxInhalt().length}`);
laufen("npm", ["cache", "clean", "--force"]);
console.log(`nach npm cache clean --force: ${npxInhalt().length}`);
laufen("npm", ["cache", "npx", "rm", "--force"]);
const rest = npxInhalt();
console.log(`nach npm cache npx rm --force: ${rest.length}`);
if (rest.length) {
  console.log("  _npx ist nicht leer, der Durchgang misst so nichts");
  gut = false;
}

console.log("");
for (const [n, e] of eintraege) {
  try {
    console.log(`  ${n.padEnd(24)} ${await mcpFragen(e)} Werkzeuge`);
  } catch (f) {
    console.log(`  ${n.padEnd(24)} FEHLER ${f.message}`);
    gut = false;
  }
}
console.log(gut ? "\nalle Einträge laufen nach dem Leeren" : "\nnicht bestanden");
process.exit(gut ? 0 : 1);
