// 3D-Stadt für das Dashboard, realistisch: echte Häuser mit Putzfassaden, Fenstern je Etage, Sattel- oder Flachdach,
// Balkonen, Bäumen, Autos und weichen Schatten. Ringsum neutrale Blockrandbebauung, damit die eigenen Liegenschaften auffallen.
// In der Mitte die KMS-Zentrale (Glas und Bronze) mit Agent O.S.A als Leuchtsignal auf dem Dach.
// Helles Design: Stadt bei Tag. Dunkelmodus: dieselbe Stadt am Abend mit erleuchteten Fenstern und Laternen.
// Bedienung wie bisher: Haus anklicken, Kamera fährt hin; neue Liegenschaften wachsen beim nächsten Öffnen aus dem Boden.
import { LOGO_KM, LOGO_S } from './logoPfade';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export type StadtObjekt = { id: number; name: string; einheiten: number; verwaltungsart: string };

const BEKANNT = 'nano-stadt-bekannt';
const RASTER = 7, BLOCK = 5.2, STRASSE = RASTER - BLOCK, ETAGE = 0.62, SOCKEL = 0.16;
const zufall = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// Stadtraster: das HQ steht im mittleren Block, jedes Haus bekommt einen festen Block, von innen nach außen vergeben
const ZELLEN: [number, number][] = (() => {
  const z: [number, number][] = [];
  for (let i = -8; i <= 1; i++) for (let j = -8; j <= 8; j++) if (i || j) z.push([i, j]);   // östlich davon liegen Rheinufer und Rhein
  const ring = (c: [number, number]) => Math.max(Math.abs(c[0]), Math.abs(c[1]));
  const winkel = (c: [number, number]) => (Math.atan2(c[1], c[0]) + Math.PI * 2.25) % (Math.PI * 2);
  return z.sort((a, b) => ring(a) - ring(b) || Math.hypot(...a) - Math.hypot(...b) || winkel(a) - winkel(b));
})();
const zelle = (i: number): [number, number] => ZELLEN[Math.min(i, ZELLEN.length - 1)];

// Köln: die Altstadt liegt im Halbkreis am linken Rheinufer, gegenüber Deutz. Der Rhein fließt östlich der Zentrale.
const UFER = 1.5 * RASTER + STRASSE / 2;                    // Beginn der Uferzone (Rheinboulevard, Dom, Kranhäuser)
const rheinW = (z: number) => 19.5 + 2.6 * Math.sin(z / 45);  // linkes Ufer
const rheinO = (z: number) => rheinW(z) + 17;               // rechtes Ufer (Deutz)
const RING = 4.1 * RASTER + 19.5;                           // Halbkreis der Ringe um die Altstadt, außen Grüngürtel

type Stil = {
  abend: boolean; himmel: [string, string]; nebel: number; boden: number; strasse: number; gehweg: number; bord: number; rasen: number; platz: number;
  putz: string[]; kontext: string[]; fenster: string; rahmen: string; dach: number; kontextDach: number; attika: number; baum: number[]; stamm: number;
  sonne: number; sonnenFarbe: number; himmelOben: number; himmelUnten: number; himmelLicht: number; env: number; markierung: number; akzent: number;
};
const TAG: Stil = {
  abend: false, himmel: ['#cdd8e2', '#eef1f3'], nebel: 0xe4e9ed, boden: 0x8d9094, strasse: 0x6f7378, gehweg: 0xbdbab3, bord: 0xcfccc5, rasen: 0x8fa772, platz: 0xd6d1c6,
  putz: ['#e9e2d3', '#dccdb4', '#e6e5e0', '#cfbfa6', '#b9765c', '#d8d3c8', '#a4a29d', '#ece7dc'], kontext: ['#e4e1db', '#dad6ce', '#d0ccc4', '#e9e7e2'],
  fenster: '#3c4652', rahmen: '#f2f0ea', dach: 0x4b4e53, kontextDach: 0x9a9893, attika: 0x7d7a74, baum: [0x5d7f45, 0x6e8f4c, 0x4e6f3d], stamm: 0x5b4636,
  sonne: 3.2, sonnenFarbe: 0xfff3e2, himmelOben: 0xffffff, himmelUnten: 0x8a8478, himmelLicht: 0.7, env: 0.6, markierung: 0xe9e7e0, akzent: 0xc8955a,
};
const ABEND: Stil = {
  abend: true, himmel: ['#0f1115', '#24262c'], nebel: 0x15171b, boden: 0x1d1f23, strasse: 0x26282c, gehweg: 0x34363a, bord: 0x45474b, rasen: 0x1f2a1d, platz: 0x3a3a3c,
  putz: ['#6d675e', '#625a4f', '#6a6a68', '#5e554a', '#6b4639', '#64615b', '#4f4e4c', '#6e6a62'], kontext: ['#4a4845', '#43413e', '#504d49'],
  fenster: '#1b2129', rahmen: '#7c7870', dach: 0x2a2c30, kontextDach: 0x2e3034, attika: 0x55524d, baum: [0x22301d, 0x283621, 0x1d2a19], stamm: 0x2a221c,
  sonne: 0.35, sonnenFarbe: 0x8ea2d0, himmelOben: 0x5a6a90, himmelUnten: 0x111111, himmelLicht: 0.35, env: 0.18, markierung: 0x8c8a84, akzent: 0xe0ad6e,
};
const ART_FARBE: Record<string, string> = { WEG: '#5f89d8', Mietverwaltung: '#5bb06f' };

const SCHILD_CSS = `.stadt-schild{font:600 12.5px/1 Montserrat,system-ui,sans-serif;padding:6px 10px 6px 8px;border-radius:7px;white-space:nowrap;display:flex;align-items:center;gap:7px;
 transform:translateY(-50%);box-shadow:0 4px 14px rgba(0,0,0,.28);border:1px solid rgba(200,149,90,.7);pointer-events:none;letter-spacing:.1px;transition:background .25s,color .25s,border-color .25s}
.stadt-schild{background:rgba(20,22,25,.9);color:#ece9e3}
.stadt-schild i{width:8px;height:8px;border-radius:50%;background:var(--punkt,#c8955a);box-shadow:0 0 0 3px rgba(255,255,255,.12)}
.stadt-schild.zentrale{font-size:13px;border-color:#c8955a}
.stadt-schild.hover{border-color:#e0ad6e}
.stadt-schild.aktiv{background:#c8955a;color:#17130d;border-color:#e0ad6e;box-shadow:0 6px 20px rgba(200,149,90,.45)}
.stadt-schild.aktiv i{box-shadow:0 0 0 3px rgba(0,0,0,.18)}
.stadt-schild.leise{opacity:.55}
.stadt-schild.klein{font-size:11px;padding:4px 8px 4px 6px;gap:5px}.stadt-schild.klein i{width:6px;height:6px}`;

function schild(text: string, punkt: string, extra = '') {
  const d = document.createElement('div');
  d.className = 'stadt-schild ' + extra;
  d.style.setProperty('--punkt', punkt);
  const i = document.createElement('i'); d.appendChild(i); d.appendChild(document.createTextNode(text.length > 30 ? text.slice(0, 29) + '…' : text));
  return new CSS2DObject(d);
}

