// Gezieltes Umschreiben des knowmind-Eintrags in Konfigurationsdateien der
// KI-Clients, ohne den Rest der Datei anzufassen.
//
// WARUM (16.10.2026): install las die Datei mit JSON.parse und schrieb sie mit
// JSON.stringify zurück. Damit änderten sich Einrückung, Zeilenenden und
// Schreibweise aller fremden Einträge, und eine Datei mit Kommentaren (VS Code,
// Zed) wurde gar nicht erst gelesen. Hier wird nur der Textbereich des eigenen
// Eintrags ersetzt oder eingefügt; jedes andere Byte bleibt, wie es war.
//
// Gelesen wird JSON mit Kommentaren und Komma vor der schließenden Klammer
// (JSONC), wie VS Code und Zed es schreiben.

/** Liest JSONC und liefert einen Baum mit Textpositionen. Wirft bei Fehlern. */
export function jsoncLesen(text) {
  let i = 0;
  const fehler = (was) => {
    throw new Error(`${was} an Stelle ${i}`);
  };
  const leer = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text.startsWith("//", i)) {
        while (i < text.length && text[i] !== "\n") i++;
      } else if (text.startsWith("/*", i)) {
        const e = text.indexOf("*/", i + 2);
        if (e < 0) fehler("Kommentar ohne Ende");
        i = e + 2;
      } else return;
    }
  };
  const zeichenkette = () => {
    if (text[i] !== '"') fehler("Zeichenkette erwartet");
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    if (i >= text.length) fehler("Zeichenkette ohne Ende");
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const wert = () => {
    leer();
    const start = i;
    const c = text[i];
    if (c === "{") {
      i++;
      const glieder = [];
      for (;;) {
        leer();
        if (text[i] === "}") break;
        const nameStart = i;
        const name = zeichenkette();
        leer();
        if (text[i] !== ":") fehler("Doppelpunkt erwartet");
        i++;
        const w = wert();
        glieder.push({ name, nameStart, wert: w });
        leer();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] !== "}") fehler("Komma oder } erwartet");
      }
      i++;
      return { art: "objekt", start, ende: i, glieder };
    }
    if (c === "[") {
      i++;
      const elemente = [];
      for (;;) {
        leer();
        if (text[i] === "]") break;
        elemente.push(wert());
        leer();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] !== "]") fehler("Komma oder ] erwartet");
      }
      i++;
      return { art: "liste", start, ende: i, elemente };
    }
    if (c === '"') {
      zeichenkette();
      return { art: "wert", start, ende: i };
    }
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!m) fehler("Wert erwartet");
    i += m[0].length;
    return { art: "wert", start, ende: i };
  };
  const wurzel = wert();
  leer();
  if (i !== text.length) fehler("Text nach dem Ende");
  return wurzel;
}

/** Wert eines Knotens als JavaScript-Wert (Kommentare entfernt). */
export function knotenWert(text, knoten) {
  if (knoten.art === "objekt") {
    return Object.fromEntries(knoten.glieder.map((g) => [g.name, knotenWert(text, g.wert)]));
  }
  if (knoten.art === "liste") return knoten.elemente.map((e) => knotenWert(text, e));
  return JSON.parse(text.slice(knoten.start, knoten.ende));
}

const zeilenende = (text) => (text.includes("\r\n") ? "\r\n" : "\n");

function einzugVor(text, pos) {
  const zeilenStart = text.lastIndexOf("\n", pos - 1) + 1;
  const m = /^[ \t]*/.exec(text.slice(zeilenStart, pos));
  return m ? m[0] : "";
}

function schreibweise(wert, basis, eol) {
  return JSON.stringify(wert, null, 2).split("\n").join(eol + basis);
}

/** Fügt `"name": wert` als letztes Glied in ein Objekt ein. */
function gliedHinzu(text, objekt, name, wert, eol) {
  const basis = einzugVor(text, objekt.start);
  if (objekt.glieder.length === 0) {
    const innen = basis + "  ";
    const neu = `{${eol}${innen}${JSON.stringify(name)}: ${schreibweise(wert, innen, eol)}${eol}${basis}}`;
    return text.slice(0, objekt.start) + neu + text.slice(objekt.ende);
  }
  const letztes = objekt.glieder[objekt.glieder.length - 1];
  const innen = einzugVor(text, letztes.nameStart);
  const einschub = `,${eol}${innen}${JSON.stringify(name)}: ${schreibweise(wert, innen, eol)}`;
  return text.slice(0, letztes.wert.ende) + einschub + text.slice(letztes.wert.ende);
}

