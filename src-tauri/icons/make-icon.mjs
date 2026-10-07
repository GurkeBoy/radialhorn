// App-Icon aus der echten Geometrie: Draufsicht eines Radialhorns (Traktrix rosa, gerade Wand mint,
// Mundbogen sand, Treiber grau) auf dunklem Grund, Farben wie in den Zeichnungen (theme.js).
//   node src-tauri/icons/make-icon.mjs   → src-tauri/icons/icon.svg (1024 × 1024)
// Daraus die Icons aller Plattformen: PNG rendern (1024 px) und `npx tauri icon <png>`.
import { writeFileSync } from "node:fs";
import { solveHorn, traktrixPoints, linearWallPoints } from "../../src/horn-math.js";
import { COLOR, UI } from "../../src/theme.js";

const SIZE = 1024, MARGIN = 120;
const dw = 182, dh = 90;
const s = solveHorn(500, 60, 25.4, dw, dh);

// Geometrie [x, z] (z nach unten = Hornachse), Treiber oberhalb z = 0
const trak = traktrixPoints(s, 60);
const wall = linearWallPoints(s, 20);
const arc = Array.from({ length: 61 }, (_, i) => {
  const a = -s.alpha2 + 2 * s.alpha2 * i / 60;
  return [s.arcR * Math.sin(a), s.zFocus + s.arcR * Math.cos(a)];
});
const zTop = -dh, zBottom = s.zApex, xMax = Math.max(s.xMouth, dw / 2);
const scale = (SIZE - 2 * MARGIN) / Math.max(2 * xMax, zBottom - zTop);
const ox = SIZE / 2, oy = SIZE / 2 - (zTop + zBottom) / 2 * scale;
const P = ([x, z]) => `${(ox + x * scale).toFixed(1)},${(oy + z * scale).toFixed(1)}`;
const mirror = pts => pts.map(([x, z]) => [-x, z]);
const path = pts => "M" + pts.map(P).join(" L");

// Innenfläche: rechte Kontur hinunter, Mundbogen, linke Kontur hinauf
const outline = [...trak, ...wall.slice(1), ...[...arc].reverse(), ...[...mirror(wall)].reverse().slice(1), ...[...mirror(trak)].reverse()];
const stroke = 20;   // wie der Rahmen des Treibers
const line = (pts, color) => `<path d="${path(pts)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`;
const [dx, dy] = [ox - dw / 2 * scale, oy + zTop * scale];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${COLOR.horn}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${COLOR.arc}" stop-opacity="0.50"/>
    </linearGradient>
  </defs>
  <rect x="24" y="24" width="${SIZE - 48}" height="${SIZE - 48}" rx="200" fill="${UI.panel}" stroke="${UI.borderControl}" stroke-width="8"/>
  <rect x="${dx.toFixed(1)}" y="${dy.toFixed(1)}" width="${(dw * scale).toFixed(1)}" height="${(dh * scale).toFixed(1)}" rx="22" fill="${COLOR.drivPlan}" stroke="${COLOR.driv}" stroke-width="20"/>
  <path d="${path(outline)} Z" fill="url(#fill)"/>
  ${line(wall, COLOR.horn)}
  ${line(mirror(wall), COLOR.horn)}
  ${line(arc, COLOR.arc)}
  ${line(trak, COLOR.trak)}
  ${line(mirror(trak), COLOR.trak)}
</svg>
`;
writeFileSync(new URL("icon.svg", import.meta.url), svg);
console.log("icon.svg geschrieben");
