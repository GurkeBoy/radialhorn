// Abgeleitete Geometrie aus den Reglerwerten: Grenzen, Lösung, Verrundung, Übergang, Flansch und
// die Schalen-Umrisse der Ansichten. Läuft im Web Worker (geometry.worker.js), damit der
// Haupt-Thread beim Ziehen nur zeichnet; die App rechnet nur den allerersten Stand direkt.
//
// Jede Stufe hängt nur an ihren eigenen Eingaben und ist zwischengespeichert (cached): ein Regler
// rechnet nur neu, was er betrifft. Jedes Ergebnis trägt eine Version; die App behält bei gleicher
// Version ihr bisheriges Objekt (adoptGeometry) – so bleiben memo/useMemo dahinter wirksam, auch
// wenn die Daten als Kopie aus dem Worker kommen.
import { createHornMath, computeFillet, makeProfile, throatMorph } from "./horn-math.js";
import { flangeLayout, shellPlanOutline, shellProfileOutline } from "./horn-mesh.js";
import { linspace } from "./utils.js";

export const L_MAX = 1200;   // Obergrenze des L-Reglers ohne Raumecke [mm]

/** Reglerwerte, von denen die Geometrie abhängt (alles andere – Simulation, Ansicht – nicht). */
export const GEOMETRY_KEYS = [
  "throatDiam", "openingAngle", "L", "Lt", "dw", "dh", "hMouth", "curve", "hypexT", "showRaumecke", "showWandstaerke",
  "wandstaerke", "filletOn", "filletR", "clothoidOn", "clothoidLength", "morphOn", "morphLength", "flangeOn", "flangeD",
  "flangeT", "holeCount", "holeCircle", "holeD", "holeAngle", "edgeOn", "edgeR",
];

/** Teilergebnisse mit Version (Objekte, deren Gleichheit nachgelagert zählt). */
const VERSIONED = ["s", "fillet", "morph", "flange", "shellOuter", "shellCut"];

/**
 * Rechenkern mit Zwischenspeichern. compute(params) → { params, values, versions }.
 * values: s, fillet, morph, flange, shellOuter (Draufsicht), shellCut (Seitenriss), Grenzen
 * (LtMin, LtMax, LtClamped, LtMinClothoid, LMaxRaumecke, Lmin, Lmax, LClamped), warnings, wall, edge.
 * versions: je Eintrag aus VERSIONED, eindeutig über Kerne hinweg.
 */
