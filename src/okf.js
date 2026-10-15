/**
 * Bündel im Open Knowledge Format (OKF 0.1 und 0.2) für `knowmind sync`.
 *
 * Ein OKF-Bündel ist ein Ordner mit Markdown-Seiten, deren YAML-Kopf sagt,
 * woher eine Seite stammt (`sources`), wer sie geschrieben und wer sie geprüft
 * hat (`generated`, `verified`), ob sie noch gilt (`status`, `stale_after`).
 * So schreibt etwa OpenWiki das Verzeichnis openwiki/ eines Repos, dazu unter
 * `.claims/` je Seite die belegten Aussagen. Spezifikation:
 * https://github.com/GoogleCloudPlatform/open-knowledge-format
 * (SPEC.md, Version 0.2).
 *
 * Dieses Modul erkennt ein Bündel und bildet den Kopf einer Seite auf die
 * Angaben ab, die knowmind an jedem Abschnitt des Dokuments führt:
 *
 *   - `metadata.okf`: Typ, Status, Vertrauensstufe (§5.3), Prüfungen,
 *     Erzeugung, Verfallsdatum, die ersten Quellen und der Stand der Belege.
 *     Kurz gehalten, weil die Angaben an jedem Treffer des Abrufs stehen und
 *     damit im Kontext des Agenten landen; den vollständigen Kopf trägt das
 *     Dokument selbst.
 *   - `metadata.valid_from`: der Zeitpunkt der letzten inhaltlichen Änderung
 *     (`generated.at`, bei OKF 0.1 `timestamp`). Der Abruf zu einem Zeitpunkt
 *     wertet ihn aus.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parse } from "yaml";

/** Dateien mit festgelegter Bedeutung (§3.1): Verzeichnisliste und Verlauf, keine Seiten. */
export const RESERVIERT = new Set(["index.md", "log.md"]);

const HOECHSTZAHL_QUELLEN = 10;
const HOECHSTZAHL_VERIFIZIERT = 5;

/** YAML-Kopf einer Markdown-Datei als Objekt, sonst null. */
export function kopfLesen(inhalt) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(inhalt);
  if (!m) return null;
  try {
    const daten = parse(m[1]);
    return daten && typeof daten === "object" && !Array.isArray(daten) ? daten : null;
  } catch {
    return null;
  }
}

/**
 * Ist `ordner` die Wurzel eines Bündels? Ein Bündel nennt seine Fassung im
 * Kopf der `index.md` an der Wurzel (`okf_version`, §12). OpenWiki-Verzeichnisse
 * erkennt man zusätzlich an `.last-update.json` und `.page-manifest.json`.
 * Rückgabe `{ version, openwiki }` oder null.
 */
export function buendelWurzel(ordner) {
  const index = join(ordner, "index.md");
  let version = null;
  if (existsSync(index)) {
    const kopf = kopfLesen(readFileSync(index, "utf-8"));
    if (kopf?.okf_version != null) version = String(kopf.okf_version);
  }
  const openwiki = existsSync(join(ordner, ".last-update.json")) && existsSync(join(ordner, ".page-manifest.json"));
  if (!version && !openwiki) return null;
  return { version: version ?? "unbekannt", openwiki };
}

