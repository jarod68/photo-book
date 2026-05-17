import * as THREE from 'three';
import { OrbitControls }                 from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject }    from 'three/addons/renderers/CSS2DRenderer.js';
import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import '../utils/admin-shortcut.js';
import { getMapPhotos } from '../api/client.js';

applyTranslations();
initLangSwitcher('lang-switcher');

const R        = 1;
const TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

// Country labels: [name, lat, lng, minDist]
// minDist = camera distance at which label becomes visible (lower = more zoomed in required)
const LABELS = [
  // Always visible
  ['Russia',        62,   96,  99],
  ['Canada',        58, -100,  99],
  ['USA',           40,  -98,  99],
  ['Brazil',       -10,  -52,  99],
  ['Australia',    -25,  133,  99],
  ['China',         35,  103,  99],
  ['India',         22,   80,  99],
  ['Argentina',    -35,  -65,  99],
  ['Kazakhstan',    48,   68,  99],
  ['Algeria',       28,    2,  99],
  // Visible from medium zoom
  ['DR Congo',      -3,   23, 2.1],
  ['Libya',         27,   18, 2.1],
  ['Mexico',        24, -102, 2.1],
  ['Peru',         -10,  -76, 2.1],
  ['Mongolia',      46,  105, 2.1],
  ['Egypt',         26,   30, 2.1],
  ['Nigeria',        9,    8, 2.1],
  ['Ethiopia',       9,   40, 2.1],
  ['South Africa', -30,   25, 2.1],
  ['Saudi Arabia',  24,   45, 2.1],
  ['Iran',          32,   54, 2.1],
  ['Indonesia',     -2,  118, 2.1],
  ['Pakistan',      30,   70, 2.1],
  ['Colombia',       4,  -72, 2.1],
  // Visible only when zoomed in
  ['France',        46,    2, 1.7],
  ['Germany',       51,   10, 1.7],
  ['United Kingdom',53,   -2, 1.7],
  ['Italy',         43,   12, 1.7],
  ['Spain',         40,   -4, 1.7],
  ['Ukraine',       49,   32, 1.7],
  ['Turkey',        39,   35, 1.7],
  ['Japan',         37,  137, 1.7],
  ['Myanmar',       20,   96, 1.7],
  ['Thailand',      15,  101, 1.7],
  ['Vietnam',       16,  108, 1.7],
  ['South Korea',   37,  128, 1.7],
  ['Angola',       -12,   18, 1.7],
  ['Mali',          16,   -2, 1.7],
  ['Niger',         16,    8, 1.7],
  ['Mozambique',   -18,   35, 1.7],
  ['Zambia',       -14,   28, 1.7],
  ['Venezuela',      8,  -66, 1.7],
  ['Chile',        -35,  -71, 1.7],
  ['Greenland',     72,  -42, 1.7],
  ['Sweden',        62,   16, 1.7],
  ['Norway',        64,   15, 1.7],
  ['Morocco',       32,   -7, 1.7],
  ['Poland',        52,   20, 1.7],
  ['Afghanistan',   33,   66, 1.7],
  ['Iraq',          33,   44, 1.7],
  ['Malaysia',       3,  112, 1.7],
  ['Namibia',      -22,   17, 1.7],
  ['Sudan',         15,   30, 1.7],
  ['Bolivia',      -17,  -65, 1.7],
];

function latLngToVec3(lat, lng, r = R) {
  const phi   = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  );
}

function meshToPositions(multiLineString, r = R) {
  const positions = [];
  for (const ring of multiLineString.coordinates) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [lng0, lat0] = ring[i];
      const [lng1, lat1] = ring[i + 1];
      if (Math.abs(lng1 - lng0) > 180) continue; // skip antimeridian crossing
      const a = latLngToVec3(lat0, lng0, r);
      const b = latLngToVec3(lat1, lng1, r);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  return positions;
}

function makeLineSegments(positions, color, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.LineSegments(geo, mat);
}

