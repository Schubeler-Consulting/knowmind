/**
 * Tests für `knowmind init` — Schwerpunkt Idempotenz & Client-Erkennung.
 * Läuft mit `node --test`. Keine Netz-/Server-Zugriffe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit, _internals } from "./init.js";

const { upsertMarkedBlock, writeOwnFile, ensureClaudeHookEntry, detectClients, BEGIN, END } = _internals;

function freshDir() {
  return mkdtempSync(join(tmpdir(), "knowmind-init-test-"));
}

test("upsertMarkedBlock: create / replace / idempotent", () => {
  const dir = freshDir();
  const f = join(dir, "CLAUDE.md");

  const a = upsertMarkedBlock(f, `${BEGIN}\nv1\n${END}`);
  assert.equal(a.action, "create");
  writeFileSync(f, a.content);

  // Bestehende fremde Inhalte + Block anhängen
  writeFileSync(f, "# Mein Projekt\n\nEigener Text.\n");
  const b = upsertMarkedBlock(f, `${BEGIN}\nv1\n${END}`);
  assert.equal(b.action, "append");
  assert.match(b.content, /Eigener Text/);
  assert.match(b.content, /v1/);
  writeFileSync(f, b.content);

  // Zweiter identischer Lauf -> unchanged (KEIN Duplikat)
  const c = upsertMarkedBlock(f, `${BEGIN}\nv1\n${END}`);
  assert.equal(c.action, "unchanged");
  const occurrences = (b.content.match(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  assert.equal(occurrences, 1);

  // Geänderter Block -> replace, immer noch nur EIN Block
  const d = upsertMarkedBlock(f, `${BEGIN}\nv2\n${END}`);
  assert.equal(d.action, "replace");
  assert.match(d.content, /v2/);
  assert.doesNotMatch(d.content, /v1/);
  assert.match(d.content, /Eigener Text/);

  rmSync(dir, { recursive: true, force: true });
});

test("writeOwnFile: fremde Datei ohne Marker wird NICHT überschrieben", () => {
  const dir = freshDir();
  const f = join(dir, "hook.mjs");
  writeFileSync(f, "// fremder Hook ohne Marker\n");
  const r = writeOwnFile(f, "neuer Inhalt mit MARKER", "MARKER");
  assert.equal(r.action, "skip-foreign");

  const f2 = join(dir, "neu.mjs");
  const r2 = writeOwnFile(f2, "MARKER inhalt", "MARKER");
  assert.equal(r2.action, "create");
  rmSync(dir, { recursive: true, force: true });
});

test("ensureClaudeHookEntry: idempotent, kein doppelter Eintrag", () => {
  const settings = {};
  const m1 = ensureClaudeHookEntry(settings, "UserPromptSubmit", ".claude/hooks/knowmind_recall.mjs");
  assert.equal(m1, true);
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);

  const m2 = ensureClaudeHookEntry(settings, "UserPromptSubmit", ".claude/hooks/knowmind_recall.mjs");
  assert.equal(m2, false);
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);
});

test("ensureClaudeHookEntry: respektiert bestehende fremde Hooks", () => {
  const settings = {
    hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "node fremd.js" }] }] },
  };
  ensureClaudeHookEntry(settings, "UserPromptSubmit", ".claude/hooks/knowmind_recall.mjs");
  assert.equal(settings.hooks.UserPromptSubmit.length, 2);
  // fremder Hook unangetastet
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, "node fremd.js");
});

test("detectClients erkennt .claude und .cursor im Projekt", () => {
  const dir = freshDir();
  const home = freshDir();
  assert.deepEqual(detectClients(dir, home), []);
  mkdirSync(join(dir, ".claude"));
  assert.deepEqual(detectClients(dir, home), ["claude-code"]);
  mkdirSync(join(dir, ".cursor"));
  assert.deepEqual(detectClients(dir, home).sort(), ["claude-code", "cursor"]);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("runInit --dry-run schreibt nichts", async () => {
  const dir = freshDir();
  const home = freshDir();
  mkdirSync(join(dir, ".claude"));
  const out = await runInit({ client: "claude-code", dryRun: true, cwd: dir, home });
  assert.match(out, /dry-run/i);
  assert.equal(existsSync(join(dir, ".claude", "hooks", "knowmind_recall.mjs")), false);
  assert.equal(existsSync(join(dir, "CLAUDE.md")), false);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("runInit echter Lauf + zweiter Lauf = idempotent", async () => {
  const dir = freshDir();
  const home = freshDir();
  mkdirSync(join(dir, ".claude"));

  await runInit({ client: "claude-code", dryRun: false, cwd: dir, home });
  const recall = join(dir, ".claude", "hooks", "knowmind_recall.mjs");
  const capture = join(dir, ".claude", "hooks", "knowmind_capture.mjs");
  const settingsPath = join(dir, ".claude", "settings.json");
  const claudeMd = join(dir, "CLAUDE.md");
  assert.ok(existsSync(recall));
  assert.ok(existsSync(capture));
  assert.ok(existsSync(settingsPath));
  assert.ok(existsSync(claudeMd));

  const settings1 = JSON.parse(readFileSync(settingsPath, "utf-8"));
  assert.equal(settings1.hooks.UserPromptSubmit.length, 1);
  assert.equal(settings1.hooks.Stop.length, 1);

  const md1 = readFileSync(claudeMd, "utf-8");
  const beginCount1 = (md1.match(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  assert.equal(beginCount1, 1);

  // Zweiter Lauf
  await runInit({ client: "claude-code", dryRun: false, cwd: dir, home });
  const settings2 = JSON.parse(readFileSync(settingsPath, "utf-8"));
  assert.equal(settings2.hooks.UserPromptSubmit.length, 1, "kein doppelter UserPromptSubmit-Hook");
  assert.equal(settings2.hooks.Stop.length, 1, "kein doppelter Stop-Hook");

  const md2 = readFileSync(claudeMd, "utf-8");
  const beginCount2 = (md2.match(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  assert.equal(beginCount2, 1, "kein doppelter Memory-First-Block");

  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("runInit cursor schreibt .mdc-Regel", async () => {
  const dir = freshDir();
  const home = freshDir();
  await runInit({ client: "cursor", dryRun: false, cwd: dir, home });
  const mdc = join(dir, ".cursor", "rules", "knowmind.mdc");
  assert.ok(existsSync(mdc));
  const txt = readFileSync(mdc, "utf-8");
  assert.match(txt, /alwaysApply: true/);
  assert.match(txt, /knowmind_recall/);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("runInit generic gibt manuellen Snippet aus, schreibt nichts", async () => {
  const dir = freshDir();
  const home = freshDir();
  const out = await runInit({ client: "generic", dryRun: false, cwd: dir, home });
  assert.match(out, /Memory-First/i);
  assert.match(out, /MCP-instructions/);
  assert.equal(existsSync(join(dir, "CLAUDE.md")), false);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});
