// OKF-Bündel einlesen (openwiki/ und andere Bündel nach OKF 0.2).
//
// Die Fälle laufen gegen das Beispiel test/fixtures/okf-beispiel, nach der
// Spezifikation gebaut (SPEC.md §3–§12 von OKF 0.2) und im Aufbau einem
// Verzeichnis von OpenWiki 0.7.0 nachgebildet: .claims/, .last-update.json,
// .page-manifest.json. Der Ende-zu-Ende-Fall schickt die Uploads an einen
// Prüfserver auf 127.0.0.1, nichts geht hinaus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  kopfLesen, buendelWurzel, okfAngaben, verifiziert, vertrauensstufe, seitenFassung, belegeLesen,
} from "./okf.js";
import { syncDirectory } from "./sync.js";

const HIER = dirname(fileURLToPath(import.meta.url));
const BEISPIEL = join(HIER, "..", "test", "fixtures", "okf-beispiel");
const lies = (rel) => readFileSync(join(BEISPIEL, rel), "utf-8");

test("Kopf mit verschachtelten Feldern wird gelesen, kaputtes YAML ergibt null", () => {
  const kopf = kopfLesen(lies("architecture/mandantentrennung.md"));
  assert.equal(kopf.type, "concept");
  assert.equal(kopf.sources.length, 12);
  assert.equal(kopf.generated.by, "openwiki/0.7.0");
  assert.equal(kopfLesen("---\ntype: [kaputt\n---\nText"), null);
  assert.equal(kopfLesen("Kein Kopf"), null);
});

test("Bündel wird an okf_version und an den Dateien von OpenWiki erkannt", () => {
  assert.deepEqual(buendelWurzel(BEISPIEL), { version: "0.2", openwiki: true });
  assert.equal(buendelWurzel(join(BEISPIEL, "architecture")), null, "Unterordner ohne Kennung ist keine Wurzel");
});

test("Vertrauensstufen nach §5.3, einzelne Prüfung als Liste", () => {
  assert.equal(vertrauensstufe(verifiziert(undefined)), "unverified");
  assert.equal(vertrauensstufe(verifiziert({ by: "process:nightly", at: "2026-10-01T00:00:00Z" })), "machine-confirmed");
  assert.equal(vertrauensstufe(verifiziert([{ by: "openwiki/0.7.0" }, { by: "human:jj" }])), "human-reviewed");
  assert.deepEqual(verifiziert([{ at: "2026-01-01" }, "x"]), [], "Prüfung ohne Prüfer zählt nicht");
});

test("Feldabbildung einer geprüften Seite mit Belegen", () => {
  const inhalt = lies("architecture/mandantentrennung.md");
  const a = okfAngaben({
    kopf: kopfLesen(inhalt), inhalt, konzept: "architecture/mandantentrennung", version: "0.2",
    belege: belegeLesen(BEISPIEL, "architecture/mandantentrennung"), commit: "1111111",
  });
  assert.equal(a.valid_from, "2026-10-14T08:05:00.000Z", "generated.at wird zur Gültigkeit");
  const o = a.okf;
  assert.equal(o.version, "0.2");
  assert.equal(o.concept, "architecture/mandantentrennung");
  assert.equal(o.type, "concept");
  assert.equal(o.status, "stable");
  assert.equal(o.trust, "human-reviewed");
  assert.deepEqual(o.verified.map((v) => v.by), ["process:nightly-tests", "human:jschuebeler"]);
  assert.deepEqual(o.generated, { by: "openwiki/0.7.0", at: "2026-10-14T08:05:00.000Z" });
  assert.equal(o.stale_after, "2027-01-01T00:00:00.000Z");
  assert.equal(o.resource, "repo://src/mandant.ts");
  assert.equal(o.git_head, "1111111");
  assert.equal(o.sources_total, 12);
  assert.equal(o.sources.length, 10, "die ersten zehn Quellen, der Rest steht im Dokument");
  assert.deepEqual(o.sources[0], {
    resource: "repo://src/mandant.ts", author: "human:jschuebeler", last_modified: "2026-10-01T12:00:00.000Z",
  });
  assert.deepEqual(o.claims, {
    count: 2, page_version_current: true, verified_by: "openwiki/0.7.0", verified_at: "2026-10-14T08:05:30.000Z",
  });
  assert.ok(JSON.stringify(a).length < 4000, "klein genug für jeden Treffer");
});

