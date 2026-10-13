import { useState, useEffect, useRef } from "react";
import { readSetting, writeSetting } from "./settings.js";
import * as H from "./history.js";
import { createGeometryEngine, adoptGeometry } from "./geometry.js";

/** Größe eines DOM-Elements, laufend per ResizeObserver gemessen. */
export function useSize(ref) {
  const [size, setSize] = useState({ w: 540, h: 480 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

const ZOOM_MIN = 0.25, ZOOM_MAX = 20;
const VIEW_RESET = { k: 1, tx: 0, ty: 0 };

/**
 * Zoom (Mausrad, um den Cursor) und Verschieben (Klick + Ziehen) einer Ansicht.
 * Liefert die Bildschirm-Transformation p' = t + k·p, die auf die Basis-Abbildung
 * (Standard-Zoom, zentriert) angewendet wird, plus Reset und Pointer-Handler.
 *
 * @param minZoom    kleinste Zoomstufe; Diagramme nutzen 1 und springen bei 100 % in
 *                   die Ausgangslage zurück
 * @param unitsPerPx Umrechnung Bildschirm-px → eigene Koordinaten (per viewBox skaliertes SVG)
 */
export function useZoomPan(ref, { minZoom = ZOOM_MIN, unitsPerPx = () => 1 } = {}) {
  const [view, setView] = useState(VIEW_RESET);
  const drag = useRef(null);

  // Wheel-Listener nativ und nicht passiv, damit preventDefault das Seiten-Scrollen
  // verhindert (React registriert onWheel passiv). Ohne Dependency-Array, weil das
  // Element hinter ref zwischen Renders wechseln kann.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const u = unitsPerPx();
      const mx = (e.clientX - r.left) * u, my = (e.clientY - r.top) * u;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView(v => {
        const k = Math.min(ZOOM_MAX, Math.max(minZoom, v.k * factor));
        if (minZoom >= 1 && k <= 1) return VIEW_RESET;
        const f = k / v.k;
        return { k, tx: mx - (mx - v.tx) * f, ty: my - (my - v.ty) * f };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const onPointerDown = e => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = e => {
    if (!drag.current) return;
    const u = unitsPerPx();
    const dx = (e.clientX - drag.current.x) * u, dy = (e.clientY - drag.current.y) * u;
    drag.current = { x: e.clientX, y: e.clientY };
    setView(v => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const onPointerUp = () => { drag.current = null; };

  return {
    view,
    reset: () => setView(VIEW_RESET),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}

/**
 * Wert, der einem schnell wechselnden Wert gedrosselt folgt: Ändert er sich, zieht der Rückgabewert
 * nach einer kurzen Pause (gap) auf den dann neuesten Stand nach; die nächste Runde beginnt erst
 * nach dem Neuzeichnen. So aktualisieren aufwendige Ansichten beim Ziehen eines Reglers laufend,
 * so schnell sie rechnen können, und zwischen den Runden bleibt Zeit für die Eingabe selbst.
 */
export function useThrottledValue(value, gap = 30) {
  const [shown, setShown] = useState(value);
  const latest = useRef(value);
  useEffect(() => { latest.current = value; });
  useEffect(() => {
    if (shown === value) return;
    const timer = setTimeout(() => setShown(latest.current), gap);
    return () => clearTimeout(timer);
  }, [shown, value === shown, gap]);   // eslint-disable-line react-hooks/exhaustive-deps -- Takt hängt nur am Abschluss der Runde
  return shown;
}

/**
 * Wert erst weitergeben, wenn er delay ms lang unverändert war (der erste sofort): für Teures,
 * das beim Ziehen nicht live mitlaufen muss (Frequenzgang) – es folgt nach dem Loslassen.
 */
export function useSettledValue(value, delay = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (settled === value) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, settled, delay]);
  return settled;
}

/**
 * Abgeleitete Geometrie zu den Reglerwerten params, gerechnet im Web Worker (geometry.worker.js).
 * Der erste Stand wird direkt gerechnet (kein leerer Start). Es läuft höchstens eine Berechnung;
 * Werte, die währenddessen kommen, ersetzen einander, nur die neuesten werden danach gerechnet.
 * Liefert das zuletzt fertige Ergebnis { params, values, versions } – params sind die Werte,
 * zu denen es gehört; unveränderte Teile behalten ihr Objekt (adoptGeometry).
 */
export function useGeometry(params) {
  const [state, setState] = useState(() => createGeometryEngine()(params));
  const ref = useRef(null);
  useEffect(() => {
    const worker = new Worker(new URL("./geometry.worker.js", import.meta.url), { type: "module" });
    const st = { busy: false, pending: null };
    st.send = prm => { st.busy = true; worker.postMessage({ params: prm }); };
    worker.onmessage = ({ data }) => {
      st.busy = false;
      if (st.pending) { const next = st.pending; st.pending = null; st.send(next); }
      if (data.error) { console.error("Geometrie:", data.error); return; }
      setState(prev => adoptGeometry(prev, data));
    };
    ref.current = st;
    return () => { worker.terminate(); ref.current = null; };
  }, []);
  useEffect(() => {
    const st = ref.current;
    if (!st || params === state.params) return;   // erster Stand ist schon gerechnet
    if (st.busy) st.pending = params;
    else st.send(params);
  }, [params]);   // eslint-disable-line react-hooks/exhaustive-deps -- nur bei neuen Werten senden
  return state;
}

/** useState, dessen Wert gespeichert wird und beim nächsten Start wieder da ist (settings.js). */
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => readSetting(key, initial));
  useEffect(() => writeSetting(key, value), [key, value]);
  return [value, setValue];
}

/** Tastenfokus in einem Textfeld? Dort gehören Strg+Z/Y dem Feld selbst. */
const isTextEntry = el =>
  el?.isContentEditable || el?.tagName === "TEXTAREA" ||
  (el?.tagName === "INPUT" && !["range", "checkbox", "radio", "button", "file"].includes(el.type));

/**
 * Rückgängig/Wiederherstellen für einen Satz von Werten (history.js). Eine Änderung wird erst
 * festgehalten, wenn die Werte settle ms ruhig sind – ein Zug am Regler oder eine getippte Zahl
 * ist ein Schritt, nicht hundert. apply(werte) setzt einen früheren Stand. Tastenkürzel:
 * Strg+Z, Strg+Y und Strg+Umschalt+Z (Mac: ⌘), nicht in Textfeldern.
 */
export function useUndo(values, apply, settle = 500) {
  const current = JSON.stringify(values);
  const [history, setHistory] = useState(() => H.createHistory(current));
  useEffect(() => {
    if (current === history.present) return;
    const timer = setTimeout(() => setHistory(h => H.record(h, current)), settle);
    return () => clearTimeout(timer);
  }, [current, history.present, settle]);

  const step = fn => {
    const { history: next, target } = fn(history, current);
    if (target === null) return;
    setHistory(next);
    apply(JSON.parse(target));
  };
  const actions = { undo: () => step(H.undo), redo: () => step(H.redo) };
  const latest = useRef(actions);
  useEffect(() => { latest.current = actions; });
  useEffect(() => {
    const onKey = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextEntry(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) latest.current.undo();
      else if (key === "y" || (key === "z" && e.shiftKey)) latest.current.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { ...actions, canUndo: H.canUndo(history, current), canRedo: H.canRedo(history, current) };
}
