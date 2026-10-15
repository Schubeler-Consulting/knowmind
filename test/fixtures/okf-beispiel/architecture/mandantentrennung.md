---
type: concept
title: Mandantentrennung
description: Wie der Abrechnungsdienst die Daten verschiedener Kunden trennt.
status: stable
stale_after: 2027-01-01T00:00:00Z
resource: repo://src/mandant.ts
sources:
  - { id: s1, resource: repo://src/mandant.ts, author: human:jschuebeler, last_modified: 2026-10-01T12:00:00Z }
  - { id: s2, resource: repo://src/db/zeilenregeln.sql }
  - { id: s3, resource: repo://src/buchung.ts }
  - { id: s4, resource: repo://src/rechnung.ts }
  - { id: s5, resource: repo://src/kunde.ts }
  - { id: s6, resource: repo://src/abo.ts }
  - { id: s7, resource: repo://src/ereignisse.ts }
  - { id: s8, resource: repo://src/protokoll.ts }
  - { id: s9, resource: repo://test/mandant.test.ts }
  - { id: s10, resource: repo://test/buchung.test.ts }
  - { id: s11, resource: repo://docs/adr/0003-zeilenregeln.md }
  - { id: s12, resource: repo://docs/sicherheit.md }
generated: { by: openwiki/0.7.0, at: 2026-10-14T08:05:00Z }
verified:
  - { by: process:nightly-tests, at: 2026-10-14T02:00:00Z }
  - { by: human:jschuebeler, at: 2026-10-15T09:30:00Z }
---

# Mandantentrennung

Jede Abfrage läuft mit gesetzter Mandantenkennung; eine Zeilenregel in der
Datenbank lässt nur Zeilen dieses Mandanten durch.[^s2] Buchungen schreibt
ausschließlich `src/buchung.ts`.[^s3]

[^s2]: Zeilenregeln der Datenbank
[^s3]: Buchungsdienst
