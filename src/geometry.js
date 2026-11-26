// Abgeleitete Geometrie aus den Reglerwerten: Grenzen, Lösung, Verrundung, Übergang, Flansch und
// die Schalen-Umrisse der Ansichten. Läuft im Web Worker (geometry.worker.js), damit der
// Haupt-Thread beim Ziehen nur zeichnet; die App rechnet nur den allerersten Stand direkt.
//
// Jede Stufe hängt nur an ihren eigenen Eingaben und ist zwischengespeichert (cached): ein Regler
// rechnet nur neu, was er betrifft. Jedes Ergebnis trägt eine Version; die App behält bei gleicher
// Version ihr bisheriges Objekt (adoptGeometry) – so bleiben memo/useMemo dahinter wirksam, auch
// wenn die Daten als Kopie aus dem Worker kommen.
import { createHornMath, computeFillet, computeFilletClothoid, makeProfile, throatMorph, mouthRounding, lengthOffset } from "./horn-math.js";
import { shellPlanOutline, shellProfileOutline } from "./horn-mesh.js";
import { layoutFlange } from "./bodies.js";
import { resolveVanes } from "./vanes.js";
import { linspace } from "./utils.js";

export const L_MAX = 1200;   // Obergrenze des L-Reglers [mm]; mit Raumecke gilt maxLWithRaumecke, falls kleiner

/** Reglerwerte, von denen die Geometrie abhängt (alles andere – Simulation, Ansicht – nicht). */
export const GEOMETRY_KEYS = [
  "hornShape", "throatDiam", "openingAngle", "L", "Lt", "dw", "dh", "hMouth", "curve", "hypexT", "showRaumecke", "showWandstaerke",
  "wandstaerke", "filletOn", "filletR", "filletClothoidOn", "filletClothoidLength", "clothoidOn", "clothoidLength", "arcOn", "arcRadius", "morphOn", "morphLength", "mouthRoundOn", "mouthRoundR", "flangeOn", "flangeD",
  "flangeT", "holeCount", "holeCircle", "holeD", "holeAngle", "ribsOn", "ribThickness", "ribLength", "roundOn", "roundR", "edgeOn", "edgeR",
  "vanesOn", "vaneCount", "vaneThickness", "vaneStartMode", "vaneStart", "vaneEndMode", "vaneEnd", "vaneTipStart", "vaneTipEnd", "vaneTipLength",
  "vaneStagger", "vaneStages", "vaneStageMode", "vaneStageChannel", "vaneStageZ1", "vaneStageZ2", "vaneStageZ3",
];

/** Teilergebnisse mit Version (Objekte, deren Gleichheit nachgelagert zählt). */
const VERSIONED = ["s", "fillet", "morph", "flange", "vanes", "shellOuter", "shellCut"];

