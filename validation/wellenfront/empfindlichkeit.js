// Empfindlichkeit des Frequenzgangs auf die Form der Wellenfront im Flächenmodell S(x).
//   npm run wellenfront
// Die App nimmt überall den Voigt-Bogen (crossSection). Hier wird die Wölbung stetig verringert:
// Kreisbogen durch dieselben Wandpunkte (±xWall, zWall) mit Pfeilhöhe κ·f_Voigt – κ = 1 ist das
// App-Modell, κ = 0 die ebene Wellenfront zwischen den Wandpunkten. Lage auf der Achse = Scheitel
// des Bogens, Fläche = ∫ 2h ds mit der Höhe nach der 3D-Regel. Verglichen wird
//   - im ganzen Horn eben,
//   - nur im Eingang (Traktrix/Klothoide) eben bzw. halb gewölbt, hinter dem Übergang über 60 mm
//     stetig zurück auf Voigt (ein Sprung in S(x) wäre ein Artefakt, keine Modellunsicherheit).
// Ausgabe je Band: größte Abweichung im SPL (mit Frequenz), Median, Maximum nach ⅓-Oktav-Glättung.
// Ergebnis (2026-10-13) in CLAUDE.md unter „Wellenfront – Modellgrenzen“.
import { createHornMath, makeProfile, computeFillet, crossSection, wallPoint, focusRadius } from "../../src/horn-math.js";
import { airAt, driverSI, logFrequencies, simulate, areaCurve, PLACEHOLDER_DRIVER } from "../../src/simulation.js";

const DESIGNS = {
  "Standard (L 500, Lₜ 60, exp)":   { angle: 140, L: 500, Lt: 60,    throat: 50.8, hMouth: 200, curve: "exponential", hypexT: 0.5, fillet: 0,   clothoid: 0 },
  "L 700, Lₜ 132, Klothoide, Verr.": { angle: 140, L: 700, Lt: 132.3, throat: 50.8, hMouth: 200, curve: "hypex",       hypexT: 0.7, fillet: 477, clothoid: 30 },
  "ohne Traktrix (L 500)":          { angle: 140, L: 500, Lt: 0,     throat: 50.8, hMouth: 200, curve: "exponential", hypexT: 0.5, fillet: 0,   clothoid: 0 },
  "lange Traktrix (Lₜ 250)":        { angle: 140, L: 700, Lt: 250,   throat: 50.8, hMouth: 200, curve: "exponential", hypexT: 0.5, fillet: 0,   clothoid: 0 },
};
const DW = 182, DH = 90;
const BANDS = [[20, 200], [200, 2000], [2000, 20000]];
const RAMP = 60;   // Rückkehr auf Voigt hinter dem Übergang [mm]
const FREQS = logFrequencies(20, 20000, 24);
const AIR = airAt(20);
const DRIVER = driverSI({ ...PLACEHOLDER_DRIVER, Sd: 60 }, AIR.rho);

/** Simpson über [a, b] mit m (gerade) Schritten. */
function simpson(f, a, b, m = 200) {
  let sum = 0;
  for (let j = 0; j <= m; j++) sum += (j === 0 || j === m ? 1 : j % 2 ? 4 : 2) * f(a + (b - a) * j / m);
  return sum * (b - a) / m / 3;
}

/** Flächenkurve { x [m], S [m²] } mit Wölbung kappaAt(zWall) ∈ [0, 1]. */
function curveFor(s, rt, profile, kappaAt, n = 700) {
  const h = (x, z) => profile(s.zFocus + focusRadius(s, x, z));
  const walls = Array.from({ length: n + 1 }, (_, i) => s.zMouth * i / n);
  const voigt = crossSection(s, profile, 0, walls).filter(p => p.zWall > 0);
  const x = [0], S = [2 * rt * 2 * profile(0) * 1e-6];   // ebener Hals wie areaCurve
  for (const { z: zApex, zWall } of voigt) {
    const xW = wallPoint(s, profile, zWall).xWall;
    const f = kappaAt(zWall) * (zApex - zWall);   // Pfeilhöhe
    let A;
    if (f < 1e-9) A = simpson(xx => 2 * h(xx, zWall), -xW, xW);
    else {
      const R = (xW * xW + f * f) / (2 * f), zc = zWall + f - R, th = Math.asin(Math.min(1, xW / R));
      A = R * simpson(t => 2 * h(R * Math.sin(t), zc + R * Math.cos(t)), -th, th);
    }
    const xa = (zWall + f) * 1e-3;
    if (xa <= x.at(-1) + 1e-12) continue;
    x.push(xa);
    S.push(A * 1e-6);
  }
  return { x, S };
}

const run = curve => simulate({ curve, air: AIR, driver: DRIVER, mouth: "2pi", freqs: FREQS }).spl;
const smooth = spl => FREQS.map(f => {
  const idx = FREQS.map((_, j) => j).filter(j => Math.abs(Math.log2(FREQS[j] / f)) <= 1 / 6);
  return idx.reduce((a, j) => a + spl[j], 0) / idx.length;
});
const stats = (a, b) => BANDS.map(([lo, hi]) => {
  const idx = FREQS.map((_, i) => i).filter(i => FREQS[i] >= lo && FREQS[i] <= hi);
  const d = idx.map(i => Math.abs(a[i] - b[i]));
  const sa = smooth(a), sb = smooth(b), ds = idx.map(i => Math.abs(sa[i] - sb[i]));
  const iMax = idx[d.indexOf(Math.max(...d))];
  const median = [...d].sort((p, q) => p - q)[d.length >> 1];
  return `max ${Math.max(...d).toFixed(1)} dB @${Math.round(FREQS[iMax])} Hz, Median ${median.toFixed(1)}, ⅓-Okt. ${Math.max(...ds).toFixed(1)}`;
});

for (const [name, d] of Object.entries(DESIGNS)) {
  const math = createHornMath(d.angle, { clothoid: d.clothoid });
  const rt = d.throat / 2;
  const s = math.solveHorn(d.L, d.Lt, rt, DW, DH);
  const fillet = d.fillet ? computeFillet(s, rt, d.hMouth, d.curve, d.hypexT, d.fillet) : null;
  const profile = makeProfile(s, rt, d.hMouth, d.curve, d.hypexT, fillet);
  const entrance = k => zW => zW <= s.zTrans ? k : zW >= s.zTrans + RAMP ? 1 : k + (1 - k) * (zW - s.zTrans) / RAMP;

  const voigt = run(curveFor(s, rt, profile, () => 1));
  const check = Math.max(...run(areaCurve(s, rt, profile)).map((v, i) => Math.abs(v - voigt[i])));
  console.log(`\n## ${name}${s.Lt > 0.5 ? ` (Traktrix-Ende z = ${s.zTrans.toFixed(0)} mm)` : ""}`);
  console.log(`  Kontrolle κ = 1 gegen areaCurve der App: ${check.toFixed(2)} dB`);
  for (const [label, kappa] of [["überall eben     ", () => 0], ["nur Eingang eben ", entrance(0)], ["nur Eingang ½    ", entrance(0.5)]]) {
    console.log(`  Voigt ↔ ${label} ${stats(voigt, run(curveFor(s, rt, profile, kappa))).join("  |  ")}`);
  }
}
console.log(`\nBänder: ${BANDS.map(([a, b]) => `${a}–${b} Hz`).join(" | ")}; Abstrahlung 2π, Platzhalter-Treiber (Sd 60 cm²)`);