/** Hängt ein Element an eine Liste an. */
function elementHinzu(text, liste, wert, eol) {
  const basis = einzugVor(text, liste.start);
  if (liste.elemente.length === 0) {
    const innen = basis + "  ";
    return text.slice(0, liste.start) + `[${eol}${innen}${schreibweise(wert, innen, eol)}${eol}${basis}]` + text.slice(liste.ende);
  }
  const letztes = liste.elemente[liste.elemente.length - 1];
  const innen = einzugVor(text, letztes.start);
  return text.slice(0, letztes.ende) + `,${eol}${innen}${schreibweise(wert, innen, eol)}` + text.slice(letztes.ende);
}

/**
 * Setzt `wurzel[fach][name] = bauen(alt)` im Text. Nur der Bereich des
 * Eintrags ändert sich. `alt` im Ergebnis ist der bisherige Wert oder null.
 * `zusatzListe` hängt bei Bedarf ein Element an eine Liste der Wurzel an
 * (VS Code: inputs).
 */
export function jsonEintragSetzen(text, fach, name, bauen, { zusatzListe } = {}) {
  if (!text || !text.trim()) {
    const neu = { [fach]: { [name]: bauen(null) } };
    if (zusatzListe) neu[zusatzListe.fach] = [zusatzListe.element];
    return { text: JSON.stringify(neu, null, 2) + "\n", alt: null };
  }
  const eol = zeilenende(text);
  let wurzel = jsoncLesen(text);
  if (wurzel.art !== "objekt") throw new Error("Die Datei ist kein JSON-Objekt");
  let alt = null;
  const fachKnoten = wurzel.glieder.find((g) => g.name === fach);
  if (!fachKnoten) {
    text = gliedHinzu(text, wurzel, fach, { [name]: bauen(null) }, eol);
  } else {
    if (fachKnoten.wert.art !== "objekt") throw new Error(`"${fach}" ist kein Objekt`);
    const treffer = fachKnoten.wert.glieder.filter((g) => g.name === name);
    if (treffer.length > 1) throw new Error(`"${name}" steht mehrfach in "${fach}"`);
    if (treffer.length === 1) {
      const e = treffer[0];
      alt = knotenWert(text, e.wert);
      const neu = schreibweise(bauen(alt), einzugVor(text, e.nameStart), eol);
      text = text.slice(0, e.wert.start) + neu + text.slice(e.wert.ende);
    } else {
      text = gliedHinzu(text, fachKnoten.wert, name, bauen(null), eol);
    }
  }
  if (zusatzListe) {
    wurzel = jsoncLesen(text);
    const listenKnoten = wurzel.glieder.find((g) => g.name === zusatzListe.fach);
    if (!listenKnoten) {
      text = gliedHinzu(text, wurzel, zusatzListe.fach, [zusatzListe.element], eol);
    } else if (listenKnoten.wert.art === "liste") {
      const da = knotenWert(text, listenKnoten.wert);
      if (!da.some(zusatzListe.gleich)) text = elementHinzu(text, listenKnoten.wert, zusatzListe.element, eol);
    }
  }
  jsoncLesen(text); // das Ergebnis muss lesbar bleiben
  return { text, alt };
}

// ── TOML (Codex) ────────────────────────────────────────────────────────────
// Kein TOML-Parser als Abhängigkeit. Die Datei wird in Abschnitte zerlegt
// (Kopfzeile bis zur nächsten Kopfzeile); Abschnitte, die nicht zu knowmind
// gehören, bleiben Byte für Byte erhalten.

