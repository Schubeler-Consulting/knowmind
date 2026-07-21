#!/usr/bin/env node
// Hält server.json (MCP-Registry-Manifest) an der TATSÄCHLICH auf npm
// veröffentlichten Version. npm ist die Quelle der Wahrheit: die offizielle
// Registry validiert npm-Ownership + Existenz, ein Manifest, das auf eine
// nicht-publizierte Version zeigt, wird mit Fehler abgelehnt. Deshalb NICHT
// package.json folgen (die kann einen unveröffentlichten Bump tragen), sondern
// npm-latest.
//
// Aufruf:
//   node scripts/sync-server-json.mjs           -> setzt auf npm-latest, schreibt
//   node scripts/sync-server-json.mjs <version>  -> setzt auf <version>, schreibt
//   node scripts/sync-server-json.mjs --check     -> nur prüfen, Exit 1 bei Abweichung
//
// Wird vom Publish-Workflow VOR dem Registry-Publish aufgerufen, damit die
// Registry immer == npm-latest ist, ohne dass server.json von Hand gepflegt wird.
import { readFileSync, writeFileSync } from "node:fs";

const PKG = "knowmind";
const arg = process.argv[2];
const checkOnly = arg === "--check";

// npm-latest per HTTP (kein child_process/Shell — plattformunabhängig).
async function npmLatest() {
  const res = await fetch(`https://registry.npmjs.org/${PKG}`);
  if (!res.ok) throw new Error(`npm-Registry HTTP ${res.status}`);
  const data = await res.json();
  return data["dist-tags"]?.latest;
}

const ziel = arg && !arg.startsWith("--") ? arg : await npmLatest();
if (!/^\d+\.\d+\.\d+/.test(ziel)) {
  console.error(`Ungültige Zielversion: ${ziel}`);
  process.exit(2);
}

const pfad = new URL("../server.json", import.meta.url);
const sj = JSON.parse(readFileSync(pfad, "utf8"));
const glamaPfad = new URL("../glama.json", import.meta.url);
const glama = JSON.parse(readFileSync(glamaPfad, "utf8"));

const abweichungen = [];
if (sj.version !== ziel) abweichungen.push(`version ${sj.version} -> ${ziel}`);
for (const p of sj.packages ?? []) {
  if (p.version !== ziel) abweichungen.push(`packages[${p.identifier}].version ${p.version} -> ${ziel}`);
}
// glama.json (Glama-Listing) hängt an derselben Wahrheit (npm-latest).
if (glama.version !== ziel) abweichungen.push(`glama.json version ${glama.version} -> ${ziel}`);

// Identitäts-Invariante: server.json.name muss dem npm-mcpName entsprechen,
// sonst scheitert die Ownership-Validierung der Registry.
const pkgJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (pkgJson.mcpName && pkgJson.mcpName !== sj.name) {
  console.error(`FEHLER: package.json mcpName (${pkgJson.mcpName}) != server.json name (${sj.name})`);
  process.exit(2);
}

if (!abweichungen.length) {
  console.log(`server.json + glama.json bereits auf ${ziel} — nichts zu tun.`);
  process.exit(0);
}

if (checkOnly) {
  console.error(`Manifeste weichen ab:\n  ${abweichungen.join("\n  ")}`);
  process.exit(1);
}

sj.version = ziel;
for (const p of sj.packages ?? []) p.version = ziel;
writeFileSync(pfad, JSON.stringify(sj, null, 2) + "\n");
if (glama.version !== ziel) {
  glama.version = ziel;
  writeFileSync(glamaPfad, JSON.stringify(glama, null, 2) + "\n");
}
console.log(`Manifeste -> ${ziel} gesetzt:\n  ${abweichungen.join("\n  ")}`);
