// 3D-Ansicht des Luftvolumens mit three.js: Drehen/Zoomen/Verschieben (OrbitControls),
// Flächen oder Gitter, optional Treiber und Raumecke als Bezug.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildHornGeometry, buildShellGeometry, triangulate, gridLines } from "../horn-mesh.js";
import { COLOR, FONT, UI } from "../theme.js";
import { useSize } from "../hooks.js";

const SECTION_COLOR = { traktrix: COLOR.trak, linear: COLOR.horn, rim: COLOR.wand };

/** Dreiecke bzw. Strecken [p, …] als BufferGeometry (Punkte [x, h, z]). */
function bufferGeometry(items) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(items.flat(2), 3));
  return g;
}

/** Horn als Gruppe: je Sektion Flächen und Gitterlinien (Kappen des Luftvolumens werden nicht gezeigt). */
function hornGroup(geometry) {
  const group = new THREE.Group();
  for (const section of Object.keys(SECTION_COLOR)) {
    const surfaces = geometry.surfaces.filter(f => f.section === section);
    if (!surfaces.length) continue;
    const faces = bufferGeometry(surfaces.flatMap(triangulate));
    faces.computeVertexNormals();
    const mesh = new THREE.Mesh(faces, new THREE.MeshStandardMaterial({
      color: SECTION_COLOR[section], side: THREE.DoubleSide, roughness: 0.75, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    mesh.userData.kind = "faces";
    const lines = new THREE.LineSegments(bufferGeometry(surfaces.flatMap(gridLines)),
      new THREE.LineBasicMaterial({ color: SECTION_COLOR[section], transparent: true, opacity: 0.8 }));
    lines.userData.kind = "grid";
    group.add(mesh, lines);
  }
  return group;
}

/** Treiber (Zylinder Ø dw, Länge dh, Achse = Hornachse z) und Raumecken-Wände als halbtransparenter Bezug. */
function referenceGroup(s, dw, dh, hMouth, showRaumecke) {
  const group = new THREE.Group();
  const cylinder = new THREE.CylinderGeometry(dw / 2, dw / 2, dh, 64);
  cylinder.rotateX(Math.PI / 2);                 // three.js-Zylinder liegen auf Y, die Hornachse ist Z
  const driver = new THREE.Mesh(cylinder,
    new THREE.MeshStandardMaterial({ color: COLOR.driv, transparent: true, opacity: 0.35 }));
  driver.position.set(0, 0, -dh / 2);
  group.add(driver);
  if (showRaumecke) {
    const halfMax = Math.max(dw / 2, hMouth / 2) * 1.05;
    const endX = dw / 2 + (s.zApex + dh);
    for (const sign of [1, -1]) {
      const wall = bufferGeometry([
        [[0, -halfMax, s.hatTipZ], [sign * endX, -halfMax, s.zApex], [sign * endX, halfMax, s.zApex]],
        [[0, -halfMax, s.hatTipZ], [sign * endX, halfMax, s.zApex], [0, halfMax, s.hatTipZ]],
      ]);
      wall.computeVertexNormals();
      group.add(new THREE.Mesh(wall, new THREE.MeshStandardMaterial({
        color: COLOR.raum, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
      })));
    }
  }
  return group;
}

function disposeGroup(group) {
  group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
}

/** Kamera so setzen, dass das Horn schräg von vorn oben vollständig zu sehen ist. */
function frame(camera, controls, object) {
  const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
  // Abstand mit Reserve: durch die Perspektive wirken die kameranahen Mundecken größer
  const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.45;
  const dir = new THREE.Vector3(0.8, 1.0, 1.2).normalize();
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.near = dist / 100;
  camera.far = dist * 10;
  camera.updateProjectionMatrix();
  controls.update();
}

/**
 * @param profile  z ↦ halbe Höhe inkl. Verrundung (makeProfile)
 * @param wall     Wandstärke [mm]; 0 zeigt das Luftvolumen, > 0 die Schale
 */
export function Ansicht3D({ s, rt, dw, dh, hMouth, profile, fillet, wall, showRaumecke }) {
  const containerRef = useRef(null);
  const { w, h } = useSize(containerRef);
  const three = useRef(null);
  const [wireframe, setWireframe] = useState(false);
  const [showReference, setShowReference] = useState(true);

  const geometry = useMemo(() => s && (wall > 0
    ? buildShellGeometry(s, rt, profile, fillet, wall)
    : buildHornGeometry(s, rt, profile, fillet)), [s, rt, profile, fillet, wall]);

  // Szene, Kamera, Renderer und Steuerung einmalig anlegen
  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(UI.panel);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    // Zeichnen nur bei Bedarf (Kamerabewegung, Geometrie, Größe, Darstellung) statt Dauerschleife
    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);
    three.current = { renderer, scene, camera, controls, render, horn: null, reference: null, framed: false };
    return () => {
      controls.removeEventListener("change", render);
      controls.dispose();
      for (const g of [three.current.horn, three.current.reference]) if (g) disposeGroup(g);
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // Größe
  useEffect(() => {
    const t = three.current;
    if (!t || w < 10 || h < 10) return;
    t.renderer.setSize(w, h);
    t.camera.aspect = w / h;
    t.camera.updateProjectionMatrix();
    t.render();
  }, [w, h]);

  // Horn und Bezug neu aufbauen, wenn sich die Geometrie ändert
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    for (const key of ["horn", "reference"]) {
      if (t[key]) { t.scene.remove(t[key]); disposeGroup(t[key]); t[key] = null; }
    }
    if (!geometry) return;
    t.horn = hornGroup(geometry);
    t.reference = referenceGroup(s, dw, dh, hMouth, showRaumecke);
    t.scene.add(t.horn, t.reference);
    if (!t.framed) { frame(t.camera, t.controls, t.horn); t.framed = true; }
    t.render();
  }, [geometry, s, dw, dh, hMouth, showRaumecke]);

  // Darstellung umschalten
  useEffect(() => {
    const t = three.current;
    if (!t?.horn) return;
    t.horn.traverse(o => {
      if (o.userData.kind === "faces") o.visible = !wireframe;
      if (o.userData.kind === "grid") o.visible = wireframe;
    });
    t.reference.visible = showReference;
    t.render();
  }, [geometry, wireframe, showReference]);

  const resetView = () => {
    const t = three.current;
    if (t?.horn) { frame(t.camera, t.controls, t.horn); t.render(); }
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 10, left: 0, right: 0, textAlign: "center", fontSize: 9, color: COLOR.text, fontFamily: FONT, letterSpacing: "0.12em", pointerEvents: "none" }}>
        {wall > 0 ? `3D · SCHALE · WANDSTÄRKE ${wall} MM` : "3D · LUFTVOLUMEN"}
      </div>
      <div style={{ position: "absolute", top: 6, right: 36, zIndex: 10, display: "flex", gap: 4 }}>
        <ViewButton active={wireframe} onClick={() => setWireframe(v => !v)} title="Flächen / Gitter">▦ Gitter</ViewButton>
        <ViewButton active={showReference} onClick={() => setShowReference(v => !v)} title="Treiber und Raumecke einblenden">▭ Bezug</ViewButton>
        <ViewButton onClick={resetView} title="Ansicht zurücksetzen">⟲ Reset</ViewButton>
      </div>
      {!s && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: COLOR.trans, fontSize: 12, fontFamily: FONT }}>⚠ Parameter ungültig</div>}
    </div>
  );
}

function ViewButton({ active, onClick, title, children }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={active} style={{
      background: UI.overlay, border: `1px solid ${active ? UI.accent : UI.borderControl}`, borderRadius: 4,
      color: active ? UI.accent : UI.muted, fontFamily: FONT, fontSize: 10, height: 24, padding: "0 7px", cursor: "pointer",
    }}>{children}</button>
  );
}
