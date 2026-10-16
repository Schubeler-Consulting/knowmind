# -*- coding: utf-8 -*-
"""Übergang: Starter am alten Ort bin/, der Starter selbst liegt unter src/.

WARUM (16.10.2026): Am 13.10.2026 fiel der knowmind-MCP-Server in einer
Claude-Code-Einrichtung aus („Connection closed“). Ihr Eintrag zeigte auf
`node_modules/knowmind/bin/mcp-starter.py`. Diese Datei war von Hand dorthin
kopiert worden; kein veröffentlichtes Paket hat sie je enthalten (geprüft an
allen 33 Fassungen auf npm, 0.1.9 bis 0.4.2). Beim Update ersetzt npm das ganze
Paketverzeichnis, und die Kopie war weg.

Diese Datei hält den alten Pfad am Leben, ohne dass jemand eine
Konfigurationsdatei anfassen muss. Sie führt `src/mcp-starter.py` aus, mit
denselben Argumenten und demselben Rückgabewert. Sie bleibt im Paket, solange
ein Eintrag auf sie zeigen kann; `src/starterpfad.test.js` hält das fest.
"""
import os
import runpy
import sys

ZIEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "src", "mcp-starter.py")

if __name__ == "__main__":
    sys.argv[0] = ZIEL
    runpy.run_path(ZIEL, run_name="__main__")
