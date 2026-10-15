// lint: ascii-ok
//   (Bezeichner und die Prüfadresse des Test-Repos sind ASCII.)
// Belegdrift: Belege einer OKF-Seite gegen den Code im Repo (seit 0.4.2).
//
// Jeder Fall legt ein eigenes Prüf-Repo an (git init im Temp-Verzeichnis),
// darin `src/rechnung.ts` mit zwanzig Zeilen und ein OpenWiki-Verzeichnis,
// dessen Beleg auf die Zeilen 8 bis 10 zeigt. Bezugsstand ist der erste
// Commit. Der Ende-zu-Ende-Fall lädt an einen Prüfserver auf 127.0.0.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abschnitte, bereichBeruehrt, belegOrt, belegPruefen, gitWurzel, seitenDrift } from "./belegdrift.js";
import { syncDirectory } from "./sync.js";

const ZEILEN = Array.from({ length: 20 }, (_, i) => `export const zeile${i + 1} = ${i + 1};`);
const BELEG = { resource: "repo://src/rechnung.ts#L8-L10", version: "repo-lines-v1:sha256:" + "a".repeat(64) };
const WER = ["-c", "user.name=Pruefung", "-c", "user.email=pruefung@example.invalid"];

function g(repo, ...args) {
  return execFileSync("git", [...WER, ...args], { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function commit(repo, botschaft, datum) {
  execFileSync("git", [...WER, "add", "-A"], { cwd: repo });
  execFileSync("git", [...WER, "commit", "-q", "-m", botschaft], {
    cwd: repo,
    env: { ...process.env, GIT_COMMITTER_DATE: datum, GIT_AUTHOR_DATE: datum },
  });
  return g(repo, "rev-parse", "HEAD");
}

function pruefRepo(t) {
  const repo = mkdtempSync(join(tmpdir(), "belegdrift-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  g(repo, "init", "-q");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "rechnung.ts"), ZEILEN.join("\n") + "\n");
  const ref = commit(repo, "Anfang", "2026-10-01T10:00:00Z");
  return { repo, ref };
}

const datei = (repo) => join(repo, "src", "rechnung.ts");
const zeilen = (repo) => readFileSync(datei(repo), "utf-8").split("\n");

test("Diff-Bereiche: ersetzt, eingefügt davor, danach und mittendrin", () => {
  assert.deepEqual(abschnitte("@@ -9 +9 @@\n-a\n+b\n@@ -2,0 +3,2 @@\n+x\n+y\n"), [
    { alt: 9, anzahl: 1 }, { alt: 2, anzahl: 0 },
  ]);
  assert.equal(bereichBeruehrt([{ alt: 9, anzahl: 1 }], 8, 10), true);
  assert.equal(bereichBeruehrt([{ alt: 2, anzahl: 0 }], 8, 10), false, "eingefügt davor");
  assert.equal(bereichBeruehrt([{ alt: 10, anzahl: 0 }], 8, 10), false, "eingefügt danach");
  assert.equal(bereichBeruehrt([{ alt: 8, anzahl: 0 }], 8, 10), true, "eingefügt zwischen Zeile 8 und 9");
  assert.equal(bereichBeruehrt([{ alt: 11, anzahl: 3 }], 8, 10), false);
  assert.deepEqual(belegOrt("repo://src/a.ts#L3-L5"), { pfad: "src/a.ts", von: 3, bis: 5 });
  assert.deepEqual(belegOrt("repo://src/a.ts#L7"), { pfad: "src/a.ts", von: 7, bis: 7 });
  assert.deepEqual(belegOrt("repo://README.md"), { pfad: "README.md" });
  assert.equal(belegOrt("https://example.org"), null);
});

test("belegte Zeilen unverändert", (t) => {
  const { repo, ref } = pruefRepo(t);
  writeFileSync(join(repo, "NOTIZ.md"), "anderes\n");
  commit(repo, "anderswo", "2026-10-02T10:00:00Z");
  assert.equal(belegPruefen(repo, ref, BELEG).status, "unchanged");
});

test("belegte Zeile geändert", (t) => {
  const { repo, ref } = pruefRepo(t);
  const z = zeilen(repo);
  z[8] = "export const zeile9 = 99;";
  writeFileSync(datei(repo), z.join("\n"));
  commit(repo, "Zeile 9", "2026-10-02T10:00:00Z");
  assert.equal(belegPruefen(repo, ref, BELEG).status, "changed");
});

test("nur Zeilen davor eingefügt, Inhalt verschoben: keine Drift", (t) => {
  const { repo, ref } = pruefRepo(t);
  const z = zeilen(repo);
  z.splice(2, 0, "// neu 1", "// neu 2", "// neu 3");
  writeFileSync(datei(repo), z.join("\n"));
  commit(repo, "Kopf erweitert", "2026-10-02T10:00:00Z");
  assert.equal(belegPruefen(repo, ref, BELEG).status, "unchanged");
});

test("Datei gelöscht", (t) => {
  const { repo, ref } = pruefRepo(t);
  rmSync(datei(repo));
  commit(repo, "weg", "2026-10-02T10:00:00Z");
  assert.equal(belegPruefen(repo, ref, BELEG).status, "removed");
});

test("Datei umbenannt: verglichen wird am neuen Ort, eine Umbenennung allein ist keine Drift", (t) => {
  const { repo, ref } = pruefRepo(t);
  renameSync(datei(repo), join(repo, "src", "abrechnung.ts"));
  commit(repo, "umbenannt", "2026-10-02T10:00:00Z");
  assert.deepEqual(belegPruefen(repo, ref, BELEG), {
    status: "unchanged", resource: BELEG.resource, moved_to: "src/abrechnung.ts",
  });
  const z = readFileSync(join(repo, "src", "abrechnung.ts"), "utf-8").split("\n");
  z[9] = "export const zeile10 = 100;";
  writeFileSync(join(repo, "src", "abrechnung.ts"), z.join("\n"));
  commit(repo, "danach geändert", "2026-10-03T10:00:00Z");
  assert.equal(belegPruefen(repo, ref, BELEG).status, "changed");
});

test("Bezugsstand fehlt oder liegt nicht in der Historie: unbekannt, keine Drift", (t) => {
  const { repo } = pruefRepo(t);
  assert.equal(belegPruefen(repo, null, BELEG).status, "unknown");
  assert.equal(belegPruefen(repo, "1".repeat(40), BELEG).status, "unknown");
  const d = seitenDrift({ wurzel: repo, ref: null, daten: { claims: [{ id: "c1", evidence: [BELEG] }] } });
  assert.equal(d.unknown, 1);
  assert.equal(d.changed + d.removed, 0);
});

test("erneut bestätigt: Prüfung nach der Änderung hebt die Drift auf, eine ältere nicht", (t) => {
  const { repo, ref } = pruefRepo(t);
  const z = zeilen(repo);
  z[7] = "export const zeile8 = 88;";
  writeFileSync(datei(repo), z.join("\n"));
  commit(repo, "Zeile 8", "2026-10-05T10:00:00Z");
  const vorher = Date.parse("2026-10-04T10:00:00Z");
  const nachher = Date.parse("2026-10-06T10:00:00Z");
  assert.equal(belegPruefen(repo, ref, BELEG, { bestaetigtAm: vorher }).status, "changed");
  assert.deepEqual(belegPruefen(repo, ref, BELEG, { bestaetigtAm: nachher }), {
    status: "unchanged", resource: BELEG.resource, reconfirmed: true,
  });
  const neu = g(repo, "rev-parse", "HEAD");
  assert.equal(belegPruefen(repo, neu, BELEG).status, "unchanged", "neuer Bezugsstand: deckungsgleich");
});

test("außerhalb eines Git-Repos keine Wurzel", (t) => {
  const ordner = mkdtempSync(join(tmpdir(), "ohne-git-"));
  t.after(() => rmSync(ordner, { recursive: true, force: true }));
  assert.equal(gitWurzel(ordner), null);
});

// ─── Ende zu Ende über `knowmind sync` ───────────────────────────────

async function pruefserver(t) {
  const eingang = [];
  let n = 0;
  const server = createServer((req, res) => {
    let roh = "";
    req.on("data", (s) => (roh += s));
    req.on("end", () => {
      eingang.push(JSON.parse(roh));
      n += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const alt = { ...process.env };
  Object.assign(process.env, {
    KNOWMIND_API_URL: `http://127.0.0.1:${server.address().port}`, KNOWMIND_TOKEN: "kmt_pruefung", KNOWMIND_EMBED_MODE: "server",
  });
  t.mock.method(console, "log", () => {});
  t.after(() => {
    server.close();
    process.env = alt;
  });
  return eingang;
}

function wikiAnlegen(ordner, ref) {
  const wiki = join(ordner, "openwiki");
  mkdirSync(join(wiki, ".claims"), { recursive: true });
  writeFileSync(join(wiki, "index.md"), '---\nokf_version: "0.2"\n---\n\n# Files\n');
  writeFileSync(join(wiki, "rechnung.md"), [
    "---", "type: concept", "title: Rechnung", "generated: { by: openwiki/0.7.0, at: 2026-10-01T11:00:00Z }",
    "---", "", "# Rechnung", "", "Zeilen 8 bis 10 legen die Werte fest.", "",
  ].join("\n"));
  writeFileSync(join(wiki, ".claims", "rechnung.json"), JSON.stringify({
    schemaVersion: 1, pageVersion: "sha256:" + "0".repeat(64), claims: [{ id: "claim_1", statement: "Werte", evidence: [BELEG] }],
  }));
  writeFileSync(join(wiki, ".last-update.json"), JSON.stringify({ gitHead: ref, status: "complete" }));
  writeFileSync(join(wiki, ".page-manifest.json"), JSON.stringify({
    schemaVersion: 1, pages: { "/openwiki/rechnung.md": { gitHead: ref } },
  }));
  return wiki;
}

test("sync: Drift geht an die Seite, zweiter Lauf schreibt nichts, Bestätigung hebt sie auf", async (t) => {
  const eingang = await pruefserver(t);
  const { repo, ref } = pruefRepo(t);
  const wiki = wikiAnlegen(repo, ref);

  await syncDirectory(wiki);
  const erst = eingang.find((b) => b.title === "Rechnung").metadata.okf.claims.drift;
  assert.deepEqual({ checked: erst.checked, changed: erst.changed, ref: erst.ref }, { checked: 1, changed: 0, ref });

  // Belegte Zeile ändern und committen: Die Seite geht mit der Drift erneut hinaus.
  const z = zeilen(repo);
  z[8] = "export const zeile9 = 99;";
  writeFileSync(datei(repo), z.join("\n"));
  commit(repo, "Zeile 9", "2026-10-05T10:00:00Z");
  eingang.length = 0;
  const zweit = await syncDirectory(wiki);
  assert.equal(eingang.length, 1);
  const drift = eingang[0].metadata.okf.claims.drift;
  assert.equal(drift.changed, 1);
  assert.deepEqual(drift.items, [{ claim: "claim_1", status: "changed", resource: BELEG.resource }]);
  assert.equal(zweit.belegStand.changed, 1);

  // Zweiter Lauf ohne Änderung: nichts geht hinaus.
  eingang.length = 0;
  await syncDirectory(wiki);
  assert.equal(eingang.length, 0);

  // Neu bestätigt (OpenWiki hat die Seite gegen HEAD neu geschrieben): keine Drift mehr.
  const neu = g(repo, "rev-parse", "HEAD");
  writeFileSync(join(wiki, ".page-manifest.json"), JSON.stringify({ schemaVersion: 1, pages: { "/openwiki/rechnung.md": { gitHead: neu } } }));
  await syncDirectory(wiki);
  assert.equal(eingang.length, 1);
  assert.equal(eingang[0].metadata.okf.claims.drift.changed, 0);
});

test("sync außerhalb eines Git-Repos: Hinweis, keine Drift, kein Fehler", async (t) => {
  const eingang = await pruefserver(t);
  const ordner = mkdtempSync(join(tmpdir(), "ohne-git-"));
  t.after(() => rmSync(ordner, { recursive: true, force: true }));
  const wiki = wikiAnlegen(ordner, "1".repeat(40));
  const ergebnis = await syncDirectory(wiki);
  assert.equal(ergebnis.failed, 0);
  assert.equal(ergebnis.belegStand.ohneGit, true);
  const seite = eingang.find((b) => b.title === "Rechnung");
  assert.equal(seite.metadata.okf.claims.drift, undefined);
  assert.ok(console.log.mock.calls.some((c) => String(c.arguments[0]).includes("in keinem Git-Repository")));
});
