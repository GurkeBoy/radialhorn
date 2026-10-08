// Verlauf für Rückgängig/Wiederherstellen, rein funktional. Ein Zustand ist ein Schnappschuss als
// String (JSON des Entwurfs) – vergleichbar und unveränderlich. present ist der zuletzt
// festgehaltene Stand; was die App gerade zeigt (current), kann noch neuer sein, solange eine
// Eingabe läuft (Regler ziehen, tippen) und noch nicht festgehalten ist.

/** Höchstzahl der Schritte zurück. */
export const HISTORY_LIMIT = 200;

/** Neuer Verlauf mit dem Ausgangsstand. */
export const createHistory = present => ({ past: [], present, future: [] });

/**
 * Aktuellen Stand festhalten: der bisherige wandert in past, Wiederherstellen entfällt.
 * Unverändert zurück, wenn current schon festgehalten ist.
 */
export function record(h, current, limit = HISTORY_LIMIT) {
  if (current === h.present) return h;
  return { past: [...h.past, h.present].slice(-limit), present: current, future: [] };
}

/** Rückgängig möglich? (auch ein noch nicht festgehaltener Stand lässt sich zurücknehmen) */
export const canUndo = (h, current) => h.past.length > 0 || current !== h.present;

/** Wiederherstellen möglich? (nicht, sobald seit dem letzten Rückgängig etwas geändert wurde) */
export const canRedo = (h, current) => h.future.length > 0 && current === h.present;

/**
 * Einen Schritt zurück. Ein noch nicht festgehaltener Stand wird erst festgehalten, damit er
 * sich wiederherstellen lässt. @returns { history, target } – target ist der anzuwendende Stand,
 * oder null, wenn es nichts zurückzunehmen gibt.
 */
export function undo(h, current) {
  const base = record(h, current);
  if (base.past.length === 0) return { history: base, target: null };
  const target = base.past.at(-1);
  return { history: { past: base.past.slice(0, -1), present: target, future: [base.present, ...base.future] }, target };
}

/** Einen Schritt vor. @returns { history, target } wie undo. */
export function redo(h, current) {
  if (!canRedo(h, current)) return { history: h, target: null };
  const target = h.future[0];
  return { history: { past: [...h.past, h.present], present: target, future: h.future.slice(1) }, target };
}
