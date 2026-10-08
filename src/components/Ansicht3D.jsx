// 3D-Ansicht (Luftvolumen oder Schale) mit three.js: Drehen/Zoomen/Verschieben (OrbitControls),
// Flächen oder Gitter, optional Treiber und Raumecke als Bezug. Das Netz entsteht in einem Web
// Worker (mesh.worker.js), damit Slider und 2D-Ansichten beim Neuaufbau flüssig bleiben.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { COLOR, FONT, UI } from "../theme.js";
import { useSize } from "../hooks.js";

const SECTION_COLOR = { traktrix: COLOR.trak, klothoide: COLOR.klo, linear: COLOR.horn, rim: COLOR.wand, flansch: COLOR.flansch };

/** Dreiecke bzw. Strecken [p, …] als BufferGeometry (Punkte [x, h, z]). */
function bufferGeometry(items) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(items.flat(2), 3));
  return g;
}

/**
 * Horn als Gruppe aus den Puffern des Workers: je Sektion Flächen und Gitterlinien (Kappen des
 * Luftvolumens werden nicht angefordert).
 */
function hornGroup(sections) {
  const group = new THREE.Group();
  for (const { section, positions, normals, lines } of sections) {
    const faces = new THREE.BufferGeometry();
    faces.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    faces.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    const mesh = new THREE.Mesh(faces, new THREE.MeshStandardMaterial({
      color: SECTION_COLOR[section], side: THREE.DoubleSide, roughness: 0.75, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    mesh.userData.kind = "faces";
    const grid = new THREE.BufferGeometry();
    grid.setAttribute("position", new THREE.BufferAttribute(lines, 3));
    const gridMesh = new THREE.LineSegments(grid,
      new THREE.LineBasicMaterial({ color: SECTION_COLOR[section], transparent: true, opacity: 0.8 }));
    gridMesh.userData.kind = "grid";
    group.add(mesh, gridMesh);
  }
  return group;
}

/**
 * Netz im Web Worker bauen lassen. Es läuft höchstens eine Berechnung; Eingaben, die währenddessen
 * eintreffen, ersetzen einander, und nur die jeweils neueste wird danach gerechnet. Liefert die
 * Sektionen der zuletzt fertigen Berechnung (null ohne gültige Eingabe).
 */
function useMeshWorker(input) {
  const [sections, setSections] = useState(null);
  const state = useRef(null);
  useEffect(() => {
    const worker = new Worker(new URL("../mesh.worker.js", import.meta.url), { type: "module" });
    const st = { worker, busy: false, pending: undefined, wanted: null };
    st.send = inp => { st.busy = true; worker.postMessage({ input: inp }); };
    worker.onmessage = ({ data }) => {
      st.busy = false;
      if (data.error) console.error("3D-Netz:", data.error);
      if (st.pending !== undefined) {                 // inzwischen neuere Eingabe: die zuerst rechnen
        const next = st.pending;
        st.pending = undefined;
        if (next) { st.send(next); return; }
      }
      setSections(st.wanted ? data.sections ?? null : null);
    };
    state.current = st;
    return () => { worker.terminate(); state.current = null; };
  }, []);
  useEffect(() => {
    const st = state.current;
    if (!st) return;
    st.wanted = input;
    if (!input) { if (st.busy) st.pending = null; return; }
    if (st.busy) st.pending = input;
    else st.send(input);
  }, [input]);
  return input ? sections : null;
}

/**
 * Treiber (Zylinder Ø dw, Länge dh, Achse = Hornachse z, deckend) und Raumecken-Wände
 * (halbtransparent) als Bezug, einzeln ein- und ausblendbar (userData.kind "driver" / "corner"). Die Wände reichen
 * doppelt so weit nach oben und unten wie das höchste Teil (Treiber, Mund samt Wandstärke,
 * Flansch) – sie sollen als Wand lesbar sein, nicht als Rahmen ums Horn.
 * @param top  halbe Höhe des höchsten Teils über der Achse [mm]
 */
function referenceGroup(s, dw, dh, top, showRaumecke) {
  const group = new THREE.Group();
  const cylinder = new THREE.CylinderGeometry(dw / 2, dw / 2, dh, 64);
  cylinder.rotateX(Math.PI / 2);                 // three.js-Zylinder liegen auf Y, die Hornachse ist Z
  const driver = new THREE.Mesh(cylinder,
    new THREE.MeshStandardMaterial({ color: COLOR.driv }));
  driver.position.set(0, 0, -dh / 2);
  driver.userData.kind = "driver";
  group.add(driver);
  if (showRaumecke) {
    const halfMax = 2 * top;
    const endX = dw / 2 + (s.zApex + dh);
    for (const sign of [1, -1]) {
      const wall = bufferGeometry([
        [[0, -halfMax, s.hatTipZ], [sign * endX, -halfMax, s.zApex], [sign * endX, halfMax, s.zApex]],
        [[0, -halfMax, s.hatTipZ], [sign * endX, halfMax, s.zApex], [0, halfMax, s.hatTipZ]],
      ]);
      wall.computeVertexNormals();
      const mesh = new THREE.Mesh(wall, new THREE.MeshStandardMaterial({
        color: COLOR.raum, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
      }));
      mesh.userData.kind = "corner";
      group.add(mesh);
    }
  }
  return group;
}

/**
 * Bohrungen, die nicht gebohrt werden können (in der Schale): rote Scheibe mit Ring auf der
 * Flanschrückseite und Ring an der Vorderseite, damit das Bohrbild trotzdem sichtbar ist.
 */
function conflictGroup(flange) {
  const group = new THREE.Group();
  if (!flange?.conflicts.length) return group;
  const material = new THREE.MeshBasicMaterial({ color: COLOR.konflikt, side: THREE.DoubleSide });
  const lineMaterial = new THREE.LineBasicMaterial({ color: COLOR.konflikt });
  const r = flange.holes.diameter / 2;
  for (const [x, h] of flange.conflicts) {
    const disk = new THREE.Mesh(new THREE.CircleGeometry(r, 32), material);
    disk.position.set(x, h, -0.05);              // knapp vor der Rückseite (z = 0)
    group.add(disk);
    for (const z of [-0.1, flange.thickness]) {
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 48 }, (_, k) => new THREE.Vector3(
          x + r * 1.3 * Math.cos(2 * Math.PI * k / 48), h + r * 1.3 * Math.sin(2 * Math.PI * k / 48), z))), lineMaterial);
      group.add(ring);
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
 * @param curve, hypexT, fillet  Seitenprofil (der Worker baut daraus makeProfile nach)
 * @param wall     Wandstärke [mm]; 0 zeigt das Luftvolumen, > 0 die Schale
 * @param edgeR    Radius der gerundeten Längskanten außen [mm], 0 = scharf
 * @param flange   aufgelöster Throat-Flansch (flangeLayout) oder null, nur mit Schale
 * @param morph    Übergang rund → eckig am Throat (throatMorph) oder null
 */
export const Ansicht3D = memo(function Ansicht3D({ s, rt, dw, dh, hMouth, curve, hypexT, fillet, wall, edgeR = 0, flange, morph = null, showRaumecke }) {
  const tr = useT();
  const containerRef = useRef(null);
  const { w, h } = useSize(containerRef);
  const three = useRef(null);
  const [wireframe, setWireframe] = useState(false);
  const [showDriver, setShowDriver] = useState(true);
  const [showCorner, setShowCorner] = useState(true);

  const meshInput = useMemo(() => s ? {
    s, rt, hMouth, curve, hypexT, fillet, wall, edgeR, morph,
    flange: wall > 0 ? flange : null, sections: Object.keys(SECTION_COLOR),
  } : null, [s, rt, hMouth, curve, hypexT, fillet, wall, edgeR, flange, morph]);
  const sections = useMeshWorker(meshInput);

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
    // Anforderungen innerhalb eines Bildes werden zu einem Zeichenvorgang zusammengefasst
    let frameId = 0;
    const render = () => {
      if (!frameId) frameId = requestAnimationFrame(() => { frameId = 0; renderer.render(scene, camera); });
    };
    controls.addEventListener("change", render);
    three.current = { renderer, scene, camera, controls, render, horn: null, reference: null, conflicts: null, framed: false };
    return () => {
      cancelAnimationFrame(frameId);
      controls.removeEventListener("change", render);
      controls.dispose();
      for (const g of [three.current.horn, three.current.reference, three.current.conflicts]) if (g) disposeGroup(g);
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

  const replace = (t, key, group) => {
    if (t[key]) { t.scene.remove(t[key]); disposeGroup(t[key]); }
    t[key] = group;
    if (group) t.scene.add(group);
  };

  // Horn neu aufbauen, sobald der Worker ein neues Netz liefert
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    replace(t, "horn", sections && hornGroup(sections));
    if (t.horn && !t.framed) { frame(t.camera, t.controls, t.horn); t.framed = true; }
    t.render();
  }, [sections]);

  // Bezug (Treiber, Raumecke) und Konflikt-Bohrungen: sofort, aber nur neu, wenn sich ihre
  // Werte ändern (nicht bei jedem neuen s- oder Flansch-Objekt mit gleichen Maßen)
  const top = Math.max(dw / 2, hMouth / 2 + wall, wall > 0 && flange ? flange.diameter / 2 : 0);
  const referenceKey = s ? JSON.stringify([s.zApex, s.hatTipZ, dw, dh, top, showRaumecke]) : "";
  const conflictKey = wall > 0 && flange ? JSON.stringify([flange.conflicts, flange.holes.diameter, flange.thickness]) : "";
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    replace(t, "reference", referenceKey && referenceGroup(s, dw, dh, top, showRaumecke));
    t.render();
  }, [referenceKey]);   // eslint-disable-line react-hooks/exhaustive-deps -- referenceKey fasst die Werte zusammen
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    replace(t, "conflicts", conflictKey && conflictGroup(flange));
    t.render();
  }, [conflictKey]);    // eslint-disable-line react-hooks/exhaustive-deps -- conflictKey fasst die Werte zusammen

  // Darstellung umschalten
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.horn?.traverse(o => {
      if (o.userData.kind === "faces") o.visible = !wireframe;
      if (o.userData.kind === "grid") o.visible = wireframe;
    });
    t.reference?.children.forEach(o => { o.visible = o.userData.kind === "driver" ? showDriver : showCorner; });
    t.render();
  }, [sections, referenceKey, wireframe, showDriver, showCorner]);

  const resetView = () => {
    const t = three.current;
    if (t?.horn) { frame(t.camera, t.controls, t.horn); t.render(); }
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      {/* Kopfzeile: Titel links (kürzt mit …), Knöpfe rechts neben dem Vollbild-Knopf */}
      <div style={{ position: "absolute", top: 6, left: 12, right: 36, zIndex: 10, display: "flex", alignItems: "center", gap: 8, pointerEvents: "none" }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 9, color: COLOR.text, fontFamily: FONT, letterSpacing: "0.12em" }}>
          {wall > 0 ? tr("view.3dShell", { mm: wall }) : tr("view.3dAir")}
        </span>
        <div style={{ display: "flex", gap: 4, flexShrink: 0, pointerEvents: "auto" }}>
          <ViewButton active={wireframe} onClick={() => setWireframe(v => !v)} title={tr("view.gridTitle")}>{tr("view.grid")}</ViewButton>
          <ViewButton active={showDriver} onClick={() => setShowDriver(v => !v)} title={tr("view.showDriverTitle")}>{tr("view.showDriver")}</ViewButton>
          {showRaumecke && <ViewButton active={showCorner} onClick={() => setShowCorner(v => !v)} title={tr("view.showCornerTitle")}>{tr("view.showCorner")}</ViewButton>}
          <ViewButton onClick={resetView} title={tr("view.resetView")}>{tr("view.reset")}</ViewButton>
        </div>
      </div>
      {!s && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: COLOR.trans, fontSize: 12, fontFamily: FONT }}>{tr("view.invalid")}</div>}
    </div>
  );
});

function ViewButton({ active, onClick, title, children }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={active} style={{
      background: UI.overlay, border: `1px solid ${active ? UI.accent : UI.borderControl}`, borderRadius: 4,
      color: active ? UI.accent : UI.muted, fontFamily: FONT, fontSize: 10, height: 24, padding: "0 7px", cursor: "pointer",
    }}>{children}</button>
  );
}