type Fassade = { tex: THREE.CanvasTexture; em: THREE.CanvasTexture | null };
/** Fassade als Bild: Putz, Gesimse, Fenster mit Rahmen und Bank, Haustür; am Abend zusätzlich eine Leuchtmaske für erleuchtete Fenster */
function fassade(breite: number, etagen: number, s: Stil, seed: number, front: boolean, palette: string[], licht: number): Fassade {
  const pxE = 64, buchten = Math.max(2, Math.round(breite / 0.62));
  const W = buchten * 40, H = etagen * pxE;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  let ge: CanvasRenderingContext2D | null = null, e: HTMLCanvasElement | null = null;
  if (s.abend) { e = document.createElement('canvas'); e.width = W; e.height = H; ge = e.getContext('2d')!; ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H); }
  g.fillStyle = palette[Math.floor(zufall(seed) * palette.length)]; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(0,0,0,${0.015 + zufall(seed * 9 + k) * 0.025})`; g.fillRect(zufall(k + seed) * W, zufall(k * 3 + seed) * H, 2, 2); }
  g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(0, H - pxE, W, pxE);
  g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(0, 0, W, 5);
  for (let f = 1; f < etagen; f++) { g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(0, H - f * pxE - 2, W, 2); }
  for (let f = 0; f < etagen; f++) for (let b = 0; b < buchten; b++) {
    const x = b * 40 + 9, y = H - (f + 1) * pxE + 14, w = 22, h = f === 0 ? 34 : 36;
    if (front && f === 0 && b === Math.floor(buchten / 2)) {
      g.fillStyle = s.rahmen; g.fillRect(x - 3, y - 3, w + 6, pxE - 11); g.fillStyle = '#3b3027'; g.fillRect(x, y, w, pxE - 14);
      if (ge) { ge.fillStyle = '#ffcf80'; ge.fillRect(x + 2, y - 6, w - 4, 3); }
      continue;
    }
    g.fillStyle = s.rahmen; g.fillRect(x - 2, y - 2, w + 4, h + 4);
    g.fillStyle = s.fenster; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(x, y, w, h * 0.4);
    g.fillStyle = s.rahmen; g.fillRect(x + w / 2 - 1, y, 2, h);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x - 3, y + h + 2, w + 6, 3);
    if (ge && zufall(seed * 31 + f * 7 + b * 3) < licht) {
      const warm = zufall(seed + f + b) < 0.9 ? '#ffc56e' : '#d8e6f5';
      ge.fillStyle = warm; ge.fillRect(x, y, w, h); g.fillStyle = warm; g.fillRect(x, y, w, h);
    }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  let em: THREE.CanvasTexture | null = null;
  if (e) { em = new THREE.CanvasTexture(e); em.colorSpace = THREE.SRGBColorSpace; }
  return { tex, em };
}

/** Weg der Verbindung von der Zentrale über die Straßen zum Block (rechte Winkel mit kurzen Fasen) */
function spurPunkte(i: number): THREE.Vector3[] {
  const [ci, cj] = zelle(i);
  const versatz = ((i % 5) - 2) * 0.12;
  const sx = Math.sign(ci) || 1, sz = Math.sign(cj) || 1;
  const tx = ci * RASTER, tz = cj * RASTER;
  const zs = sz * RASTER / 2 + versatz;
  const xs = (ci === 0 ? RASTER / 2 : tx - sx * RASTER / 2) + versatz;
  const roh = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, zs), new THREE.Vector3(xs, 0, zs), new THREE.Vector3(xs, 0, tz), new THREE.Vector3(tx, 0, tz)];
  const p: THREE.Vector3[] = [roh[0]];
  for (let k = 1; k < roh.length - 1; k++) {
    const a = roh[k - 1], m = roh[k], b = roh[k + 1];
    const c = Math.min(0.45, a.distanceTo(m) / 3, m.distanceTo(b) / 3);
    if (c < 0.01) { p.push(m); continue; }
    p.push(m.clone().add(a.clone().sub(m).normalize().multiplyScalar(c)), m.clone().add(b.clone().sub(m).normalize().multiplyScalar(c)));
  }
  p.push(roh[roh.length - 1]);
  return p.filter((x, k) => k === 0 || x.distanceTo(p[k - 1]) > 0.001).map((x) => x.setY(0.03));
}
type Pfad = { punkte: THREE.Vector3[]; laengen: number[]; gesamt: number };
function pfad(punkte: THREE.Vector3[]): Pfad {
  const laengen = [0];
  for (let k = 1; k < punkte.length; k++) laengen.push(laengen[k - 1] + punkte[k].distanceTo(punkte[k - 1]));
  return { punkte, laengen, gesamt: laengen[laengen.length - 1] };
}
function aufPfad(p: Pfad, s: number, pos: THREE.Vector3) {
  const d = Math.max(0, Math.min(p.gesamt, s));
  let k = 1; while (k < p.laengen.length - 1 && p.laengen[k] < d) k++;
  const a = p.punkte[k - 1], b = p.punkte[k], f = (d - p.laengen[k - 1]) / Math.max(1e-6, p.laengen[k] - p.laengen[k - 1]);
  pos.copy(a).lerp(b, f);
}

type Haus = { id: number; gruppe: THREE.Group; koerper: THREE.Mesh; hoehe: number; pos: THREE.Vector3; label: CSS2DObject;
  pfad: Pfad; spur: THREE.Group; spurMat: THREE.MeshBasicMaterial; start: number; neu: boolean; wachsen: THREE.Mesh };

const istDunkel = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dunkel';

export function Stadt3D({ objekte, gewaehlt, onWahl }: { objekte: StadtObjekt[]; gewaehlt: number | null; onWahl: (id: number | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const welt = useRef<{ setzeObjekte: (o: StadtObjekt[]) => void; waehle: (id: number | null) => void } | null>(null);
  const wahlRef = useRef(onWahl); wahlRef.current = onWahl;
  const [abend, setAbend] = useState(istDunkel);

  // Darstellung beobachten: Wechsel auf Dunkel zeigt die Stadt am Abend
  useEffect(() => {
    const mo = new MutationObserver(() => setAbend(istDunkel()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current!;
    const s = abend ? ABEND : TAG;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { el.classList.add('ohne-3d'); return; }
    el.classList.remove('ohne-3d');
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = s.abend ? 1.0 : 0.95;
    el.appendChild(renderer.domElement);
    if (!document.getElementById('stadt-schild-css')) { const st = document.createElement('style'); st.id = 'stadt-schild-css'; st.textContent = SCHILD_CSS; document.head.appendChild(st); }
    const css2d = new CSS2DRenderer();
    Object.assign(css2d.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    el.appendChild(css2d.domElement);

    const szene = new THREE.Scene();
    const texturen: THREE.Texture[] = [];
    const merke = <T extends THREE.Texture>(t: T) => { texturen.push(t); return t; };
    const hc = document.createElement('canvas'); hc.width = 4; hc.height = 256;
    const hg = hc.getContext('2d')!; const lg = hg.createLinearGradient(0, 0, 0, 256); lg.addColorStop(0, s.himmel[0]); lg.addColorStop(1, s.himmel[1]);
    hg.fillStyle = lg; hg.fillRect(0, 0, 4, 256);
    const himmel = merke(new THREE.CanvasTexture(hc)); himmel.colorSpace = THREE.SRGBColorSpace; szene.background = himmel;
    const nebel = new THREE.Fog(s.nebel, 70, 125); szene.fog = nebel;
    const pm = new THREE.PMREMGenerator(renderer);
    const umg = pm.fromScene(new RoomEnvironment(), 0.04); szene.environment = umg.texture; szene.environmentIntensity = s.env; pm.dispose();

    szene.add(new THREE.HemisphereLight(s.himmelOben, s.himmelUnten, s.himmelLicht));
    const sonne = new THREE.DirectionalLight(s.sonnenFarbe, s.sonne);
    sonne.position.set(-22, 34, 16); sonne.castShadow = true;
    sonne.shadow.mapSize.set(2048, 2048); sonne.shadow.bias = -0.0004; sonne.shadow.normalBias = 0.03; sonne.shadow.radius = 4;
    szene.add(sonne, sonne.target);

    const mat = (c: number, r = 0.9, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const boden = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat(s.boden, 1)); boden.rotation.x = -Math.PI / 2; boden.receiveShadow = true; szene.add(boden);

    // KMS-Zentrale: Glas mit Bronze-Lisenen, Vorplatz, KMS-Schriftzug am Dach
    const hq = new THREE.Group(); hq.position.y = SOCKEL; szene.add(hq);
    const glas = new THREE.MeshPhysicalMaterial({ color: s.abend ? 0x1c2630 : 0x6f8496, metalness: 0.7, roughness: 0.12, clearcoat: 1, envMapIntensity: 1.6,
      emissive: s.abend ? 0x7a5428 : 0x000000, emissiveIntensity: s.abend ? 0.55 : 0 });
    const bronze = mat(0x9c7a4a, 0.42, 0.75);
    const band = mat(0x3a4048, 0.5, 0.5);
    for (const [w, h, d, y] of [[3.6, 3.0, 3.6, 0], [2.8, 4.6, 2.8, 3.0], [2.0, 2.4, 2.0, 7.6]] as const) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glas); k.position.y = y + h / 2; k.castShadow = k.receiveShadow = true; hq.add(k);
      const lisene = new THREE.BoxGeometry(0.045, h, 0.045);
      for (let n = -w / 2; n <= w / 2 + 0.01; n += w / 4) for (const [sx, sz] of [[n, d / 2 + 0.03], [n, -d / 2 - 0.03], [w / 2 + 0.03, n], [-w / 2 - 0.03, n]]) {
        const l = new THREE.Mesh(lisene, bronze); l.position.set(sx, y + h / 2, sz); l.castShadow = true; hq.add(l);
      }
      const bandG = new THREE.BoxGeometry(w + 0.03, 0.025, d + 0.03);
      for (let f = y + ETAGE; f < y + h; f += ETAGE) { const b = new THREE.Mesh(bandG, band); b.position.y = f; hq.add(b); }
      const deck = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.12, d + 0.12), bronze); deck.position.y = y + h; deck.castShadow = true; hq.add(deck);
      if (s.abend) for (let f = y + 0.3; f < y + h - 0.2; f += ETAGE) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.22, d - 0.1), new THREE.MeshBasicMaterial({ color: zufall(f * 10) < 0.6 ? 0xffd08a : 0x3a3020 })); l.position.y = f + 0.15; hq.add(l);
      }
    }
    const lc = document.createElement('canvas'); lc.width = 512; lc.height = 160; const lgx = lc.getContext('2d')!;
    // Originales KMS-Zeichen als Vektor: KM hell, S bronze
    { const f = Math.min(480 / 950, 146 / 380); lgx.save(); lgx.translate(256 - (110 + 475) * f, 80 - (18 + 190) * f); lgx.scale(f, f);
      lgx.fillStyle = '#f2f2f0'; lgx.fill(new Path2D(LOGO_KM), 'evenodd'); lgx.fillStyle = '#d4a05a'; lgx.fill(new Path2D(LOGO_S), 'evenodd'); lgx.restore(); }
    const logoTex = merke(new THREE.CanvasTexture(lc)); logoTex.colorSpace = THREE.SRGBColorSpace;
    const logoMat = new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, toneMapped: false });
    for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.6), logoMat); p.position.set(Math.sin(r) * 1.02, 9.4, Math.cos(r) * 1.02); p.rotation.y = r; hq.add(p);
    }
    // Agent O.S.A: Antenne mit pulsierendem Bronze-Licht auf dem Dach
    const antenne = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.1, 8), bronze); antenne.position.y = 10.6; hq.add(antenne);
    const osa = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false })); osa.position.y = 11.2; hq.add(osa);
    const osaRing = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.33, 48), new THREE.MeshBasicMaterial({ color: s.akzent, transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
    osaRing.rotation.x = -Math.PI / 2; osaRing.position.y = 11.2; hq.add(osaRing);
    const osaLicht = new THREE.PointLight(0xffc27a, s.abend ? 6 : 2, 8, 1.6); osaLicht.position.y = 11.2; hq.add(osaLicht);
    const hqSchild = schild('KMS Zentrale · Agent O.S.A', '#c8955a', 'zentrale'); hqSchild.position.set(0, 12.2, 0); hq.add(hqSchild);
    const platz = new THREE.Mesh(new THREE.BoxGeometry(BLOCK - 0.5, 0.02, BLOCK - 0.5), mat(s.platz, 0.85)); platz.position.y = SOCKEL + 0.01; platz.receiveShadow = true; szene.add(platz);
    const hqLaterne: THREE.PointLight[] = [];
    if (s.abend) for (const [x, z] of [[0, 3.6], [3.6, 0], [-3.6, 0], [0, -3.6]]) { const p = new THREE.PointLight(0xffc27a, 6, 9, 1.5); p.position.set(x, 2.2, z); szene.add(p); hqLaterne.push(p); }

    // Umgebung: Straßen, Gehwege, Nachbarhäuser, Parks, Bäume, Autos, Laternen; wird neu gebaut, wenn die Stadt wächst
    const umgebung = new THREE.Group(); szene.add(umgebung);
    let umgebungSchluessel = '';
    let N = 3;
    const mGehweg = mat(s.gehweg, 0.95), mBord = mat(s.bord, 0.9), mRasen = mat(s.rasen, 1), mStrasse = mat(s.strasse, 0.95), mKDach = mat(s.kontextDach, 0.9);
    const kontextFassaden = new Map<string, THREE.MeshStandardMaterial>();
    const kontextMat = (len: number, et: number, variante: number) => {
      const key = `${len.toFixed(2)}|${et}|${variante}`;
      let m = kontextFassaden.get(key);
      if (!m) {
        const f = fassade(len, et, s, 500 + variante * 17 + et * 3 + Math.round(len * 10), false, s.kontext, 0.12);
        merke(f.tex); if (f.em) merke(f.em);
        m = new THREE.MeshStandardMaterial({ map: f.tex, roughness: 0.95, emissive: s.abend ? 0xffffff : 0, emissiveMap: f.em, emissiveIntensity: 0.55 });
        kontextFassaden.set(key, m);
      }
      return m;
    };
    // Köln: Rhein, Dom, Hohenzollernbrücke, Groß St. Martin, Kranhäuser, Deutz mit KölnTriangle
    const koeln = new THREE.Group(); szene.add(koeln);
    {
      const wasser = new THREE.MeshPhysicalMaterial({ color: s.abend ? 0x2b3c4a : 0x6c8796, roughness: s.abend ? 0.08 : 0.18, metalness: 0.15, clearcoat: 0.6, envMapIntensity: s.abend ? 0.9 : 1.1,
        emissive: s.abend ? 0x0d1a24 : 0x000000, emissiveIntensity: 1 });
      const form = new THREE.Shape(), rand = new THREE.Shape();
      const zs: number[] = []; for (let z = -170; z <= 170; z += 4) zs.push(z);
      form.moveTo(rheinW(zs[0]), -zs[0]); for (const z of zs) form.lineTo(rheinW(z), -z); for (const z of [...zs].reverse()) form.lineTo(rheinO(z), -z);
      rand.moveTo(rheinW(zs[0]) - 0.35, -zs[0]); for (const z of zs) rand.lineTo(rheinW(z) - 0.35, -z); for (const z of [...zs].reverse()) rand.lineTo(rheinO(z) + 0.35, -z);
      const fluss = new THREE.Mesh(new THREE.ShapeGeometry(form), wasser); fluss.rotation.x = -Math.PI / 2; fluss.position.y = 0.02; fluss.receiveShadow = true; koeln.add(fluss);
      const kai = new THREE.Mesh(new THREE.ShapeGeometry(rand), mat(s.abend ? 0x3b3b3a : 0xb3aea4, 0.95)); kai.rotation.x = -Math.PI / 2; kai.position.y = 0.015; koeln.add(kai);

      // Kölner Dom: dunkler Sandstein, Westfassade mit zwei Türmen zur Stadt, Chor zum Rhein
      const stein = new THREE.MeshStandardMaterial({ color: s.abend ? 0x6b6256 : 0x5a5650, roughness: 0.95, emissive: s.abend ? 0xffb35c : 0x000000, emissiveIntensity: s.abend ? 0.16 : 0 });
      const steinDach = mat(s.abend ? 0x2c3236 : 0x4a5a5c, 0.7, 0.3);
      const dom = new THREE.Group(); dom.position.set(UFER + 0.9, SOCKEL, -7); koeln.add(dom);
      const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material = stein) => { const k = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); k.position.set(x, y + h / 2, z); k.castShadow = k.receiveShadow = true; dom.add(k); return k; };
      const giebelDach = (laenge: number, breite: number, hoehe: number, x: number, y: number, z: number, quer = false) => {
        const f = new THREE.Shape(); f.moveTo(-breite / 2, 0); f.lineTo(breite / 2, 0); f.lineTo(0, hoehe); f.closePath();
        const g = new THREE.ExtrudeGeometry(f, { depth: laenge, bevelEnabled: false }); g.translate(0, 0, -laenge / 2); if (!quer) g.rotateY(Math.PI / 2);
        const d = new THREE.Mesh(g, steinDach); d.position.set(x, y, z); d.castShadow = true; dom.add(d);
      };
      box(4.6, 2.5, 1.7, 3.3, 0, 0); giebelDach(4.6, 1.8, 1.3, 3.3, 2.5, 0);            // Langhaus
      box(1.4, 2.5, 3.4, 3.4, 0, 0); giebelDach(3.4, 1.5, 1.2, 3.4, 2.5, 0, true);       // Querhaus
      const chor = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.5, 14, 1, false, 0, Math.PI), stein); chor.position.set(5.6, 1.25, 0); chor.castShadow = true; dom.add(chor);
      const chorDach = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.3, 14, 1, false, 0, Math.PI), steinDach); chorDach.position.set(5.6, 3.15, 0); dom.add(chorDach);
      const reiter = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.8, 8), steinDach); reiter.position.set(3.4, 4.6, 0); dom.add(reiter);   // Dachreiter über der Vierung
      const spitz = new THREE.ConeGeometry(0.07, 0.55, 6);
      for (let x = 1.4; x <= 5.4; x += 0.55) for (const z of [-0.95, 0.95]) { const p = new THREE.Mesh(spitz, stein); p.position.set(x, 2.75, z); dom.add(p); }   // Fialen
      for (const z of [-0.62, 0.62]) {
        box(1.15, 5.6, 1.15, 0.45, 0, z); box(1.0, 1.6, 1.0, 0.45, 5.6, z);
        const okt = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.47, 1.9, 8), stein); okt.position.set(0.45, 8.15, z); okt.castShadow = true; dom.add(okt);
        const helm = new THREE.Mesh(new THREE.ConeGeometry(0.42, 3.6, 8), stein); helm.position.set(0.45, 10.9, z); helm.castShadow = true; dom.add(helm);
        const kreuz = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.9, roughness: 0.3 })); kreuz.position.set(0.45, 12.75, z); dom.add(kreuz);
        for (const [dx, dz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.9, 6), stein); f.position.set(0.45 + dx, 7.6, z + dz); dom.add(f); }
      }
      box(0.5, 3.4, 0.5, 0.45, 0, 0);   // Mittelportal zwischen den Türmen
      const domSchild = schild('Kölner Dom', '#8a8174'); domSchild.position.set(0.45, 13.6, 0); dom.add(domSchild);
      if (s.abend) for (const [x, z] of [[-1.2, -1.5], [-1.2, 1.5], [6.8, 0]]) { const l = new THREE.SpotLight(0xffc27a, 14, 18, 0.7, 0.6, 1.2); l.position.set(UFER + 0.9 + x, 0.5, -7 + z); l.target.position.set(UFER + 1.35, 7, -7); koeln.add(l, l.target); }

      // Hohenzollernbrücke: drei Stahlbögen je Seite über den Rhein, nördlich vom Dom
      const stahl = mat(s.abend ? 0x51605a : 0x6e8a80, 0.5, 0.6);
      const bruecke = (z: number, boegen: boolean) => {
        const a = rheinW(z) - 1.2, b = rheinO(z) + 1.2, l = b - a;
        const deck = new THREE.Mesh(new THREE.BoxGeometry(l, 0.2, boegen ? 1.9 : 1.5), mat(s.abend ? 0x2c2e31 : 0x8a8d90, 0.8)); deck.position.set((a + b) / 2, 0.7, z); deck.castShadow = deck.receiveShadow = true; koeln.add(deck);
        const fl = rheinW(z), w = rheinO(z) - fl;
        for (let k = 1; k < 3; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, boegen ? 2.1 : 1.6), mat(0x9b958a, 0.9)); p.position.set(fl + (w * k) / 3, 0.2, z); koeln.add(p); }
        if (!boegen) return;
        for (let k = 0; k < 3; k++) for (const dz of [-0.85, 0.85]) {
          const x0 = fl + (w * k) / 3, x1 = fl + (w * (k + 1)) / 3, pts: THREE.Vector3[] = [];
          for (let t = 0; t <= 1.0001; t += 0.1) pts.push(new THREE.Vector3(x0 + (x1 - x0) * t, 0.8 + 1.9 * Math.sin(Math.PI * t), z + dz));
          const bogen = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.07, 6), stahl); bogen.castShadow = true; koeln.add(bogen);
          if (s.abend) for (const p of pts.slice(1, -1)) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false })); l.position.copy(p).y += 0.08; koeln.add(l); }
          for (let t = 0.12; t < 0.9; t += 0.11) { const hh = 1.9 * Math.sin(Math.PI * t); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, hh, 4), stahl); st.position.set(x0 + (x1 - x0) * t, 0.8 + hh / 2, z + dz); koeln.add(st); }
        }
      };
      bruecke(-10.5, true); bruecke(10.5, false);   // Hohenzollernbrücke und Deutzer Brücke

      // Groß St. Martin: romanischer Vierungsturm mit vier Ecktürmchen, südlich vom Dom am Ufer
      const gsm = new THREE.Group(); gsm.position.set(UFER + 2.4, SOCKEL, 2.6); koeln.add(gsm);
      const gk = (w: number, h: number, d: number, x: number, y: number, z: number) => { const k = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stein); k.position.set(x, y + h / 2, z); k.castShadow = k.receiveShadow = true; gsm.add(k); };
      gk(3.0, 1.6, 1.3, 0, 0, 0); gk(1.3, 1.6, 2.6, 0.6, 0, 0); gk(1.25, 3.6, 1.25, 0.6, 0, 0);
      const gHelm = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.4, 4), steinDach); gHelm.position.set(0.6, 4.3, 0); gHelm.rotation.y = Math.PI / 4; gsm.add(gHelm);
      for (const [dx, dz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) { gk(0.32, 3.9, 0.32, 0.6 + dx, 0, dz); const h = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.8, 4), steinDach); h.position.set(0.6 + dx, 4.3, dz); h.rotation.y = Math.PI / 4; gsm.add(h); }

      // Kranhäuser im Rheinauhafen: drei umgedrehte L, der Arm ragt zum Rhein
      const kranGlas = new THREE.MeshPhysicalMaterial({ color: s.abend ? 0x253038 : 0xb9c3cb, metalness: 0.5, roughness: 0.15, clearcoat: 1, emissive: s.abend ? 0x6a4a22 : 0, emissiveIntensity: s.abend ? 0.45 : 0 });
      const kranStahl = mat(s.abend ? 0x3b3f44 : 0xe8e8e6, 0.5, 0.3);
      for (const z of [12.5, 17.5, 22.5]) {
        const x0 = UFER + 1.6, arm = rheinW(z) + 1.0 - x0;
        for (const [w, h, d, x, y] of [[1.2, 6.2, 1.4, x0, 0], [arm + 0.6, 1.3, 1.4, x0 + arm / 2, 4.9]] as const) {
          const k = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), kranGlas); k.position.set(x, SOCKEL + y + h / 2, z); k.castShadow = k.receiveShadow = true; koeln.add(k);
          const r = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.08, d + 0.06), kranStahl); r.position.set(x, SOCKEL + y + h, z); koeln.add(r);
        }
        for (const dz of [-0.75, 0.75]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.08, 6.2, 0.08), kranStahl); st.position.set(x0 + 0.62, SOCKEL + 3.1, z + dz); koeln.add(st); }
      }

      // Deutz: Häuser gegenüber, KölnTriangle an der Hohenzollernbrücke
      const deutzStrasse = new THREE.Mesh(new THREE.PlaneGeometry(60, 340), mStrasse); deutzStrasse.rotation.x = -Math.PI / 2; deutzStrasse.position.set(rheinO(0) + 32, 0.008, 0); koeln.add(deutzStrasse);
      const dPlatte = mat(s.gehweg, 0.95);
      for (let gx = 0; gx < 6; gx++) for (let gz = -9; gz <= 9; gz++) {
        const x = rheinO(gz * RASTER) + 4.5 + gx * RASTER, z = gz * RASTER;
        const p = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, SOCKEL, BLOCK), dPlatte); p.position.set(x, SOCKEL / 2, z); p.receiveShadow = true; koeln.add(p);
        if (gx === 0 && gz === -2) {   // KölnTriangle
          const t = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 11.5, 3), new THREE.MeshPhysicalMaterial({ color: s.abend ? 0x1c2630 : 0x7d93a6, metalness: 0.7, roughness: 0.12, clearcoat: 1, emissive: s.abend ? 0x2c4a66 : 0, emissiveIntensity: s.abend ? 0.7 : 0 })); t.position.set(x, SOCKEL + 5.75, z); t.rotation.y = 0.4; t.castShadow = true; koeln.add(t);
          const kr = new THREE.Mesh(new THREE.CylinderGeometry(1.58, 1.58, 0.25, 3), bronze); kr.position.set(x, SOCKEL + 11.6, z); kr.rotation.y = 0.4; koeln.add(kr);
          continue;
        }
        if (zufall(gx * 19 + gz * 7) < 0.15) continue;
        const et = 3 + Math.floor(zufall(gx * 3 + gz * 11) * 3), hh = et * ETAGE, v = Math.floor(zufall(gx + gz * 5) * 4), mSeite = kontextMat(BLOCK - 0.6, et, v);
        const k = new THREE.Mesh(new THREE.BoxGeometry(BLOCK - 0.6, hh, BLOCK - 0.6), [mSeite, mSeite, mKDach, mKDach, mSeite, mSeite]); k.position.set(x, SOCKEL + hh / 2, z); k.castShadow = k.receiveShadow = true; koeln.add(k);
      }
      // Colonius (Fernsehturm) im Hintergrund
      const col = new THREE.Group(); col.position.set(-38, 0, -46); koeln.add(col);
      const sch = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 20, 12), mat(s.abend ? 0x4a4c50 : 0xd8d8d4, 0.7)); sch.position.y = 10; col.add(sch);
      const korb = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.1, 1.4, 16), mat(s.abend ? 0x3a3d42 : 0xc9c9c4, 0.6)); korb.position.y = 17; col.add(korb);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 6, 6), mat(0xb54a3c, 0.6)); ant.position.y = 23; col.add(ant);
    }

    const lichtFleck = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
      const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32); rg.addColorStop(0, 'rgba(255,255,255,.9)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
      return merke(new THREE.CanvasTexture(c));
    })();
    const umgebungBauen = (belegt: Set<string>) => {
      const neuerN = Math.max(3, ...[...belegt].map((k) => Math.max(...k.split(',').map((x) => Math.abs(Number(x)))))) + 2;
      const schluessel = neuerN + '|' + [...belegt].sort().join(';');
      if (schluessel === umgebungSchluessel) return;
      umgebungSchluessel = schluessel; N = neuerN;
      umgebung.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
      umgebung.clear();
      const weite = (2 * N + 1) * RASTER + STRASSE;
      const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(UFER + weite / 2, weite), mStrasse); asphalt.rotation.x = -Math.PI / 2; asphalt.position.set((UFER - weite / 2) / 2, 0.01, 0); asphalt.receiveShadow = true; umgebung.add(asphalt);
      // Fahrbahnmarkierung zwischen den Kreuzungen
      const striche: [number, number, boolean][] = [];
      for (let k = -N - 1; k <= N; k++) for (let t = -weite / 2 + 0.6; t < weite / 2; t += 1.1) {
        if (Math.abs(t - Math.round(t / RASTER) * RASTER) > BLOCK / 2 - 0.3) continue;
        if (t < UFER - 0.6) striche.push([t, (k + 0.5) * RASTER, false]);
        if ((k + 0.5) * RASTER < UFER - 0.6) striche.push([(k + 0.5) * RASTER, t, true]);
      }
      const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.55, 0.06), new THREE.MeshBasicMaterial({ color: s.markierung }), striche.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(), eins = new THREE.Vector3(1, 1, 1);
      striche.forEach(([a, b, quer], i) => { eu.set(-Math.PI / 2, 0, quer ? Math.PI / 2 : 0); q.setFromEuler(eu); m4.compose(new THREE.Vector3(a, 0.02, b), q, eins); im.setMatrixAt(i, m4); });
      umgebung.add(im);
      // Blöcke
      const bordG = new THREE.BoxGeometry(BLOCK + 0.12, 0.14, BLOCK + 0.12), platteG = new THREE.BoxGeometry(BLOCK, SOCKEL, BLOCK);
      const bordI = new THREE.InstancedMesh(bordG, mBord, (2 * N + 1) ** 2), platteI = new THREE.InstancedMesh(platteG, mGehweg, (2 * N + 1) ** 2);
      bordI.receiveShadow = platteI.receiveShadow = true;
      const baumOrte: [number, number, number][] = [];
      let n = 0;
      for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
        const cx = i * RASTER, cz = j * RASTER;
        if (i >= 2) continue;   // Rheinufer
        m4.makeTranslation(cx, 0.07, cz); bordI.setMatrixAt(n, m4); m4.makeTranslation(cx, SOCKEL / 2, cz); platteI.setMatrixAt(n, m4); n++;
        if (!i && !j) continue;
        const e2 = BLOCK / 2 - 0.35;
        if (belegt.has(`${i},${j}`)) { for (const [dx, dz] of [[e2, e2], [-e2, e2], [e2, -e2], [-e2, -e2]]) baumOrte.push([cx + dx, cz + dz, 0.75]); continue; }
        if (Math.hypot(cx - 19.5, cz) < RING && zufall(i * 17 + j * 29 + 3) < 0.82) {
          // Blockrandbebauung in ruhigen Tönen
          const L = BLOCK - 0.5, T = 1.15, off = L / 2 - T / 2;
          for (let sd = 0; sd < 4; sd++) {
            const et = 3 + Math.floor(zufall(i * 5 + j * 3 + sd) * 3), hh = et * ETAGE, len = sd < 2 ? L : L - 2 * T, v = Math.floor(zufall(i * 13 + j * 7 + sd) * 4);
            const ma = kontextMat(len, et, v), mb = kontextMat(T, et, v);
            const k2 = new THREE.Mesh(new THREE.BoxGeometry(len, hh, T), [mb, mb, mKDach, mKDach, ma, ma]);
            k2.castShadow = k2.receiveShadow = true;
            if (sd === 0) k2.position.set(cx, SOCKEL + hh / 2, cz + off);
            if (sd === 1) k2.position.set(cx, SOCKEL + hh / 2, cz - off);
            if (sd === 2) { k2.position.set(cx + off, SOCKEL + hh / 2, cz); k2.rotation.y = Math.PI / 2; }
            if (sd === 3) { k2.position.set(cx - off, SOCKEL + hh / 2, cz); k2.rotation.y = Math.PI / 2; }
            umgebung.add(k2);
          }
          const hof = new THREE.Mesh(new THREE.BoxGeometry(L - 2 * T, 0.03, L - 2 * T), mRasen); hof.position.set(cx, SOCKEL + 0.02, cz); hof.receiveShadow = true; umgebung.add(hof);
          baumOrte.push([cx + 0.3, cz - 0.2, 0.8]);
        } else {
          const r = new THREE.Mesh(new THREE.BoxGeometry(BLOCK - 1.0, 0.04, BLOCK - 1.0), mRasen); r.position.set(cx, SOCKEL + 0.02, cz); r.receiveShadow = true; umgebung.add(r);
          const anz = 4 + Math.floor(zufall(i * 31 + j) * 4);
          for (let k = 0; k < anz; k++) baumOrte.push([cx + (zufall(i * 7 + j * 13 + k) - 0.5) * (BLOCK - 1.8), cz + (zufall(i * 11 + j * 5 + k * 3) - 0.5) * (BLOCK - 1.8), 0.9 + zufall(k + i + j) * 0.6]);
        }
      }
      bordI.count = platteI.count = n;
      umgebung.add(bordI, platteI);
      // Rheinboulevard: Promenade zwischen Altstadt und Rhein, mit Baumreihe am Wasser
      const prom = new THREE.Mesh(new THREE.PlaneGeometry(rheinW(0) + 4 - UFER, weite + 40), mat(s.platz, 0.9)); prom.rotation.x = -Math.PI / 2;
      prom.position.set((UFER + rheinW(0) + 4) / 2, 0.012, 0); prom.receiveShadow = true; umgebung.add(prom);
      for (let z = -weite / 2; z < weite / 2; z += 2.4) {
        if ((z > -12 && z < -3.5) || (z > 9 && z < 25) || Math.abs(z + 10.5) < 1.6 || Math.abs(z - 10.5) < 1.6) continue;
        baumOrte.push([rheinW(z) - 1.1, z, 0.85]);
      }
      // Bäume: Stamm und drei Kronenkugeln, leicht unterschiedliche Grüntöne
      const stammG = new THREE.CylinderGeometry(0.05, 0.08, 0.7, 6); stammG.translate(0, 0.35, 0);
      const stamm = new THREE.InstancedMesh(stammG, mat(s.stamm, 1), baumOrte.length);
      const krone = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.4, 2), mat(0xffffff, 0.95), baumOrte.length * 3);
      stamm.castShadow = krone.castShadow = true; krone.receiveShadow = true;
      const sk = new THREE.Vector3(), col = new THREE.Color(), q0 = new THREE.Quaternion();
      baumOrte.forEach(([x, z, g], k) => {
        m4.compose(new THREE.Vector3(x, SOCKEL, z), q0, sk.set(g, g, g)); stamm.setMatrixAt(k, m4);
        for (let c = 0; c < 3; c++) {
          const a = c * 2.1 + k, r = c ? 0.18 * g : 0, f = g * (c === 0 ? 1.05 : 0.8);
          m4.compose(new THREE.Vector3(x + Math.cos(a) * r, SOCKEL + g * (0.85 + (c ? 0.1 : 0.25)), z + Math.sin(a) * r), q0, sk.set(f, f * 1.05, f));
          krone.setMatrixAt(k * 3 + c, m4); krone.setColorAt(k * 3 + c, col.set(s.baum[(k + c) % s.baum.length]).offsetHSL(0, 0, (zufall(k * 3 + c) - 0.5) * 0.06));
        }
      });
      umgebung.add(stamm, krone);
      // Geparkte und fahrende Autos am Straßenrand
      const farben = s.abend ? [0x2c2f34, 0x3a3d42, 0x4a3f36, 0x1f2329] : [0xe9e9e6, 0x2b2e33, 0x6e7680, 0x8a1f24, 0x1f3b5c, 0xbfc3c7];
      const kdG = new THREE.BoxGeometry(0.95, 0.24, 0.44), kabG = new THREE.BoxGeometry(0.52, 0.2, 0.4), lG = new THREE.SphereGeometry(0.045, 8, 8);
      const kabM = mat(0x1c2026, 0.15, 0.6), lackM = farben.map((f) => new THREE.MeshPhysicalMaterial({ color: f, roughness: 0.3, metalness: 0.6, clearcoat: 1 }));
      const vorneM = new THREE.MeshBasicMaterial({ color: 0xfff1d0, toneMapped: false }), hintenM = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false });
      for (let k = 0; k < N * 9; k++) {
        const quer = zufall(k * 5) < 0.5, spur = (Math.floor(zufall(k * 7) * (2 * N + 2)) - N - 0.5) * RASTER;
        const t = (zufall(k * 11) - 0.5) * (weite - 4);
        if (Math.abs(t - Math.round(t / RASTER) * RASTER) > BLOCK / 2 - 0.5) continue;
        if ((quer ? spur : t) > UFER - 1) continue;
        const seite = zufall(k * 13) < 0.5 ? -0.42 : 0.42;
        const a = new THREE.Group();
        const kd = new THREE.Mesh(kdG, lackM[k % lackM.length]); kd.position.y = 0.2; kd.castShadow = true; a.add(kd);
        const kab = new THREE.Mesh(kabG, kabM); kab.position.set(-0.05, 0.4, 0); kab.castShadow = true; a.add(kab);
        if (s.abend) for (const zz of [-0.13, 0.13]) { const v = new THREE.Mesh(lG, vorneM); v.position.set(0.48, 0.22, zz); const h = new THREE.Mesh(lG, hintenM); h.position.set(-0.48, 0.22, zz); a.add(v, h); }
        if (quer) { a.position.set(spur + seite, 0, t); a.rotation.y = seite > 0 ? Math.PI / 2 : -Math.PI / 2; } else { a.position.set(t, 0, spur + seite); a.rotation.y = seite > 0 ? Math.PI : 0; }
        umgebung.add(a);
      }
      // Straßenlaternen am Abend
      if (s.abend) {
        const orte: [number, number][] = [];
        for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) for (const [dx, dz] of [[BLOCK / 2 - 0.15, 0], [0, BLOCK / 2 - 0.15]]) if (i < 2) orte.push([i * RASTER + dx, j * RASTER + dz]);
        const mast = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.035, 1.3, 6), mat(0x2a2c30, 0.6, 0.6), orte.length);
        const kopf = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }), orte.length);
        const fleckG = new THREE.CircleGeometry(1.1, 24); fleckG.rotateX(-Math.PI / 2);
        const fleck = new THREE.InstancedMesh(fleckG, new THREE.MeshBasicMaterial({ map: lichtFleck, color: 0xffb860, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }), orte.length);
        orte.forEach(([x, z], k) => {
          m4.makeTranslation(x, 0.81, z); mast.setMatrixAt(k, m4);
          m4.makeTranslation(x, 1.48, z); kopf.setMatrixAt(k, m4);
          m4.makeTranslation(x, SOCKEL + 0.015, z); fleck.setMatrixAt(k, m4);
        });
        umgebung.add(mast, kopf, fleck);
      }
      const r = (N + 1) * RASTER;
      Object.assign(sonne.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 140 });
      sonne.shadow.camera.updateProjectionMatrix();
    };

    // Häuser
    const haeuser = new Map<number, Haus>();
    const stadt = new THREE.Group(); szene.add(stadt);
    let bekannt: number[] = [];
    try { bekannt = JSON.parse(localStorage.getItem(BEKANNT) ?? '[]'); } catch { /* egal */ }
    const ersteSicht = bekannt.length === 0;
    const dachMat = mat(s.dach, 0.8), attikaMat = mat(s.attika, 0.85), aufbauMat = mat(s.abend ? 0x55524d : 0x8b8882, 0.8), pvMat = mat(0x1e2633, 0.3, 0.4);
    const balkonMat = mat(s.abend ? 0x55524d : 0xd9d6cf, 0.8), gelaenderMat = mat(0x3d4148, 0.4, 0.5);
    const fenstermat = (f: Fassade, starke: number) => {
      merke(f.tex); if (f.em) merke(f.em);
      return new THREE.MeshStandardMaterial({ map: f.tex, roughness: 0.92, emissive: s.abend ? 0xffffff : 0x000000, emissiveMap: f.em, emissiveIntensity: starke });
    };

    const bauen = (o: StadtObjekt, i: number, verzoegerung: number) => {
      const [ci, cj] = zelle(i);
      const einheiten = Math.max(1, Number(o.einheiten) || 1);
      const etagen = Math.max(2, Math.min(8, Math.round(einheiten / 3) + 2));
      const h = etagen * ETAGE;
      const b = 2.8 + Math.min(1.4, einheiten / 18), t = 2.4 + zufall(o.id) * 0.8;
      const gruppe = new THREE.Group(); gruppe.position.set(ci * RASTER, SOCKEL, cj * RASTER);
      const innen = new THREE.Group(); gruppe.add(innen);
      innen.rotation.y = Math.abs(ci) >= Math.abs(cj) ? (ci > 0 ? -Math.PI / 2 : Math.PI / 2) : (cj > 0 ? 0 : Math.PI);
      const seed = o.id * 7 + 1;
      const pal = s.putz;
      const fl = fenstermat(fassade(b, etagen, s, seed, true, pal, 0.42), 1.6), sl = fenstermat(fassade(t, etagen, s, seed, false, pal, 0.42), 1.6), rl = fenstermat(fassade(b, etagen, s, seed + 20, false, pal, 0.42), 1.6);
      const koerper = new THREE.Mesh(new THREE.BoxGeometry(b, h, t), [sl, sl, dachMat, dachMat, fl, rl]);
      koerper.position.y = h / 2; koerper.castShadow = koerper.receiveShadow = true; koerper.userData.id = o.id; innen.add(koerper);
      let dachHoehe = 0;
      if (einheiten <= 6) {
        // Satteldach mit Giebeln
        const form = new THREE.Shape(); form.moveTo(-t / 2 - 0.12, 0); form.lineTo(t / 2 + 0.12, 0); form.lineTo(0, 0.95); form.closePath();
        const dg = new THREE.ExtrudeGeometry(form, { depth: b + 0.16, bevelEnabled: false }); dg.translate(0, 0, -(b + 0.16) / 2); dg.rotateY(Math.PI / 2);
        const d = new THREE.Mesh(dg, dachMat); d.position.y = h; d.castShadow = d.receiveShadow = true; d.userData.id = o.id; innen.add(d);
        const giebel = new THREE.Shape(); giebel.moveTo(-t / 2, 0); giebel.lineTo(t / 2, 0); giebel.lineTo(0, 0.88); giebel.closePath();
        const gm = new THREE.MeshStandardMaterial({ color: pal[Math.floor(zufall(seed) * pal.length)], roughness: 0.92 });
        for (const sx of [-1, 1]) { const gg = new THREE.Mesh(new THREE.ShapeGeometry(giebel), gm); gg.rotation.y = sx * Math.PI / 2; gg.position.set(sx * (b / 2 + 0.001), h, 0); innen.add(gg); }
        dachHoehe = 0.95;
      } else {
        // Flachdach mit Attika, Treppenhausaufbau und Solarmodulen
        for (const [w, d2, x, z] of [[b, 0.08, 0, t / 2 - 0.04], [b, 0.08, 0, -t / 2 + 0.04], [0.08, t, b / 2 - 0.04, 0], [0.08, t, -b / 2 + 0.04, 0]]) {
          const a = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d2), attikaMat); a.position.set(x, h + 0.08, z); a.castShadow = true; innen.add(a);
        }
        const auf = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45, 0.7), aufbauMat); auf.position.set(-b * 0.2, h + 0.22, 0); auf.castShadow = true; innen.add(auf);
        const pv = new THREE.Mesh(new THREE.BoxGeometry(b * 0.35, 0.04, t * 0.5), pvMat); pv.position.set(b * 0.22, h + 0.05, 0); pv.rotation.z = 0.15; innen.add(pv);
        dachHoehe = 0.45;
      }
      if (einheiten >= 8) {
        const bkG = new THREE.BoxGeometry(0.7, 0.05, 0.35), glG = new THREE.BoxGeometry(0.7, 0.18, 0.02);
        for (let f = 1; f < etagen; f++) for (const x of [-b * 0.25, b * 0.25]) {
          const bk = new THREE.Mesh(bkG, balkonMat); bk.position.set(x, f * ETAGE + 0.02, -t / 2 - 0.17); bk.castShadow = true; innen.add(bk);
          const gl = new THREE.Mesh(glG, gelaenderMat); gl.position.set(x, f * ETAGE + 0.12, -t / 2 - 0.34); innen.add(gl);
        }
      }
      const label = schild(o.name, ART_FARBE[o.verwaltungsart] ?? '#c8955a'); label.position.set(0, h + dachHoehe + 0.7, 0); gruppe.add(label);
      // Rahmen am Boden: wählt man das Haus, leuchtet er in Bronze; beim Wachsen pulsiert er
      const r = Math.max(b, t) / 2 + 0.75;
      const wachsen = new THREE.Mesh(new THREE.RingGeometry(r * Math.SQRT2 - 0.06, r * Math.SQRT2 + 0.06, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({ color: s.akzent, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
      wachsen.rotation.x = -Math.PI / 2; wachsen.position.y = 0.03; gruppe.add(wachsen);
      gruppe.scale.set(1, 0.001, 1); label.visible = false;
      stadt.add(gruppe);
      // Verbindung zur Zentrale: feine Linie auf der Straße
      const pf = pfad(spurPunkte(i));
      const spurMat = new THREE.MeshBasicMaterial({ color: s.akzent, transparent: true, opacity: 0, toneMapped: !s.abend, depthWrite: false });
      const spur = new THREE.Group();
      for (let k = 1; k < pf.punkte.length; k++) {
        const a = pf.punkte[k - 1], c = pf.punkte[k], l = a.distanceTo(c);
        const seg = new THREE.Mesh(new THREE.PlaneGeometry(l + 0.05, 0.05), spurMat);
        seg.rotation.x = -Math.PI / 2; seg.rotation.z = -Math.atan2(c.z - a.z, c.x - a.x); seg.position.copy(a).lerp(c, 0.5); spur.add(seg);
      }
      szene.add(spur);
      haeuser.set(o.id, { id: o.id, gruppe, koerper, hoehe: h + dachHoehe, pos: gruppe.position.clone(), label, pfad: pf, spur, spurMat,
        start: performance.now() / 1000 + verzoegerung, neu: !ersteSicht && !bekannt.includes(o.id), wachsen });
    };
    const entfernen = (h: Haus) => {
      stadt.remove(h.gruppe); szene.remove(h.spur);
      for (const g of [h.gruppe, h.spur]) g.traverse((o) => {
        const m = o as THREE.Mesh; if (!m.isMesh) return; m.geometry.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { const sm = x as THREE.MeshStandardMaterial; if (sm.map && !texturen.includes(sm.map)) sm.map.dispose(); x.dispose(); });
      });
      h.label.element.remove();
    };

    // Lichtpunkte auf den Verbindungen
    const punktGeo = new THREE.SphereGeometry(0.07, 12, 12);
    type Puls = { m: THREE.Mesh; h: Haus; s: number; v: number; rueck: boolean };
    const pulse: Puls[] = [];
    const puls = (h: Haus, rueck: boolean, farbe: number, gross = 1) => {
      const m = new THREE.Mesh(punktGeo, new THREE.MeshBasicMaterial({ color: farbe, transparent: true, toneMapped: false }));
      m.scale.setScalar(gross); szene.add(m); pulse.push({ m, h, s: 0, v: 6 + Math.random() * 3, rueck });
    };

    // Kamera: Blick schräg von oben (etwa 33°), passt die Stadt oder das gewählte Haus ins Bild
    const kamera = new THREE.PerspectiveCamera(30, 1, 0.5, 600);
    const NEIGUNG = 0.58;
    let winkel = 0.15, zoom = 1, entfernung = 80, zielEntfernung = 60;
    const ziel = new THREE.Vector3(), zielPunkt = new THREE.Vector3(0, 2, 0);
    let wahl: number | null = null, ueber: number | null = null;
    const passend = (radius: number) => {
      const vf = THREE.MathUtils.degToRad(kamera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * kamera.aspect);
      return (radius * 1.08) / Math.tan(Math.min(vf, hf) / 2);
    };
    const fokus = (id: number | null) => {
      wahl = id;
      const h = id != null ? haeuser.get(id) : null;
      if (h) { zielPunkt.set(h.pos.x, h.hoehe * 0.45, h.pos.z); zielEntfernung = passend(Math.max(4.2, h.hoehe * 0.75)); winkel = Math.atan2(h.pos.z, h.pos.x) + 0.32; }
      else {
        const r = Math.max(RASTER * 2.4, ...[...haeuser.values()].map((x) => Math.max(Math.abs(x.pos.x), Math.abs(x.pos.z)))) + RASTER * 0.35;
        zielPunkt.set(7, 2, -1); zielEntfernung = passend(r);
      }
      zoom = 1;
      for (const x of haeuser.values()) x.label.element.classList.toggle('aktiv', x.id === id);
    };

    welt.current = {
      setzeObjekte: (liste) => {
        const sortiert = [...liste].sort((a, b) => a.id - b.id);
        const ids = new Set(sortiert.map((o) => o.id));
        for (const [id, h] of haeuser) if (!ids.has(id)) { entfernen(h); haeuser.delete(id); }
        let neuZahl = 0;
        sortiert.forEach((o, i) => {
          const h = haeuser.get(o.id);
          const [ci, cj] = zelle(i);
          if (h && (h.pos.x !== ci * RASTER || h.pos.z !== cj * RASTER)) { entfernen(h); haeuser.delete(o.id); }
          if (!haeuser.has(o.id)) bauen(o, i, 0.3 + (ersteSicht ? i * 0.1 : bekannt.includes(o.id) ? i * 0.04 : 1.0 + neuZahl++ * 0.5));
        });
        umgebungBauen(new Set(sortiert.map((_, i) => zelle(i).join(','))));
        try { localStorage.setItem(BEKANNT, JSON.stringify(sortiert.map((o) => o.id))); } catch { /* egal */ }
        fokus(wahl);
      },
      waehle: fokus,
    };

    // Nachbearbeitung: Umgebungsverdeckung für weiche Kontaktschatten, am Abend leichtes Leuchten
    const komp = new EffectComposer(renderer);
    komp.addPass(new RenderPass(szene, kamera));
    if (renderer.capabilities.isWebGL2) {
      try { const ao = new GTAOPass(szene, kamera, 1, 1); ao.blendIntensity = s.abend ? 0.6 : 0.9; ao.updateGtaoMaterial({ radius: 0.6, distanceFallOff: 1, thickness: 1.5 }); komp.addPass(ao); }
      catch { /* ohne Verdeckung */ }
    }
    if (s.abend) komp.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.5, 0.82));
    komp.addPass(new OutputPass());

    // Bedienung: ziehen dreht, Mausrad zoomt, Klick wählt ein Haus
    const ray = new THREE.Raycaster(), maus = new THREE.Vector2();
    let zieh: { x: number; w: number; bewegt: boolean } | null = null;
    const runter = (e: PointerEvent) => { zieh = { x: e.clientX, w: winkel, bewegt: false }; };
    const bewegen = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      maus.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (zieh) { const d = e.clientX - zieh.x; if (Math.abs(d) > 4) zieh.bewegt = true; winkel = zieh.w - d * 0.006; }
      ray.setFromCamera(maus, kamera);
      const ziele: THREE.Object3D[] = []; for (const h of haeuser.values()) h.gruppe.traverse((o) => { if (o.userData.id != null) ziele.push(o); });
      const treffer = ray.intersectObjects(ziele, false)[0];
      const neu = treffer ? (treffer.object.userData.id as number) : null;
      if (neu !== ueber) { for (const h of haeuser.values()) h.label.element.classList.toggle('hover', h.id === neu); ueber = neu; }
      renderer.domElement.style.cursor = treffer ? 'pointer' : zieh ? 'grabbing' : 'grab';
    };
    const hoch = () => { if (zieh && !zieh.bewegt) wahlRef.current(ueber ?? null); zieh = null; };
    const rad = (e: WheelEvent) => { e.preventDefault(); zoom = Math.max(0.35, Math.min(1.8, zoom * (1 + e.deltaY * 0.001))); };
    renderer.domElement.addEventListener('pointerdown', runter);
    renderer.domElement.addEventListener('pointermove', bewegen);
    window.addEventListener('pointerup', hoch);
    renderer.domElement.addEventListener('wheel', rad, { passive: false });

    let obenFrei = 10, hoehePx = 1;
    const groesse = () => {
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
      hoehePx = h;
      const legende = el.parentElement?.querySelector('.leit-legende');
      obenFrei = legende ? Math.max(10, legende.getBoundingClientRect().bottom - el.getBoundingClientRect().top + 6) : 10;
      renderer.setSize(w, h); komp.setPixelRatio(renderer.getPixelRatio()); komp.setSize(w, h); css2d.setSize(w, h);
      kamera.aspect = w / h; kamera.updateProjectionMatrix(); fokus(wahl);
    };
    const ro = new ResizeObserver(groesse); ro.observe(el); groesse();
    fokus(null); ziel.copy(zielPunkt); entfernung = zielEntfernung * 1.5;

    const wp = new THREE.Vector3();
    const alleSchilder = function* () { yield hqSchild; for (const h of haeuser.values()) yield h.label; };
    let raf = 0, letzt = performance.now() / 1000, naechsterPuls = 0, naechsterWahlPuls = 0;
    const weiss = new THREE.Color(s.abend ? 0xffe0b0 : 0xffffff), bronzeHell = new THREE.Color(0xffd08a);
    const lauf = () => {
      raf = requestAnimationFrame(lauf);
      const t = performance.now() / 1000, dt = Math.min(0.05, t - letzt); letzt = t;
      if (!zieh && wahl == null) winkel += dt * 0.035;
      ziel.lerp(zielPunkt, 0.05); entfernung += (zielEntfernung * zoom - entfernung) * 0.05;
      kamera.position.set(ziel.x + Math.cos(winkel) * Math.cos(NEIGUNG) * entfernung, ziel.y + Math.sin(NEIGUNG) * entfernung, ziel.z + Math.sin(winkel) * Math.cos(NEIGUNG) * entfernung);
      kamera.lookAt(ziel);
      nebel.near = entfernung * 0.95; nebel.far = entfernung * 2.1;
      sonne.position.set(ziel.x - 22, 34, ziel.z + 16); sonne.target.position.copy(ziel);

      // Agent O.S.A pulsiert
      const p0 = (t * 0.6) % 1; osaRing.scale.setScalar(1 + p0 * 2.2); (osaRing.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - p0);
      osaLicht.intensity = (s.abend ? 6 : 2) * (0.75 + Math.sin(t * 3) * 0.25);

      for (const h of haeuser.values()) {
        const p = Math.max(0, Math.min(1, (t - h.start) / (h.neu ? 1.8 : 1.1)));
        const e = p < 1 ? 1 + 2.4 * Math.pow(p - 1, 3) + 1.4 * Math.pow(p - 1, 2) : 1;
        h.gruppe.scale.set(1, Math.max(0.001, p === 0 ? 0.001 : e), 1);
        h.label.visible = p > 0.85;
        h.label.element.classList.toggle('leise', wahl != null && wahl !== h.id);
        h.label.element.classList.toggle('klein', haeuser.size > 8 && wahl !== h.id);
        const an = wahl === h.id;
        const wm = h.wachsen.material as THREE.MeshBasicMaterial;
        const zielRahmen = an ? 0.7 + Math.sin(t * 4) * 0.25 : h.neu && p > 0 && p < 1 ? 0.5 + Math.sin(t * 8) * 0.4 : ueber === h.id ? 0.45 : 0;
        wm.opacity += (zielRahmen - wm.opacity) * 0.15;
        const zielLinie = p < 0.6 ? 0 : wahl == null ? 0.7 : an ? 1 : 0.2;
        h.spurMat.opacity += (zielLinie - h.spurMat.opacity) * 0.08;
        if (h.neu && p >= 1) h.neu = false;
      }
      // Lichtpunkte: ab und zu ins Netz, zum gewählten Haus ein ruhiger Strom
      const fertig = [...haeuser.values()].filter((h) => t > h.start + 1.2);
      if (t > naechsterPuls && fertig.length) {
        naechsterPuls = t + (wahl == null ? 0.45 : 1.1);
        const h = fertig[Math.floor(Math.random() * fertig.length)];
        if (wahl == null || h.id !== wahl) puls(h, Math.random() < 0.4, Math.random() < 0.6 ? weiss.getHex() : bronzeHell.getHex(), 0.9);
      }
      const gw = wahl != null ? haeuser.get(wahl) : null;
      if (gw && t > naechsterWahlPuls && t > gw.start + 1.2) { naechsterWahlPuls = t + 0.3; puls(gw, Math.random() < 0.35, bronzeHell.getHex(), 1.2); }
      for (let i = pulse.length - 1; i >= 0; i--) {
        const p = pulse[i]; p.s += dt * p.v;
        const g = p.h.pfad.gesamt;
        if (p.s >= g || !haeuser.has(p.h.id)) { szene.remove(p.m); (p.m.material as THREE.Material).dispose(); pulse.splice(i, 1); continue; }
        aufPfad(p.h.pfad, p.rueck ? g - p.s : p.s, p.m.position); p.m.position.y = 0.09;
        (p.m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.s / 1.0, (g - p.s) / 1.0);
      }
      komp.render(); css2d.render(szene, kamera);
      // Schilder nie unter der Legende: ragt eines oben hinein, rückt es nach unten
      for (const l of alleSchilder()) {
        if (!l.visible) continue;
        l.getWorldPosition(wp).project(kamera);
        const oben = (-wp.y * 0.5 + 0.5) * hoehePx - 15;
        const schub = oben < obenFrei ? Math.round(obenFrei - oben) : 0;
        const neu = schub ? schub + 'px' : '';
        if (l.element.style.marginTop !== neu) l.element.style.marginTop = neu;
      }
    };
    lauf();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener('pointerup', hoch);
      for (const h of haeuser.values()) h.label.element.remove();
      szene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mt = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose());
      });
      texturen.forEach((x) => x.dispose());
      umg.dispose(); komp.dispose(); renderer.dispose();
      renderer.domElement.remove(); css2d.domElement.remove();
      welt.current = null;
    };
  }, [abend]);

  useEffect(() => { welt.current?.setzeObjekte(objekte); }, [objekte, abend]);
  useEffect(() => { welt.current?.waehle(gewaehlt); }, [gewaehlt, objekte, abend]);

  return <div ref={box} className="stadt3d" />;
}
