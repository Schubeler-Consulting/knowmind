/**
 * Ein Update von knowmind lässt jeden eingerichteten MCP-Eintrag laufen.
 *
 * Anlass (CRM 73f2f7c7, 13.10.2026): Ein Eintrag in ~/.claude.json zeigte auf
 * `node_modules/knowmind/bin/mcp-starter.py`. Die Datei war von Hand dorthin
 * kopiert worden, kein veröffentlichtes Paket hat sie je enthalten. npm ersetzt
 * beim Update das ganze Paketverzeichnis, die Kopie war weg, der MCP-Server
 * startete nicht mehr, ohne Meldung.
 *
 * Seit 0.4.3 liegt am alten Ort ein Übergangsstarter (bin/mcp-starter.py), der
 * an src/mcp-starter.py weiterreicht. Kein Update schreibt eine
 * Konfigurationsdatei um. Die Fälle hier bilden das nach: Paket wie von npm,
 * alte Einrichtung je Client in dessen Dateiformat, Update durch Ersetzen des
 * Paketverzeichnisses, dann der Eintrag so gestartet, wie der Client ihn
 * startet, mit `initialize` und `tools/list`. Ohne Netz: Die Werkzeugliste
 * kommt aus dem mitgelieferten Stand, weil die Adresse auf einen geschlossenen
 * Port zeigt.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _internals } from "./install.js";

const { IDES } = _internals;
const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const UMGEBUNG = ["HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME"];
const OFFLINE = "http://127.0.0.1:9";

let arbeit; // Arbeitsverzeichnis dieses Laufs
let paketNeu; // ausgepacktes Paket wie von npm
let paketDateien; // Dateiliste aus npm pack
let paketAlt; // dasselbe ohne bin/mcp-starter.py (Stand bis 0.4.2)
const vorher = {};

const vorwaerts = (p) => p.replace(/\\/g, "/");

function pythonFinden() {
  if (platform() === "win32") {
    // Dieselbe Suche wie install.js: pythonw.exe ist der Fall, der zählt.
    const lokal = process.env.LOCALAPPDATA;
    for (const v of ["313", "312", "311", "310"]) {
      for (const p of [lokal && join(lokal, "Programs", "Python", `Python${v}`, "pythonw.exe"),
        join("C:\\", `Python${v}`, "pythonw.exe")]) {
        if (p && existsSync(p)) return p;
      }
    }
    return "python";
  }
  return "python3";
}
const PYTHON = vorwaerts(pythonFinden());

function paketBauen(ziel) {
  const r = spawnSync("npm", ["pack", JSON.stringify(WURZEL), "--json", "--ignore-scripts"], {
    cwd: ziel, encoding: "utf-8", shell: true,
  });
  assert.equal(r.status, 0, `npm pack scheiterte: ${r.stderr}`);
  const [{ filename, files }] = JSON.parse(r.stdout);
  const t = spawnSync("tar", ["-xzf", filename], { cwd: ziel, encoding: "utf-8" });
  assert.equal(t.status, 0, `tar scheiterte: ${t.stderr}`);
  return { verzeichnis: join(ziel, "package"), dateien: files.map((f) => f.path) };
}

/** Ort wie `npm install -g --prefix`, mit den Abhängigkeiten, die der Start braucht. */
function prefixAnlegen(name) {
  const prefix = join(arbeit, name);
  mkdirSync(join(prefix, "node_modules"), { recursive: true });
  cpSync(join(WURZEL, "node_modules", "yaml"), join(prefix, "node_modules", "yaml"), { recursive: true });
  return join(prefix, "node_modules", "knowmind");
}

/** Wie npm beim Update: Das Paketverzeichnis wird ersetzt, was nicht im neuen Paket liegt, ist weg. */
function aktualisieren(paket, quelle) {
  rmSync(paket, { recursive: true, force: true });
  cpSync(quelle, paket, { recursive: true });
}

/** Alte Einrichtung: Paket ohne Übergang, dazu die Handkopie des Starters unter bin/. */
function altEinrichten(paket) {
  aktualisieren(paket, paketAlt);
  cpSync(join(paket, "src", "mcp-starter.py"), join(paket, "bin", "mcp-starter.py"));
}

function eintrag(paket, ort, zusatz = []) {
  return {
    command: PYTHON,
    args: [vorwaerts(join(paket, ort, "mcp-starter.py")), vorwaerts(process.execPath),
      vorwaerts(join(paket, "bin", "knowmind.js")), "mcp", ...zusatz],
    env: { KNOWMIND_API_URL: OFFLINE },
  };
}

