/**
 * Vergleicht die mitgelieferte Werkzeugliste mit der öffentlichen Discovery.
 *
 * `src/tools-fallback.json` ist der Rückfall, wenn der Weg zu knowmind.de
 * versperrt ist — eine Sandbox ohne Netz, ein Verzeichnis-Crawler hinter einer
 * Firewall. Ohne ihn sieht eine Inspektion kein einziges Werkzeug und hält den
 * Server für leer.
 *
 * Der Rückfall veraltet, sobald der Server ein Werkzeug bekommt oder ein
 * Eingabeschema ändert. Dieser Abgleich schlägt dann an. Er gehört in die
 * Pipeline und vor jedes Release.
 *
 *     node scripts/tools-abgleich.mjs
 *
 * Rückgabewert 1, wenn die Listen auseinanderlaufen; 0, wenn sie gleich sind.
 * Ist die Discovery nicht erreichbar, endet der Lauf mit 2 — dann sagt er
 * nichts über den Rückfall aus und darf nicht als bestanden gelten.
 */
import { readFileSync } from "node:fs";

const QUELLE = "https://knowmind.de/api/mcp/v1";

const datei = JSON.parse(
  readFileSync(new URL("../src/tools-fallback.json", import.meta.url), "utf8"),
);

let live;
try {
  const r = await fetch(QUELLE, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  live = await r.json();
} catch (e) {
  console.error(`Discovery nicht erreichbar (${QUELLE}): ${e.message}`);
  console.error("Der Abgleich sagt damit nichts über den Rückfall aus.");
  process.exit(2);
}

const namen = (liste) => (liste ?? []).map((w) => w.name).sort();
const alt = namen(datei.tools);
const neu = namen(live.tools);

const fehlen = neu.filter((n) => !alt.includes(n));
const zuviel = alt.filter((n) => !neu.includes(n));

// Ein Werkzeug kann denselben Namen tragen und ein anderes Eingabeschema haben.
const schema = (liste, name) =>
  JSON.stringify((liste ?? []).find((w) => w.name === name)?.inputSchema ?? {});
const geaendert = neu
  .filter((n) => alt.includes(n))
  .filter((n) => schema(datei.tools, n) !== schema(live.tools, n));

if (fehlen.length === 0 && zuviel.length === 0 && geaendert.length === 0) {
  console.log(
    `Rückfall aktuell: ${alt.length} Werkzeuge, Stand ${datei.stand}, Schemas gleich.`,
  );
  process.exit(0);
}

console.error(`Rückfall veraltet (Stand ${datei.stand}):`);
if (fehlen.length) console.error(`  fehlen:     ${fehlen.join(", ")}`);
if (zuviel.length) console.error(`  überzählig: ${zuviel.join(", ")}`);
if (geaendert.length)
  console.error(`  Schema neu: ${geaendert.join(", ")}`);
console.error("");
console.error("Neu erzeugen und die Änderung mit einem Release ausliefern.");
process.exit(1);
