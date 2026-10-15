// Kopfzeile eines Treffers bei `knowmind search`, mit Kennzeichen aus OKF-Seiten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { trefferKopf } from "./anzeige.js";

const hit = (metadata) => ({ chunk_id: "c1", score: 0.81234, content: "x", metadata });

test("Kennzeichen stehen in eckigen Klammern hinter dem Wert", () => {
  assert.equal(
    trefferKopf(hit({ name: "Mandantentrennung", review_flags: ["stale", "unverified"] }), 0),
    "#1  Mandantentrennung  (score 0.812)  [stale, unverified]",
  );
});

test("ohne Kennzeichen oder mit leerer Liste bleibt die Zeile wie bisher", () => {
  assert.equal(trefferKopf(hit({ name: "Notiz" }), 1), "#2  Notiz  (score 0.812)");
  assert.equal(trefferKopf(hit({ name: "Notiz", review_flags: [] }), 1), "#2  Notiz  (score 0.812)");
  assert.equal(trefferKopf(hit({ source_id: "d9" }), 2), "#3  d9  (score 0.812)");
});
