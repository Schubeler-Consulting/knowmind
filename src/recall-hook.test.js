/**
 * Tests für den Recall-Hook, den `knowmind init` für Claude Code einrichtet.
 *
 * - Voreinstellung: nur dieses Projekt; für alle Projekte (~/.claude) nur mit global (--global oder Wahl im Dialog).
 * - Bei global wird ein Recall-Eintrag im Projekt entfernt, damit je Eingabe ein Abruf läuft.
 * - init sagt, was übertragen wird; --uninstall-hook trägt den Abruf aus.
 * - Der erzeugte Hook selbst, gegen einen nachgebauten Server: Abruf auch bei Eingaben in einer Hülle,
 *   kein Abruf bei Hinweisen des Systems, Stille ohne belastbaren Treffer, „(ungeprüft)“ an unbestätigten
 *   Beziehungen, ein zweiter Versuch nach einem frühen Serverfehler.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { runInit, runUninstallHook } from "./init.js";

function freshDir() {
  return mkdtempSync(join(tmpdir(), "knowmind-recall-test-"));
}

test("init richtet den Recall ohne Wahl nur im Projekt ein und sagt, was übertragen wird", async () => {
  const dir = freshDir();
  const home = freshDir();
  mkdirSync(join(dir, ".claude"));
  const aus = await runInit({ client: "claude-code", dryRun: false, cwd: dir, home });
  assert.ok(existsSync(join(dir, ".claude", "hooks", "knowmind_recall.mjs")));
  assert.ok(!existsSync(join(home, ".claude", "hooks", "knowmind_recall.mjs")));
  const s = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf-8"));
  assert.equal(s.hooks.UserPromptSubmit.length, 1);
  assert.match(aus, /Jede Eingabe in Claude Code in diesem Projekt wird für den Abruf an \S+ übertragen/);
  assert.match(aus, /Abschalten: knowmind init --uninstall-hook/);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("init global nimmt den Recall-Eintrag aus dem Projekt und sagt es", async () => {
  const dir = freshDir();
  const home = freshDir();
  mkdirSync(join(dir, ".claude"));
  await runInit({ client: "claude-code", dryRun: false, cwd: dir, home });
  // Fremder Hook im selben Event bleibt stehen.
  const pfad = join(dir, ".claude", "settings.json");
  const s0 = JSON.parse(readFileSync(pfad, "utf-8"));
  s0.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command: "node fremd.js" }] });
  writeFileSync(pfad, JSON.stringify(s0));
  const aus = await runInit({ client: "claude-code", dryRun: false, cwd: dir, home, global: true });
  assert.match(aus, /in allen Projekten\. Jede Eingabe in Claude Code wird für den Abruf an \S+ übertragen/);
  const s = JSON.parse(readFileSync(pfad, "utf-8"));
  assert.equal(s.hooks.UserPromptSubmit.length, 1);
  assert.equal(s.hooks.UserPromptSubmit[0].hooks[0].command, "node fremd.js");
  const h = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf-8"));
  assert.equal(h.hooks.UserPromptSubmit.length, 1);
  // Die Projektkopie trägt die neue Fassung und tritt neben der globalen zurück.
  assert.match(readFileSync(join(dir, ".claude", "hooks", "knowmind_recall.mjs"), "utf-8"), /projektKopieNebenGlobaler/);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

// ── Der erzeugte Hook gegen einen nachgebauten Server ──────────────

function antwortMit(daten) {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(daten) }] } });
}

const TREFFER = {
  kein_belastbarer_treffer: false,
  hits: [
    { content: "Bambu Lab", source: "relationship",
      metadata: { rel_satz: "Bambu Lab X2D hergestellt von: Bambu Lab", rel_geprueft: true } },
    { content: "Lernardo", source: "relationship",
      metadata: { rel_satz: "Agenten-Setup-Kurs baut auf: Lernardo", rel_geprueft: false } },
    { content: "Der X2D steht im Büro.", score: 0.8, metadata: { title: "3D-Druck" } },
  ],
};

async function mitServer(antworten, fn) {
  const anfragen = [];
  const server = createServer((req, res) => {
    let roh = "";
    req.on("data", (c) => (roh += c));
    req.on("end", () => {
      anfragen.push(JSON.parse(roh));
      const naechste = antworten[Math.min(anfragen.length - 1, antworten.length - 1)];
      res.writeHead(naechste.status || 200, { "Content-Type": "application/json" });
      res.end(naechste.body || "");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, anfragen);
  } finally {
    server.close();
  }
}

async function hookLauf(home, api, prompt) {
  const hook = join(home, ".claude", "hooks", "knowmind_recall.mjs");
  return await new Promise((resolve) => {
    const p = spawn(process.execPath, [hook], {
      env: { ...process.env, HOME: home, USERPROFILE: home, KNOWMIND_API_URL: api, KNOWMIND_TOKEN: "nur-fuer-den-test" },
    });
    let aus = "";
    p.stdout.on("data", (c) => (aus += c));
    p.on("close", (code) => resolve({ code, aus }));
    p.stdin.end(JSON.stringify({ prompt, session_id: "test" }));
  });
}

async function eingerichtet() {
  const dir = freshDir();
  const home = freshDir();
  await runInit({ client: "claude-code", dryRun: false, cwd: dir, home, global: true });
  return { dir, home };
}

test("Hook: Abruf bei Eingabe, Sitzungsnachricht und Kanal; ungeprüfte Beziehung gekennzeichnet", async () => {
  const { dir, home } = await eingerichtet();
  await mitServer([{ body: antwortMit(TREFFER) }], async (api, anfragen) => {
    const eingaben = [
      "Angebot für Müller schreiben",
      '<cross-session-message from="uds:x" from-name="Orchestrator">Wer stellt den X2D her?</cross-session-message>',
      '<channel source="telegram" chat_id="1" message_id="2">Wer stellt den X2D her?</channel>',
    ];
    for (const e of eingaben) {
      const { code, aus } = await hookLauf(home, api, e);
      assert.equal(code, 0);
      assert.match(aus, /Beziehung: Bambu Lab X2D hergestellt von: Bambu Lab\n/);
      assert.match(aus, /Agenten-Setup-Kurs baut auf: Lernardo \(ungeprüft\)/);
    }
    assert.equal(anfragen.length, 3);
    assert.equal(anfragen[0].params.arguments.query, "Angebot für Müller schreiben");
    assert.equal(anfragen[1].params.arguments.query, "Wer stellt den X2D her?");
    assert.equal(anfragen[2].params.arguments.query, "Wer stellt den X2D her?");
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("Hook: Hinweise des Systems und Kurzes ohne Abruf, ohne belastbaren Treffer still", async () => {
  const { dir, home } = await eingerichtet();
  await mitServer([{ body: antwortMit({ ...TREFFER, kein_belastbarer_treffer: true }) }], async (api, anfragen) => {
    for (const e of ["<task-notification><status>completed</status></task-notification>",
      "<system-reminder>Aktuelle Zeit</system-reminder>", "ok", "/woche zeigen"]) {
      assert.deepEqual(await hookLauf(home, api, e), { code: 0, aus: "" });
    }
    assert.equal(anfragen.length, 0);
    assert.deepEqual(await hookLauf(home, api, "Welche Leistungen bietet die Firma an?"), { code: 0, aus: "" });
    assert.equal(anfragen.length, 1);
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("Hook: zweiter Versuch nach frühem Serverfehler, nie blockiert", async () => {
  const { dir, home } = await eingerichtet();
  await mitServer([{ status: 502, body: "Bad Gateway" }, { body: antwortMit(TREFFER) }], async (api, anfragen) => {
    const { code, aus } = await hookLauf(home, api, "Wer stellt den X2D her?");
    assert.equal(code, 0);
    assert.equal(anfragen.length, 2);
    assert.match(aus, /Bambu Lab/);
  });
  // Server weg: still, Rückgabe 0.
  const { code, aus } = await hookLauf(home, "http://127.0.0.1:9", "Wer stellt den X2D her?");
  assert.deepEqual({ code, aus }, { code: 0, aus: "" });
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("--uninstall-hook trägt den Abruf aus; die Projektkopie tritt nur neben einem Eintrag zurück", async () => {
  const dir = freshDir();
  const home = freshDir();
  mkdirSync(join(dir, ".claude"));
  await runInit({ client: "claude-code", dryRun: false, cwd: dir, home });              // Projekt
  await runInit({ client: "claude-code", dryRun: false, cwd: freshDir(), home, global: true }); // alle Projekte
  const projektHook = join(dir, ".claude", "hooks", "knowmind_recall.mjs");
  await mitServer([{ body: antwortMit(TREFFER) }], async (api, anfragen) => {
    const lauf = (hook) => new Promise((resolve) => {
      const p = spawn(process.execPath, [hook], {
        env: { ...process.env, HOME: home, USERPROFILE: home, KNOWMIND_API_URL: api, KNOWMIND_TOKEN: "t" },
      });
      p.on("close", resolve);
      p.stdin.end(JSON.stringify({ prompt: "Wer stellt den X2D her?" }));
    });
    await lauf(projektHook);
    assert.equal(anfragen.length, 0, "Projektkopie tritt neben dem globalen Eintrag zurück");
    const aus = runUninstallHook({ cwd: dir, home });
    assert.match(aus, /Abruf ausgetragen \(alle Projekte\)/);
    assert.match(aus, /Abruf ausgetragen \(dieses Projekt\)/);
    const h = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf-8"));
    const s = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf-8"));
    assert.equal(h.hooks.UserPromptSubmit, undefined);
    assert.equal(s.hooks.UserPromptSubmit, undefined);
    assert.equal(s.hooks.Stop.length, 1, "andere Hooks bleiben");
    // Ohne globalen Eintrag tritt die Projektkopie nicht mehr zurück (falls jemand sie von Hand einträgt).
    await lauf(projektHook);
    assert.equal(anfragen.length, 1);
    assert.match(runUninstallHook({ cwd: dir, home }), /nichts zu tun/);
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});