/** Jeder Client, für den install.js eine Datei kennt, dazu Claude Code im Benutzerbereich. */
function clients(projekt) {
  const liste = [];
  const ohneDatei = [];
  for (const [key, ide] of Object.entries(IDES)) {
    const datei = ide.globalPath ? ide.globalPath() : ide.projectPath ? ide.projectPath(projekt) : null;
    if (datei) liste.push({ key, family: ide.family, datei });
    else ohneDatei.push(key);
  }
  // Der Fall vom 13.10.2026: `claude mcp add --scope user` schreibt nach ~/.claude.json.
  liste.push({ key: "claude-code-benutzer", family: "mcpServers", datei: join(homedir(), ".claude.json") });
  return { liste, ohneDatei };
}

function fach(family) {
  return family === "servers" ? "servers" : family;
}

function schreiben(client, e) {
  mkdirSync(dirname(client.datei), { recursive: true });
  if (client.family === "toml") {
    const env = Object.entries(e.env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join("\n");
    writeFileSync(client.datei,
      `model = "eigenes"\n\n[mcp_servers.anderer]\ncommand = "anderer-server"\n\n` +
      `[mcp_servers.knowmind]\ncommand = ${JSON.stringify(e.command)}\nargs = ${JSON.stringify(e.args)}\n\n` +
      `[mcp_servers.knowmind.env]\n${env}\n`);
    return;
  }
  const knowmind = client.family === "servers" ? { type: "stdio", ...e } : e;
  const cfg = { eigeneEinstellung: true, [fach(client.family)]: { anderer: { command: "anderer-server", args: [] }, knowmind } };
  writeFileSync(client.datei, JSON.stringify(cfg, null, 2) + "\n");
}

/** Liest den Eintrag so, wie der Client ihn liest. */
function lesen(client) {
  const text = readFileSync(client.datei, "utf-8");
  if (client.family === "toml") {
    const bloecke = text.split(/\n(?=\[)/);
    assert.equal(bloecke.filter((b) => b.startsWith("[mcp_servers.knowmind]")).length, 1, "knowmind steht nicht genau einmal");
    const block = bloecke.find((b) => b.startsWith("[mcp_servers.knowmind]"));
    const envBlock = bloecke.find((b) => b.startsWith("[mcp_servers.knowmind.env]")) || "";
    const env = Object.fromEntries([...envBlock.matchAll(/^(\w+) = (".*")$/gm)].map((m) => [m[1], JSON.parse(m[2])]));
    return { command: JSON.parse(block.match(/^command = (.*)$/m)[1]), args: JSON.parse(block.match(/^args = (.*)$/m)[1]), env };
  }
  return JSON.parse(text)[fach(client.family)].knowmind;
}

const pruefsumme = (datei) => createHash("sha256").update(readFileSync(datei)).digest("hex");

/** Startet den Eintrag wie ein Client und fragt initialize und tools/list. */
function mcpFragen(e, frist = 30000) {
  return new Promise((ja, nein) => {
    const env = { ...process.env, ...(e.env || {}) };
    delete env.KNOWMIND_TOKEN;
    const kind = spawn(e.command, e.args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let aus = "";
    let fehler = "";
    const uhr = setTimeout(() => { kind.kill(); nein(new Error(`keine Antwort auf tools/list: ${fehler.slice(-400)}`)); }, frist);
    kind.on("error", (f) => { clearTimeout(uhr); nein(f); });
    kind.on("exit", (code) => {
      clearTimeout(uhr);
      nein(new Error(`Server endete mit ${code} vor der Antwort: ${fehler.slice(-400)}`));
    });
    kind.stderr.on("data", (d) => { fehler += d; });
    kind.stdout.on("data", (d) => {
      aus += d;
      for (const zeile of aus.split("\n")) {
        if (!zeile.trim()) continue;
        let antwort;
        try { antwort = JSON.parse(zeile); } catch { continue; }
        if (antwort.id === 2) {
          clearTimeout(uhr);
          kind.removeAllListeners("exit");
          kind.stdin.end();
          kind.kill();
          ja(antwort.result?.tools ?? []);
        }
      }
    });
    const senden = (n) => kind.stdin.write(JSON.stringify(n) + "\n");
    senden({ jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "starterpfad-test", version: "0" } } });
    senden({ jsonrpc: "2.0", method: "notifications/initialized" });
    senden({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  });
}

before(() => {
  arbeit = mkdtempSync(join(tmpdir(), "knowmind-starterpfad-"));
  const neu = paketBauen(arbeit);
  paketNeu = neu.verzeichnis;
  paketDateien = neu.dateien;
  paketAlt = join(arbeit, "paket-bis-042");
  cpSync(paketNeu, paketAlt, { recursive: true });
  rmSync(join(paketAlt, "bin", "mcp-starter.py"));
  for (const k of UMGEBUNG) vorher[k] = process.env[k];
});

after(() => {
  for (const k of UMGEBUNG) {
    if (vorher[k] === undefined) delete process.env[k];
    else process.env[k] = vorher[k];
  }
  rmSync(arbeit, { recursive: true, force: true });
});

function heimAnlegen(name) {
  const heim = join(arbeit, name);
  mkdirSync(heim, { recursive: true });
  process.env.HOME = heim;
  process.env.USERPROFILE = heim;
  process.env.APPDATA = join(heim, "AppData", "Roaming");
  process.env.XDG_CONFIG_HOME = join(heim, ".config");
  return heim;
}

test("Paket enthält jeden Starterpfad, auf den ein Eintrag zeigen kann", () => {
  // bin/mcp-starter.py: Handeinrichtungen bis 13.10.2026. src/mcp-starter.py:
  // install.js seit 0.3.5. bin/knowmind.js: Einträge mit node statt npx.
  for (const pfad of ["bin/mcp-starter.py", "src/mcp-starter.py", "bin/knowmind.js"]) {
    assert.ok(paketDateien.includes(pfad), `${pfad} fehlt im Paket`);
  }
});

test("Gegenprobe: Ohne Übergang startet die alte Einrichtung nach dem Update nicht", async () => {
  heimAnlegen("heim-gegenprobe");
  const paket = prefixAnlegen("prefix-gegenprobe");
  altEinrichten(paket);
  const e = eintrag(paket, "bin");
  assert.ok((await mcpFragen(e)).length > 0, "die alte Einrichtung läuft schon vor dem Update nicht");
  aktualisieren(paket, paketAlt);
  await assert.rejects(mcpFragen(e, 15000), /endete|keine Antwort/);
});

test("Je Client: alte Einrichtung, Update, zweites Update, MCP antwortet auf tools/list", async () => {
  heimAnlegen("heim-clients");
  const projekt = join(arbeit, "projekt");
  mkdirSync(projekt, { recursive: true });
  const { liste, ohneDatei } = clients(projekt);
  // JetBrains wird in der Oberfläche eingerichtet, install.js gibt dort nur den
  // Eintrag aus. Kommt ein weiterer Client ohne Datei dazu, fällt er hier auf.
  assert.deepEqual(ohneDatei, ["jetbrains"]);

  const paket = prefixAnlegen("prefix-clients");
  altEinrichten(paket);
  const summen = {};
  for (const c of liste) {
    // Je Client beide alten Formen nacheinander wären doppelt so lang; der
    // Folgefall prüft beide Orte, hier zählt das Dateiformat des Clients.
    schreiben(c, eintrag(paket, "bin"));
    summen[c.key] = pruefsumme(c.datei);
  }

  for (const runde of ["erstes Update", "zweites Update"]) {
    aktualisieren(paket, paketNeu);
    for (const c of liste) {
      assert.equal(pruefsumme(c.datei), summen[c.key], `${c.key}: ${runde} hat die Datei verändert`);
      const tools = await mcpFragen(lesen(c));
      assert.ok(tools.length > 0, `${c.key}: ${runde}, keine Werkzeuge`);
    }
  }
});

test("Starter unter bin/ und unter src/ laufen nach dem Update", async () => {
  heimAnlegen("heim-orte");
  const paket = prefixAnlegen("prefix-orte");
  altEinrichten(paket);
  aktualisieren(paket, paketNeu);
  for (const ort of ["bin", "src"]) {
    assert.ok((await mcpFragen(eintrag(paket, ort))).length > 0, `Starter unter ${ort}/`);
  }
});

test("Eigene Zusatzargumente und weitere Einträge des Nutzers bleiben erhalten", async () => {
  heimAnlegen("heim-zusatz");
  const projekt = join(arbeit, "projekt-zusatz");
  const { liste } = clients(projekt);
  const paket = prefixAnlegen("prefix-zusatz");
  altEinrichten(paket);
  const e = eintrag(paket, "bin", ["--eigenes-argument"]);
  e.env.EIGENE_VARIABLE = "bleibt";
  const summen = {};
  for (const c of liste) {
    schreiben(c, e);
    summen[c.key] = pruefsumme(c.datei);
  }
  aktualisieren(paket, paketNeu);
  for (const c of liste) {
    assert.equal(pruefsumme(c.datei), summen[c.key], `${c.key}: Datei verändert`);
    const gelesen = lesen(c);
    assert.equal(gelesen.args.at(-1), "--eigenes-argument");
    assert.equal(gelesen.env.EIGENE_VARIABLE, "bleibt");
    assert.ok((await mcpFragen(gelesen)).length > 0, `${c.key}: keine Werkzeuge`);
  }
  const claude = JSON.parse(readFileSync(liste.find((c) => c.key === "claude-code-benutzer").datei, "utf-8"));
  assert.deepEqual(claude.mcpServers.anderer, { command: "anderer-server", args: [] });
  assert.equal(claude.eigeneEinstellung, true);
});

test("Fehlende Konfigurationsdateien: Update ohne Fehler, keine Datei angelegt", () => {
  const heim = heimAnlegen("heim-leer");
  const paket = prefixAnlegen("prefix-leer");
  altEinrichten(paket);
  assert.doesNotThrow(() => aktualisieren(paket, paketNeu));
  assert.deepEqual(readdirSync(heim), []);
});
