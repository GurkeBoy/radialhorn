import { useState, useEffect, useRef } from "react";
import { readSetting, writeSetting } from "./settings.js";

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

/** useState, dessen Wert gespeichert wird und beim nächsten Start wieder da ist (settings.js). */
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => readSetting(key, initial));
  useEffect(() => writeSetting(key, value), [key, value]);
  return [value, setValue];
}
