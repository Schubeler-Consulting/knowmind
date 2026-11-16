/**
 * Aufrufe der Kommandozeile tragen den Kopf X-Knowmind-Herkunft: cli (seit 0.4.9), gegen einen nachgebauten Server.
 * Der Kopf trägt nur die Art des Aufrufs, keine Kennung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { recall, uploadDocument } from "./client.js";

test("recall und upload schicken X-Knowmind-Herkunft: cli", async () => {
  const koepfe = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      koepfe.push(req.headers);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(req.url === "/api/documents"
        ? JSON.stringify({ ok: true })
        : JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "{\"hits\":[]}" }] } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const alt = { api: process.env.KNOWMIND_API_URL, token: process.env.KNOWMIND_TOKEN, modus: process.env.KNOWMIND_EMBED_MODE };
  process.env.KNOWMIND_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.KNOWMIND_TOKEN = "nur-fuer-den-test";
  process.env.KNOWMIND_EMBED_MODE = "server";
  try {
    await recall("Wer stellt den X2D her?");
    await uploadDocument("Titel", "Inhalt");
    assert.equal(koepfe.length, 2);
    for (const k of koepfe) assert.equal(k["x-knowmind-herkunft"], "cli");
  } finally {
    server.close();
    for (const [name, wert] of [["KNOWMIND_API_URL", alt.api], ["KNOWMIND_TOKEN", alt.token], ["KNOWMIND_EMBED_MODE", alt.modus]]) {
      if (wert === undefined) delete process.env[name];
      else process.env[name] = wert;
    }
  }
});
