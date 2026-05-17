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

// [name, lat, lng, maxCamDist] — maxCamDist: camera distance below which label is visible
const LABELS = [
  ['Russia',         62,  96, 99], ['Canada',       58, -100, 99],
  ['USA',            40, -98, 99], ['Brazil',       -10,  -52, 99],
  ['Australia',     -25, 133, 99], ['China',         35,  103, 99],
  ['India',          22,  80, 99], ['Argentina',    -35,  -65, 99],
  ['Kazakhstan',     48,  68, 99], ['Algeria',       28,    2, 99],
  ['DR Congo',       -3,  23, 2.1], ['Libya',        27,   18, 2.1],
  ['Mexico',         24,-102, 2.1], ['Peru',        -10,  -76, 2.1],
  ['Mongolia',       46, 105, 2.1], ['Egypt',        26,   30, 2.1],
  ['Nigeria',         9,   8, 2.1], ['Ethiopia',      9,   40, 2.1],
  ['South Africa',  -30,  25, 2.1], ['Saudi Arabia', 24,   45, 2.1],
  ['Iran',           32,  54, 2.1], ['Indonesia',    -2,  118, 2.1],
  ['Pakistan',       30,  70, 2.1], ['Colombia',      4,  -72, 2.1],
  ['France',         46,   2, 1.7], ['Germany',      51,   10, 1.7],
  ['United Kingdom', 53,  -2, 1.7], ['Italy',        43,   12, 1.7],
  ['Spain',          40,  -4, 1.7], ['Ukraine',      49,   32, 1.7],
  ['Turkey',         39,  35, 1.7], ['Japan',        37,  137, 1.7],
  ['South Korea',    37, 128, 1.7], ['Vietnam',      16,  108, 1.7],
  ['Thailand',       15, 101, 1.7], ['Myanmar',      20,   96, 1.7],
  ['Angola',        -12,  18, 1.7], ['Mali',         16,   -2, 1.7],
  ['Mozambique',    -18,  35, 1.7], ['Zambia',      -14,   28, 1.7],
  ['Venezuela',       8, -66, 1.7], ['Chile',       -35,  -71, 1.7],
  ['Greenland',      72, -42, 1.7], ['Sweden',       62,   16, 1.7],
  ['Morocco',        32,  -7, 1.7], ['Poland',       52,   20, 1.7],
  ['Afghanistan',    33,  66, 1.7], ['Iraq',         33,   44, 1.7],
  ['Malaysia',        3, 112, 1.7], ['Sudan',        15,   30, 1.7],
];

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

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
      if (Math.abs(lng1 - lng0) > 180) continue;
      const a = latLngToVec3(lat0, lng0, r);
      const b = latLngToVec3(lat1, lng1, r);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  return positions;
}

