// Der MCP-Starter für Windows an einem festen Ort im Benutzerverzeichnis.
//
// WARUM (16.10.2026, CRM 4b33e6fe): install schrieb den Pfad des Starters
// dorthin, wo das Kommandozeilenwerkzeug gerade lief. Wer nach README
// `npx -y knowmind install <ide>` aufruft, bekommt einen Pfad in den
// npx-Zwischenspeicher (%LOCALAPPDATA%\npm-cache\_npx\…). Leert er den, gibt es
// die Datei nicht mehr, und der MCP-Server startet ohne Meldung nicht.
//
// Deshalb liegt der Starter in ~/.knowmind/mcp-starter.py. install legt ihn
// dort ab und trägt diesen Pfad ein. Der Starter ruft `npx -y knowmind mcp`
// auf; ist der Zwischenspeicher leer, holt npx das Paket neu.
//
// Den Starter gibt es wegen des Konsolenfensters (src/mcp-starter.py, Johann
// am 10.08.2026: „Viele werden es deshalb deinstallieren.“). Er bleibt also
// pythonw.exe plus Starter, nur an einem Ort, der nicht verschwindet.
//
// Auffrischen: Jede Fassung trägt `STARTER_STAND = <n>` im Starter. install und
// der Start des MCP-Servers ersetzen die abgelegte Datei, wenn die mitgelieferte
// einen höheren Stand hat. Eine ältere Fassung überschreibt nie eine neuere.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MITGELIEFERT = join(dirname(fileURLToPath(import.meta.url)), "mcp-starter.py");

export function starterOrt(heim = homedir()) {
  return join(heim, ".knowmind", "mcp-starter.py");
}

export function starterStand(text) {
  const m = /^STARTER_STAND = (\d+)/m.exec(text || "");
  return m ? Number(m[1]) : 0;
}

/**
 * Legt den Starter ab oder frischt ihn auf. `nurWennDa`: nichts anlegen, nur
 * eine vorhandene Datei auffrischen (Start des MCP-Servers).
 * Rückgabe: "angelegt", "aufgefrischt", "aktuell" oder "fehlt".
 */
export function starterAblegen({ ziel = starterOrt(), nurWennDa = false, quelle = MITGELIEFERT } = {}) {
  const neu = readFileSync(quelle, "utf-8");
  if (existsSync(ziel)) {
    const alt = readFileSync(ziel, "utf-8");
    if (alt === neu || starterStand(alt) >= starterStand(neu)) return "aktuell";
  } else if (nurWennDa) {
    return "fehlt";
  }
  const da = existsSync(ziel);
  mkdirSync(dirname(ziel), { recursive: true });
  // Erst daneben schreiben, dann umbenennen: Ein Client, der in diesem Moment
  // startet, liest die alte oder die neue Datei, nie eine halbe.
  const zwischen = `${ziel}.${process.pid}.neu`;
  writeFileSync(zwischen, neu, "utf-8");
  renameSync(zwischen, ziel);
  return da ? "aufgefrischt" : "angelegt";
}