export function createGeometryEngine() {
  // Kennung des Kerns: Worker und Haupt-Thread zählen getrennt, Versionen dürfen sich nicht verwechseln
  const id = Math.random().toString(36).slice(2, 10);
  const cache = {};
  // Stufe name: neu rechnen nur bei geändertem Schlüssel; Version zählt mit
  const stage = (name, deps, f) => {
    const key = JSON.stringify(deps);
    const c = cache[name] ??= { key: undefined, value: undefined, version: 0 };
    if (c.key !== key) { c.key = key; c.value = f(); c.version++; }
    return c;
  };

  return function compute(p) {
    const rt = p.throatDiam / 2;
    const math = stage("math", [p.openingAngle, p.clothoidOn ? p.clothoidLength : 0],
      () => createHornMath(p.openingAngle, { clothoid: p.clothoidOn ? p.clothoidLength : 0 }));
    const m = math.value;
    // Wandstärke vergrößert die Außenkante senkrecht zur Wand; ihre Projektion auf die
    // 45°-Raumecke verkleinert den verfügbaren Platz
    const extraBreite = p.showRaumecke && p.showWandstaerke ? (Math.cos(m.ALPHA2) + Math.sin(m.ALPHA2)) * p.wandstaerke : 0;
    const geo = [math.version, rt, p.dw, p.dh];

    // Grenzen für Lₜ hängen an L, nicht an Lₜ; die Klothoiden-Grenze nur an rt
    const { LtMax, LtMinRaumecke } = stage("ltLimits", [...geo, p.L, p.showRaumecke, extraBreite], () => ({
      LtMax:         m.maxLt(p.L, rt, p.dw, p.dh),
      LtMinRaumecke: p.showRaumecke ? m.minLtForRaumecke(p.L, rt, p.dw, p.dh, extraBreite) : null,
    })).value;
    const LtMinClothoid = stage("ltClothoid", [math.version, rt], () => m.minLtForClothoid(rt)).value;
    const LtMin     = Math.max(LtMinRaumecke ?? 0, LtMinClothoid);
    const LtClamped = Math.min(Math.max(p.Lt, LtMin), LtMax);
    // Grenzen für L hängen am begrenzten Lₜ, nicht an L
    const { LMaxRaumecke, Lmin } = stage("lLimits", [...geo, LtClamped, p.showRaumecke, extraBreite], () => ({
      LMaxRaumecke: p.showRaumecke ? m.maxLforRaumecke(LtClamped, rt, p.dw, p.dh, extraBreite) : null,
      Lmin:         m.minL(LtClamped, rt, p.dw, p.dh),
    })).value;
    const LClamped = LMaxRaumecke !== null && p.L > LMaxRaumecke ? LMaxRaumecke : p.L;
    const s = stage("s", [...geo, LClamped, LtClamped], () => m.solveHorn(LClamped, LtClamped, rt, p.dw, p.dh));
    const sv = s.value;

    const fillet = stage("fillet", [s.version, p.filletOn, p.hMouth, p.curve, p.hypexT, p.filletR],
      () => p.filletOn && sv ? computeFillet(sv, rt, p.hMouth, p.curve, p.hypexT, p.filletR) : null);
    const profile = stage("profile", [s.version, fillet.version, p.hMouth, p.curve, p.hypexT],
      () => sv && makeProfile(sv, rt, p.hMouth, p.curve, p.hypexT, fillet.value));
    // Übergang rund → eckig am Throat (Eckradius entlang der Wand), auf das Machbare begrenzt
    const morph = stage("morph", [s.version, p.morphOn, p.morphLength],
      () => p.morphOn && sv ? throatMorph(sv, rt, p.morphLength) : null);

    const wall = p.showWandstaerke ? p.wandstaerke : 0;
    // gerundete Längskanten außen: Radius höchstens die Wandstärke (sonst würde die Wand an der Ecke dünner)
    const edge = wall > 0 && p.edgeOn ? Math.min(p.edgeR ?? wall, wall) : 0;
    // Flansch nur an der Schale; Ø und Lochkreis werden gegen den Außenkörper aufgelöst
    const flange = stage("flange", [profile.version, morph.version, wall, edge, p.flangeOn, p.flangeD, p.dw, p.flangeT,
      p.holeCount, p.holeCircle, p.holeD, p.holeAngle], () => sv && wall > 0 && p.flangeOn ? flangeLayout(sv, rt, profile.value, fillet.value, wall, {
      diameter: p.flangeD, fallback: p.dw, thickness: p.flangeT,
      holes: { count: p.holeCount, circle: p.holeCircle, diameter: p.holeD, angle: p.holeAngle },
    }, edge, morph.value) : null);

    // Schalen-Umrisse der Ansichten (Schnitt durch die Wand), ab der Flanschebene
    const zShell = flange.value ? flange.value.thickness : 0;
    const shellOuter = stage("shellOuter", [s.version, wall, zShell],
      () => sv && wall > 0 ? shellPlanOutline(sv, rt, wall, zShell) : null);
    const shellCut = stage("shellCut", [profile.version, wall, zShell], () => sv && wall > 0 ? {
      inner: linspace(zShell, sv.zApex, 300).map(z => [profile.value(z), z]),
      outer: shellProfileOutline(sv, rt, profile.value, wall, zShell),
    } : null);

    const stages = { s, fillet, morph, flange, shellOuter, shellCut };
    return {
      params: p,
      values: {
        ...Object.fromEntries(VERSIONED.map(k => [k, stages[k].value])),
        LtMin, LtMax, LtClamped, LtMinClothoid, LMaxRaumecke, Lmin, Lmax: LMaxRaumecke ?? L_MAX, LClamped, wall, edge,
        warnings: {
          raumecke: p.showRaumecke && LMaxRaumecke !== null && p.L >= LMaxRaumecke - 1,
          ltMax:    p.Lt > LtMax,
          ltMin:    p.showRaumecke && LtMinRaumecke !== null && p.Lt <= LtMin + 0.5,
          clothoid: LtMinClothoid > LtMax ? "zu lang" : p.Lt < LtMinClothoid ? "Lt" : null,
        },
      },
      versions: Object.fromEntries(VERSIONED.map(k => [k, `${id}:${stages[k].version}`])),
    };
  };
}

/**
 * Neues Ergebnis übernehmen: Teile mit gleicher Version behalten ihr bisheriges Objekt (die Kopie
 * aus dem Worker ist inhaltsgleich), damit nachgelagerte memo/useMemo nicht neu rechnen.
 */
export function adoptGeometry(prev, next) {
  if (!prev) return next;
  const values = { ...next.values };
  for (const k of VERSIONED) if (prev.versions[k] === next.versions[k]) values[k] = prev.values[k];
  return { ...next, values };
}
