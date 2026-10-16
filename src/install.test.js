/**
 * Prüffälle für `knowmind install`: Starter an festem Ort, Berichtigung einer
 * Einrichtung mit Pfad im npx-Zwischenspeicher, zweiter Aufruf ohne Änderung,
 * fremde Einträge Byte für Byte erhalten, Windows mit und ohne Python.
 * Anlass: CRM 4b33e6fe (16.10.2026). Kein Netz, alles in einem eigenen
 * Heimverzeichnis.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInstall, _internals } from "./install.js";
import { jsoncLesen, knotenWert, tomlEintragLesen } from "./konfig-text.js";
import { MITGELIEFERT, starterAblegen, starterOrt, starterStand } from "./starter.js";

const { startBefehl } = _internals;
const UMGEBUNG = ["HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME"];
const vorher = {};
let arbeit;
let heim;
let n = 0;
const PYTHONW = "C:/Users/nutzer/AppData/Local/Programs/Python/Python313/pythonw.exe";
const CACHE = "C:/Users/nutzer/AppData/Local/npm-cache/_npx/1f2e3d4c5b6a7980/node_modules/knowmind/src/mcp-starter.py";

before(() => {
  arbeit = mkdtempSync(join(tmpdir(), "knowmind-install-test-"));
  for (const k of UMGEBUNG) vorher[k] = process.env[k];
});
after(() => {
  for (const k of UMGEBUNG) {
    if (vorher[k] === undefined) delete process.env[k];
    else process.env[k] = vorher[k];
  }
  rmSync(arbeit, { recursive: true, force: true });
});
beforeEach((t) => {
  heim = join(arbeit, `heim-${++n}`);
  mkdirSync(heim, { recursive: true });
  process.env.HOME = heim;
  process.env.USERPROFILE = heim;
  process.env.APPDATA = join(heim, "AppData", "Roaming");
  process.env.XDG_CONFIG_HOME = join(heim, ".config");
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
});

const mitPython = () => ({ plattform: "win32", pythonw: PYTHONW, heim });
const ohnePython = () => ({ plattform: "win32", pythonw: null, heim });
const install = (ideKey, umgebung, extra = {}) =>
  runInstall({ ideKey, project: false, dryRun: false, printOnly: false, apiUrl: null, literalToken: null, umgebung, cwd: heim, ...extra });
const cursorDatei = () => join(heim, ".cursor", "mcp.json");
const lesenJson = (datei) => {
  const text = readFileSync(datei, "utf-8");
  return knotenWert(text, jsoncLesen(text));
};
const sicherungen = (datei) => readdirSync(join(datei, "..")).filter((f) => f.includes(".knowmind-sicherung-"));

test("startBefehl: Windows mit Python über den Starter im Benutzerverzeichnis, sonst npx", () => {
  const mit = startBefehl({ plattform: "win32", pythonw: PYTHONW, heim: "C:/Users/nutzer" });
  assert.equal(mit.command, PYTHONW);
  assert.deepEqual(mit.args, [join("C:/Users/nutzer", ".knowmind", "mcp-starter.py"), "npx", "-y", "knowmind", "mcp"]);
  assert.ok(!mit.args[0].includes("npm-cache") && !mit.args[0].includes("node_modules"));
  assert.deepEqual(startBefehl({ plattform: "win32", pythonw: null }).args, ["-y", "knowmind", "mcp"]);
  assert.equal(startBefehl({ plattform: "win32", pythonw: null }).command, "npx");
  assert.equal(startBefehl({ plattform: "linux" }).command, "npx");
  assert.equal(startBefehl({ plattform: "darwin" }).command, "npx");
});

test("Neueinrichtung, Windows mit Python: Eintrag zeigt auf ~/.knowmind, Starter liegt dort", () => {
  install("cursor", mitPython());
  const e = lesenJson(cursorDatei()).mcpServers.knowmind;
  assert.equal(e.command, PYTHONW);
  assert.equal(e.args[0], starterOrt(heim));
  assert.deepEqual(e.args.slice(1), ["npx", "-y", "knowmind", "mcp"]);
  assert.equal(readFileSync(starterOrt(heim), "utf-8"), readFileSync(MITGELIEFERT, "utf-8"));
  assert.deepEqual(sicherungen(cursorDatei()), [], "neue Datei braucht keine Sicherung");
});

test("Neueinrichtung, Windows ohne Python: npx direkt, kein Starter", () => {
  install("cursor", ohnePython());
  const e = lesenJson(cursorDatei()).mcpServers.knowmind;
  assert.equal(e.command, "npx");
  assert.deepEqual(e.args, ["-y", "knowmind", "mcp"]);
  assert.equal(existsSync(starterOrt(heim)), false);
});

// Eine Datei, wie sie ein Nutzer hat: CRLF, vier Leerzeichen, Kommentar, Komma
// vor der Klammer, fremder Server, eigenes Token im knowmind-Eintrag.
function cacheEinrichtung(datei, fach = "mcpServers") {
  const text = [
    "{",
    "    // eigene Notiz",
    '    "theme": "dunkel",',
    ...(fach === "servers" ? ['    "inputs": [{ "type": "promptString", "id": "knowmind-token", "password": true }],'] : []),
    `    "${fach}": {`,
    '        "anderer": { "command": "anderer-server", "args": ["--x"] },',
    '        "knowmind": {',
    `            "command": "${PYTHONW}",`,
    `            "args": ["${CACHE}", "npx", "-y", "knowmind", "mcp", "--eigenes"],`,
    '            "env": { "KNOWMIND_TOKEN": "kmt_eigenes_token", "EIGENE": "1" },',
    '            "disabled": false',
    "        },",
    "    },",
    "}",
    "",
  ].join("\r\n");
  mkdirSync(join(datei, ".."), { recursive: true });
  writeFileSync(datei, text);
  return text;
}

function ausserhalbGleich(alt, neu, fach = "mcpServers") {
  // Alles vor und nach dem Wert von knowmind ist Byte für Byte gleich.
  const wertSpanne = (text) => {
    const w = jsoncLesen(text);
    const f = w.glieder.find((g) => g.name === fach).wert;
    return f.glieder.find((g) => g.name === "knowmind").wert;
  };
  const a = wertSpanne(alt);
  const b = wertSpanne(neu);
  assert.equal(neu.slice(0, b.start), alt.slice(0, a.start), "Text vor dem Eintrag verändert");
  assert.equal(neu.slice(b.ende), alt.slice(a.ende), "Text nach dem Eintrag verändert");
}

test("Berichtigung einer Cache-Einrichtung: eigener Eintrag neu, Rest byte-gleich, Sicherung, Token bleibt", () => {
  const alt = cacheEinrichtung(cursorDatei());
  install("cursor", mitPython());
  const neu = readFileSync(cursorDatei(), "utf-8");
  ausserhalbGleich(alt, neu);
  const e = lesenJson(cursorDatei()).mcpServers.knowmind;
  assert.equal(e.args[0], starterOrt(heim));
  assert.ok(!JSON.stringify(e).includes("npm-cache"));
  assert.deepEqual(e.args.slice(1), ["npx", "-y", "knowmind", "mcp", "--eigenes"], "eigenes Argument fehlt");
  assert.equal(e.env.KNOWMIND_TOKEN, "kmt_eigenes_token", "eingetragenes Token überschrieben");
  assert.equal(e.env.EIGENE, "1");
  assert.equal(e.env.KNOWMIND_API_URL, "https://knowmind.de");
  assert.equal(e.disabled, false);
  const [sicherung] = sicherungen(cursorDatei());
  assert.equal(readFileSync(join(cursorDatei(), "..", sicherung), "utf-8"), alt, "Sicherung ist nicht der alte Stand");
  assert.ok(neu.includes("\r\n") && !/[^\r]\n/.test(neu), "Zeilenenden gemischt");
});

test("Zweiter install ohne Änderung: Datei byte-gleich, keine weitere Sicherung", () => {
  cacheEinrichtung(cursorDatei());
  install("cursor", mitPython());
  const summe = createHash("sha256").update(readFileSync(cursorDatei())).digest("hex");
  install("cursor", mitPython());
  assert.equal(createHash("sha256").update(readFileSync(cursorDatei())).digest("hex"), summe);
  assert.equal(sicherungen(cursorDatei()).length, 1);
});

test("Jeder Client mit Datei: Berichtigung lässt fremde Einträge byte-gleich", () => {
  const ziele = {
    cursor: [join(heim, ".cursor", "mcp.json"), "mcpServers"],
    windsurf: [join(heim, ".codeium", "windsurf", "mcp_config.json"), "mcpServers"],
    antigravity: [join(heim, ".gemini", "config", "mcp_config.json"), "mcpServers"],
    gemini: [join(heim, ".gemini", "settings.json"), "mcpServers"],
    vscode: [_internals.IDES.vscode.globalPath(), "servers"],
    zed: [_internals.IDES.zed.globalPath(), "context_servers"],
    "claude-desktop": [_internals.IDES["claude-desktop"].globalPath(), "mcpServers"],
  };
  const alt = Object.fromEntries(Object.entries(ziele).map(([k, [d, f]]) => [k, cacheEinrichtung(d, f)]));
  install("all", mitPython());
  for (const [k, [d, f]] of Object.entries(ziele)) {
    const neu = readFileSync(d, "utf-8");
    ausserhalbGleich(alt[k], neu, f);
    assert.equal(lesenJson(d)[f].knowmind.args[0], starterOrt(heim), k);
  }
  // VS Code bekommt die Eingabe für das Token einmal angehängt, sonst nichts.
  const vs = lesenJson(ziele.vscode[0]);
  assert.equal(vs.inputs.filter((i) => i.id === "knowmind-token").length, 1);
});

test("VS Code: fehlende Eingabe für das Token wird einmal angehängt", () => {
  const datei = _internals.IDES.vscode.globalPath();
  mkdirSync(join(datei, ".."), { recursive: true });
  writeFileSync(datei, '{\n  "servers": {},\n  "inputs": [{ "id": "eigene" }]\n}\n');
  install("vscode", ohnePython());
  install("vscode", ohnePython());
  const vs = lesenJson(datei);
  assert.deepEqual(vs.inputs.map((i) => i.id), ["eigene", "knowmind-token"]);
  assert.equal(vs.servers.knowmind.type, "stdio");
});

test("Claude Code im Projekt (.mcp.json): Berichtigung wie bei den übrigen", () => {
  const datei = join(heim, ".mcp.json");
  const alt = cacheEinrichtung(datei);
  install("claude-code", mitPython(), { project: true });
  ausserhalbGleich(alt, readFileSync(datei, "utf-8"));
  assert.equal(lesenJson(datei).mcpServers.knowmind.args[0], starterOrt(heim));
});

test("Codex (TOML): npx, fremde Abschnitte byte-gleich, Token bleibt, zweiter Lauf ohne Änderung", () => {
  const datei = join(heim, ".codex", "config.toml");
  mkdirSync(join(datei, ".."), { recursive: true });
  const kopf = 'model = "eigenes"\r\n\r\n[mcp_servers.anderer]\r\ncommand = "anderer-server"\r\n\r\n';
  const schluss = '\r\n[profiles.arbeit]\r\nmodel = "x"\r\n';
  const block = '[mcp_servers.knowmind]\r\ncommand = "npx"\r\nargs = ["-y", "knowmind", "mcp"]\r\nstartup_timeout_sec = 60\r\n\r\n' +
    '[mcp_servers.knowmind.env]\r\nKNOWMIND_TOKEN = "kmt_eigenes_token"\r\n';
  writeFileSync(datei, kopf + block + schluss);
  install("codex", mitPython());
  const neu = readFileSync(datei, "utf-8");
  assert.ok(neu.startsWith(kopf), "Text vor dem Eintrag verändert");
  assert.ok(neu.endsWith(schluss), "Text nach dem Eintrag verändert");
  const e = tomlEintragLesen(neu);
  assert.equal(e.command, "npx");
  assert.equal(e.env.KNOWMIND_TOKEN, "kmt_eigenes_token");
  assert.equal(e.env.KNOWMIND_API_URL, "https://knowmind.de");
  assert.match(neu, /startup_timeout_sec = 60/);
  assert.equal((neu.match(/\[mcp_servers\.knowmind\]/g) || []).length, 1, "doppelter Eintrag");
  install("codex", mitPython());
  assert.equal(readFileSync(datei, "utf-8"), neu);
});

test("Ein Fernzugang unter dem Namen knowmind wird ganz ersetzt, nicht vermischt", () => {
  mkdirSync(join(cursorDatei(), ".."), { recursive: true });
  writeFileSync(cursorDatei(), JSON.stringify({ mcpServers: { knowmind: { url: "https://knowmind.de/api/mcp/v1", headers: { A: "b" } } } }, null, 2));
  install("cursor", ohnePython());
  const e = lesenJson(cursorDatei()).mcpServers.knowmind;
  assert.equal(e.url, undefined);
  assert.equal(e.command, "npx");
});

test("Unlesbare Datei wird nicht überschrieben", () => {
  mkdirSync(join(cursorDatei(), ".."), { recursive: true });
  writeFileSync(cursorDatei(), "{ kaputt");
  install("cursor", mitPython());
  assert.equal(readFileSync(cursorDatei(), "utf-8"), "{ kaputt");
  assert.deepEqual(sicherungen(cursorDatei()), []);
});

test("Starter: nur ein höherer Stand ersetzt die abgelegte Datei, Serverstart legt nichts an", () => {
  const ziel = starterOrt(heim);
  assert.equal(starterAblegen({ ziel, nurWennDa: true }), "fehlt");
  assert.equal(existsSync(ziel), false);
  assert.equal(starterAblegen({ ziel }), "angelegt");
  assert.equal(starterAblegen({ ziel }), "aktuell");
  const stand = starterStand(readFileSync(MITGELIEFERT, "utf-8"));
  writeFileSync(ziel, `STARTER_STAND = ${stand - 1}\n# alt\n`);
  assert.equal(starterAblegen({ ziel, nurWennDa: true }), "aufgefrischt");
  writeFileSync(ziel, `STARTER_STAND = ${stand + 1}\n# neuer\n`);
  assert.equal(starterAblegen({ ziel }), "aktuell");
  assert.match(readFileSync(ziel, "utf-8"), /# neuer/);
});

test("Stand des Starters passt zu seinem Inhalt", () => {
  // Wer src/mcp-starter.py ändert, erhöht STARTER_STAND und trägt hier die neue
  // Prüfsumme ein. Sonst bekäme niemand die Änderung, der den Starter schon hat.
  const SUMME_JE_STAND = { 3: "36d00785a4e77bc5616b8658d06c267d44201c0d036266639076d140c76e72d9" };
  const text = readFileSync(MITGELIEFERT, "utf-8").replace(/\r\n/g, "\n");
  const stand = starterStand(text);
  assert.equal(createHash("sha256").update(text).digest("hex"), SUMME_JE_STAND[stand], `Inhalt geändert, STARTER_STAND ${stand} nicht erhöht`);
});

// ── Claude Code: ausgegebener Befehl ────────────────────────────────────────
function befehlZerlegen(text) {
  return text.replace(/\\\r?\n/g, " ").trim().split(/\s+/);
}

test("Claude-Code-Befehl: Name vor den --env-Angaben, dann -- und npx", () => {
  const teile = befehlZerlegen(_internals.claudeCodeBefehl({ apiUrl: "https://knowmind.de" }));
  const name = teile.indexOf("knowmind");
  const ersteEnv = teile.indexOf("--env");
  const trenner = teile.indexOf("--");
  assert.ok(name > 0 && name < ersteEnv, `Name steht hinter --env: ${teile.join(" ")}`);
  assert.ok(teile.lastIndexOf("--env") < trenner, "--env hinter dem Trenner");
  assert.deepEqual(teile.slice(trenner + 1), ["npx", "-y", "knowmind", "mcp"]);
});

test("Claude-Code-Befehl: Claude Code nimmt ihn an (nur wenn claude installiert ist)", (t) => {
  const da = spawnSync("claude", ["--version"], { encoding: "utf-8", shell: process.platform === "win32" });
  if (da.status !== 0) {
    t.skip("claude nicht installiert");
    return;
  }
  // Eigenes Konfigurationsverzeichnis und Projektbereich: Die echte
  // Einrichtung des Rechners wird weder gelesen noch geschrieben.
  const projekt = join(heim, "projekt-claude");
  mkdirSync(projekt, { recursive: true });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(heim, "claude-konfig") };
  const befehl = befehlZerlegen(_internals.claudeCodeBefehl({ apiUrl: "https://knowmind.de", literalToken: "kmt_probe" }))
    .map((a) => (a === "user" ? "project" : a));
  const r = spawnSync(befehl[0], befehl.slice(1), { cwd: projekt, env, encoding: "utf-8", shell: process.platform === "win32" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const e = JSON.parse(readFileSync(join(projekt, ".mcp.json"), "utf-8")).mcpServers.knowmind;
  assert.equal(e.command, "npx");
  assert.deepEqual(e.args, ["-y", "knowmind", "mcp"]);
  assert.deepEqual(e.env, { KNOWMIND_TOKEN: "kmt_probe", KNOWMIND_API_URL: "https://knowmind.de" });

  // Gegenprobe: die Form bis 0.4.4 (Name hinter den --env-Angaben) lehnt Claude Code ab.
  const alt = ["claude", "mcp", "add", "--scope", "project", "--transport", "stdio", "--env", "KNOWMIND_TOKEN=kmt_probe",
    "--env", "KNOWMIND_API_URL=https://knowmind.de", "knowmind-alt", "--", "npx", "-y", "knowmind", "mcp"];
  const g = spawnSync(alt[0], alt.slice(1), { cwd: projekt, env, encoding: "utf-8", shell: process.platform === "win32" });
  assert.notEqual(g.status, 0, "die alte Form läuft durch, der Fall misst nichts");
  assert.match(g.stderr + g.stdout, /Invalid environment variable format: knowmind-alt/);
});
