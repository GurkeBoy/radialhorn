// DXF-Export der Konstruktionskurven (Einheit mm, nur ENTITIES-Sektion).
//
// Koordinaten: Draufsicht in der XY-Ebene (X = Achse z, Y = Breite x), Seitenprofil in
// der XZ-Ebene (X = Achse z, Z = Höhe h). Kurven werden als exakte Entities geschrieben –
// Traktrix und gekrümmte Aufweitung als SPLINE, Geraden als LINE, Kreisbögen als ARC –,
// damit CAD-Systeme glatte Körper daraus erzeugen.
import { hasTraktrix, hasClothoid, traktrixPoints, clothoidPoints, makeProfile } from "../horn-math.js";
import { linspace } from "../utils.js";
import { fitBSpline } from "./bspline.js";
import { downloadFile } from "./download.js";

const TRAKTRIX_FIT_POINTS = 80;    // Stützpunkte für den Spline-Fit (Fit ist O(n³))
const CLOTHOID_FIT_POINTS = 40;
const FLARE_FIT_POINTS    = 100;

const num = v => v.toFixed(4);

export function dxfSpline(pts, layer) {
  const fit = fitBSpline(pts);
  if (!fit) return "";
  const { degree, knots, controlPoints, fitPoints } = fit;
  let s = `0\nSPLINE\n8\n${layer}\n100\nAcDbSpline\n210\n0\n220\n0\n230\n1\n`;
  s += `70\n8\n71\n${degree}\n72\n${knots.length}\n73\n${controlPoints.length}\n74\n${fitPoints.length}\n`;
  for (const k of knots) s += `40\n${k.toFixed(8)}\n`;
  for (const cp of controlPoints) s += `10\n${num(cp[0])}\n20\n${num(cp[1])}\n30\n${num(cp[2] || 0)}\n`;
  for (const fp of fitPoints) s += `11\n${num(fp[0])}\n21\n${num(fp[1])}\n31\n${num(fp[2] || 0)}\n`;
  return s;
}

export function dxfLine(p1, p2, layer) {
  return `0\nLINE\n8\n${layer}\n10\n${num(p1[0])}\n20\n${num(p1[1])}\n30\n${num(p1[2] || 0)}\n11\n${num(p2[0])}\n21\n${num(p2[1])}\n31\n${num(p2[2] || 0)}\n`;
}

/**
 * Kreisbogen, Winkel in Grad gegen den Uhrzeigersinn um die Extrusionsrichtung.
 * normal: Extrusionsrichtung (OCS). Für Bögen im Seitenprofil (Ebene y = 0) wird (0,-1,0)
 * verwendet: nach dem Arbitrary-Axis-Algorithmus ist dann OCS-x = Welt-X und
 * OCS-y = Welt-Z, Mittelpunkt und Winkel also direkt in (z, h) angebbar.
 */
export function dxfArc(cx, cy, r, startDeg, endDeg, layer, normal = null) {
  const ext = normal ? `210\n${normal[0]}\n220\n${normal[1]}\n230\n${normal[2]}\n` : "";
  return `0\nARC\n8\n${layer}\n100\nAcDbCircle\n10\n${num(cx)}\n20\n${num(cy)}\n30\n0\n40\n${num(r)}\n${ext}100\nAcDbArc\n50\n${num(startDeg)}\n51\n${num(endDeg)}\n`;
}

/**
 * Kreis; normal wie bei dxfArc. Für die Flanschebene X = const wird (1,0,0) verwendet:
 * dann ist OCS-x = Welt-Y (Breite), OCS-y = Welt-Z (Höhe) und elevation = Welt-X.
 */
export function dxfCircle(cx, cy, r, layer, normal = null, elevation = 0) {
  const ext = normal ? `210
${normal[0]}
220
${normal[1]}
230
${normal[2]}
` : "";
  return `0
CIRCLE
8
${layer}
100
AcDbCircle
10
${num(cx)}
20
${num(cy)}
30
${num(elevation)}
40
${num(r)}
${ext}`;
}

export function dxfPoint(x, y, z, layer) {
  return `0\nPOINT\n8\n${layer}\n10\n${num(x)}\n20\n${num(y)}\n30\n${num(z)}\n`;
}

export const dxfDocument = entities => `0\nSECTION\n2\nENTITIES\n${entities.join("")}0\nENDSEC\n0\nEOF\n`;

/**
 * Erzeugt den DXF-Text.
 * @param design  { s, rt, hMouth, curve, hypexT, fillet, flange }
 * @param opts    Layer-Auswahl { draufsicht, mundbogen, fokus, seitenprofil, uebergang, flansch }
 */
