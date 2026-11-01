import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { zerlegen, istMarkdown, fest } from "./ueberschriftenschnitt.js";
import { chunkText } from "./local-embedding.js";

const hier = dirname(fileURLToPath(import.meta.url));
// Dieselbe Datei prüft der Dienst (soviq-platform, services/memory/tests/fixtures).
const { faelle } = JSON.parse(readFileSync(join(hier, "..", "test", "fixtures", "ueberschriftenschnitt_faelle.json"), "utf8"));

test("schneidet wie der Dienst", () => {
  for (const fall of faelle) assert.deepEqual(zerlegen(fall.text), fall.erwartet, fall.name);
});

test("Wortlaut bleibt vollständig", () => {
  for (const fall of faelle) {
    if (fall.text.trim()) assert.equal(zerlegen(fall.text).join(""), fall.text, fall.name);
  }
});

test("ohne Markdown fest wie bisher", () => {
  const text = "Fließtext ohne Gliederung. ".repeat(100);
  assert.equal(istMarkdown(text), false);
  assert.deepEqual(zerlegen(text), fest(text));
});

test("chunkText nutzt den Schnitt, leerer Text bleibt ein leerer Ausschnitt wie bisher", () => {
  const regel = "Die Regel gilt ohne Ausnahme. ".repeat(20);
  const text = `## Eins\n\n${regel}\n\n## Zwei\n\n${regel}`;
  assert.deepEqual(chunkText(text), zerlegen(text));
  assert.ok(chunkText(text)[1].startsWith("## Zwei"));
  assert.deepEqual(chunkText(""), [""]);
});
