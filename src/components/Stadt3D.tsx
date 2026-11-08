// 3D-Stadt für das Dashboard: in der Mitte das KMS HQ mit dem Agenten O.S.A, ringsum ein Gebäude je Liegenschaft.
// Ein digitales Netz verbindet jedes Gebäude mit dem HQ. Ist ein Gebäude gewählt, laufen dorthin pulsierende Signale
// und die Kamera fährt animiert hin. Neue Liegenschaften wachsen beim nächsten Öffnen sichtbar aus dem Boden.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type StadtObjekt = { id: number; name: string; einheiten: number; verwaltungsart: string };

const GOLD = 0xd4a65a;
const FARBE: Record<string, number> = { WEG: 0x6b8fd6, Mietverwaltung: 0x4fa3a5 };
const BEKANNT = 'nano-stadt-bekannt';

function schild(text: string, farbe = '#f3e3c3', gross = false) {
  const c = document.createElement('canvas');
  const s = gross ? 2 : 1;
  c.width = 512 * s; c.height = 112 * s;
  const g = c.getContext('2d')!;
  g.scale(s, s);
  g.font = `600 ${gross ? 46 : 40}px Montserrat, system-ui, sans-serif`;
  const t = text.length > 26 ? text.slice(0, 25) + '…' : text;
  const w = Math.min(500, g.measureText(t).width + 44);
  const x = (512 - w) / 2;
  g.fillStyle = 'rgba(14,17,22,.78)';
  g.beginPath(); g.roundRect(x, 18, w, 72, 36); g.fill();
  g.strokeStyle = 'rgba(212,166,90,.75)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = farbe; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(t, 256, 56);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sp.scale.set(gross ? 5.2 : 4.4, gross ? 1.14 : 0.96, 1);
  sp.renderOrder = 10;
  return sp;
}

/** Feste Plätze auf Ringen um das HQ, damit jedes Gebäude immer am selben Ort steht */
function platz(i: number) {
  let ring = 0, start = 0, anzahl = 6;
  while (i >= start + anzahl) { start += anzahl; ring++; anzahl = 6 + ring * 4; }
  const k = i - start;
  const r = 7.5 + ring * 4.6;
  const a = (k / anzahl) * Math.PI * 2 + ring * 0.42;
  return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
}

type Haus = { id: number; gruppe: THREE.Group; koerper: THREE.Mesh; kanten: THREE.LineSegments; hoehe: number; pos: THREE.Vector3;
  bahn: THREE.QuadraticBezierCurve3; linie: THREE.Line; start: number; neu: boolean; farbe: number; boden: THREE.Mesh };

