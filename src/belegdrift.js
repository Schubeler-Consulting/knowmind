/**
 * Belegdrift: Hat sich der Code geändert, auf den die Belege einer OKF-Seite
 * zeigen? (seit 0.4.2)
 *
 * OpenWiki legt zu jeder Seite unter `.claims/<Seite>.json` die belegten
 * Aussagen ab; jeder Beleg nennt eine Datei im Repo und, bei `repo-lines-v1`,
 * einen Zeilenbereich (`repo://src/x.ts#L10-L14`). Den Stand, gegen den die
 * Seite geschrieben wurde, nennt `.page-manifest.json` als `gitHead` je Seite,
 * ersatzweise `.last-update.json`.
 *
 * Gerechnet wird lokal mit git, ohne Sprachmodell: Der Inhalt der belegten
 * Zeilen im Bezugsstand wird mit dem letzten Commit (HEAD) verglichen.
 * `git diff -U0` zwischen beiden Fassungen der Datei liefert die geänderten
 * Zeilenbereiche; berührt einer davon den belegten Bereich, ist der Beleg
 * geändert. Zeilen davor oder danach verschieben den Bereich nur und zählen
 * nicht.
 *
 * Ergebnis je Beleg:
 *   unchanged   Inhalt der belegten Zeilen gleich (auch nach Verschiebung).
 *   changed     belegte Zeilen geändert, gelöscht oder im Bereich ergänzt.
 *   removed     Datei gibt es in HEAD nicht mehr (und keine Umbenennung).
 *   unknown     Bezugsstand fehlt oder liegt nicht in der Historie (flacher
 *               Klon). Das ist keine Drift.
 *
 * Umbenennung: git erkennt sie (`-M`); verglichen wird dann mit der Datei am
 * neuen Ort. Eine Umbenennung allein ist keine Drift, denn die Aussage gilt dem
 * Code, nicht seinem Pfad. Der Beleg trägt dann `moved_to`.
 *
 * Neu bestätigt: Liegt eine Prüfung der Seite (`verified.at`) nach dem letzten
 * Commit, der die Datei seit dem Bezugsstand geändert hat, gilt der Beleg als
 * geprüft und zählt als unverändert. Ein neuer `gitHead` verschiebt den
 * Bezugsstand ohnehin.
 */
import { execFileSync } from "node:child_process";

const HOECHSTZAHL_EINTRAEGE = 10;

