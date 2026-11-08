// 3D-Stadt für das Dashboard: in der Mitte das KMS HQ mit dem Agenten O.S.A, ringsum ein Gebäude je Liegenschaft.
// Ein digitales Netz verbindet jedes Gebäude mit dem HQ. Ist ein Gebäude gewählt, laufen dorthin pulsierende Signale
// und die Kamera fährt animiert hin. Neue Liegenschaften wachsen beim nächsten Öffnen sichtbar aus dem Boden.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import schriftDaten from 'three/examples/fonts/helvetiker_bold.typeface.json';

export type StadtObjekt = { id: number; name: string; einheiten: number; verwaltungsart: string };

// Helles Design passend zum System: cremefarbener Grund, weiße Gebäude, goldene und farbige Kanten
const GOLD = 0xb8873a;
const GOLD_HELL = 0xd9a441;
const TUERKIS = 0x2e9ca1;
const FARBE: Record<string, number> = { WEG: 0x4f7fd6, Mietverwaltung: 0x48a85f };
const KANTE = 0x3a3d42;   // alle Seitenlinien dunkelgrau
const HQ_BEIGE = 0xe6d3ae;
const hell = (farbe: number, anteil = 0.16) => new THREE.Color(0xffffff).lerp(new THREE.Color(farbe), anteil);
const BEKANNT = 'nano-stadt-bekannt';

function schild(text: string, farbe = '#3b3428', gross = false) {
  const c = document.createElement('canvas');
  const s = gross ? 2 : 1;
  c.width = 512 * s; c.height = 112 * s;
  const g = c.getContext('2d')!;
  g.scale(s, s);
  g.font = `600 ${gross ? 46 : 40}px Montserrat, system-ui, sans-serif`;
  const t = text.length > 26 ? text.slice(0, 25) + '…' : text;
  const w = Math.min(500, g.measureText(t).width + 44);
  const x = (512 - w) / 2;
  g.shadowColor = 'rgba(80,60,30,.18)'; g.shadowBlur = 10; g.shadowOffsetY = 3;
  g.fillStyle = 'rgba(255,255,255,.94)';
  g.beginPath(); g.roundRect(x, 18, w, 72, 36); g.fill();
  g.shadowColor = 'transparent'; g.strokeStyle = 'rgba(184,135,58,.8)'; g.lineWidth = 2.5; g.stroke();
  g.fillStyle = farbe; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(t, 256, 56);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sp.scale.set(gross ? 5.2 : 4.4, gross ? 1.14 : 0.96, 1);
  sp.renderOrder = 10;
  return sp;
}

// Stadtraster: Blöcke mit Straßen dazwischen. Das HQ steht im mittleren Block,
// jedes Gebäude bekommt einen festen Block, von innen nach außen vergeben.
const RASTER = 7;            // Abstand der Blockmitten
const BLOCK = 5.2;           // Kantenlänge eines Blocks (Gehweg-Platte)
const STRASSE = RASTER - BLOCK;
const ZELLEN: [number, number][] = (() => {
  const z: [number, number][] = [];
  for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) if (i || j) z.push([i, j]);
  const ring = (c: [number, number]) => Math.max(Math.abs(c[0]), Math.abs(c[1]));
  const winkel = (c: [number, number]) => (Math.atan2(c[1], c[0]) + Math.PI * 2.25) % (Math.PI * 2);
  return z.sort((a, b) => ring(a) - ring(b) || Math.hypot(...a) - Math.hypot(...b) || winkel(a) - winkel(b));
})();
function zelle(i: number): [number, number] { return ZELLEN[Math.min(i, ZELLEN.length - 1)]; }
function platz(i: number) { const [x, z] = zelle(i); return new THREE.Vector3(x * RASTER, 0, z * RASTER); }