/** Zeitpunkt als ISO 8601 in UTC, sonst null. */
export function zeitpunkt(wert) {
  if (wert == null || wert === "") return null;
  const ms = wert instanceof Date ? wert.getTime() : Date.parse(String(wert));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** `verified` als Liste (§5.2: eine einzelne Angabe zählt als Liste mit einem Eintrag). */
export function verifiziert(verified) {
  if (verified == null) return [];
  const liste = Array.isArray(verified) ? verified : [verified];
  return liste
    .filter((v) => v && typeof v === "object" && typeof v.by === "string" && v.by.trim())
    .map((v) => ({ by: v.by.trim(), at: zeitpunkt(v.at) }));
}

/** Vertrauensstufe nach §5.3: ungeprüft, maschinell bestätigt, von einem Menschen geprüft. */
export function vertrauensstufe(liste) {
  if (liste.length === 0) return "unverified";
  return liste.some((v) => v.by.startsWith("human:")) ? "human-reviewed" : "machine-confirmed";
}

/** Prüfsumme der Seite in der Schreibweise von OpenWiki (`pageVersion`). */
export function seitenFassung(inhalt) {
  return "sha256:" + createHash("sha256").update(inhalt, "utf-8").digest("hex");
}

/**
 * Belege einer Seite aus `.claims/<Seite>.json` (OpenWiki). Rückgabe
 * `{ roh, daten }` oder null; `roh` geht in die Änderungserkennung ein, damit
 * neue Belege zu einer unveränderten Seite ankommen.
 */
export function belegeLesen(wurzel, konzept) {
  const pfad = join(wurzel, ".claims", `${konzept}.json`);
  if (!existsSync(pfad)) return null;
  const roh = readFileSync(pfad, "utf-8");
  try {
    return { roh, daten: JSON.parse(roh) };
  } catch {
    return { roh, daten: null };
  }
}

/**
 * Commit, den OpenWiki für eine Seite dokumentiert hat (`.page-manifest.json`,
 * Schlüssel ist der Pfad ab Repo-Wurzel). Sonst null.
 */
export function seitenCommit(seiten, rel) {
  if (!seiten || typeof seiten !== "object") return null;
  for (const [pfad, eintrag] of Object.entries(seiten)) {
    if ((pfad === rel || pfad.endsWith("/" + rel)) && typeof eintrag?.gitHead === "string") return eintrag.gitHead;
  }
  return null;
}

/** Die Seitenliste aus `.page-manifest.json` eines OpenWiki-Verzeichnisses, sonst null. */
export function seitenListeLesen(wurzel) {
  const pfad = join(wurzel, ".page-manifest.json");
  if (!existsSync(pfad)) return null;
  try {
    return JSON.parse(readFileSync(pfad, "utf-8"))?.pages ?? null;
  } catch {
    return null;
  }
}

function belegStand(belege, inhalt) {
  if (!belege) return null;
  const d = belege.daten;
  if (!d || !Array.isArray(d.claims)) return { count: 0, readable: false };
  const erste = verifiziert(d.verification)[0];
  return {
    count: d.claims.length,
    // Gehören die Belege zu genau dieser Fassung der Seite? Wenn nicht, hat
    // jemand die Seite nach der letzten Prüfung geändert.
    page_version_current: typeof d.pageVersion === "string" ? d.pageVersion === seitenFassung(inhalt) : null,
    ...(erste ? { verified_by: erste.by, verified_at: erste.at } : {}),
  };
}

/**
 * Bildet den Kopf einer Seite auf `metadata` für den Upload ab. Ohne `type`
 * im Kopf ist die Datei keine OKF-Seite (§4.1) und bekommt nichts.
 */
export function okfAngaben({ kopf, inhalt, konzept, version, belege = null, commit = null }) {
  if (!kopf || typeof kopf.type !== "string" || !kopf.type.trim()) return null;
  const liste = verifiziert(kopf.verified);
  const quellen = Array.isArray(kopf.sources)
    ? kopf.sources.filter((q) => q && typeof q === "object" && q.resource != null)
    : [];
  const erzeugt =
    kopf.generated && typeof kopf.generated === "object"
      ? { by: kopf.generated.by != null ? String(kopf.generated.by) : null, at: zeitpunkt(kopf.generated.at) }
      : null;
  const status = ["draft", "stable", "deprecated"].includes(kopf.status) ? kopf.status : "stable";
  const okf = {
    version,
    concept: konzept,
    type: kopf.type.trim(),
    status,
    trust: vertrauensstufe(liste),
    ...(liste.length ? { verified: liste.slice(-HOECHSTZAHL_VERIFIZIERT) } : {}),
    ...(erzeugt ? { generated: erzeugt } : {}),
    ...(zeitpunkt(kopf.stale_after) ? { stale_after: zeitpunkt(kopf.stale_after) } : {}),
    ...(typeof kopf.resource === "string" ? { resource: kopf.resource } : {}),
    ...(commit ? { git_head: commit } : {}),
    sources_total: quellen.length,
    ...(quellen.length
      ? {
          sources: quellen.slice(0, HOECHSTZAHL_QUELLEN).map((q) => ({
            resource: String(q.resource),
            ...(q.author != null ? { author: String(q.author) } : {}),
            ...(zeitpunkt(q.last_modified) ? { last_modified: zeitpunkt(q.last_modified) } : {}),
          })),
        }
      : {}),
  };
  const stand = belegStand(belege, inhalt);
  if (stand) okf.claims = stand;
  const gueltigAb = erzeugt?.at ?? zeitpunkt(kopf.timestamp);
  return { okf, ...(gueltigAb ? { valid_from: gueltigAb } : {}) };
}
