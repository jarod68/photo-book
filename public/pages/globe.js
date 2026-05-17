import * as THREE from 'three';
import { OrbitControls }              from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { LineSegments2 }              from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry }       from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial }               from 'three/addons/lines/LineMaterial.js';
import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import '../utils/admin-shortcut.js';
import { getMapPhotos } from '../api/client.js';

applyTranslations();
initLangSwitcher('lang-switcher');

const R   = 1;
const DEG = Math.PI / 180;

// 50m resolution for max precision (finer coastlines, more islands)
const URL_110 = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const URL_50  = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';

// [name, lat, lng, maxCamDist]
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

// Geographic → Cartesian (Y-up). Z is negated so that east (positive lng)
// maps to +screen-right when the camera is on the +X axis.
// Round-trip: lat = asin(y), lng = atan2(-z, x)
function ll2v(lat, lng, r = R) {
  const lr = lat * DEG;
  const er = lng * DEG;
  return new THREE.Vector3(
    r * Math.cos(lr) * Math.cos(er),
    r * Math.sin(lr),
    -r * Math.cos(lr) * Math.sin(er),
  );
}

// Fat-line helper: uses LineSegments2 so linewidth is actual CSS pixels, not capped at 1
function buildLines(multiLineString, r, hexColor, lineWidth, opacity, W, H) {
  const pos = [];
  for (const ring of multiLineString.coordinates) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [lng0, lat0] = ring[i];
      const [lng1, lat1] = ring[i + 1];
      const a = ll2v(lat0, lng0, r);
      const b = ll2v(lat1, lng1, r);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const geo = new LineSegmentsGeometry();
  geo.setPositions(pos);
  const mat = new LineMaterial({
    color: hexColor, linewidth: lineWidth,
    opacity, transparent: true, depthTest: true,
    resolution: new THREE.Vector2(W, H),
  });
  return new LineSegments2(geo, mat);
}

function buildBorderGroup(topo, r, W, H) {
  const grp = new THREE.Group();
  grp.renderOrder = 1;
  const borders = topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
  const coast   = topojson.mesh(topo, topo.objects.land);
  const bLines = buildLines(borders, r + 0.003, 0x2a4fa8, 1.0, 0.55, W, H);
  const cLines = buildLines(coast,   r + 0.004, 0x3a7aff, 2.0, 0.85, W, H);
  bLines.renderOrder = 1;
  cLines.renderOrder = 1;
  grp.add(bLines, cLines);
  return grp;
}