async function init() {
  const container = document.getElementById('globe-container');

  const [topology, photos] = await Promise.all([
    fetch(TOPO_URL).then(r => r.json()),
    getMapPhotos(),
  ]);

  document.getElementById('globe-loading').remove();

  const countEl = document.getElementById('globe-count');
  countEl.textContent = photos.length
    ? t('map.photos', { n: photos.length, s: photos.length > 1 ? 's' : '' })
    : t('map.noPhotos');

  // ── Renderer ────────────────────────────────────────────────────────────────
  const W = container.clientWidth;
  const H = container.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.setClearColor(0x050508);
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(W, H);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  // ── Scene & camera ───────────────────────────────────────────────────────────
  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
  camera.position.z = 2.6;

  // ── Controls ─────────────────────────────────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping    = true;
  controls.dampingFactor    = 0.06;
  controls.minDistance      = 1.2;
  controls.maxDistance      = 5.0;
  controls.rotateSpeed      = 0.45;
  controls.zoomSpeed        = 0.8;
  controls.enablePan        = false;
  controls.autoRotate       = true;
  controls.autoRotateSpeed  = 0.35;

  let resumeTimer = null;
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    if (resumeTimer) clearTimeout(resumeTimer);
  });
  controls.addEventListener('end', () => {
    resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 3000);
  });

  // ── Stars ────────────────────────────────────────────────────────────────────
  const starPos = [];
  for (let i = 0; i < 3500; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = 25 + Math.random() * 20;
    starPos.push(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    );
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, transparent: true, opacity: 0.65 })));

  // ── Atmosphere glow ──────────────────────────────────────────────────────────
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(1.035, 64, 64),
    new THREE.MeshPhongMaterial({
      color: 0x0a2a6e, transparent: true, opacity: 0.10, side: THREE.FrontSide,
    }),
  ));

  // ── Globe sphere ─────────────────────────────────────────────────────────────
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(R, 72, 72),
    new THREE.MeshPhongMaterial({
      color:     0x070e1e,
      emissive:  0x040912,
      specular:  0x1a3060,
      shininess: 6,
    }),
  ));

  // ── Lighting ─────────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x2a3d5a, 1.2));
  const sun = new THREE.DirectionalLight(0x6080bb, 1.1);
  sun.position.set(4, 2, 4);
  scene.add(sun);

  // ── Country borders (TopoJSON → LineSegments) ─────────────────────────────────
  // topojson is loaded as a global via the <script> tag in globe.html
  /* global topojson */
  const borders  = topojson.mesh(topology, topology.objects.countries, (a, b) => a !== b);
  const coast    = topojson.mesh(topology, topology.objects.land);

  scene.add(makeLineSegments(meshToPositions(borders, R + 0.001), 0x1a3d7c, 0.55));
  scene.add(makeLineSegments(meshToPositions(coast,   R + 0.002), 0x2a5fcb, 0.85));

  // ── Country labels ────────────────────────────────────────────────────────────
  const labelObjects = LABELS.map(([name, lat, lng, minDist]) => {
    const div = document.createElement('div');
    div.className = 'globe-label';
    div.textContent = name;
    const obj = new CSS2DObject(div);
    obj.position.copy(latLngToVec3(lat, lng, R + 0.01));
    scene.add(obj);
    return { obj, minDist };
  });

  // ── Photo markers ─────────────────────────────────────────────────────────────
  const dotMat  = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.45, side: THREE.DoubleSide });

  photos.forEach(photo => {
    const pos = latLngToVec3(photo.gps.lat, photo.gps.lng, R + 0.012);

    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 8), dotMat);
    dot.position.copy(pos);
    scene.add(dot);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.011, 0.018, 20), ringMat);
    ring.position.copy(pos);
    ring.lookAt(new THREE.Vector3(0, 0, 0));
    scene.add(ring);
  });

  // ── Resize ────────────────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    const W = container.clientWidth;
    const H = container.clientHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    labelRenderer.setSize(W, H);
  });

  // ── Render loop ───────────────────────────────────────────────────────────────
  function animate() {
    requestAnimationFrame(animate);
    controls.update();

    const dist = camera.position.length();
    for (const { obj, minDist } of labelObjects) {
      obj.element.style.opacity = dist <= minDist ? '1' : '0';
    }

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  animate();
}

init();