/** Weg einer Datenspur vom HQ über die Straßen zum Block (rechte Winkel mit 45°-Fasen wie auf einer Leiterplatte) */
function spurPunkte(i: number, nr: number): THREE.Vector3[] {
  const [ci, cj] = zelle(i);
  const versatz = ((nr % 5) - 2) * 0.17;
  const sx = Math.sign(ci) || 1, sz = Math.sign(cj) || 1;
  const tx = ci * RASTER, tz = cj * RASTER;
  const zs = sz * RASTER / 2 + versatz;
  const xs = (ci === 0 ? RASTER / 2 : tx - sx * RASTER / 2) + versatz;
  const roh = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, zs), new THREE.Vector3(xs, 0, zs), new THREE.Vector3(xs, 0, tz), new THREE.Vector3(tx, 0, tz)];
  const p: THREE.Vector3[] = [roh[0]];
  for (let k = 1; k < roh.length - 1; k++) {
    const a = roh[k - 1], m = roh[k], b = roh[k + 1];
    const c = Math.min(0.55, a.distanceTo(m) / 3, m.distanceTo(b) / 3);
    if (c < 0.01) { p.push(m); continue; }
    p.push(m.clone().add(a.clone().sub(m).normalize().multiplyScalar(c)), m.clone().add(b.clone().sub(m).normalize().multiplyScalar(c)));
  }
  p.push(roh[roh.length - 1]);
  return p.filter((x, k) => k === 0 || x.distanceTo(p[k - 1]) > 0.001).map((x) => x.setY(0.075));
}

type Pfad = { punkte: THREE.Vector3[]; laengen: number[]; gesamt: number };
function pfad(punkte: THREE.Vector3[]): Pfad {
  const laengen = [0];
  for (let k = 1; k < punkte.length; k++) laengen.push(laengen[k - 1] + punkte[k].distanceTo(punkte[k - 1]));
  return { punkte, laengen, gesamt: laengen[laengen.length - 1] };
}
function aufPfad(p: Pfad, s: number, pos: THREE.Vector3): number {
  const d = Math.max(0, Math.min(p.gesamt, s));
  let k = 1; while (k < p.laengen.length - 1 && p.laengen[k] < d) k++;
  const a = p.punkte[k - 1], b = p.punkte[k], f = (d - p.laengen[k - 1]) / Math.max(1e-6, p.laengen[k] - p.laengen[k - 1]);
  pos.copy(a).lerp(b, f);
  return Math.atan2(b.z - a.z, b.x - a.x);
}