export function Stadt3D({ objekte, gewaehlt, onWahl }: { objekte: StadtObjekt[]; gewaehlt: number | null; onWahl: (id: number | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const welt = useRef<{ setzeObjekte: (o: StadtObjekt[]) => void; waehle: (id: number | null) => void } | null>(null);
  const wahlRef = useRef(onWahl); wahlRef.current = onWahl;

  useEffect(() => {
    const el = box.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { el.classList.add('ohne-3d'); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    const szene = new THREE.Scene();
    szene.fog = new THREE.Fog(0x0f1217, 38, 95);
    const kamera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);

    szene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sonne = new THREE.DirectionalLight(0xfff1dc, 1.1); sonne.position.set(14, 26, 10); szene.add(sonne);
    const hqLicht = new THREE.PointLight(GOLD, 30, 30, 1.6); hqLicht.position.set(0, 9, 0); szene.add(hqLicht);

    // Boden mit digitalem Raster
    const boden = new THREE.Mesh(new THREE.CircleGeometry(60, 96), new THREE.MeshStandardMaterial({ color: 0x151a21, roughness: 1 }));
    boden.rotation.x = -Math.PI / 2; szene.add(boden);
    const raster = new THREE.GridHelper(120, 60, 0x3a3326, 0x232830);
    (raster.material as THREE.Material).transparent = true; (raster.material as THREE.Material).opacity = 0.55;
    raster.position.y = 0.01; szene.add(raster);
    for (const r of [7.5, 12.1, 16.7, 21.3]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.03, r + 0.03, 128), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.16 }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; szene.add(ring);
    }

    // KMS HQ
    const hq = new THREE.Group(); szene.add(hq);
    const hqTeile: [number, number, number, number][] = [[3.4, 2.2, 3.4, 0], [2.6, 4.2, 2.6, 2.2], [1.8, 2.6, 1.8, 6.4]];
    for (const [w, h, d, y] of hqTeile) {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x232833, metalness: 0.4, roughness: 0.5, emissive: 0x3a2c14, emissiveIntensity: 0.35 }));
      m.position.y = y + h / 2; hq.add(m);
      const k = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: GOLD }));
      k.position.copy(m.position); hq.add(k);
      for (let f = 0.5; f < h; f += 0.6) {   // leuchtende Etagen
        const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.06, d + 0.02), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.35 }));
        band.position.y = y + f; hq.add(band);
      }
    }
    const antenne = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6), new THREE.MeshBasicMaterial({ color: GOLD }));
    antenne.position.y = 9.8; hq.add(antenne);
    const hqSchild = schild('KMS HQ', '#f6d48d', true); hqSchild.position.set(0, 13.6, 0); hq.add(hqSchild);
    const hqWelle = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.2, 64), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    hqWelle.rotation.x = -Math.PI / 2; hqWelle.position.y = 0.05; szene.add(hqWelle);

    // Agent O.S.A schwebt über dem HQ
    const osa = new THREE.Group(); osa.position.set(0, 11.6, 0); szene.add(osa);
    const kern = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshStandardMaterial({ color: 0xffd98a, emissive: 0xd4a65a, emissiveIntensity: 1.4, flatShading: true }));
    osa.add(kern);
    const huelle = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), new THREE.MeshBasicMaterial({ color: GOLD, wireframe: true, transparent: true, opacity: 0.45 }));
    osa.add(huelle);
    const bahnen: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.5 + i * 0.25, 0.022, 8, 80), new THREE.MeshBasicMaterial({ color: i === 1 ? 0x8fd3d6 : GOLD, transparent: true, opacity: 0.7 }));
      r.rotation.set(Math.PI / 2 + i * 0.6, i * 0.9, 0); osa.add(r); bahnen.push(r);
    }
    const osaSchild = schild('Agent O.S.A', '#bfeef0'); osaSchild.scale.multiplyScalar(0.8); osaSchild.position.set(0, -1.75, 0); osa.add(osaSchild);
    const hqPunkt = new THREE.Vector3(0, 10.5, 0);

    // Gebäude
    const haeuser = new Map<number, Haus>();
    const stadt = new THREE.Group(); szene.add(stadt);
    let bekannt: number[] = [];
    try { bekannt = JSON.parse(localStorage.getItem(BEKANNT) ?? '[]'); } catch { /* egal */ }
    const ersteSicht = bekannt.length === 0;

    const bauen = (o: StadtObjekt, i: number, verzoegerung: number) => {
      const pos = platz(i);
      const hoehe = Math.min(8, 1.6 + (Number(o.einheiten) || 1) * 0.45);
      const breite = 1.7 + Math.min(1, (Number(o.einheiten) || 1) / 12);
      const farbe = FARBE[o.verwaltungsart] ?? 0x9b7fd1;
      const gruppe = new THREE.Group(); gruppe.position.copy(pos);
      const geo = new THREE.BoxGeometry(breite, hoehe, breite); geo.translate(0, hoehe / 2, 0);
      const koerper = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1d232c, emissive: farbe, emissiveIntensity: 0.12, metalness: 0.3, roughness: 0.6, transparent: true, opacity: 0.94 }));
      koerper.userData.id = o.id; gruppe.add(koerper);
      const kanten = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: farbe, transparent: true, opacity: 0.9 }));
      gruppe.add(kanten);
      for (let f = 0.55; f < hoehe - 0.2; f += 0.55) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(breite + 0.02, 0.05, breite + 0.02), new THREE.MeshBasicMaterial({ color: farbe, transparent: true, opacity: 0.28 }));
        band.position.y = f; gruppe.add(band);
      }
      const s = schild(o.name); s.position.set(0, hoehe + 1.1, 0); gruppe.add(s);
      const bodenRing = new THREE.Mesh(new THREE.RingGeometry(breite * 0.8, breite * 0.8 + 0.12, 48), new THREE.MeshBasicMaterial({ color: farbe, transparent: true, opacity: 0, side: THREE.DoubleSide }));
      bodenRing.rotation.x = -Math.PI / 2; bodenRing.position.y = 0.04; gruppe.add(bodenRing);
      gruppe.scale.set(1, 0.001, 1);
      stadt.add(gruppe);
      const oben = new THREE.Vector3(pos.x, hoehe + 0.2, pos.z);
      const mitte = hqPunkt.clone().add(oben).multiplyScalar(0.5); mitte.y = Math.max(hqPunkt.y, oben.y) + 3 + pos.length() * 0.12;
      const bahn = new THREE.QuadraticBezierCurve3(hqPunkt.clone(), mitte, oben);
      const linie = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bahn.getPoints(48)), new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0 }));
      szene.add(linie);
      haeuser.set(o.id, { id: o.id, gruppe, koerper, kanten, hoehe, pos, bahn, linie, start: performance.now() / 1000 + verzoegerung, neu: !ersteSicht && !bekannt.includes(o.id), farbe, boden: bodenRing });
    };

    // Pulse auf den Netzlinien
    const pulsGeo = new THREE.SphereGeometry(0.16, 12, 12);
    type Puls = { m: THREE.Mesh; bahn: THREE.QuadraticBezierCurve3; t: number; v: number; rueck: boolean };
    const pulse: Puls[] = [];
    const puls = (h: Haus, rueck = false, farbe = GOLD, gross = 1) => {
      const m = new THREE.Mesh(pulsGeo, new THREE.MeshBasicMaterial({ color: farbe, transparent: true, opacity: 1 }));
      m.scale.setScalar(gross); szene.add(m);
      pulse.push({ m, bahn: h.bahn, t: 0, v: 0.45 + Math.random() * 0.25, rueck });
    };

    let wahl: number | null = null;
    const ziel = new THREE.Vector3(), blick = new THREE.Vector3();
    let winkel = Math.PI / 4, abstand = 44, hoeheKam = 30, zielAbstand = 44, zielHoehe = 30;
    const zielPunkt = new THREE.Vector3();
    const fokus = (id: number | null) => {
      wahl = id;
      const h = id != null ? haeuser.get(id) : null;
      if (h) { zielPunkt.set(h.pos.x, h.hoehe * 0.55, h.pos.z); zielAbstand = 17 + h.hoehe; zielHoehe = 14 + h.hoehe; winkel = Math.atan2(h.pos.z, h.pos.x) + 0.28; }
      else { const r = haeuser.size > 6 ? 12 + Math.ceil((haeuser.size - 6) / 10) * 4.6 : 7.5; zielPunkt.set(0, 3.5, 0); zielAbstand = 22 + r * 1.9; zielHoehe = 12 + r * 1.1; }
    };
    fokus(null); ziel.copy(zielPunkt); blick.copy(zielPunkt); abstand = zielAbstand + 30; hoeheKam = zielHoehe + 18;

    welt.current = {
      setzeObjekte: (liste) => {
        const sortiert = [...liste].sort((a, b) => a.id - b.id);
        const ids = new Set(sortiert.map((o) => o.id));
        for (const [id, h] of haeuser) if (!ids.has(id)) { stadt.remove(h.gruppe); szene.remove(h.linie); haeuser.delete(id); }
        let neuZahl = 0;
        sortiert.forEach((o, i) => { if (!haeuser.has(o.id)) bauen(o, i, 0.4 + (ersteSicht ? i * 0.12 : bekannt.includes(o.id) ? i * 0.05 : 1.2 + neuZahl++ * 0.5)); });
        try { localStorage.setItem(BEKANNT, JSON.stringify(sortiert.map((o) => o.id))); } catch { /* egal */ }
        fokus(wahl);
      },
      waehle: fokus,
    };

    // Bedienung: ziehen dreht, Mausrad zoomt, Klick wählt ein Gebäude
    const ray = new THREE.Raycaster(), maus = new THREE.Vector2();
    let zieh: { x: number; w: number; bewegt: boolean } | null = null;
    const runter = (e: PointerEvent) => { zieh = { x: e.clientX, w: winkel, bewegt: false }; };
    const bewegen = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      maus.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (zieh) { const d = e.clientX - zieh.x; if (Math.abs(d) > 4) zieh.bewegt = true; winkel = zieh.w - d * 0.006; }
      ray.setFromCamera(maus, kamera);
      const treffer = ray.intersectObjects([...haeuser.values()].map((h) => h.koerper))[0];
      renderer.domElement.style.cursor = treffer ? 'pointer' : zieh ? 'grabbing' : 'grab';
      ueber = treffer ? (treffer.object.userData.id as number) : null;
    };
    const hoch = () => {
      if (zieh && !zieh.bewegt) wahlRef.current(ueber ?? null);
      zieh = null;
    };
    const rad = (e: WheelEvent) => { e.preventDefault(); zielAbstand = Math.max(10, Math.min(90, zielAbstand * (1 + e.deltaY * 0.001))); };
    let ueber: number | null = null;
    renderer.domElement.addEventListener('pointerdown', runter);
    renderer.domElement.addEventListener('pointermove', bewegen);
    window.addEventListener('pointerup', hoch);
    renderer.domElement.addEventListener('wheel', rad, { passive: false });

    const groesse = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); kamera.aspect = w / Math.max(1, h); kamera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(groesse); ro.observe(el); groesse();

    let raf = 0, letzt = performance.now() / 1000, naechsterPuls = 0, naechsterWahlPuls = 0;
    const lauf = () => {
      raf = requestAnimationFrame(lauf);
      const t = performance.now() / 1000, dt = Math.min(0.05, t - letzt); letzt = t;
      if (!zieh && wahl == null) winkel += dt * 0.05;
      ziel.lerp(zielPunkt, 0.045); abstand += (zielAbstand - abstand) * 0.045; hoeheKam += (zielHoehe - hoeheKam) * 0.045;
      kamera.position.set(ziel.x + Math.cos(winkel) * abstand, hoeheKam, ziel.z + Math.sin(winkel) * abstand);
      blick.lerp(ziel, 0.2); kamera.lookAt(blick);

      // HQ und O.S.A
      osa.position.y = 11.6 + Math.sin(t * 1.6) * 0.25;
      kern.rotation.y = t * 0.8; huelle.rotation.y = -t * 0.4; huelle.rotation.x = t * 0.25;
      bahnen.forEach((b, i) => { b.rotation.z = t * (0.6 + i * 0.3); });
      (kern.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + Math.sin(t * 3) * 0.4;
      const wz = (t * 0.5) % 1; hqWelle.scale.setScalar(1 + wz * 3.5); (hqWelle.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - wz);
      hqLicht.intensity = 26 + Math.sin(t * 3) * 6;

      // Gebäude wachsen, gewähltes leuchtet
      for (const h of haeuser.values()) {
        const p = Math.max(0, Math.min(1, (t - h.start) / (h.neu ? 1.8 : 1.1)));
        const e = p < 1 ? 1 + 2.4 * Math.pow(p - 1, 3) + 1.4 * Math.pow(p - 1, 2) : 1;   // wächst mit leichtem Überschwingen
        h.gruppe.scale.set(1, Math.max(0.001, p === 0 ? 0.001 : e), 1);
        const an = wahl === h.id, hover = ueber === h.id;
        const mat = h.koerper.material as THREE.MeshStandardMaterial;
        const zielGlanz = an ? 0.55 + Math.sin(t * 4) * 0.2 : hover ? 0.35 : h.neu && p < 1 ? 0.6 : 0.12;
        mat.emissiveIntensity += (zielGlanz - mat.emissiveIntensity) * 0.12;
        const lm = h.linie.material as THREE.LineBasicMaterial;
        const zielLinie = p < 0.6 ? 0 : wahl == null ? 0.32 : an ? 0.95 : 0.1;
        lm.opacity += (zielLinie - lm.opacity) * 0.08;
        lm.color.setHex(an ? 0xffe2a3 : GOLD);
        const bm = h.boden.material as THREE.MeshBasicMaterial;
        if (an || (h.neu && p > 0 && p < 1)) { const z = (t * 0.9) % 1; h.boden.scale.setScalar(1 + z * 1.8); bm.opacity = 0.8 * (1 - z); }
        else bm.opacity *= 0.9;
        if (h.neu && p >= 1) h.neu = false;
      }

      // Pulse: immer wieder einzelne Signale ins Netz, zum gewählten Gebäude ein Strom in beide Richtungen
      const liste = [...haeuser.values()].filter((h) => t > h.start + 1);
      if (t > naechsterPuls && liste.length) {
        naechsterPuls = t + (wahl == null ? 0.35 : 0.9);
        const h = liste[Math.floor(Math.random() * liste.length)];
        if (wahl == null || h.id !== wahl) puls(h, Math.random() < 0.4, Math.random() < 0.25 ? 0x8fd3d6 : GOLD, wahl == null ? 1 : 0.7);
      }
      const gw = wahl != null ? haeuser.get(wahl) : null;
      if (gw && t > naechsterWahlPuls) { naechsterWahlPuls = t + 0.22; puls(gw, Math.random() < 0.3, 0xffe2a3, 1.35); }
      for (let i = pulse.length - 1; i >= 0; i--) {
        const p = pulse[i]; p.t += dt * p.v;
        if (p.t >= 1) { szene.remove(p.m); (p.m.material as THREE.Material).dispose(); pulse.splice(i, 1); continue; }
        p.m.position.copy(p.bahn.getPoint(p.rueck ? 1 - p.t : p.t));
        (p.m.material as THREE.MeshBasicMaterial).opacity = Math.sin(p.t * Math.PI);
      }
      renderer.render(szene, kamera);
    };
    lauf();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener('pointerup', hoch);
      szene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => { (x as THREE.SpriteMaterial).map?.dispose(); x.dispose(); });
      });
      renderer.dispose(); renderer.domElement.remove(); welt.current = null;
    };
  }, []);

  useEffect(() => { welt.current?.setzeObjekte(objekte); }, [objekte]);
  useEffect(() => { welt.current?.waehle(gewaehlt); }, [gewaehlt, objekte]);

  return <div ref={box} className="stadt3d" />;
}