test("Feldabbildung OKF 0.1: timestamp statt generated, überholte Seite, maschinell bestätigt", () => {
  const inhalt = lies("workflows/abo-verlaengerung.md");
  const a = okfAngaben({ kopf: kopfLesen(inhalt), inhalt, konzept: "workflows/abo-verlaengerung", version: "0.2" });
  assert.equal(a.valid_from, "2026-03-02T10:00:00.000Z");
  assert.equal(a.okf.status, "deprecated");
  assert.equal(a.okf.trust, "machine-confirmed");
  assert.equal(a.okf.generated, undefined);
  assert.equal(a.okf.claims, undefined, "ohne .claims/ keine Angabe zu Belegen");
});

test("ohne type ist eine Datei keine OKF-Seite, unbekannter Status gilt als stable", () => {
  assert.equal(okfAngaben({ kopf: { title: "x" }, inhalt: "", konzept: "x", version: "0.2" }), null);
  assert.equal(okfAngaben({ kopf: null, inhalt: "", konzept: "x", version: "0.2" }), null);
  const a = okfAngaben({ kopf: { type: "Metric", status: "fertig" }, inhalt: "", konzept: "m", version: "0.2" });
  assert.equal(a.okf.status, "stable");
  assert.equal(a.okf.trust, "unverified");
  assert.equal(a.valid_from, undefined);
});

test("ein reines Datum bei stale_after wird als Zeitpunkt in UTC gelesen", () => {
  const a = okfAngaben({ kopf: { type: "Metric", stale_after: "2026-09-23" }, inhalt: "", konzept: "m", version: "0.2" });
  assert.equal(a.okf.stale_after, "2026-09-23T00:00:00.000Z");
});

test("Belege zu einer veränderten Seite gelten nicht mehr als aktuell", () => {
  const inhalt = lies("architecture/mandantentrennung.md");
  const belege = belegeLesen(BEISPIEL, "architecture/mandantentrennung");
  assert.equal(belege.daten.pageVersion, seitenFassung(inhalt));
  const neu = inhalt.replace("ausschließlich", "nur");
  const a = okfAngaben({ kopf: kopfLesen(neu), inhalt: neu, konzept: "architecture/mandantentrennung", version: "0.2", belege });
  assert.equal(a.okf.claims.page_version_current, false);
});

// ─── Ende zu Ende: Einlesen, Änderung der Seite, Änderung nur der Belege ───