type Haus = { id: number; gruppe: THREE.Group; koerper: THREE.Mesh; kanten: THREE.LineSegments; hoehe: number; pos: THREE.Vector3;
  pfad: Pfad; spur: THREE.Group; spurMat: THREE.MeshBasicMaterial; knoten: THREE.Mesh; start: number; neu: boolean; farbe: number; boden: THREE.Mesh };

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
    szene.fog = new THREE.Fog(0xf6f1e8, 70, 170);
    const kamera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);

    szene.add(new THREE.HemisphereLight(0xffffff, 0xe9dfcd, 1.25));
    const sonne = new THREE.DirectionalLight(0xfff6e8, 1.5); sonne.position.set(14, 26, 10); szene.add(sonne);
    const hqLicht = new THREE.PointLight(GOLD_HELL, 14, 26, 1.6); hqLicht.position.set(0, 9, 0); szene.add(hqLicht);

    // Boden mit digitalem Raster
    const boden = new THREE.Mesh(new THREE.CircleGeometry(60, 96), new THREE.MeshStandardMaterial({ color: 0xf1ebe0, roughness: 1 }));
    boden.rotation.x = -Math.PI / 2; szene.add(boden);
    // Straßen, Gehwege, Bäume: werden neu gebaut, wenn die Stadt größer wird
    const strassen = new THREE.Group(); szene.add(strassen);
    let strassenN = -1;
    const mittelTex = (() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 8;
      const g = c.getContext('2d')!; g.fillStyle = '#ffffff'; g.fillRect(0, 2, 34, 4);
      const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const asphaltMat = new THREE.MeshStandardMaterial({ color: 0xc4c1bb, roughness: 0.95 });
    const gehwegMat = new THREE.MeshStandardMaterial({ color: 0xeee7da, roughness: 1 });
    const kanteMat = new THREE.MeshStandardMaterial({ color: 0xd9d1c2, roughness: 1 });
    const rasenMat = new THREE.MeshStandardMaterial({ color: 0xcfe0bf, roughness: 1 });
    const stammMat = new THREE.MeshStandardMaterial({ color: 0x8a7458, roughness: 1 });
    const kroneMat = new THREE.MeshStandardMaterial({ color: 0x8fbf7a, roughness: 0.9, flatShading: true });
    const zebraMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const strassenBauen = (N: number, belegt: Set<string>) => {
      if (N === strassenN) { baeume(N, belegt); return; }
      strassenN = N;
      strassen.children.slice().forEach((c) => { strassen.remove(c); (c as THREE.Mesh).geometry?.dispose(); });
      const weite = (2 * N + 1) * RASTER + STRASSE;
      for (let k = -N - 1; k <= N; k++) {
        const pos = (k + 0.5) * RASTER;
        for (const quer of [false, true]) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(quer ? STRASSE : weite, quer ? weite : STRASSE), asphaltMat);
          m.rotation.x = -Math.PI / 2; m.position.set(quer ? pos : 0, 0.02 + (quer ? 0.001 : 0), quer ? 0 : pos); strassen.add(m);
          // Mittellinie je Abschnitt zwischen zwei Kreuzungen
          for (let s2 = -N; s2 <= N; s2++) {
            const t = mittelTex.clone(); t.needsUpdate = true; t.repeat.set(BLOCK / 1.2, 1);
            const l = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - 0.6, 0.09), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
            l.rotation.x = -Math.PI / 2; if (quer) l.rotation.z = Math.PI / 2;
            l.position.set(quer ? pos : s2 * RASTER, 0.035, quer ? s2 * RASTER : pos); strassen.add(l);
          }
        }
      }
      // Zebrastreifen an den Kreuzungen rund um das HQ
      for (const [x, z, quer] of [[0, RASTER / 2, false], [0, -RASTER / 2, false], [RASTER / 2, 0, true], [-RASTER / 2, 0, true]] as [number, number, boolean][]) {
        for (let n = -3; n <= 3; n++) {
          const st = new THREE.Mesh(new THREE.PlaneGeometry(0.22, STRASSE * 0.8), zebraMat);
          st.rotation.x = -Math.PI / 2; if (quer) st.rotation.z = Math.PI / 2;
          st.position.set(x + (quer ? 0 : n * 0.45 + (x ? 0 : 0)) + (quer ? 0 : 0), 0.036, z + (quer ? n * 0.45 : 0));
          if (!quer) st.position.x = n * 0.45; else st.position.z = n * 0.45;
          strassen.add(st);
        }
      }
      // Gehweg-Platten mit Bordstein
      const platte = new THREE.BoxGeometry(BLOCK, 0.12, BLOCK), bord = new THREE.BoxGeometry(BLOCK + 0.14, 0.08, BLOCK + 0.14);
      for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
        const b1 = new THREE.Mesh(bord, kanteMat); b1.position.set(i * RASTER, 0.04, j * RASTER); strassen.add(b1);
        const b2 = new THREE.Mesh(platte, gehwegMat); b2.position.set(i * RASTER, 0.06, j * RASTER); strassen.add(b2);
      }
      baeume(N, belegt);
    };
    // Leere Blöcke werden kleine Parks mit Bäumen, bebaute Blöcke bekommen Bäume an den Ecken
    let baumGruppe: THREE.Group | null = null;
    const baeume = (N: number, belegt: Set<string>) => {
      if (baumGruppe) { strassen.remove(baumGruppe); baumGruppe.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); }
      baumGruppe = new THREE.Group(); strassen.add(baumGruppe);
      const orte: [number, number, number][] = [];
      const zufall = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
      for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
        if (!i && !j) continue;
        const cx = i * RASTER, cz = j * RASTER, e = BLOCK / 2 - 0.55;
        if (belegt.has(`${i},${j}`)) { for (const [dx, dz] of [[e, e], [-e, -e]]) orte.push([cx + dx, cz + dz, 0.8]); continue; }
        const rasen = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - 0.7, BLOCK - 0.7), rasenMat);
        rasen.rotation.x = -Math.PI / 2; rasen.position.set(cx, 0.125, cz); baumGruppe.add(rasen);
        const n = 3 + Math.floor(zufall(i * 31 + j) * 3);
        for (let k = 0; k < n; k++) orte.push([cx + (zufall(i * 7 + j * 13 + k) - 0.5) * (BLOCK - 1.4), cz + (zufall(i * 11 + j * 5 + k * 3) - 0.5) * (BLOCK - 1.4), 0.8 + zufall(k + i + j) * 0.5]);
      }
      const stamm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 6), stammMat, orte.length);
      const krone = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.42, 0), kroneMat, orte.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sk = new THREE.Vector3();
      orte.forEach(([x, z, g], k) => {
        m4.compose(new THREE.Vector3(x, 0.37 * g, z), q, sk.set(g, g, g)); stamm.setMatrixAt(k, m4);
        m4.compose(new THREE.Vector3(x, 0.85 * g, z), q, sk.set(g, g * 1.15, g)); krone.setMatrixAt(k, m4);
      });
      baumGruppe.add(stamm, krone);
    };

    // KMS HQ
    const hq = new THREE.Group(); szene.add(hq);
    const hqTeile: [number, number, number, number][] = [[3.4, 2.2, 3.4, 0], [2.6, 4.2, 2.6, 2.2], [1.8, 2.6, 1.8, 6.4]];
    for (const [w, h, d, y] of hqTeile) {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: HQ_BEIGE, metalness: 0.1, roughness: 0.6, emissive: 0xf2d9a8, emissiveIntensity: 0.08 }));
      m.position.y = y + h / 2; hq.add(m);
      const k = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: KANTE }));
      k.position.copy(m.position); hq.add(k);
      for (let f = 0.5; f < h; f += 0.6) {   // leuchtende Etagen
        const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.06, d + 0.02), new THREE.MeshBasicMaterial({ color: KANTE, transparent: true, opacity: 0.22 }));
        band.position.y = y + f; hq.add(band);
      }
    }
    const antenne = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6), new THREE.MeshBasicMaterial({ color: GOLD }));
    antenne.position.y = 9.8; hq.add(antenne);
    const hqWelle = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.2, 64), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    hqWelle.rotation.x = -Math.PI / 2; hqWelle.position.y = 0.05; szene.add(hqWelle);

    // Agent O.S.A schwebt über dem HQ
    const osa = new THREE.Group(); osa.position.set(0, 12.8, 0); szene.add(osa);
    // KMS-Zeichen wie im Logo: „KM“ dunkelgrau, „S“ gold, langsam drehend
    const kern = new THREE.Group(); osa.add(kern);
    const schrift = new FontLoader().parse(schriftDaten as any);
    const buchstabe = (t: string, farbe: number, glanz: number) => {
      const g = new TextGeometry(t, { font: schrift, size: 1.25, depth: 0.38, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2 });
      g.computeBoundingBox();
      return { g, m: new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: farbe, metalness: 0.35, roughness: 0.35, emissive: farbe, emissiveIntensity: glanz })) };
    };
    const km = buchstabe('KM', 0x3a3d42, 0.05), sBuch = buchstabe('S', 0xd09a3c, 0.25);
    const bKM = km.g.boundingBox!.max.x - km.g.boundingBox!.min.x, bS = sBuch.g.boundingBox!.max.x - sBuch.g.boundingBox!.min.x, luecke = 0.06;
    const breiteKMS = bKM + luecke + bS;
    km.m.position.set(-breiteKMS / 2, -0.6, -0.19); sBuch.m.position.set(-breiteKMS / 2 + bKM + luecke, -0.6, -0.19);
    kern.add(km.m, sBuch.m);
    const huelle = new THREE.Mesh(new THREE.RingGeometry(1.75, 1.8, 64), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.0, side: THREE.DoubleSide }));
    osa.add(huelle);
    const bahnen: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(2.25 + i * 0.3, 0.026, 8, 96), new THREE.MeshBasicMaterial({ color: i === 1 ? TUERKIS : GOLD, transparent: true, opacity: 0.85 }));
      r.rotation.set(Math.PI / 2 + i * 0.6, i * 0.9, 0); osa.add(r); bahnen.push(r);
    }
    const osaSchild = schild('KMS HQ · Agent O.S.A', '#237b80'); osaSchild.scale.multiplyScalar(0.9); osaSchild.position.set(0, -2.3, 0); osa.add(osaSchild);

    // Gebäude
    const haeuser = new Map<number, Haus>();
    const stadt = new THREE.Group(); szene.add(stadt);
    let bekannt: number[] = [];
    try { bekannt = JSON.parse(localStorage.getItem(BEKANNT) ?? '[]'); } catch { /* egal */ }
    const ersteSicht = bekannt.length === 0;

    const bauen = (o: StadtObjekt, i: number, verzoegerung: number) => {
      const pos = platz(i);
      const hoehe = Math.min(8, 1.6 + (Number(o.einheiten) || 1) * 0.45);
      const breite = 2.6 + Math.min(1.2, (Number(o.einheiten) || 1) / 10);
      const farbe = FARBE[o.verwaltungsart] ?? 0x9b7fd1;
      const gruppe = new THREE.Group(); gruppe.position.copy(pos);
      const geo = new THREE.BoxGeometry(breite, hoehe, breite); geo.translate(0, hoehe / 2, 0);
      const koerper = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: hell(farbe, 0.82), emissive: farbe, emissiveIntensity: 0.04, metalness: 0.1, roughness: 0.6, transparent: true, opacity: 0.96 }));
      koerper.userData.id = o.id; gruppe.add(koerper);
      const kanten = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: KANTE, transparent: true, opacity: 0.95 }));
      gruppe.add(kanten);
      for (let f = 0.55; f < hoehe - 0.2; f += 0.55) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(breite + 0.02, 0.05, breite + 0.02), new THREE.MeshBasicMaterial({ color: KANTE, transparent: true, opacity: 0.22 }));
        band.position.y = f; gruppe.add(band);
      }
      const s = schild(o.name); s.position.set(0, hoehe + 1.1, 0); gruppe.add(s);
      const bodenRing = new THREE.Mesh(new THREE.RingGeometry(breite * 0.8, breite * 0.8 + 0.12, 48), new THREE.MeshBasicMaterial({ color: farbe, transparent: true, opacity: 0, side: THREE.DoubleSide }));
      bodenRing.rotation.x = -Math.PI / 2; bodenRing.position.y = 0.04; gruppe.add(bodenRing);
      gruppe.scale.set(1, 0.001, 1);
      stadt.add(gruppe);
      // Datenspur wie im Logo: flache Leiterbahn über die Straßen, am Ende ein Knoten
      const pf = pfad(spurPunkte(i, i));
      const spurMat = new THREE.MeshBasicMaterial({ color: 0xbfa877, transparent: true, opacity: 0 });
      const spur = new THREE.Group();
      for (let k = 1; k < pf.punkte.length; k++) {
        const a2 = pf.punkte[k - 1], b2 = pf.punkte[k], l = a2.distanceTo(b2);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(l + 0.15, 0.02, 0.15), spurMat);
        seg.position.copy(a2).lerp(b2, 0.5); seg.rotation.y = -Math.atan2(b2.z - a2.z, b2.x - a2.x); spur.add(seg);
      }
      const knoten = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      const knotenRand = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 6, 24), spurMat);
      knoten.position.copy(pf.punkte[pf.punkte.length - 1]).setY(0.1); knotenRand.position.copy(knoten.position); knotenRand.rotation.x = Math.PI / 2;
      spur.add(knoten, knotenRand);
      szene.add(spur);
      haeuser.set(o.id, { id: o.id, gruppe, koerper, kanten, hoehe, pos, pfad: pf, spur, spurMat, knoten, start: performance.now() / 1000 + verzoegerung, neu: !ersteSicht && !bekannt.includes(o.id), farbe, boden: bodenRing });
    };

    // Datenpakete: kurze Lichtstriche, die auf den Leiterbahnen laufen (gold und grau wie im Logo)
    const paketGeo = new THREE.BoxGeometry(0.9, 0.06, 0.2);
    type Puls = { m: THREE.Mesh; h: Haus; s: number; v: number; rueck: boolean };
    const pulse: Puls[] = [];
    const puls = (h: Haus, rueck = false, farbe = GOLD, gross = 1) => {
      const m = new THREE.Mesh(paketGeo, new THREE.MeshBasicMaterial({ color: farbe, transparent: true, opacity: 1 }));
      m.scale.set(gross, 1, gross); szene.add(m);
      pulse.push({ m, h, s: 0, v: 7 + Math.random() * 4, rueck });
    };

    let wahl: number | null = null;
    const ziel = new THREE.Vector3(), blick = new THREE.Vector3();
    let winkel = Math.PI / 4, abstand = 44, hoeheKam = 30, zielAbstand = 44, zielHoehe = 30;
    const zielPunkt = new THREE.Vector3();
    const fokus = (id: number | null) => {
      wahl = id;
      const h = id != null ? haeuser.get(id) : null;
      if (h) { zielPunkt.set(h.pos.x, h.hoehe * 0.55, h.pos.z); zielAbstand = 17 + h.hoehe; zielHoehe = 14 + h.hoehe; winkel = Math.atan2(h.pos.z, h.pos.x) + 0.28; }
      else { const r = Math.max(1, ...[...haeuser.values()].map((x) => Math.max(Math.abs(x.pos.x), Math.abs(x.pos.z)))) + RASTER * 0.6; zielPunkt.set(0, 2.5, 0); zielAbstand = 16 + r * 1.75; zielHoehe = 12 + r * 1.15; }
    };
    fokus(null); ziel.copy(zielPunkt); blick.copy(zielPunkt); abstand = zielAbstand + 30; hoeheKam = zielHoehe + 18;

    welt.current = {
      setzeObjekte: (liste) => {
        const sortiert = [...liste].sort((a, b) => a.id - b.id);
        const ids = new Set(sortiert.map((o) => o.id));
        for (const [id, h] of haeuser) if (!ids.has(id)) { stadt.remove(h.gruppe); szene.remove(h.spur); haeuser.delete(id); }
        let neuZahl = 0;
        sortiert.forEach((o, i) => { if (!haeuser.has(o.id)) bauen(o, i, 0.4 + (ersteSicht ? i * 0.12 : bekannt.includes(o.id) ? i * 0.05 : 1.2 + neuZahl++ * 0.5)); });
        const N = Math.max(2, ...sortiert.map((_, i) => Math.max(Math.abs(zelle(i)[0]), Math.abs(zelle(i)[1])))) + 1;
        strassenBauen(N, new Set(sortiert.map((_, i) => zelle(i).join(','))));
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
      osa.position.y = 12.8 + Math.sin(t * 1.6) * 0.25;
      kern.rotation.y = Math.PI / 2 - winkel + Math.sin(t * 0.8) * 0.35;   // schaut immer zur Kamera, wiegt sich leicht
      bahnen.forEach((b, i) => { b.rotation.z = t * (0.6 + i * 0.3); });
      (sBuch.m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25 + Math.sin(t * 3) * 0.12;
      const wz = (t * 0.5) % 1; hqWelle.scale.setScalar(1 + wz * 3.5); (hqWelle.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - wz);
      hqLicht.intensity = 26 + Math.sin(t * 3) * 6;

      // Gebäude wachsen, gewähltes leuchtet
      for (const h of haeuser.values()) {
        const p = Math.max(0, Math.min(1, (t - h.start) / (h.neu ? 1.8 : 1.1)));
        const e = p < 1 ? 1 + 2.4 * Math.pow(p - 1, 3) + 1.4 * Math.pow(p - 1, 2) : 1;   // wächst mit leichtem Überschwingen
        h.gruppe.scale.set(1, Math.max(0.001, p === 0 ? 0.001 : e), 1);
        const an = wahl === h.id, hover = ueber === h.id;
        const mat = h.koerper.material as THREE.MeshStandardMaterial;
        const zielGlanz = an ? 0.32 + Math.sin(t * 4) * 0.12 : hover ? 0.2 : h.neu && p < 1 ? 0.35 : 0.04;
        mat.emissiveIntensity += (zielGlanz - mat.emissiveIntensity) * 0.12;
        const zielLinie = p < 0.6 ? 0 : wahl == null ? 0.95 : an ? 1 : 0.45;
        h.spurMat.opacity += (zielLinie - h.spurMat.opacity) * 0.08;
        h.spurMat.color.lerp(new THREE.Color(an ? GOLD_HELL : 0xbfa877), 0.1);
        const km2 = h.knoten.material as THREE.MeshBasicMaterial;
        km2.opacity = h.spurMat.opacity; h.knoten.scale.setScalar(an ? 1.2 + Math.sin(t * 6) * 0.2 : 1 + Math.sin(t * 2 + h.id) * 0.08);
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
        if (wahl == null || h.id !== wahl) puls(h, Math.random() < 0.4, Math.random() < 0.35 ? 0x6f7782 : GOLD_HELL, wahl == null ? 1 : 0.8);
      }
      const gw = wahl != null ? haeuser.get(wahl) : null;
      if (gw && t > naechsterWahlPuls) { naechsterWahlPuls = t + 0.22; puls(gw, Math.random() < 0.3, GOLD_HELL, 1.35); }
      for (let i = pulse.length - 1; i >= 0; i--) {
        const p = pulse[i]; p.s += dt * p.v;
        const g = p.h.pfad.gesamt;
        if (p.s >= g) { szene.remove(p.m); (p.m.material as THREE.Material).dispose(); pulse.splice(i, 1); continue; }
        const w = aufPfad(p.h.pfad, p.rueck ? g - p.s : p.s, p.m.position);
        p.m.position.y = 0.11; p.m.rotation.y = -w;
        (p.m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.s / 1.2, (g - p.s) / 1.2);
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
