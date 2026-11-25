/**
 * Welche Körperform? Radialhorn (Sektor mit Höhenprofil, horn-mesh.js) oder rundes Horn (Rotationskörper,
 * round-mesh.js): s.round entscheidet. Alle Aufrufer von außen gehen durch diese Funktionen.
 */
import { buildHornGeometry, buildShellGeometry, flangeLayout, DEFAULT_RES } from "./horn-mesh.js";
import { buildRoundHornGeometry, buildRoundShellGeometry, roundFlangeLayout } from "./round-mesh.js";

/** Luftvolumen als geschlossener Körper. */
export const buildAir = (s, rt, profile, fillet, morph = null, res = DEFAULT_RES) =>
  s.round ? buildRoundHornGeometry(s, rt, res) : buildHornGeometry(s, rt, profile, fillet, morph, res);

/** Schale mit Wandstärke t, optional mit Flansch (aufgelöst oder als Vorgabe). */
export const buildShell = (s, rt, profile, fillet, t, flange = null, edgeR = 0, morph = null, res = DEFAULT_RES) =>
  s.round ? buildRoundShellGeometry(s, rt, t, flange, res) : buildShellGeometry(s, rt, profile, fillet, t, flange, edgeR, morph, res);

/** Flansch gegen den Außenkörper auflösen. */
export const layoutFlange = (s, rt, profile, fillet, t, flange, edgeR = 0, morph = null, res = DEFAULT_RES) =>
  s.round ? roundFlangeLayout(s, rt, t, flange, res) : flangeLayout(s, rt, profile, fillet, t, flange, edgeR, morph, res);
