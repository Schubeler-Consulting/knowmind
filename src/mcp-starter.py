# -*- coding: utf-8 -*-
"""Startet den knowmind-MCP-Server unter Windows ohne Konsolenfenster.

WARUM (10.08.2026, Johann): „Mein Fenster öffnet sich noch immer, wenn knowmind
gecalled wird. Viele werden es deshalb deinstallieren." — und nachgeschoben:
„Du kannst währenddessen auch nicht tippen. Sehr nervig." Das Fenster stiehlt
den Tastaturfokus, es ist also kein Schönheitsfehler, sondern eine Unterbrechung
mitten im Satz.

Ein MCP-Server wird als `node …/knowmind.js mcp` gestartet. `node.exe` ist ein
Konsolenprogramm; hat der startende KI-Client keine eigene Konsole — Desktop-
Anwendung, IDE-Erweiterung —, gibt Windows dem Kind ein eigenes Fenster. Bei
jedem Werkzeugaufruf blitzt es auf. Ein Gedächtnis, das bei jeder Nutzung den
Fokus klaut, fliegt wieder runter, egal wie gut es ist.

`node.exe` hat kein fensterloses Gegenstück. `pythonw.exe` ist ein GUI-Programm
und öffnet selbst keins — es startet node mit CREATE_NO_WINDOW.

WARUM DURCHREICHEN STATT VERERBEN: Die naheliegende Fassung startet node ohne
stdin/stdout-Umleitung, damit es die Handles des Elternprozesses erbt. Unter
`pythonw.exe` schlägt das fehl — als GUI-Programm hat es keine verlässlichen
Standard-Handles, node erbt ins Leere und die Antwort kommt nie beim Client an
(gemessen 10.08.2026: initialize blieb unbeantwortet). Deshalb werden die
Datenströme über Pipes geführt und in beide Richtungen durchgepumpt. Roh, ohne
Zeilenpufferung — MCP-Nachrichten dürfen nicht verzögert oder zerschnitten
werden.

Aufruf:  pythonw.exe mcp-starter.py <befehl> [argumente]
         z. B. … mcp-starter.py npx -y knowmind mcp
         oder … mcp-starter.py node C:/…/knowmind.js mcp
"""
import shutil
import subprocess
import sys
import threading

CREATE_NO_WINDOW = 0x08000000


def pumpe(quelle, ziel) -> None:
    """Schiebt Bytes weiter, sobald sie da sind, und schliesst am Ende sauber."""
    try:
        while True:
            brocken = quelle.read(1)
            if not brocken:
                break
            ziel.write(brocken)
            ziel.flush()
    except Exception:  # noqa: BLE001 — Abbruch beim Beenden ist normal
        pass
    finally:
        try:
            ziel.close()
        except Exception:  # noqa: BLE001
            pass


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("Aufruf: mcp-starter.py <knowmind.js> [args...]\n")
        return 2

    # Erstes Argument ist der zu startende Befehl (node, npx, …), Rest sind
    # dessen Argumente. Unter Windows liegt npx als .cmd vor; subprocess findet
    # es nur über den vollen Pfad, deshalb erst auflösen.
    befehl = list(sys.argv[1:])
    aufgeloest = shutil.which(befehl[0])
    if aufgeloest:
        befehl[0] = aufgeloest

    try:
        prozess = subprocess.Popen(
            befehl,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
            creationflags=CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            bufsize=0,
        )
    except FileNotFoundError:
        sys.stderr.write(f"node nicht gefunden: {node}\n")
        return 127

    faeden = [
        threading.Thread(target=pumpe, args=(sys.stdin.buffer, prozess.stdin), daemon=True),
        threading.Thread(target=pumpe, args=(prozess.stdout, sys.stdout.buffer), daemon=True),
    ]
    for f in faeden:
        f.start()

    try:
        return prozess.wait()
    except KeyboardInterrupt:
        prozess.terminate()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
