/**
 * Tests für den Recall-Hook, den `knowmind init` für Claude Code einrichtet.
 *
 * - Voreinstellung: nur dieses Projekt; für alle Projekte (~/.claude) nur mit global (--global oder Wahl im Dialog).
 * - Bei global wird ein Recall-Eintrag im Projekt entfernt, damit je Eingabe ein Abruf läuft.
 * - init sagt, was übertragen wird; --uninstall-hook trägt den Abruf aus.
 * - Der erzeugte Hook selbst, gegen einen nachgebauten Server: Abruf auch bei Eingaben in einer Hülle,
 *   kein Abruf bei Hinweisen des Systems, Stille ohne belastbaren Treffer, „(ungeprüft)“ an unbestätigten
 *   Beziehungen, ein zweiter Versuch nach einem frühen Serverfehler, Kopf X-Knowmind-Herkunft: automatisch.
 * - Gemini CLI (seit 0.4.9): Einrichtung im Projekt und für alle Projekte, Ausgabe als
 *   hookSpecificOutput.additionalContext, --uninstall-hook deckt Gemini mit ab.
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
  const koepfe = [];
  const server = createServer((req, res) => {
    let roh = "";
    req.on("data", (c) => (roh += c));
    req.on("end", () => {
      anfragen.push(JSON.parse(roh));
      koepfe.push(req.headers);
      const naechste = antworten[Math.min(anfragen.length - 1, antworten.length - 1)];
      res.writeHead(naechste.status || 200, { "Content-Type": "application/json" });
      res.end(naechste.body || "");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, anfragen, koepfe);
  } finally {
    server.close();
  }
}

async function hookLauf(home, api, prompt, { hook = join(home, ".claude", "hooks", "knowmind_recall.mjs"), felder = {} } = {}) {
  return await new Promise((resolve) => {
    const p = spawn(process.execPath, [hook], {
      env: { ...process.env, HOME: home, USERPROFILE: home, KNOWMIND_API_URL: api, KNOWMIND_TOKEN: "nur-fuer-den-test" },
    });
    let aus = "";
    p.stdout.on("data", (c) => (aus += c));
    p.on("close", (code) => resolve({ code, aus }));
    p.stdin.end(JSON.stringify({ prompt, session_id: "test", ...felder }));
  });
}

// Eingabe von Gemini CLI für BeforeAgent (https://geminicli.com/docs/hooks/reference/): Basisfelder plus prompt.
const GEMINI = { hook_event_name: "BeforeAgent", cwd: "/tmp/projekt", transcript_path: "", timestamp: "2026-11-16T18:00:00Z" };

async function eingerichtet() {
  const dir = freshDir();
  const home = freshDir();
  await runInit({ client: "claude-code", dryRun: false, cwd: dir, home, global: true });
  return { dir, home };
}

test("Hook: Abruf bei Eingabe, Sitzungsnachricht und Kanal; ungeprüfte Beziehung gekennzeichnet", async () => {
  const { dir, home } = await eingerichtet();
  await mitServer([{ body: antwortMit(TREFFER) }], async (api, anfragen, koepfe) => {
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
    assert.ok(koepfe.every((k) => k["x-knowmind-herkunft"] === "automatisch"));
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
    assert.match(aus, /Abruf ausgetragen \(Claude Code, alle Projekte\)/);
    assert.match(aus, /Abruf ausgetragen \(Claude Code, dieses Projekt\)/);
    assert.match(aus, /Starte Claude Code neu/);
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

// ── Gemini CLI ─────────────────────────────────────────────────────

function geminiEintraege(pfad) {
  const s = JSON.parse(readFileSync(pfad, "utf-8"));
  return ((s.hooks && s.hooks.BeforeAgent) || []).flatMap((g) => g.hooks);
}

test("Gemini: init richtet den Abruf ohne Wahl nur im Projekt ein, idempotent, Fremdes bleibt", async () => {
  const dir = freshDir();
  const home = freshDir();
  mkdirSync(join(dir, ".gemini"));
  writeFileSync(join(dir, ".gemini", "settings.json"), JSON.stringify({ mcpServers: { a: { command: "x" } } }));
  const aus = await runInit({ client: "gemini-cli", dryRun: false, cwd: dir, home });
  assert.ok(existsSync(join(dir, ".gemini", "hooks", "knowmind_recall.mjs")));
  assert.ok(!existsSync(join(home, ".gemini")));
  const pfad = join(dir, ".gemini", "settings.json");
  const [eintrag] = geminiEintraege(pfad);
  assert.deepEqual(
    { name: eintrag.name, type: eintrag.type, command: eintrag.command, timeout: eintrag.timeout },
    { name: "knowmind-recall", type: "command", command: "node .gemini/hooks/knowmind_recall.mjs", timeout: 15000 },
  );
  assert.deepEqual(JSON.parse(readFileSync(pfad, "utf-8")).mcpServers, { a: { command: "x" } });
  assert.match(aus, /Jede Eingabe in Gemini CLI in diesem Projekt wird für den Abruf an \S+ übertragen/);
  assert.match(aus, /nur in vertrauenswürdigen Ordnern/);
  assert.match(aus, /Abschalten: knowmind init --uninstall-hook/);
  // Zweiter Lauf, auch über den Kurznamen: nichts doppelt.
  const zweit = await runInit({ client: "gemini", dryRun: false, cwd: dir, home });
  assert.match(zweit, /\[=\] Gemini-CLI \.gemini\/settings\.json/);
  assert.equal(geminiEintraege(pfad).length, 1);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("Gemini: init global trägt in ~/.gemini ein und nimmt den Projekteintrag heraus", async () => {
  const dir = freshDir();
  const home = freshDir();
  await runInit({ client: "gemini-cli", dryRun: false, cwd: dir, home });
  const projekt = join(dir, ".gemini", "settings.json");
  const s0 = JSON.parse(readFileSync(projekt, "utf-8"));
  s0.hooks.BeforeAgent.push({ hooks: [{ type: "command", command: "node fremd.js" }] });
  writeFileSync(projekt, JSON.stringify(s0));
  const aus = await runInit({ client: "gemini-cli", dryRun: false, cwd: dir, home, global: true });
  assert.match(aus, /in allen Projekten\. Jede Eingabe in Gemini CLI wird für den Abruf an \S+ übertragen/);
  const [global] = geminiEintraege(join(home, ".gemini", "settings.json"));
  const hookPfad = join(home, ".gemini", "hooks", "knowmind_recall.mjs").replace(/\\/g, "/");
  assert.equal(global.command, `node "${hookPfad}"`);
  assert.deepEqual(geminiEintraege(projekt).map((h) => h.command), ["node fremd.js"]);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("Gemini: auto erkennt Gemini CLI und richtet es mit ein", async () => {
  const dir = freshDir();
  const home = freshDir();
  mkdirSync(join(home, ".gemini"));
  writeFileSync(join(home, ".gemini", "settings.json"), "{}");
  const aus = await runInit({ client: "auto", dryRun: false, cwd: dir, home });
  assert.match(aus, /Erkannter Client: gemini-cli/);
  assert.equal(geminiEintraege(join(dir, ".gemini", "settings.json")).length, 1);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("Gemini: Hook gibt Treffer als additionalContext aus, mit Herkunft; ohne Treffer und bei Hinweisen still", async () => {
  const dir = freshDir();
  const home = freshDir();
  await runInit({ client: "gemini-cli", dryRun: false, cwd: dir, home, global: true });
  const hook = join(home, ".gemini", "hooks", "knowmind_recall.mjs");
  await mitServer([{ body: antwortMit(TREFFER) }], async (api, anfragen, koepfe) => {
    const { code, aus } = await hookLauf(home, api, "Wer stellt den X2D für Müller her?", { hook, felder: GEMINI });
    assert.equal(code, 0);
    assert.ok(/^[\x00-\x7f]*$/.test(aus), "reines ASCII");
    const o = JSON.parse(aus);
    assert.equal(o.hookSpecificOutput.hookEventName, "BeforeAgent");
    assert.match(o.hookSpecificOutput.additionalContext, /Beziehung: Bambu Lab X2D hergestellt von: Bambu Lab\n/);
    assert.match(o.hookSpecificOutput.additionalContext, /Agenten-Setup-Kurs baut auf: Lernardo \(ungeprüft\)/);
    assert.equal(anfragen[0].params.arguments.query, "Wer stellt den X2D für Müller her?");
    assert.equal(koepfe[0]["x-knowmind-herkunft"], "automatisch");
    assert.deepEqual(await hookLauf(home, api, "<system-reminder>Zeit</system-reminder>", { hook, felder: GEMINI }),
      { code: 0, aus: "" });
    assert.equal(anfragen.length, 1);
  });
  await mitServer([{ body: antwortMit({ ...TREFFER, kein_belastbarer_treffer: true }) }], async (api) => {
    assert.deepEqual(await hookLauf(home, api, "Welche Leistungen bietet die Firma an?", { hook, felder: GEMINI }),
      { code: 0, aus: "" });
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("Gemini: Projektkopie tritt neben dem Eintrag für alle Projekte zurück; --uninstall-hook trägt Gemini aus", async () => {
  const dir = freshDir();
  const home = freshDir();
  await runInit({ client: "gemini-cli", dryRun: false, cwd: dir, home });                      // Projekt
  await runInit({ client: "gemini-cli", dryRun: false, cwd: freshDir(), home, global: true }); // alle Projekte
  const projektHook = join(dir, ".gemini", "hooks", "knowmind_recall.mjs");
  await mitServer([{ body: antwortMit(TREFFER) }], async (api, anfragen) => {
    await hookLauf(home, api, "Wer stellt den X2D her?", { hook: projektHook, felder: GEMINI });
    assert.equal(anfragen.length, 0, "Projektkopie tritt neben dem globalen Eintrag zurück");
    const aus = runUninstallHook({ cwd: dir, home });
    assert.match(aus, /Abruf ausgetragen \(Gemini CLI, alle Projekte\)/);
    assert.match(aus, /Abruf ausgetragen \(Gemini CLI, dieses Projekt\)/);
    assert.match(aus, /Starte Gemini CLI neu/);
    assert.equal(JSON.parse(readFileSync(join(home, ".gemini", "settings.json"), "utf-8")).hooks.BeforeAgent, undefined);
    assert.equal(JSON.parse(readFileSync(join(dir, ".gemini", "settings.json"), "utf-8")).hooks.BeforeAgent, undefined);
    await hookLauf(home, api, "Wer stellt den X2D her?", { hook: projektHook, felder: GEMINI });
    assert.equal(anfragen.length, 1);
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

// ── Codex (seit 0.4.10) ────────────────────────────────────────────
// Eingabe von Codex für UserPromptSubmit (learn.chatgpt.com/docs/hooks): wie Claude Code plus turn_id und model.
const CODEX = { hook_event_name: "UserPromptSubmit", cwd: "/tmp/projekt", turn_id: "t1", model: "gpt", permission_mode: "default" };

function codexEintraege(pfad) {
  const s = JSON.parse(readFileSync(pfad, "utf-8"));
  return ((s.hooks && s.hooks.UserPromptSubmit) || []).flatMap((g) => g.hooks);
}

test("Codex: init richtet Abruf und AGENTS.md im Projekt ein, idempotent, nennt die Freigabe mit /hooks", async () => {
  const dir = freshDir();
  const home = freshDir();
  const aus = await runInit({ client: "codex", dryRun: false, cwd: dir, home });
  assert.ok(existsSync(join(dir, "AGENTS.md")));
  assert.ok(existsSync(join(dir, ".codex", "hooks", "knowmind_recall.mjs")));
  assert.ok(!existsSync(join(home, ".codex")));
  const pfad = join(dir, ".codex", "hooks.json");
  assert.deepEqual(codexEintraege(pfad), [{ type: "command", command: "node .codex/hooks/knowmind_recall.mjs", timeout: 15 }]);
  assert.match(aus, /Jede Eingabe in Codex in diesem Projekt wird für den Abruf an \S+ übertragen/);
  assert.match(aus, /in Codex \/hooks aufrufen/);
  const zweit = await runInit({ client: "codex", dryRun: false, cwd: dir, home });
  assert.match(zweit, /\[=\] Codex \.codex\/hooks\.json/);
  assert.equal(codexEintraege(pfad).length, 1);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("Codex: global trägt in ~/.codex ein, Projekteintrag fällt weg; Hook gibt Klartext; --uninstall-hook trägt aus", async () => {
  const dir = freshDir();
  const home = freshDir();
  await runInit({ client: "codex", dryRun: false, cwd: dir, home });
  const projekt = join(dir, ".codex", "hooks.json");
  const s0 = JSON.parse(readFileSync(projekt, "utf-8"));
  s0.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command: "node fremd.js" }] });
  writeFileSync(projekt, JSON.stringify(s0));
  await runInit({ client: "codex", dryRun: false, cwd: dir, home, global: true });
  const hookPfad = join(home, ".codex", "hooks", "knowmind_recall.mjs");
  assert.deepEqual(codexEintraege(join(home, ".codex", "hooks.json")).map((h) => h.command),
    [`node "${hookPfad.replace(/\\/g, "/")}"`]);
  assert.deepEqual(codexEintraege(projekt).map((h) => h.command), ["node fremd.js"]);
  await mitServer([{ body: antwortMit(TREFFER) }], async (api, anfragen, koepfe) => {
    const { code, aus } = await hookLauf(home, api, "Wer stellt den X2D her?", { hook: hookPfad, felder: CODEX });
    assert.equal(code, 0);
    assert.match(aus, /knowmind RECALL \(auto\)/);
    assert.ok(!aus.trimStart().startsWith("{"), "Codex bekommt Klartext");
    assert.equal(koepfe[0]["x-knowmind-herkunft"], "automatisch");
    const ab = runUninstallHook({ cwd: dir, home });
    assert.match(ab, /Abruf ausgetragen \(Codex, alle Projekte\)/);
    assert.equal(JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf-8")).hooks.UserPromptSubmit, undefined);
    assert.deepEqual(codexEintraege(projekt).map((h) => h.command), ["node fremd.js"], "fremder Hook bleibt");
    assert.equal(anfragen.length, 1);
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});
