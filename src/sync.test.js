// Umbenannte Datei bleibt dasselbe Dokument (B3, 10.10.2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { frontmatterName, quellpfad, vorgaengerFinden } from "./sync.js";

const manifest = {
  files: {
    "project-nacht-plan.md": { sha256: "a1", documentId: "doc-1", name: "project_nacht_plan" },
    "alt-ohne-name.md": { sha256: "b2", documentId: "doc-2" },
    "noch-da.md": { sha256: "c3", documentId: "doc-3", name: "noch_da" },
  },
};
const nurNochDa = (r) => r === "noch-da.md";

test("Frontmatter-Name wird gelesen", () => {
  assert.equal(frontmatterName("---\nname: project_nacht_plan\ndescription: x\n---\nText"), "project_nacht_plan");
  assert.equal(frontmatterName("---\r\nname: \"zitiert\"\r\n---\r\n"), "zitiert");
  assert.equal(frontmatterName("Kein Frontmatter\nname: nein"), null);
});

test("Umbenennung mit gleichem Namen findet den Vorgänger", () => {
  assert.equal(vorgaengerFinden(manifest, "project_nacht_plan.md", "project_nacht_plan", "neu", nurNochDa), "project-nacht-plan.md");
});

test("ohne Namen zählt nur gleicher Inhalt", () => {
  assert.equal(vorgaengerFinden(manifest, "neu-ohne-name.md", null, "b2", nurNochDa), "alt-ohne-name.md");
  assert.equal(vorgaengerFinden(manifest, "neu-ohne-name.md", null, "anders", nurNochDa), null);
});

test("eine Datei, die es noch gibt, ist kein Vorgänger", () => {
  assert.equal(vorgaengerFinden(manifest, "kopie.md", "noch_da", "x", nurNochDa), null);
});

test("ein anderer Name ist kein Vorgänger", () => {
  assert.equal(vorgaengerFinden(manifest, "x.md", "etwas_anderes", "a1", nurNochDa), null);
});

test("zwei Ordner mit gleicher Datei bekommen verschiedene Quellpfade", () => {
  const a = { files: {} };
  const b = { files: {} };
  assert.notEqual(quellpfad(a, "README.md"), quellpfad(b, "README.md"));
  assert.equal(quellpfad(a, "README.md"), quellpfad(a, "README.md"), "Kennung bleibt je Manifest gleich");
  assert.ok(quellpfad(a, "x/README.md").endsWith("/x/README.md"));
});
