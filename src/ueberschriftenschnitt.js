/**
 * Schneidet Markdown an Überschriften: ein Ausschnitt je Abschnitt.
 *
 * Gleiche Regel wie im Dienst (`services/memory/app/ueberschriftenschnitt.py`
 * in soviq-platform); beide prüfen sich gegen
 * `test/fixtures/ueberschriftenschnitt_faelle.json`. Bis 0.4.5 schnitt die
 * Kommandozeile alle 1.200 Zeichen. In den Kompendien begann der Ausschnitt
 * einer Regel dadurch mitten in der Regel davor, und die Nachsortierung, die
 * nur die ersten 500 Zeichen liest, sah sie nicht.
 *
 * - Jede Überschrift (# bis ######, außerhalb von Codeblöcken) beginnt einen
 *   eigenen Ausschnitt; benachbarte Abschnitte werden nicht zusammengelegt.
 * - Ein Abschnitt unter MINDEST Zeichen wandert zum folgenden.
 * - Lange Abschnitte werden an Leerzeilen geteilt, dann an Zeilenenden, zuletzt hart.
 * - Kopfdaten (--- … ---) bleiben mit dem Vorspann vorn.
 * - Die Ausschnitte hintereinander ergeben den Text Zeichen für Zeichen.
 * - Text ohne Überschrift und ohne Kopfdaten schneidet fest wie bisher.
 *
 * Längen zählen Unicode-Zeichen wie Python, nicht UTF-16-Einheiten: Sonst
 * schnitte ein Emoji die Grenze anders als der Dienst und könnte ein
 * Ersatzzeichenpaar zerreißen.
 */
export const ZIEL = 1200;
export const MINDEST = 200;

const UEBERSCHRIFT = /^#{1,6}[ \t]+[^ \t\r\n\f\v]/;
const ZAUN = /^[ \t]*(```|~~~)/;
const KOPFDATEN = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const LEERZEILE = /\n[ \t\r]*\n/g;
// Leerraum ausdrücklich, wie im Dienst: trim() zählt andere Zeichen dazu als Pythons strip().
const RAND = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;

const rumpf = (s) => s.replace(RAND, "");
const laenge = (s) => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

/** Der bisherige Schnitt: alle `groesse` Zeichen, leere Stücke fallen weg. */
export function fest(text, groesse = ZIEL) {
  const z = Array.from(text);
  const aus = [];
  for (let i = 0; i < z.length; i += groesse) {
    const seg = z.slice(i, i + groesse).join("");
    if (rumpf(seg)) aus.push(seg);
  }
  return aus;
}

function zeilen(text) {
  return text.split(/(?<=\n)/).filter((z) => z);
}

/** Kopfdaten am Anfang oder eine Überschrift außerhalb eines Codeblocks. */
export function istMarkdown(text) {
  if (KOPFDATEN.test(text)) return true;
  let zaun = false;
  for (const zeile of zeilen(text)) {
    if (ZAUN.test(zeile)) zaun = !zaun;
    else if (!zaun && UEBERSCHRIFT.test(zeile)) return true;
  }
  return false;
}

function abschnitte(text) {
  const teile = [];
  let aktuell = "";
  let zaun = false;
  for (const zeile of zeilen(text)) {
    if (ZAUN.test(zeile)) zaun = !zaun;
    else if (!zaun && UEBERSCHRIFT.test(zeile) && aktuell) {
      teile.push(aktuell);
      aktuell = "";
    }
    aktuell += zeile;
  }
  if (aktuell) teile.push(aktuell);
  return teile;
}

function hart(text, groesse) {
  let z = Array.from(text);
  const stuecke = [];
  while (z.length > groesse) {
    let schnitt = z.lastIndexOf("\n", groesse - 1) + 1;
    if (schnitt <= Math.floor(groesse / 3)) schnitt = groesse;
    stuecke.push(z.slice(0, schnitt).join(""));
    z = z.slice(schnitt);
  }
  if (z.length) stuecke.push(z.join(""));
  return stuecke;
}

function langTeilen(text, groesse) {
  if (laenge(text) <= groesse) return [text];
  const grenzen = [0];
  for (const m of text.matchAll(LEERZEILE)) grenzen.push(m.index + m[0].length);
  grenzen.push(text.length);
  const absaetze = [];
  for (let i = 0; i + 1 < grenzen.length; i++) {
    if (grenzen[i + 1] > grenzen[i]) absaetze.push(text.slice(grenzen[i], grenzen[i + 1]));
  }
  const stuecke = [];
  let puffer = "";
  for (const absatz of absaetze) {
    // Ein kurzer Puffer (etwa die Überschrift allein) bleibt beim folgenden Absatz.
    if (puffer && laenge(puffer) + laenge(absatz) > groesse && laenge(rumpf(puffer)) >= MINDEST) {
      stuecke.push(puffer);
      puffer = "";
    }
    puffer += absatz;
    if (laenge(puffer) > groesse) {
      const teile = hart(puffer, groesse);
      puffer = teile.pop();
      stuecke.push(...teile);
    }
  }
  if (puffer) stuecke.push(puffer);
  return stuecke;
}

/** Die Ausschnitte eines Textes für das Hochladen. Leerer Text ergibt keinen. */
export function zerlegen(text, groesse = ZIEL) {
  if (!text || !rumpf(text)) return [];
  if (!istMarkdown(text)) return fest(text, groesse);

  const m = text.match(KOPFDATEN);
  const kopf = m ? m[0] : "";
  const teile = abschnitte(m ? text.slice(m[0].length) : text);
  const roh = [];
  let offen = kopf;
  teile.forEach((t, i) => {
    const abschnitt = offen + t;
    offen = "";
    if (laenge(rumpf(abschnitt)) < MINDEST && i + 1 < teile.length) {
      offen = abschnitt;
      return;
    }
    roh.push(...langTeilen(abschnitt, groesse));
  });
  if (offen) roh.push(offen);

  // Reiner Leerraum hängt am Ausschnitt davor, damit der Wortlaut vollständig bleibt.
  let aus = [];
  for (const stueck of roh) {
    if (!rumpf(stueck) && aus.length) aus[aus.length - 1] += stueck;
    else if (rumpf(stueck) || !aus.length) aus.push(stueck);
  }
  if (aus.length && !rumpf(aus[0])) {
    if (aus.length > 1) aus[1] = aus[0] + aus[1];
    aus = aus.slice(1);
  }
  return aus;
}