function makeLines(positions, color, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geo,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true }),
  );
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

  const W = container.clientWidth;
  const H = container.clientHeight;

  // ── Renderers ────────────────────────────────────────────────────────────────
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
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.06;
  controls.minDistance     = 1.2;
  controls.maxDistance     = 5.0;
  controls.rotateSpeed     = 0.45;
  controls.zoomSpeed       = 0.8;
  controls.enablePan       = false;
  controls.autoRotate      = true;
  controls.autoRotateSpeed = 0.35;

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
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const r  = 25 + Math.random() * 20;
    starPos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th));
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, transparent: true, opacity: 0.65 })));

  // ── Atmosphere ───────────────────────────────────────────────────────────────
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(1.035, 64, 64),
    new THREE.MeshPhongMaterial({
      color: 0x0a2a6e, transparent: true, opacity: 0.10, side: THREE.FrontSide,
      depthWrite: false,
    }),
  ));

  // ── Globe sphere (opaque, renders before lines to properly occlude back side) ─
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(R, 72, 72),
    new THREE.MeshPhongMaterial({
      color:     0x070e1e,
      emissive:  0x040912,
      specular:  0x1a3060,
      shininess: 6,
      // Polygon offset: push sphere depth slightly forward so lines exactly on
      // the surface are cleanly occluded on the far side
      polygonOffset:      true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  globe.renderOrder = 0;
  scene.add(globe);

  // ── Lighting ─────────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x2a3d5a, 1.2));
  const sun = new THREE.DirectionalLight(0x6080bb, 1.1);
  sun.position.set(4, 2, 4);
  scene.add(sun);

  // ── Country borders ──────────────────────────────────────────────────────────
  /* global topojson */
  const borders = topojson.mesh(topology, topology.objects.countries, (a, b) => a !== b);
  const coast   = topojson.mesh(topology, topology.objects.land);

  const borderLines = makeLines(meshToPositions(borders, R + 0.001), 0x1a3d7c, 0.55);
  const coastLines  = makeLines(meshToPositions(coast,   R + 0.002), 0x2a5fcb, 0.85);
  borderLines.renderOrder = 1;
  coastLines.renderOrder  = 1;
  scene.add(borderLines);
  scene.add(coastLines);

  // ── Country labels ────────────────────────────────────────────────────────────
  const labelObjects = LABELS.map(([name, lat, lng, maxDist]) => {
    const div = document.createElement('div');
    div.className = 'globe-label';
    div.textContent = name;
    const obj = new CSS2DObject(div);
    obj.position.copy(latLngToVec3(lat, lng, R + 0.01));
    scene.add(obj);
    return { obj, worldPos: obj.position.clone(), maxDist };
  });

  // ── Photo pins ────────────────────────────────────────────────────────────────
  let activePopup = null;

  // Close popup on canvas click (distinguish click from drag)
  let pointerDownXY = null;
  renderer.domElement.addEventListener('pointerdown', e => {
    pointerDownXY = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!pointerDownXY) return;
    const dx = e.clientX - pointerDownXY.x;
    const dy = e.clientY - pointerDownXY.y;
    if (Math.hypot(dx, dy) < 6 && activePopup) {
      activePopup.style.display = 'none';
      activePopup = null;
    }
    pointerDownXY = null;
  });

  const pinObjects = photos.map(photo => {
    const wrap = document.createElement('div');
    wrap.className = 'globe-pin-wrap';
    wrap.innerHTML = `
      <div class="globe-popup">
        <span class="globe-popup-album">${esc(photo.album)}</span>
        <span class="globe-popup-name">${esc(photo.name || photo.filename)}</span>
        <a class="globe-popup-link"
           href="viewer.html?album=${encodeURIComponent(photo.album)}&photo=${encodeURIComponent(photo.filename)}">
          ${t('map.viewInAlbum')} →
        </a>
      </div>
      <svg class="globe-pin-svg" viewBox="0 0 20 28" width="20" height="28"
           xmlns="http://www.w3.org/2000/svg">
        <path d="M10 0C4.48 0 0 4.48 0 10C0 17.5 10 28 10 28C10 28 20 17.5 20 10C20 4.48 15.52 0 10 0Z"
              fill="#ef4444" stroke="rgba(255,255,255,0.85)" stroke-width="1.5"/>
        <circle cx="10" cy="10" r="3.5" fill="rgba(255,255,255,0.85)"/>
      </svg>`;

    const popup  = wrap.querySelector('.globe-popup');
    const pinSvg = wrap.querySelector('.globe-pin-svg');

    // Popup starts hidden
    popup.dataset.open = 'false';

    pinSvg.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = popup.dataset.open === 'true';
      if (activePopup && activePopup !== popup) {
        activePopup.dataset.open = 'false';
      }
      popup.dataset.open = isOpen ? 'false' : 'true';
      activePopup = isOpen ? null : popup;
    });

    const obj = new CSS2DObject(wrap);
    obj.position.copy(latLngToVec3(photo.gps.lat, photo.gps.lng, R + 0.015));
    scene.add(obj);
    return { obj, worldPos: obj.position.clone() };
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
  const camDir = new THREE.Vector3();

  function animate() {
    requestAnimationFrame(animate);
    controls.update();

    camera.getWorldDirection(camDir); // direction camera is looking toward
    const camDist = camera.position.length();

    // Country labels: visible only on front hemisphere + within zoom threshold
    for (const { obj, worldPos, maxDist } of labelObjects) {
      // dot > 0 means the point is on the same side as the camera (front hemisphere)
      const onFront = worldPos.dot(camera.position) > 0.2;
      obj.element.style.opacity = (onFront && camDist <= maxDist) ? '1' : '0';
    }

    // Photo pins: visible only on front hemisphere
    for (const { obj, worldPos } of pinObjects) {
      const onFront = worldPos.dot(camera.position) > 0.05;
      obj.element.style.opacity       = onFront ? '1' : '0';
      obj.element.style.pointerEvents = onFront ? 'auto' : 'none';
      // Close popup if pin goes to back side
      if (!onFront) {
        const popup = obj.element.querySelector('.globe-popup');
        if (popup && popup.dataset.open === 'true') {
          popup.dataset.open = 'false';
          if (activePopup === popup) activePopup = null;
        }
      }
    }

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  animate();
}

init();