function git(wurzel, args) {
  return execFileSync("git", args, { cwd: wurzel, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
}

function versuche(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Wurzel des Git-Repos, in dem `ordner` liegt, sonst null. */
export function gitWurzel(ordner) {
  const out = versuche(() => git(ordner, ["rev-parse", "--show-toplevel"]));
  return out ? out.trim() : null;
}

/** Liegt der Commit `ref` in der Historie? */
export function commitBekannt(wurzel, ref) {
  if (!ref || !/^[0-9a-f]{4,64}$/i.test(ref)) return false;
  return versuche(() => git(wurzel, ["cat-file", "-e", `${ref}^{commit}`])) !== null;
}

/** `repo://pfad#L10-L14` → { pfad, von, bis }; ohne Zeilen nur { pfad }. */
export function belegOrt(resource) {
  const m = /^repo:\/\/([^#]+?)(?:#L(\d+)(?:-L(\d+))?)?$/.exec(String(resource ?? ""));
  if (!m) return null;
  const pfad = m[1].replace(/^\/+/, "");
  if (!m[2]) return { pfad };
  const von = Number(m[2]);
  return { pfad, von, bis: m[3] ? Number(m[3]) : von };
}

/** Geänderte Bereiche aus `git diff -U0`: [{ alt, anzahl }] in Zeilen der alten Fassung. */
export function abschnitte(diff) {
  const liste = [];
  for (const z of diff.split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(z);
    if (m) liste.push({ alt: Number(m[1]), anzahl: m[2] === undefined ? 1 : Number(m[2]) });
  }
  return liste;
}

/** Berührt einer der Bereiche die Zeilen von..bis der alten Fassung? */
export function bereichBeruehrt(liste, von, bis) {
  return liste.some(({ alt, anzahl }) =>
    anzahl > 0
      ? alt <= bis && alt + anzahl - 1 >= von // ersetzt oder gelöscht
      : alt >= von && alt < bis, // eingefügt nach Zeile `alt`, also innerhalb
  );
}

function neuerOrt(wurzel, ref, pfad, merker) {
  const kennung = `${ref}\0${pfad}`;
  if (merker.has(kennung)) return merker.get(kennung);
  let ort = null;
  if (versuche(() => git(wurzel, ["cat-file", "-e", `HEAD:${pfad}`])) !== null) ort = pfad;
  else {
    const status = versuche(() => git(wurzel, ["diff", "-M", "--name-status", ref, "HEAD"])) ?? "";
    for (const z of status.split("\n")) {
      const [art, alt, neu] = z.split("\t");
      if (art?.startsWith("R") && alt === pfad && neu) ort = neu;
    }
  }
  merker.set(kennung, ort);
  return ort;
}

function letzterCommit(wurzel, ref, pfade) {
  const out = versuche(() => git(wurzel, ["log", "-1", "--format=%cI", `${ref}..HEAD`, "--", ...pfade]));
  return out && out.trim() ? Date.parse(out.trim()) : null;
}

/**
 * Prüft einen Beleg. `bestaetigtAm`: späteste Prüfung der Seite (ms) oder null.
 * Rückgabe { status, resource, moved_to? } oder null, wenn der Beleg nicht
 * auf eine Datei im Repo zeigt.
 */
export function belegPruefen(wurzel, ref, beleg, { bestaetigtAm = null, merker = new Map() } = {}) {
  const ort = belegOrt(beleg?.resource);
  if (!ort) return null;
  const typ = String(beleg?.version ?? "");
  if (!typ.startsWith("repo-lines-v1:") && !typ.startsWith("repo-file-v1:")) return null;
  const ergebnis = (status, extra = {}) => ({ status, resource: beleg.resource, ...extra });
  if (!commitBekannt(wurzel, ref)) return ergebnis("unknown");
  if (versuche(() => git(wurzel, ["cat-file", "-e", `${ref}:${ort.pfad}`])) === null) return ergebnis("unknown");

  const jetzt = neuerOrt(wurzel, ref, ort.pfad, merker);
  if (!jetzt) return ergebnis("removed");
  const verschoben = jetzt !== ort.pfad ? { moved_to: jetzt } : {};
  const diff = versuche(() => git(wurzel, ["diff", "-U0", "--no-color", `${ref}:${ort.pfad}`, `HEAD:${jetzt}`])) ?? "";
  const liste = abschnitte(diff);
  const betroffen = ort.von === undefined ? liste.length > 0 : bereichBeruehrt(liste, ort.von, ort.bis);
  if (!betroffen) return ergebnis("unchanged", verschoben);
  // Nach der letzten Änderung erneut geprüft? Dann gilt der Beleg als bestätigt.
  const zuletzt = letzterCommit(wurzel, ref, [...new Set([ort.pfad, jetzt])]);
  if (bestaetigtAm !== null && zuletzt !== null && bestaetigtAm >= zuletzt) {
    return ergebnis("unchanged", { ...verschoben, reconfirmed: true });
  }
  return ergebnis("changed", verschoben);
}

/**
 * Drift aller Belege einer Seite. `daten`: Inhalt von `.claims/<Seite>.json`.
 * Rückgabe { ref, checked, unchanged, changed, removed, unknown, items } mit
 * höchstens zehn Einträgen, die nicht unverändert sind.
 */
export function seitenDrift({ wurzel, ref, daten, bestaetigtAm = null, merker = new Map() }) {
  const anzahl = { unchanged: 0, changed: 0, removed: 0, unknown: 0 };
  const items = [];
  for (const aussage of Array.isArray(daten?.claims) ? daten.claims : []) {
    for (const beleg of Array.isArray(aussage?.evidence) ? aussage.evidence : []) {
      const e = belegPruefen(wurzel, ref, beleg, { bestaetigtAm, merker });
      if (!e) continue;
      anzahl[e.status] += 1;
      if (e.status !== "unchanged" && items.length < HOECHSTZAHL_EINTRAEGE) {
        items.push({ claim: aussage.id ?? null, ...e });
      }
    }
  }
  const checked = anzahl.unchanged + anzahl.changed + anzahl.removed + anzahl.unknown;
  return { ref: ref ?? null, checked, ...anzahl, ...(items.length ? { items } : {}) };
}
