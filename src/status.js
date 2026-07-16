/**
 * knowmind status — sichtbares Lebenszeichen des Gedächtnisses.
 *
 * Zwei Ausgaben:
 *   renderFull()  → mehrzeilig, menschenlesbar (`knowmind status`)
 *   renderLine()  → einzeilig, gefärbt, für die Statusline eines KI-Werkzeugs
 *                   (`knowmind status --line`, z. B. Claude-Code statusLine)
 *
 * Die Statusline wird oft gerendert und darf NIE blockieren. Deshalb:
 *   - Erreichbarkeit + Erinnerungszahl liegen in Cache-Dateien unter ~/.knowmind.
 *   - Ist der Cache abgelaufen, wird ein LOSGELÖSTER Hintergrund-Probe gestartet
 *     (`knowmind status --probe`), der den Cache auffrischt (stale-while-revalidate).
 *   - Läuft knowmind gerade (Recall in den letzten Sekunden — der init-Recall-Hook
 *     stempelt ~/.knowmind/activity), blinkt die Anzeige.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { health, stats } from "./client.js";

const KM_DIR = join(homedir(), ".knowmind");
const HEALTH_CACHE = join(KM_DIR, "status-health.json");
const COUNT_CACHE = join(KM_DIR, "status-count.json");
const ACTIVITY = join(KM_DIR, "activity");

const HEALTH_TTL_OK = 30_000; // erreichbar → alle 30 s neu prüfen
const HEALTH_TTL_FAIL = 15_000; // gestört → alle 15 s (schnellere Erholung)
const PROBE_GUARD = 12_000; // kein zweiter Hintergrund-Probe innerhalb 12 s
const COUNT_TTL = 900_000; // Erinnerungszahl: 15 min
const ACTIVE_MS = 15_000; // Recall jünger als 15 s → „arbeitet"

// ANSI (dezent). NO_COLOR respektieren.
const useColor = !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `[${code}m${s}[0m` : s);
const green = (s) => c("32", s);
const brightGreen = (s) => c("92", s);
const dimGreen = (s) => c("2;32", s);
const red = (s) => c("31", s);
const dim = (s) => c("2", s);
const kmBlue = (s) => c("38;5;111", s); // ≈ knowmind-Blau #6ea8ff (Session-Akzent)

/** Abgerufene Erinnerungen in DIESER Claude-Code-Session (null wenn keine). */
function sessionRecalls(sessionId) {
  if (!sessionId) return null;
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  const data = readJson(join(KM_DIR, "sessions", safe + ".json"));
  return data && data.memories > 0 ? data.memories : null;
}

/**
 * Grüne Festplatten-LED: bei Aktivität flackert das ●-Zeichen unregelmäßig
 * zwischen hell- und dunkelgrün (nicht im gleichmäßigen Takt). Die Statusline
 * wird bei Arbeit häufig neu gerendert — das bit-gemischte Zeit-Muster erzeugt
 * dabei das nervöse HDD-Flackern statt eines sauberen Blinkens.
 */
function flickerLed() {
  const t = Date.now();
  const on = (((t >> 6) ^ (t >> 4) ^ (t >> 8)) & 1) === 1;
  return on ? brightGreen("●") : dimGreen("●");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function writeJson(path, obj) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(obj), "utf-8");
  } catch {
    /* best effort */
  }
}

