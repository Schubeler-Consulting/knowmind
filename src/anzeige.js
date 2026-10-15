/**
 * Kopfzeile eines Treffers für `knowmind search`.
 *
 * Treffer aus Seiten im Open Knowledge Format tragen seit dem Serverstand vom
 * 16.10.2026 `metadata.review_flags`: `stale` (Verfallszeitpunkt erreicht),
 * `unverified` (keine Prüfung verzeichnet), `superseded` (überholt), seit 0.4.2
 * `drifted` (belegter Code geändert). Die
 * Kopfzeile zeigt sie in eckigen Klammern; ohne Kennzeichen bleibt sie wie
 * bisher.
 */
export function trefferKopf(hit, i) {
  const src = hit.metadata?.source_id ?? hit.chunk_id;
  const name = hit.metadata?.name ?? src;
  const kennzeichen = Array.isArray(hit.metadata?.review_flags) && hit.metadata.review_flags.length
    ? `  [${hit.metadata.review_flags.join(", ")}]`
    : "";
  return `#${i + 1}  ${name}  (score ${hit.score.toFixed(3)})${kennzeichen}`;
}