export function buildDXF({ s, rt, hMouth, curve, hypexT, fillet, flange = null }, opts) {
  const out = [];
  const mirrored = fn => [1, -1].forEach(fn);

  if (opts.draufsicht) {
    const trak = traktrixPoints(s, TRAKTRIX_FIT_POINTS);
    const klo = clothoidPoints(s, CLOTHOID_FIT_POINTS);
    mirrored(sign => {
      if (trak.length > 1) out.push(dxfSpline(trak.map(([x, z]) => [z, sign * x]), "Draufsicht_Wand"));
      if (klo.length > 1) out.push(dxfSpline(klo.map(([x, z]) => [z, sign * x]), "Draufsicht_Wand"));
      out.push(dxfLine([s.zTrans, sign * s.xTrans], [s.zMouth, sign * s.xMouth], "Draufsicht_Wand"));
    });
  }
  if (opts.mundbogen) {
    const a = s.alpha2 * 180 / Math.PI;
    out.push(dxfArc(s.zFocus, 0, s.arcR, -a, a, "Mundbogen"));
  }
  if (opts.fokus) out.push(dxfPoint(s.zFocus, 0, 0, "Fokus"));

  if (opts.seitenprofil) {
    // Mit Verrundung endet der Throat an T1, die Aufweitung beginnt an T2, dazwischen ein ARC
    const throatEnd = fillet ? fillet.zT1 : s.zInnerApex;
    const zFrom = fillet ? fillet.zT2 : (hasTraktrix(s) ? s.zInnerApex : 0);
    const profile = makeProfile(s, rt, hMouth, curve, hypexT);
    const flare = linspace(zFrom, s.zApex, FLARE_FIT_POINTS).map(z => [z, profile(z)]);
    if (fillet) {
      const a2 = Math.atan2(fillet.hT2 - fillet.hc, fillet.zT2 - fillet.zc) * 180 / Math.PI;   // −90° … 0°
      out.push(dxfArc(fillet.zc,  fillet.hc, fillet.R, 270, 360 + a2, "Seitenprofil_Verrundung", [0, -1, 0]));
      out.push(dxfArc(fillet.zc, -fillet.hc, fillet.R, -a2, 90,       "Seitenprofil_Verrundung", [0, -1, 0]));
    }
    if (hasTraktrix(s)) {
      mirrored(sign => out.push(dxfLine([0, 0, sign * rt], [throatEnd, 0, sign * rt], "Seitenprofil_Throat")));
    }
    mirrored(sign => {
      const pts3d = flare.map(([z, h]) => [z, 0, sign * h]);
      out.push(curve === "linear"
        ? dxfLine(pts3d[0], pts3d[pts3d.length - 1], "Seitenprofil_Flare")
        : dxfSpline(pts3d, "Seitenprofil_Flare"));
    });
  }

  if (opts.uebergang && hasTraktrix(s)) {
    const points = [
      [0, rt, 0], [s.zTrans, s.xTrans, 0],                 // Draufsicht: Throat, Eingang → gerade Wand
      ...(hasClothoid(s) ? [[s.clothoid.start[1], s.clothoid.start[0], 0]] : []),   // Traktrix → Klothoide
      [0, 0, rt], [s.zInnerApex, 0, rt],                   // Seitenprofil: Throat, Throat → Aufweitung
      ...(fillet ? [[fillet.zT1, 0, rt], [fillet.zT2, 0, fillet.hT2]] : []),   // Tangentenpunkte der Verrundung
      [s.zMouth, s.xMouth, 0], [s.zApex, 0, hMouth / 2],   // Mund
    ];
    // jeweils beide Seiten: Draufsicht spiegelt y, Seitenprofil spiegelt z
    for (const [x, y, z] of points) mirrored(sign => out.push(dxfPoint(x, sign * y, sign * z, "Uebergang")));
  }
  // Flansch: Rückseite (X = 0) mit quadratischer Throat-Öffnung und Bohrungen, Vorderseite
  // (X = Dicke) als Außenkreis – in der Ebene quer zur Achse (Y = Breite, Z = Höhe)
  if (opts.flansch && flange) {
    const X = [1, 0, 0], r = flange.diameter / 2;
    out.push(dxfCircle(0, 0, r, "Flansch", X, 0), dxfCircle(0, 0, r, "Flansch", X, flange.thickness));
    const sq = [[rt, rt], [-rt, rt], [-rt, -rt], [rt, -rt]];
    sq.forEach(([y, z], i) => out.push(dxfLine([0, y, z], [0, ...sq[(i + 1) % 4]], "Flansch")));
    for (const [y, z] of flange.centers) out.push(dxfCircle(y, z, flange.holes.diameter / 2, "Flansch", X, 0));
    // Bohrungen im Konflikt mit der Schale: gleiches Bohrbild, eigener Layer
    for (const [y, z] of flange.conflicts ?? []) out.push(dxfCircle(y, z, flange.holes.diameter / 2, "Flansch_Konflikt", X, 0));
  }
  return dxfDocument(out);
}

export function exportDXF(design, opts) {
  const { s, rt } = design;
  const fname = `radialhorn_${Math.round(s.openingAngle)}deg_L${Math.round(s.zApex - s.hatTipZ)}_T${(rt * 2).toFixed(0)}mm.dxf`;
  downloadFile(buildDXF(design, opts), fname, "application/dxf");
}