function fmtCount(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Sekunden-genaue mtime von ~/.knowmind/activity (0 wenn nicht vorhanden). */
function activityAgeMs() {
  try {
    return Date.now() - statSync(ACTIVITY).mtimeMs;
  } catch {
    return Infinity;
  }
}

/** Stempelt den Aktivitäts-Zeitpunkt. Wird vom Recall-Hook aufgerufen. */
export function markActivity() {
  try {
    mkdirSync(KM_DIR, { recursive: true });
    writeFileSync(ACTIVITY, String(Date.now()), "utf-8");
  } catch {
    /* best effort */
  }
}

/** Interner Probe-Modus: Health + Zahl frisch holen, Cache schreiben. */
export async function probe() {
  const t0 = Date.now();
  try {
    const h = await health();
    const ok = String(h?.status ?? "").toLowerCase() === "ok";
    const prev = readJson(HEALTH_CACHE) || {};
    writeJson(HEALTH_CACHE, {
      ts: Date.now(),
      ok,
      latencyMs: Date.now() - t0,
      downSince: ok ? null : prev.downSince || Date.now(),
      probing: 0,
    });
    if (ok) {
      try {
        const s = await stats();
        const n = s?.memories ?? s?.memory_count ?? s?.count ?? null;
        if (n != null) writeJson(COUNT_CACHE, { ts: Date.now(), count: Number(n) });
      } catch {
        /* Zahl ist optional */
      }
    }
  } catch {
    const prev = readJson(HEALTH_CACHE) || {};
    writeJson(HEALTH_CACHE, {
      ts: Date.now(),
      ok: false,
      latencyMs: 0,
      downSince: prev.downSince || Date.now(),
      probing: 0,
    });
  }
}

/** Losgelösten Hintergrund-Probe starten (blockiert die Statusline nie). */
function spawnProbe() {
  try {
    const self = fileURLToPath(new URL("../bin/knowmind.js", import.meta.url));
    const child = spawn(process.execPath, [self, "status", "--probe"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    /* best effort */
  }
}

/** Erreichbarkeits-Zustand aus Cache; stößt bei Ablauf einen Refresh an. */
function healthState() {
  const cache = readJson(HEALTH_CACHE);
  const now = Date.now();
  if (!cache) {
    // Allererster Aufruf: einmal im Hintergrund prüfen, vorerst „unbekannt".
    spawnProbe();
    return { ok: null, ts: 0 };
  }
  const ttl = cache.ok ? HEALTH_TTL_OK : HEALTH_TTL_FAIL;
  if (now - (cache.ts || 0) > ttl && now - (cache.probing || 0) > PROBE_GUARD) {
    cache.probing = now;
    writeJson(HEALTH_CACHE, cache);
    spawnProbe();
  }
  return cache;
}

function hhmm(ts) {
  try {
    return new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "?";
  }
}

/** Einzeilige Statusline-Ausgabe. Flackert bei Aktivität, erholt sich selbst.
 *  sessionId (optional): zeigt „N abgerufen" für die laufende Claude-Code-Sitzung. */
export function renderLine(sessionId) {
  if (!loadConfig().token && !process.env.KNOWMIND_TOKEN) {
    return dim("○ knowmind · nicht angemeldet");
  }
  const h = healthState();
  const sep = " " + dim("·") + " ";

  if (h.ok === false) {
    const since = h.downSince ? ` (seit ${hhmm(h.downSince)})` : "";
    return `${red("●")} ${dim(`knowmind · nicht erreichbar${since}`)}`;
  }
  if (h.ok == null) {
    return `${dimGreen("●")} ${dim("knowmind · prüfe …")}`;
  }
  // Session-Zähler = Lebenszeichen dieser Sitzung (knowmind-Blau, auffällig).
  const sess = sessionRecalls(sessionId);
  const sessTxt = sess ? kmBlue(`${fmtCount(sess)} abgerufen`) : null;

  // erreichbar: bei Aktivität grünes HDD-Flackern, sonst ruhig leuchtend grün
  if (activityAgeMs() <= ACTIVE_MS) {
    return `${flickerLed()} ${dim("knowmind arbeitet")}` + (sessTxt ? sep + sessTxt : "");
  }
  let tail = sessTxt;
  if (!tail) {
    const cnt = readJson(COUNT_CACHE);
    tail = cnt?.count != null ? dim(`${fmtCount(cnt.count)} gespeichert`) : null;
  }
  return `${green("●")} ${dim("knowmind")}` + (tail ? sep + tail : "");
}

/** Mehrzeilige, menschenlesbare Ausgabe (`knowmind status`). */
export async function renderFull() {
  if (!loadConfig().token && !process.env.KNOWMIND_TOKEN) {
    return "knowmind: nicht angemeldet — `knowmind login --token kmt_…` ausführen.";
  }
  const t0 = Date.now();
  try {
    const h = await health();
    const ok = String(h?.status ?? "").toLowerCase() === "ok";
    const ms = Date.now() - t0;
    if (!ok) return red("● knowmind nicht erreichbar.");
    let line = green("● knowmind erreichbar") + dim(` · ${ms} ms`);
    try {
      const s = await stats();
      const n = s?.memories ?? s?.memory_count ?? s?.count;
      const e = s?.edges;
      if (n != null) line += `\n  Erinnerungen: ${fmtCount(Number(n))}`;
      if (e != null) line += `\n  Beziehungen:  ${fmtCount(Number(e))}`;
      if (s?.memoryLimit != null) line += dim(`\n  Tarif-Limit:  ${fmtCount(Number(s.memoryLimit))}`);
    } catch {
      /* Zahl optional */
    }
    // Cache gleich mitschreiben, damit die Statusline sofort frisch ist.
    await probe();
    return line;
  } catch (e) {
    return red(`● knowmind nicht erreichbar: ${e.message}`);
  }
}
