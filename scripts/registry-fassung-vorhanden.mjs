#!/usr/bin/env node
// Steht diese Fassung schon im MCP-Verzeichnis?
//
// WARUM ES DIESES SKRIPT GIBT
// Der Ablauf „Publish to MCP Registry" läuft an zwei Auslösern: von Hand
// (`workflow_dispatch`) und beim Setzen eines Versionsmerkmals (`push: tags`).
// Am 07.09.2026 lief beides zehn Minuten auseinander für dieselbe Fassung
// 0.3.7. Der erste Lauf veröffentlichte sie, der zweite bekam vom Verzeichnis
//
//   400 Bad Request: invalid version: cannot publish duplicate version
//
// und färbte den Ablauf rot. Elf Tage lang stand dort ein rotes Kreuz für
// einen Vorgang, der gelungen war — und ein Ablauf, der dauerhaft rot steht,
// verbirgt den nächsten echten Fehler.
//
// Die Ablehnung des Verzeichnisses ist richtig: Eine veröffentlichte Fassung
// darf sich nicht ändern. Falsch war, dass unser Ablauf den zweiten Versuch
// überhaupt unternimmt.
//
// WAS ES TUT
// Es liest die Fassung aus `server.json`, fragt das Verzeichnis und sagt,
// ob sie dort schon steht.
//
//   node scripts/registry-fassung-vorhanden.mjs
//     Rückgabe 0  -> Fassung steht schon im Verzeichnis, Veröffentlichung übergehen
//     Rückgabe 1  -> Fassung fehlt, veröffentlichen
//     Rückgabe 2  -> Abbruch (Datei unlesbar, Verzeichnis antwortet nicht)
//
// **Rückgabe 2 heißt veröffentlichen, nicht überspringen.** Wer bei einer
// unbeantworteten Abfrage übergeht, verpasst eine Veröffentlichung und merkt
// es nie; wer veröffentlicht, riskiert höchstens genau den Doppelversuch, den
// der Ablauf danach ohnehin abfängt. Der Ablauf behandelt 2 deshalb wie 1.
//
//   node scripts/registry-fassung-vorhanden.mjs --fassung 9.9.9
//     prüft eine andere Fassung als die in server.json (für den Prüfstand)
import { readFileSync } from "node:fs";

const VERZEICHNIS = "https://registry.modelcontextprotocol.io/v0/servers";
const NAME = "io.github.Schubeler-Consulting/knowmind";

const argv = process.argv.slice(2);
const i = argv.indexOf("--fassung");
let fassung = i >= 0 ? argv[i + 1] : null;

if (!fassung) {
  try {
    fassung = JSON.parse(readFileSync("server.json", "utf8")).version;
  } catch (e) {
    console.error(`ABBRUCH: server.json nicht lesbar (${e.message})`);
    process.exit(2);
  }
}

if (!fassung) {
  console.error("ABBRUCH: server.json nennt keine Fassung.");
  process.exit(2);
}

let antwort;
try {
  const r = await fetch(`${VERZEICHNIS}?search=knowmind`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) {
    console.error(`ABBRUCH: Verzeichnis antwortet mit ${r.status}.`);
    process.exit(2);
  }
  antwort = await r.json();
} catch (e) {
  console.error(`ABBRUCH: Verzeichnis nicht erreichbar (${e.message})`);
  process.exit(2);
}

// Die Suche liefert auch fremde Server, deren Beschreibung das Wort enthält.
// Deshalb wird auf den vollständigen Namen gefiltert, nicht auf den Treffer.
const unsere = (antwort.servers ?? [])
  .map((e) => e.server ?? {})
  .filter((s) => s.name === NAME);

if (unsere.length === 0) {
  console.log(`Kein Eintrag für ${NAME} im Verzeichnis. Veröffentlichen.`);
  process.exit(1);
}

const vorhanden = unsere.some((s) => s.version === fassung);
if (vorhanden) {
  console.log(`Fassung ${fassung} steht schon im Verzeichnis (${unsere.length} Fassungen gesamt). Übergehen.`);
  process.exit(0);
}

console.log(`Fassung ${fassung} fehlt im Verzeichnis (${unsere.length} andere Fassungen). Veröffentlichen.`);
process.exit(1);