const KOPF = /^[ \t]*\[\[?[^\]\n]*\]\]?[ \t]*(?:#.*)?$/;
const EIGENER_KOPF = /^[ \t]*\[[ \t]*mcp_servers\.knowmind(?:\.([^\]\s]+))?[ \t]*\][ \t]*(?:#.*)?$/;

function abschnitte(text) {
  const zeilen = text.split(/(?<=\n)/);
  const teile = [{ kopf: null, zeilen: [] }];
  for (const z of zeilen) {
    const ohneEnde = z.replace(/\r?\n$/, "");
    if (KOPF.test(ohneEnde)) teile.push({ kopf: ohneEnde, zeilen: [z] });
    else teile[teile.length - 1].zeilen.push(z);
  }
  return teile;
}

const tomlString = (s) => JSON.stringify(s);

/**
 * Setzt command, args und die eigenen env-Schlüssel des knowmind-Eintrags in
 * einer Codex-config.toml. Weitere Zeilen und Unterabschnitte des Eintrags und
 * alle fremden Abschnitte bleiben stehen. `env` wird gesetzt, `envFallsFehlt`
 * kommt nur dazu, wo der Schlüssel noch fehlt.
 */
export function tomlEintragSetzen(text, { command, args, env = {}, envFallsFehlt = {} }) {
  text = text || "";
  if (/^[ \t]*mcp_servers\.knowmind[ \t]*=/m.test(text) ||
      abschnitte(text).some((t) => /^\[[ \t]*mcp_servers[ \t]*\]/.test(t.kopf || "") &&
        t.zeilen.some((z) => /^[ \t]*knowmind[ \t]*=/.test(z)))) {
    throw new Error("knowmind steht dort in Kurzform (knowmind = { … }); bitte von Hand umstellen");
  }
  const eol = text ? zeilenende(text) : "\n";
  const teile = abschnitte(text);
  const eigene = teile.filter((t) => t.kopf && EIGENER_KOPF.test(t.kopf));
  const haupt = eigene.find((t) => !EIGENER_KOPF.exec(t.kopf)[1]);
  const envTeil = eigene.find((t) => EIGENER_KOPF.exec(t.kopf)[1] === "env");
  const zeileFuer = (k, v) => `${k} = ${v}${eol}`;
  const befehl = zeileFuer("command", tomlString(command));
  const argumente = zeileFuer("args", `[${args.map(tomlString).join(", ")}]`);
  const alleEnv = { ...envFallsFehlt, ...env };

  if (!haupt) {
    const envZeilen = Object.entries(alleEnv).map(([k, v]) => zeileFuer(k, tomlString(v))).join("");
    const block = `[mcp_servers.knowmind]${eol}${befehl}${argumente}${eol}[mcp_servers.knowmind.env]${eol}${envZeilen}`;
    const trenner = !text ? "" : text.endsWith(eol + eol) ? "" : text.endsWith("\n") ? eol : eol + eol;
    return text + trenner + block;
  }

  // Hauptabschnitt: command und args ersetzen, alles andere stehen lassen.
  const rest = haupt.zeilen.slice(1).filter((z) => !/^[ \t]*(command|args)[ \t]*=/.test(z));
  haupt.zeilen = [haupt.zeilen[0], befehl, argumente, ...rest];

  if (envTeil) {
    const da = new Set();
    envTeil.zeilen = envTeil.zeilen.map((z, n) => {
      if (n === 0) return z;
      const m = /^([ \t]*)([A-Za-z0-9_]+)([ \t]*=[ \t]*)(.*?)(\r?\n)?$/.exec(z);
      if (!m) return z;
      da.add(m[2]);
      return m[2] in env ? `${m[1]}${m[2]}${m[3]}${tomlString(env[m[2]])}${m[5] ?? eol}` : z;
    });
    const neu = Object.entries(alleEnv).filter(([k]) => !da.has(k));
    if (neu.length) {
      let ende = envTeil.zeilen.length;
      while (ende > 1 && !envTeil.zeilen[ende - 1].trim()) ende--;
      envTeil.zeilen.splice(ende, 0, ...neu.map(([k, v]) => zeileFuer(k, tomlString(v))));
    }
  } else if (Object.keys(alleEnv).length) {
    const kopf = "[mcp_servers.knowmind.env]";
    teile.splice(teile.indexOf(haupt) + 1, 0, {
      kopf, zeilen: [kopf + eol, ...Object.entries(alleEnv).map(([k, v]) => zeileFuer(k, tomlString(v)))],
    });
  }
  return teile.map((t) => t.zeilen.join("")).join("");
}

/** Liest command, args und env des knowmind-Eintrags aus einer config.toml. */
export function tomlEintragLesen(text) {
  const teile = abschnitte(text || "");
  const haupt = teile.find((t) => t.kopf && EIGENER_KOPF.test(t.kopf) && !EIGENER_KOPF.exec(t.kopf)[1]);
  if (!haupt) return null;
  const envTeil = teile.find((t) => t.kopf && EIGENER_KOPF.exec(t.kopf)?.[1] === "env");
  const wert = (k) => {
    const z = haupt.zeilen.find((x) => new RegExp(`^[ \\t]*${k}[ \\t]*=`).test(x));
    return z ? JSON.parse(z.slice(z.indexOf("=") + 1).trim()) : undefined;
  };
  const env = {};
  for (const z of envTeil?.zeilen.slice(1) ?? []) {
    const m = /^[ \t]*([A-Za-z0-9_]+)[ \t]*=[ \t]*(".*")/.exec(z);
    if (m) env[m[1]] = JSON.parse(m[2]);
  }
  return { command: wert("command"), args: wert("args"), env };
}
