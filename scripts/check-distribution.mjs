#!/usr/bin/env node
// Distributions-Wächter: prüft, ob knowmind über ALLE Kanäle konsistent und auf
// Stand ist. Läuft täglich in CI (distribution-consistency.yml) und bei jedem
// Push, der package.json/server.json berührt. Bei Drift Exit 1 -> roter CI-Lauf
// -> GitHub mailt an den Maintainer.
//
// Wahrheitskette:  package.json (Entwicklung) -> npm-latest (veröffentlicht)
//                  -> server.json -> offizielle MCP-Registry -> Aggregatoren.
// npm-latest ist der Anker für alles Nachgelagerte (die Registry validiert
// npm-Ownership+Existenz). package.json DARF voraus sein (unveröffentlichter
// Bump) — das ist eine Warnung, kein Fehler: es bedeutet nur "npm publish steht
// noch aus" (manuell, 2FA).
import { readFileSync } from "node:fs";

const PKG = "knowmind";
const REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers?search=knowmind";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const sj = JSON.parse(readFileSync(new URL("server.json", root), "utf8"));
const glama = JSON.parse(readFileSync(new URL("glama.json", root), "utf8"));

// npm-latest per HTTP (kein child_process/Shell — plattformunabhängig).
async function npmLatest() {
  const res = await fetch(`https://registry.npmjs.org/${PKG}`);
  if (!res.ok) throw new Error(`npm-Registry HTTP ${res.status}`);
  const data = await res.json();
  return data["dist-tags"]?.latest;
}

async function registryLatest() {
  const res = await fetch(REGISTRY);
  if (!res.ok) throw new Error(`Registry HTTP ${res.status}`);
  const data = await res.json();
  const eintraege = (data.servers ?? []).filter(
    (s) => (s.server ?? s).name === sj.name,
  );
  const latest = eintraege.find(
    (s) => s._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest,
  );
  return latest ? (latest.server ?? latest).version : null;
}

const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true });

const npmV = await npmLatest();
const regV = await registryLatest();

const fehler = [];
const warnung = [];

// 1. Identität: server.json.name == package.json.mcpName (Registry-Ownership)
if (pkg.mcpName && pkg.mcpName !== sj.name)
  fehler.push(`Identität: package.json mcpName (${pkg.mcpName}) != server.json name (${sj.name})`);

// 2. server.json intern konsistent
for (const p of sj.packages ?? [])
  if (p.version !== sj.version)
    fehler.push(`server.json intern: packages[${p.identifier}] ${p.version} != top ${sj.version}`);

// 3. server.json zeigt auf die veröffentlichte npm-Version
if (sj.version !== npmV)
  fehler.push(`server.json (${sj.version}) != npm-latest (${npmV}) — Registry-Publish nötig`);

// 4. Registry auf Stand mit npm
if (regV !== npmV)
  fehler.push(`MCP-Registry (${regV ?? "fehlt"}) != npm-latest (${npmV}) — Registry-Publish nötig`);

// 4b. glama.json zeigt auf die veröffentlichte npm-Version (Glama-Listing;
// hing bis 2026-07-21 unbemerkt bei 0.1.25, weil hier nicht geprüft).
if (glama.version !== npmV)
  fehler.push(`glama.json (${glama.version}) != npm-latest (${npmV})`);

// 5. package.json voraus = unveröffentlichter Bump (Warnung, kein Fehler)
if (cmp(pkg.version, npmV) > 0)
  warnung.push(`package.json (${pkg.version}) > npm-latest (${npmV}) — npm publish steht aus (manuell, 2FA)`);
else if (cmp(pkg.version, npmV) < 0)
  fehler.push(`package.json (${pkg.version}) < npm-latest (${npmV}) — Repo hinter npm, ungewöhnlich`);

console.log(`Distributions-Stand knowmind:`);
console.log(`  package.json : ${pkg.version}`);
console.log(`  npm-latest   : ${npmV}`);
console.log(`  server.json  : ${sj.version}`);
console.log(`  glama.json   : ${glama.version}`);
console.log(`  MCP-Registry : ${regV ?? "—"}`);
console.log(`  mcpName/name : ${pkg.mcpName ?? "—"} / ${sj.name}`);

for (const w of warnung) console.log(`  ⚠ ${w}`);
for (const f of fehler) console.error(`  ✗ ${f}`);

// Maschinen-Flags für den CI-Heil-Schritt (nur wenn in GitHub Actions).
if (process.env.GITHUB_OUTPUT) {
  const registryStale = sj.version !== npmV || regV !== npmV;
  const { appendFileSync } = await import("node:fs");
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `registry_stale=${registryStale ? 1 : 0}\nnpm_latest=${npmV}\n`,
  );
}

if (fehler.length) {
  console.error(`\nDistribution NICHT synchron (${fehler.length} Drift).`);
  process.exit(1);
}
console.log(warnung.length ? `\nSynchron (mit ${warnung.length} Hinweis).` : `\nAlle Kanäle synchron.`);
