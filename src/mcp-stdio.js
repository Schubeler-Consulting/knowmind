/**
 * Lokaler MCP-Stdio-Server — dünner Proxy auf die Knowmind-Plattform.
 *
 * Forwarded JSON-RPC-Requests von stdin an den Remote-MCP-Endpoint
 * (POST {apiUrl}/api/mcp/v1) und schreibt die Antworten auf stdout. Damit kann
 * Knowmind in jeden lokalen MCP-fähigen Client (Claude Code, Claude Desktop,
 * ChatGPT, Cursor, ...) eingebunden werden, ohne dass der Client Bearer-Token
 * kennen muss — der CLI-Wrapper verwaltet die Auth.
 *
 * DESIGN: Seit 0.1.18 ist dieser Server ein reiner Proxy. Tool-Definitionen,
 * Namen (knowmind_recall, knowmind_store_memory, ...), Schemas und
 * Safety-Annotations kommen direkt vom Server (tools/list wird durchgereicht).
 * Dadurch können lokale Definitionen nie mehr vom Server-Stand abweichen —
 * genau diese Abweichung (Punkt- vs. Unterstrich-Namen) hatte 0.1.17 unbrauchbar
 * gemacht, nachdem die Plattform auf das MCP-Namensschema umgestellt wurde.
 *
 * Protokoll: stdio mit zeilenweise JSON (NDJSON-Style). Jedes Frame ist ein
 * vollständiges JSON-RPC-Objekt.
 */
import { loadConfig, VERSION } from "./config.js";
import { createInterface } from "node:readline";

/** Methoden, die lokal beantwortet werden (alles andere geht an den Server). */
const LOCAL_METHODS = new Set(["initialize", "ping"]);

async function forwardToServer(method, params) {
  const { apiUrl, token } = loadConfig();
  if (!token)
    throw new Error("Knowmind: kein Token konfiguriert. `knowmind login` zuerst.");

  const r = await fetch(`${apiUrl}/api/mcp/v1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  let data;
  try {
    data = await r.json();
  } catch {
    // HTTP-Status ohne parsebaren JSON-Body sauber als JSON-RPC-Fehler melden.
    return {
      error: {
        code: r.ok ? -32700 : -32000,
        message: r.ok
          ? "Knowmind-Server lieferte kein gültiges JSON."
          : `Knowmind-Server: HTTP ${r.status}`,
      },
    };
  }
  return data;
}

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

/**
 * Probiert den konfigurierten Token gegen den Server. Liefert
 * { ok: true } oder { ok: false, reason: "..." }. Wird in der
 * `initialize`-Phase aufgerufen, damit der MCP-Client (Claude Code,
 * Codex, Cursor) bei ungültigem Token NICHT „connected ✓" anzeigt,
 * sondern eine klare Fehlermeldung.
 */
async function probeAuth() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    return { ok: false, reason: `Config nicht lesbar: ${e.message}` };
  }
  if (!cfg.token) {
    return {
      ok: false,
      reason:
        "Kein Knowmind-Token konfiguriert. Bitte `knowmind login` im Terminal ausführen.",
    };
  }
  if (!cfg.token.startsWith("kmt_")) {
    return {
      ok: false,
      reason:
        "Konfigurierter Token hat ein ungültiges Format (erwartet: kmt_…). Bitte `knowmind login` neu ausführen.",
    };
  }
  try {
    const r = await fetch(`${cfg.apiUrl}/api/mcp/v1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "knowmind_health", arguments: {} },
      }),
    });
    if (!r.ok) {
      return {
        ok: false,
        reason:
          `Knowmind-Server antwortet mit HTTP ${r.status}. Token wahrscheinlich abgelaufen — bitte "knowmind login" neu ausführen.`,
      };
    }
    const data = await r.json();
    if (data.error) {
      return {
        ok: false,
        reason:
          `Knowmind-Server lehnt Token ab: ${data.error.message ?? "unbekannter Grund"}. Bitte "knowmind login" neu ausführen.`,
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: `Knowmind-Server nicht erreichbar (${cfg.apiUrl}): ${e.message}`,
    };
  }
}

export async function runStdioServer() {
  // Auth einmal am Start prüfen. Das Ergebnis cachen — der MCP-Client
  // soll sofort beim initialize wissen, ob die Verbindung wirklich steht.
  const auth = await probeAuth();
  if (!auth.ok) {
    process.stderr.write(`[knowmind] AUTH-FEHLER: ${auth.reason}\n`);
  }

  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      write({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      continue;
    }
    try {
      // Notifications (kein id-Feld) bekommen per JSON-RPC keine Antwort.
      const isNotification = req.id === undefined && typeof req.method === "string" && req.method.startsWith("notifications/");
      if (isNotification) continue;

      if (!auth.ok && req.method !== "ping") {
        // Initialize (und alles weitere) FEHLSCHLAGEN lassen, damit der
        // MCP-Client „connected" nicht fälschlich anzeigt. Claude Code,
        // Codex und Cursor werten -32001 als harte Connection-Failure.
        write({
          jsonrpc: "2.0",
          id: req.id ?? null,
          error: {
            code: -32001,
            message: `Knowmind nicht verbunden: ${auth.reason}`,
          },
        });
        continue;
      }

      if (LOCAL_METHODS.has(req.method)) {
        if (req.method === "ping") {
          write({ jsonrpc: "2.0", id: req.id ?? null, result: {} });
          continue;
        }
        // initialize
        write({
          jsonrpc: "2.0",
          id: req.id ?? null,
          result: {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "knowmind", version: VERSION },
            capabilities: { tools: {}, prompts: {} },
          },
        });
        continue;
      }

      // Alles andere (tools/list, tools/call, prompts/list, prompts/get, …)
      // geht 1:1 an den Server — Definitionen bleiben dadurch immer synchron.
      const upstream = await forwardToServer(req.method, req.params);
      // Upstream-Response hat eigene jsonrpc/id-Felder — die müssen durch
      // die Client-id ersetzt werden, damit der Client korrekt zuordnet.
      const response = {
        jsonrpc: "2.0",
        id: req.id ?? null,
      };
      if (upstream && typeof upstream === "object" && "result" in upstream) {
        response.result = upstream.result;
      } else if (upstream && typeof upstream === "object" && "error" in upstream) {
        response.error = upstream.error;
      } else {
        response.result = upstream;
      }
      write(response);
    } catch (e) {
      write({
        jsonrpc: "2.0",
        id: req?.id ?? null,
        error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
      });
    }
  }
}
