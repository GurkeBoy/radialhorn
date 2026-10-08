import { describe, it, expect } from "vitest";
import { createHistory, record, undo, redo, canUndo, canRedo } from "./history.js";

describe("Verlauf (Rückgängig/Wiederherstellen)", () => {
  it("festhalten, zurück und vor", () => {
    let h = createHistory("a");
    h = record(h, "b");
    h = record(h, "c");
    let r = undo(h, "c");
    expect(r.target).toBe("b");
    r = undo(r.history, "b");
    expect(r.target).toBe("a");
    expect(canUndo(r.history, "a")).toBe(false);
    expect(undo(r.history, "a").target).toBeNull();
    r = redo(r.history, "a");
    expect(r.target).toBe("b");
    r = redo(r.history, "b");
    expect(r.target).toBe("c");
    expect(canRedo(r.history, "c")).toBe(false);
  });

  it("gleicher Stand wird nicht doppelt festgehalten", () => {
    const h = record(createHistory("a"), "a");
    expect(h.past).toHaveLength(0);
  });

  it("noch nicht festgehaltener Stand: Rückgängig geht zurück und lässt ihn wiederherstellen", () => {
    const h = createHistory("a");               // Nutzer zieht gerade, die App zeigt "x"
    expect(canUndo(h, "x")).toBe(true);
    const r = undo(h, "x");
    expect(r.target).toBe("a");
    expect(redo(r.history, "a").target).toBe("x");
  });

  it("neue Änderung nach Rückgängig verwirft Wiederherstellen", () => {
    let h = record(createHistory("a"), "b");
    h = undo(h, "b").history;                   // zurück auf "a"
    expect(canRedo(h, "a")).toBe(true);
    expect(canRedo(h, "z")).toBe(false);        // schon wieder geändert, noch nicht festgehalten
    expect(redo(h, "z").target).toBeNull();
    h = record(h, "z");
    expect(h.future).toHaveLength(0);
    expect(undo(h, "z").target).toBe("a");
  });

  it("begrenzt die Schritte zurück", () => {
    let h = createHistory("0");
    for (let i = 1; i <= 10; i++) h = record(h, String(i), 3);
    expect(h.past).toEqual(["7", "8", "9"]);
  });
});