async function init() {
  const container  = document.getElementById('globe-container');
  const popup      = document.getElementById('globe-popup');
  const popupClose = document.getElementById('globe-popup-close');
  const popupAlbum = popup.querySelector('.globe-popup-album');
  const popupTitle = popup.querySelector('.globe-popup-title');
  const popupDate  = popup.querySelector('.globe-popup-date');
  const popupImg   = popup.querySelector('.globe-popup-img');
  const popupLink  = popup.querySelector('.globe-popup-link');

  // Start 50m fetch immediately in background for LOD upgrade
  const p50 = fetch(URL_50).then(r => r.json());

  const [topo110, photos] = await Promise.all([
    fetch(URL_110).then(r => r.json()),
    getMapPhotos(),
  ]);

  document.getElementById('globe-loading').remove();

  const countEl = document.getElementById('globe-count');
  countEl.textContent = photos.length
    ? t('map.photos', { n: photos.length, s: photos.length > 1 ? 's' : '' })
    : t('map.noPhotos');

  const W = container.clientWidth;
  const H = container.clientHeight;

  // ── Renderer ──────────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
  renderer.setSize(W, H);
  renderer.setClearColor(0x050508);
  container.appendChild(renderer.domElement);

  // CSS2D renderer for country labels only
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(W, H);
  Object.assign(labelRenderer.domElement.style, {
    position: 'absolute', top: '0', left: '0',
    pointerEvents: 'none',
    willChange: 'transform',
  });
  container.appendChild(labelRenderer.domElement);

  // ── Scene & camera ────────────────────────────────────────────────────────────
  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 100);
  // Atlantic view: Americas left, Europe/Africa right, north pole up
  camera.position.set(2.6, 0.4, 0);

  // ── Controls ──────────────────────────────────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.07;
  controls.minDistance     = 1.02;
  controls.maxDistance     = 5.0;
  controls.rotateSpeed     = 0.55;
  controls.zoomSpeed       = 0.8;
  controls.enablePan       = false;
  controls.autoRotate      = true;
  controls.autoRotateSpeed = 0.35;

  let resumeTimer = null;
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
    closePopup();
  });
  controls.addEventListener('end', () => {
    resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 3000);
  });

  // ── Stars ─────────────────────────────────────────────────────────────────────
  {
    const pos = [];
    for (let i = 0; i < 3500; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const r  = 25 + Math.random() * 20;
      pos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    scene.add(new THREE.Points(geo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, transparent: true, opacity: 0.65 })));
  }

  // ── Atmosphere glow ───────────────────────────────────────────────────────────
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(1.035, 128, 128),
    new THREE.MeshPhongMaterial({
      color: 0x0a2a6e, transparent: true, opacity: 0.10,
      side: THREE.FrontSide, depthWrite: false,
    }),
  ));

  // ── Globe sphere (fully opaque, no polygonOffset) ─────────────────────────────
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(R, 256, 128),
    new THREE.MeshPhongMaterial({
      color: 0x070e1e, emissive: 0x040912, specular: 0x1a3060, shininess: 6,
    }),
  );
  globe.renderOrder = 0;
  scene.add(globe);

  // ── Lighting ──────────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x2a3d5a, 1.2));
  const sun = new THREE.DirectionalLight(0x6080bb, 1.1);
  sun.position.set(4, 2, 4);
  scene.add(sun);

  // ── Country borders — 110m first, 50m + fills when ready ─────────────────────
  let currentBorders = buildBorderGroup(topo110, R, W, H);
  scene.add(currentBorders);

  p50.then(topo => {
    // Swap to 50m borders — max precision at all zoom levels
    const b50 = buildBorderGroup(topo, R, container.clientWidth, container.clientHeight);
    scene.remove(currentBorders);
    scene.add(b50);
    currentBorders = b50;

  });

  // ── Country labels (CSS2D, state-cached) ──────────────────────────────────────
  const labelObjects = LABELS.map(([name, lat, lng, maxDist]) => {
    const div = document.createElement('div');
    div.className = 'globe-label';
    div.textContent = name;
    const obj = new CSS2DObject(div);
    obj.position.copy(ll2v(lat, lng, R + 0.01));
    scene.add(obj);
    return { obj, wp: obj.position.clone(), maxDist, vis: null };
  });

  // ── Photo pins — Sprite visual + invisible raycaster target ─────────────────
  // Shared canvas texture: 160×224 px (4× scaled for crisp rendering), tip at bottom-center
  const pinCanvas = document.createElement('canvas');
  pinCanvas.width = 320; pinCanvas.height = 448;
  const pctx = pinCanvas.getContext('2d');
  // viewBox 20×28 scaled ×16 — 320×448 for crisp rendering at any DPR or zoom level
  const pinPath = new Path2D('M160 0C71.63 0 0 71.63 0 160C0 280 160 448 160 448C160 448 320 280 320 160C320 71.63 248.37 0 160 0Z');
  pctx.fillStyle = '#ff1010';
  pctx.fill(pinPath);
  pctx.strokeStyle = 'rgba(255,255,255,0.80)';
  pctx.lineWidth = 12;
  pctx.stroke(pinPath);
  pctx.beginPath();
  pctx.arc(160, 144, 56, 0, Math.PI * 2);
  pctx.fillStyle = 'rgba(255,255,255,0.90)';
  pctx.fill();
  const pinTex = new THREE.CanvasTexture(pinCanvas);

  const hitGeo  = new THREE.SphereGeometry(0.022, 6, 4);
  const hitMat  = new THREE.MeshBasicMaterial({ visible: false });
  const pinItems = []; // { sprite, hit, wp, vis }

  photos.forEach(photo => {
    const wp = ll2v(photo.gps.lat, photo.gps.lng, R + 0.020);

    // Sprite always faces camera; center=(0.5,0) anchors tip at world position.
    // depthTest:true + alphaTest lets the opaque globe occlude back-hemisphere pins,
    // and lets sprites write depth so borders (at R+0.003/0.004, further from camera)
    // fail the depth test at sprite pixels — pins always render in front of borders.
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: pinTex, transparent: true, depthTest: true, depthWrite: true, alphaTest: 0.01,
    }));
    sprite.position.copy(wp);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 0;
    scene.add(sprite);

    // Invisible sphere for raycasting — placed at surface (R+0.001) so it
    // sits just above the globe but inside the sprite's visual footprint
    const surfaceWp = ll2v(photo.gps.lat, photo.gps.lng, R + 0.001);
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.copy(surfaceWp);
    hit.userData = { photo, wp: wp.clone() };
    scene.add(hit);

    pinItems.push({ sprite, hit, wp: wp.clone(), surfaceWp: surfaceWp.clone(), vis: null });
  });

  const hitMeshes = pinItems.map(p => p.hit);

  // ── Raycaster for pin clicks ───────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const mouse     = new THREE.Vector2();
  let   activeHit = null;

  function closePopup() {
    popup.dataset.open = 'false';
    activeHit = null;
  }

  function openPopup(hit) {
    const { photo, wp } = hit.userData;
    popupAlbum.textContent = photo.album;
    popupTitle.textContent = photo.name || photo.filename;

    if (photo.date) {
      const locale = { fr: 'fr-FR', en: 'en-US', es: 'es-ES' }[
        document.documentElement.lang
      ] ?? 'en-US';
      popupDate.textContent  = new Date(photo.date).toLocaleDateString(locale,
        { day: 'numeric', month: 'short', year: 'numeric' });
      popupDate.style.display = '';
    } else {
      popupDate.style.display = 'none';
    }

    if (photo.previewUrl) {
      popupImg.src = photo.previewUrl;
      popupImg.style.display = '';
    } else {
      popupImg.style.display = 'none';
    }

    popupLink.textContent = t('map.viewInAlbum');
    popupLink.href = `viewer.html?album=${encodeURIComponent(photo.album)}&photo=${encodeURIComponent(photo.filename)}`;
    positionPopup(wp);
    popup.dataset.open = 'true';
    activeHit = hit;
  }

  function positionPopup(wp) {
    const v    = wp.clone().project(camera);
    const rect = container.getBoundingClientRect();
    const sx   = (v.x + 1) / 2 * rect.width  + rect.left;
    const sy   = (-v.y + 1) / 2 * rect.height + rect.top;
    popup.style.left = `${sx}px`;
    popup.style.top  = `${sy}px`;
  }

  popupClose.addEventListener('click', closePopup);

  let pointerDownXY = null;
  renderer.domElement.addEventListener('pointerdown', e => {
    pointerDownXY = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!pointerDownXY) return;
    const dx = e.clientX - pointerDownXY.x;
    const dy = e.clientY - pointerDownXY.y;
    pointerDownXY = null;
    if (Math.hypot(dx, dy) >= 6) return;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)   / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const hits = raycaster.intersectObjects(hitMeshes, false);
    if (hits.length > 0) {
      const hit = hits[0].object;
      if (activeHit === hit) { closePopup(); return; }
      openPopup(hit);
    } else {
      closePopup();
    }
  });

  // ── Resize ────────────────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    const W = container.clientWidth;
    const H = container.clientHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    labelRenderer.setSize(W, H);
    // Fat lines need the updated resolution to keep correct pixel width
    scene.traverse(obj => {
      if (obj.material instanceof LineMaterial) obj.material.resolution.set(W, H);
    });
  });

  // ── Render loop ───────────────────────────────────────────────────────────────
  const TAN_HALF_FOV = Math.tan(22.5 * Math.PI / 180); // tan(fov/2) for fov=45°, fixed

  function animate() {
    requestAnimationFrame(animate);
    controls.update();

    const camPos = camera.position;
    const dist   = camPos.length();

    // Movement speed scales with zoom: very slow and fluid when close in
    const t = Math.max(0, Math.min(1, (dist - 1.0) / 4.0));
    controls.rotateSpeed = 0.05 + t * 0.50;   // 0.05 at max zoom → 0.55 when far
    controls.zoomSpeed   = 0.15 + t * 0.65;   // 0.15 at max zoom → 0.80 when far

    // Target pin height in CSS px: 40 at max zoom, 12 when far out
    const viewH    = container.clientHeight;
    const targetPx = Math.max(12, Math.min(40, (5.0 - dist) / 3.98 * 28 + 12));

    // Labels: state-cached DOM updates only on change
    for (const lbl of labelObjects) {
      const vis = lbl.wp.dot(camPos) > 0.2 && dist <= lbl.maxDist;
      if (vis !== lbl.vis) {
        lbl.obj.element.style.opacity       = vis ? '1' : '0';
        lbl.obj.element.style.pointerEvents = vis ? 'auto' : 'none';
        lbl.vis = vis;
      }
    }

    // Pins: per-sprite scale so every pin has the same CSS-pixel height.
    // Each sprite's camera-space depth (z_view) is computed individually:
    //   z_view = dist - (wp · camPos) / dist
    // This is the actual distance from the camera plane to the sprite, which
    // varies from (dist-1) for a sprite directly below the camera to dist
    // for a sprite at 90°. Using dist instead of z_view was the bug that made
    // close-in pins gigantic (dist-1 can be 0.02 at max zoom).
    for (const item of pinItems) {
      const dot = item.surfaceWp.dot(camPos);
      const vis = dot > 0.05;
      if (vis !== item.vis) {
        item.sprite.visible = vis;
        item.hit.visible    = vis;
        item.vis = vis;
        if (!vis && activeHit === item.hit) closePopup();
      }
      if (vis) {
        const zView = dist - dot / dist;
        const sw    = targetPx * 2 * zView * TAN_HALF_FOV / (1.4 * viewH);
        item.sprite.scale.set(sw, sw * 1.4, 1);
      }
    }

    // Reposition popup each frame if open (follows pin as globe rotates)
    if (activeHit && popup.dataset.open === 'true') {
      positionPopup(activeHit.userData.wp);
    }

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  animate();
}

init();