async function pruefserver() {
  const eingang = [];
  let n = 0;
  const server = createServer((req, res) => {
    let roh = "";
    req.on("data", (s) => (roh += s));
    req.on("end", () => {
      eingang.push(JSON.parse(roh));
      n += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, chunksWritten: 1 }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { eingang, server, url: `http://127.0.0.1:${server.address().port}` };
}

function umgebung(t, url) {
  const alt = { ...process.env };
  t.after(() => {
    process.env = alt;
  });
  Object.assign(process.env, { KNOWMIND_API_URL: url, KNOWMIND_TOKEN: "kmt_pruefung", KNOWMIND_EMBED_MODE: "server" });
  t.mock.method(console, "log", () => {});
}

test("sync liest das Bündel ein, lässt Listen aus und schickt Herkunft und Prüfstand mit", async (t) => {
  const { eingang, server, url } = await pruefserver();
  const ordner = mkdtempSync(join(tmpdir(), "okf-sync-"));
  t.after(() => {
    server.close();
    rmSync(ordner, { recursive: true, force: true });
  });
  cpSync(BEISPIEL, ordner, { recursive: true });
  umgebung(t, url);

  // 1. Einlesen
  const erst = await syncDirectory(ordner);
  const titel = eingang.map((b) => b.title).sort();
  assert.deepEqual(titel, ["Abo-Verlängerung (alt)", "Mandantentrennung", "Schnellstart Abrechnungsdienst", "notizen"]);
  assert.equal(erst.okfSeiten, 3);
  assert.equal(erst.ausgelassen, 4, "index.md (2), log.md, INSTRUCTIONS.md");
  const mandant = eingang.find((b) => b.title === "Mandantentrennung");
  assert.equal(mandant.metadata.okf.trust, "human-reviewed");
  assert.equal(mandant.metadata.okf.git_head, "1111111111111111111111111111111111111111");
  assert.equal(mandant.metadata.okf.claims.page_version_current, true);
  assert.equal(mandant.metadata.valid_from, "2026-10-14T08:05:00.000Z");
  assert.equal(mandant.content, lies("architecture/mandantentrennung.md"), "das Dokument trägt die ganze Seite");
  assert.equal(eingang.find((b) => b.title === "notizen").metadata, undefined, "Datei ohne Kopf bekommt nichts");

  // 2. Unverändert: nichts geht hinaus
  eingang.length = 0;
  await syncDirectory(ordner);
  assert.equal(eingang.length, 0);

  // 3. Die Seite ändert sich (ein Mensch hat sie geprüft): neue Fassung derselben Seite
  const pfad = join(ordner, "quickstart.md");
  writeFileSync(pfad, readFileSync(pfad, "utf-8").replace(
    "generated: { by: openwiki/0.7.0, at: 2026-10-14T08:00:00Z }",
    "generated: { by: openwiki/0.7.0, at: 2026-10-14T08:00:00Z }\nverified: { by: human:jschuebeler, at: 2026-10-16T08:00:00Z }",
  ));
  await syncDirectory(ordner);
  assert.equal(eingang.length, 1);
  assert.equal(eingang[0].title, "Schnellstart Abrechnungsdienst");
  assert.equal(eingang[0].metadata.okf.trust, "human-reviewed");
  assert.ok(eingang[0].replaceDocumentId, "ersetzt die vorige Fassung");

  // 4. Nur die Belege ändern sich: Die Seite geht mit dem neuen Stand erneut hinaus
  eingang.length = 0;
  const belegPfad = join(ordner, ".claims", "architecture", "mandantentrennung.json");
  const belege = JSON.parse(readFileSync(belegPfad, "utf-8"));
  belege.pageVersion = "sha256:" + "0".repeat(64);
  writeFileSync(belegPfad, JSON.stringify(belege));
  await syncDirectory(ordner);
  assert.equal(eingang.length, 1);
  assert.equal(eingang[0].title, "Mandantentrennung");
  assert.equal(eingang[0].metadata.okf.claims.page_version_current, false);
});

test("ein Ordner ohne Bündel bleibt beim alten Verhalten, --okf erzwingt das Bündel", async (t) => {
  const { eingang, server, url } = await pruefserver();
  const ordner = mkdtempSync(join(tmpdir(), "okf-ohne-"));
  t.after(() => {
    server.close();
    rmSync(ordner, { recursive: true, force: true });
  });
  writeFileSync(join(ordner, "index.md"), "# Liste\n");
  writeFileSync(join(ordner, "metrik.md"), "---\ntype: Metric\nname: umsatz\n---\nUmsatz je Monat.\n");
  umgebung(t, url);

  await syncDirectory(ordner);
  assert.deepEqual(eingang.map((b) => b.title).sort(), ["index", "metrik"]);
  assert.ok(eingang.every((b) => b.metadata === undefined), "ohne Bündel keine OKF-Angaben");

  eingang.length = 0;
  rmSync(join(ordner, ".knowmind-manifest.json"));
  await syncDirectory(ordner, { okf: true });
  assert.deepEqual(eingang.map((b) => b.title), ["metrik"], "index.md ist im Bündel eine Liste");
  assert.equal(eingang[0].metadata.okf.version, "unbekannt");
  assert.equal(eingang[0].metadata.okf.type, "Metric");
});