/**
 * Rechenkern mit Zwischenspeichern. compute(params) → { params, values, versions }.
 * values: s, fillet, morph, flange, vanes (Lamellen, aufgelöst), shellOuter (Draufsicht), shellCut (Seitenriss), Grenzen
 * (LtMin, LtMax, LtClamped, LtMinClothoid, LMaxRaumecke, Lmin, Lmax, LClamped – Längen wie angezeigt,
 * ohne Raumecke ab der Treiberrückseite; s rechnet intern ab der Hut-Spitze), warnings, wall, edge.
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

  return function compute(input) {
    // Rundes Horn (Rotationskörper): ohne Treiberabmessungen, Raumecke, vertikales Profil und Kantenrundungen; L zählt vom Throat
    const round = input.hornShape === "round";
    const p = round
      ? { ...input, dw: 0, dh: 0, showRaumecke: false, filletOn: false, filletClothoidOn: false, morphOn: false, mouthRoundOn: false, edgeOn: false }
      : input;
    const rt = p.throatDiam / 2;
    // Übergang Traktrix → Gerade: Klothoide (Länge) oder Kreisbogen (Radius), nie beides
    const blendClothoid = p.clothoidOn ? p.clothoidLength : 0, blendArc = !p.clothoidOn && p.arcOn ? p.arcRadius : 0;
    const math = stage("math", [p.openingAngle, blendClothoid, blendArc],
      () => createHornMath(p.openingAngle, { clothoid: blendClothoid, arc: blendArc }));
    const m = math.value;
    // Wandstärke vergrößert die Außenkante senkrecht zur Wand; ihre Projektion auf die
    // 45°-Raumecke verkleinert den verfügbaren Platz
    const extraBreite = p.showRaumecke && p.showWandstaerke ? (Math.cos(m.ALPHA2) + Math.sin(m.ALPHA2)) * p.wandstaerke : 0;
    const geo = [math.version, rt, p.dw, p.dh];
    // Angezeigtes L beginnt ohne Raumecke an der Treiberrückseite, gerechnet wird ab der Hut-Spitze
    // (dw/2 dahinter): L hier intern, Grenzen und LClamped gehen angezeigt zurück
    const off = lengthOffset(p.dw, p.showRaumecke);
    const L = p.L + off;

    // Grenzen für Lₜ hängen an L, nicht an Lₜ; die Klothoiden-Grenze nur an rt. Lₜ folgt der
    // Raumecke: wächst L, steigt die Untergrenze so, dass die Mundkante an der Wand bleibt – das
    // eingestellte Lₜ bleibt gespeichert und gilt wieder, sobald L kleiner wird
    const { LtMax, LtMinRaumecke } = stage("ltLimits", [...geo, L, p.showRaumecke, extraBreite], () => ({
      LtMax:         m.maxLt(L, rt, p.dw, p.dh),
      LtMinRaumecke: p.showRaumecke ? m.minLtForRaumecke(L, rt, p.dw, p.dh, extraBreite) : null,
    })).value;
    // Untergrenze des Übergangsstücks (Klothoide passt, Kreisbogen beginnt hinter dem Throat) und Obergrenze (nur
    // Kreisbogen: er schrumpft sonst auf 0); gibt es für den Kreisbogen kein Fenster, bleibt Lₜ = 0 (keine Traktrix)
    const blendLimits = stage("ltBlend", [math.version, rt], () => ({ min: m.minLtForClothoid(rt), max: m.maxLtForBlend(rt) })).value;
    const LtMinClothoid = Number.isFinite(blendLimits.min) ? blendLimits.min : 0;
    const LtMaxAll   = Math.min(LtMax, blendLimits.max);
    const LtMin     = Math.min(Math.max(LtMinRaumecke ?? 0, LtMinClothoid), LtMaxAll);
    const LtClamped = Math.min(Math.max(p.Lt, LtMin), LtMaxAll);
    // Grenzen für L hängen am begrenzten Lₜ, nicht an L. LMaxForLt: mit diesem Lₜ (begrenzt nur,
    // wenn Lₜ nicht mehr folgen kann); LMaxRaumecke: Reglergrenze, mit folgendem Lₜ – hängt weder an L noch an Lₜ
    const { LMaxForLt, Lmin } = stage("lLimits", [...geo, LtClamped, p.showRaumecke, extraBreite], () => ({
      LMaxForLt: p.showRaumecke ? m.maxLforRaumecke(LtClamped, rt, p.dw, p.dh, extraBreite) : null,
      Lmin:      m.minL(LtClamped, rt, p.dw, p.dh),
    })).value;
    const LMaxRaumecke = stage("lMaxRaumecke", [...geo, p.showRaumecke, extraBreite],
      () => p.showRaumecke ? m.maxLWithRaumecke(rt, p.dw, p.dh, extraBreite, L_MAX) : null).value;
    const LClamped = LMaxForLt !== null && L > LMaxForLt ? LMaxForLt : L;
    const s = stage("s", [...geo, LClamped, LtClamped, round], () => {
      const solution = m.solveHorn(LClamped, LtClamped, rt, p.dw, p.dh);
      return solution && round ? { ...solution, round: true } : solution;
    });
    const sv = s.value;

    // Verrundung des Übergangs Throat → Aufweitung im Seitenriss: Kreisbogen (Radius) oder Klothoide (Länge)
    const fillet = stage("fillet", [s.version, p.filletOn, p.filletClothoidOn, p.hMouth, p.curve, p.hypexT, p.filletR, p.filletClothoidLength],
      () => !sv ? null
        : p.filletOn ? computeFillet(sv, rt, p.hMouth, p.curve, p.hypexT, p.filletR)
        : p.filletClothoidOn ? computeFilletClothoid(sv, rt, p.hMouth, p.curve, p.hypexT, p.filletClothoidLength) : null);
    const profile = stage("profile", [s.version, fillet.version, p.hMouth, p.curve, p.hypexT],
      () => sv && makeProfile(sv, rt, p.hMouth, p.curve, p.hypexT, fillet.value));
    // Eckradius entlang der Wand: Übergang rund → eckig am Throat, auf das Machbare begrenzt, und/oder
    // Ecken am Mund gerundet (mouthRounding hängt am Profil)
    const morph = stage("morph", [s.version, p.morphOn, p.morphLength, p.mouthRoundOn, p.mouthRoundOn ? profile.version : 0, p.mouthRoundR], () => {
      const throat = p.morphOn && sv ? throatMorph(sv, rt, p.morphLength) : null;
      return p.mouthRoundOn && sv ? mouthRounding(sv, profile.value, throat, p.mouthRoundR) : throat;
    });

    const wall = p.showWandstaerke ? p.wandstaerke : 0;
    // gerundete Längskanten außen: Radius höchstens die Wandstärke (sonst würde die Wand an der Ecke dünner)
    const edge = wall > 0 && p.edgeOn ? Math.min(p.edgeR ?? wall, wall) : 0;
    // Flansch nur an der Schale; Ø und Lochkreis werden gegen den Außenkörper aufgelöst
    const flange = stage("flange", [profile.version, morph.version, wall, edge, p.flangeOn, p.flangeD, p.dw, p.flangeT,
      p.holeCount, p.holeCircle, p.holeD, p.holeAngle, p.ribsOn, p.ribThickness, p.ribLength, p.roundOn, p.roundR], () => sv && wall > 0 && p.flangeOn ? layoutFlange(sv, rt, profile.value, fillet.value, wall, {
      diameter: p.flangeD, fallback: p.dw, thickness: p.flangeT,
      holes: { count: p.holeCount, circle: p.holeCircle, diameter: p.holeD, angle: p.holeAngle },
      ribs: p.ribsOn ? { thickness: p.ribThickness, length: p.ribLength } : null,
      round: p.roundOn ? p.roundR : 0,
    }, edge, morph.value) : null);

    // Lamellen nur an der Schale des Radialhorns; Beginn und Ende werden gegen die Lösung aufgelöst und begrenzt
    const vanes = stage("vanes", [s.version, wall, round, p.vanesOn, p.vaneCount, p.vaneThickness, p.vaneStartMode, p.vaneStart, p.vaneEndMode, p.vaneEnd, p.vaneTipStart, p.vaneTipEnd, p.vaneTipLength,
      p.vaneStagger, p.vaneStages, p.vaneStageMode, p.vaneStageChannel, p.vaneStageZ1, p.vaneStageZ2, p.vaneStageZ3],
      () => sv && wall > 0 && !round && p.vanesOn ? resolveVanes(sv, {
        count: p.vaneCount, thickness: p.vaneThickness,
        start: { mode: p.vaneStartMode, value: p.vaneStart }, end: { mode: p.vaneEndMode, value: p.vaneEnd },
        tip: { start: p.vaneTipStart, end: p.vaneTipEnd, length: p.vaneTipLength },
        stagger: p.vaneStagger ? { stages: p.vaneStages, mode: p.vaneStageMode, channel: p.vaneStageChannel, z: [p.vaneStageZ1, p.vaneStageZ2, p.vaneStageZ3] } : null,
      }) : null);

    // Schalen-Umrisse der Ansichten (Schnitt durch die Wand), ab der Flanschebene
    const zShell = flange.value ? flange.value.thickness : 0;
    const shellOuter = stage("shellOuter", [s.version, wall, zShell],
      () => sv && wall > 0 ? shellPlanOutline(sv, rt, wall, zShell) : null);
    const shellCut = stage("shellCut", [profile.version, wall, zShell, round], () => sv && wall > 0 && !round ? {
      inner: linspace(zShell, sv.zApex, 300).map(z => [profile.value(z), z]),
      outer: shellProfileOutline(sv, rt, profile.value, wall, zShell),
    } : null);

    const stages = { s, fillet, morph, flange, vanes, shellOuter, shellCut };
    return {
      params: input,
      values: {
        ...Object.fromEntries(VERSIONED.map(k => [k, stages[k].value])),
        // Längen angezeigt (ohne Raumecke ab der Treiberrückseite); LMaxRaumecke nur mit Raumecke, dort ist off = 0
        LtMin, LtMax: LtMaxAll, LtClamped, LtMinClothoid, LMaxRaumecke, Lmin: Lmin - off, Lmax: LMaxRaumecke ?? L_MAX,
        LClamped: LClamped - off, wall, edge,
        warnings: {
          raumecke:  LMaxRaumecke !== null && LMaxRaumecke < L_MAX && p.L >= LMaxRaumecke - 1,
          ltMax:     p.Lt > LtMaxAll,
          ltFollows: LtMinRaumecke !== null && LtMinRaumecke >= LtMinClothoid && p.Lt < LtMinRaumecke - 1e-6,
          clothoid:  LtMinClothoid > LtMaxAll ? "zu lang" : p.Lt < LtMinClothoid ? "Lt" : null,
          // Kreisbogen ohne zulässige Traktrix-Länge (Radius zu klein für den Winkel): keine Traktrix
          arcNone:   blendArc > 0 && blendLimits.max <= 0,
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
