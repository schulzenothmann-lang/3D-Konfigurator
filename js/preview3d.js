/**
 * preview3d.js — Three.js GLB preview for MINO Konfigurator
 * Exposes window.preview3d = { load, setColor, setWindowVariant, setView, dispose }
 */
import * as THREE          from 'three';
import { GLTFLoader }      from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ── infill panel names ─────────────────────────────────────── */
const INFILL_NAMES = {
  medium: ['Window_Infill_Medium_Left', 'Window_Infill_Medium_Right'],
  small:  ['Window_Infill_Small_Left',  'Window_Infill_Small_Right'],
};

/* ── body material names
 *  Material_tripo_part_24 = frame/trim around the large side panel
 *  Material_tripo_part_0  = large outer side panel (main body surface)
 */
const BODY_MATERIAL_NAMES = new Set([
  'Material_tripo_part_24',
  'Material_tripo_part_0',
]);

function isBodyMaterial(mat) {
  return BODY_MATERIAL_NAMES.has(mat.name);
}

/* ── state ─────────────────────────────────────────────────── */
let renderer, scene, camera, controls, rafId;
let currentModel = null;
let bodyMeshData  = [];   // { mat, origColor, origMap, origMetalness, origRoughness }
let infillMeshes  = {};   // name → Mesh
let infillMat     = null;
let currentColor  = 'original';
let ready         = false;
const canvas = document.getElementById('glbCanvas');

/* ── camera presets ─────────────────────────────────────────── */
const VIEWS = {
  side: { pos: [ 0.3,  0.8,  3.5], target: [0, 0.15, 0] },
  rear: { pos: [ 3.5,  0.8,  0.3], target: [0, 0.15, 0] },
  open: { pos: [ 2.0,  1.2,  2.8], target: [0, 0.20, 0] },
};

/* ── init Three.js ──────────────────────────────────────────── */
function initThree() {
  if (ready) return;
  ready = true;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
  applyViewImmediate('side');

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(4, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xcce0ff, 0.9);
  fill.position.set(-4, 4, 2);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(0, 6, -5);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.ShadowMaterial({ opacity: 0.2 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance   = 1.5;
  controls.maxDistance   = 12;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.target.set(0, 0.15, 0);
  controls.update();

  new ResizeObserver(onResize).observe(canvas.parentElement);
  onResize();
  animate();
}

function onResize() {
  const p = canvas.parentElement;
  if (!p || !renderer) return;
  const w = p.clientWidth, h = p.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function animate() {
  rafId = requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

/* ── view helpers ───────────────────────────────────────────── */
function applyViewImmediate(name) {
  const v = VIEWS[name] || VIEWS.side;
  camera.position.set(...v.pos);
  if (controls) {
    controls.target.set(...v.target);
    controls.update();
  }
}

function animateCameraTo(name) {
  const v         = VIEWS[name] || VIEWS.side;
  const targetPos = new THREE.Vector3(...v.pos);
  const targetLook= new THREE.Vector3(...v.target);
  const startPos  = camera.position.clone();
  const startLook = controls.target.clone();
  let t = 0;
  function step() {
    t += 0.016 / 0.5;
    if (t >= 1) t = 1;
    const ease = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(startPos, targetPos, ease);
    controls.target.lerpVectors(startLook, targetLook, ease);
    controls.update();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ── PBR params per color ────────────────────────────────── */
function pbrForHex(hex) {
  const c   = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (lum > 0.88) return { metalness: 0.50, roughness: 0.30 }; // white/very light → gloss metallic
  if (lum < 0.08) return { metalness: 0.00, roughness: 0.88 }; // dark             → flat matte
  return               { metalness: 0.10, roughness: 0.65 };   // all others       → satin (silver, colors)
}

/* ── color helper ───────────────────────────────────────────── */
function applyColorNow(hexOrOriginal) {
  const isOriginal = hexOrOriginal === 'original';
  bodyMeshData.forEach(({ mat, origColor, origMap, origMetalness, origRoughness, origMetalnessMap, origRoughnessMap }) => {
    if (isOriginal) {
      // Full restore to GLB state
      mat.color.copy(origColor);
      mat.map          = origMap;
      mat.metalness    = origMetalness;
      mat.roughness    = origRoughness;
      mat.metalnessMap = origMetalnessMap;
      mat.roughnessMap = origRoughnessMap;
    } else {
      const pbr = pbrForHex(hexOrOriginal);
      // Keep albedo texture (preserves surface detail).
      // Null PBR maps so scalar metalness/roughness take effect
      // instead of the Tripo3D metalness=1.0 map artifact.
      // mat.color tints the texture: final_albedo = texture × color.
      mat.color.set(hexOrOriginal);
      mat.map          = origMap;
      mat.metalnessMap = null;
      mat.roughnessMap = null;
      mat.metalness    = pbr.metalness;
      mat.roughness    = pbr.roughness;
    }
    mat.needsUpdate = true;
  });
  if (infillMat) {
    infillMat.color.set(isOriginal ? 0x111111 : hexOrOriginal);
    infillMat.needsUpdate = true;
  }
}

/* ── PUBLIC API ─────────────────────────────────────────────── */
window.preview3d = {

  load(url) {
    initThree();
    document.querySelector('.preview').classList.add('glb-active');

    bodyMeshData = [];
    infillMeshes = {};
    infillMat    = null;
    currentColor = 'original';

    const loader = new GLTFLoader();
    loader.load(url, gltf => {
      if (currentModel) {
        scene.remove(currentModel);
        currentModel.traverse(c => { if (c.isMesh) c.geometry.dispose(); });
      }
      currentModel = gltf.scene;

      /* center + scale to 2.5-unit bounding box */
      const box    = new THREE.Box3().setFromObject(currentModel);
      const center = box.getCenter(new THREE.Vector3());
      const size   = box.getSize(new THREE.Vector3());
      const scale  = 2.5 / Math.max(size.x, size.y, size.z);

      currentModel.position.sub(center);
      currentModel.scale.setScalar(scale);

      /* lift so bottom of model sits at y = 0 */
      const box2 = new THREE.Box3().setFromObject(currentModel);
      currentModel.position.y -= box2.min.y;

      /* rotate so the service-window side faces +Z (toward default camera) */
      currentModel.rotation.y = Math.PI * 0.5;

      currentModel.traverse(child => {
        if (!child.isMesh) return;
        const name = child.name;

        if (name.startsWith('Window_Infill_')) {
          infillMeshes[name] = child;
          child.visible = false;
          if (!infillMat && child.material) infillMat = child.material;
          return;
        }

        child.castShadow    = true;
        child.receiveShadow = true;

        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m) return;
          if (isBodyMaterial(m)) {
            bodyMeshData.push({
              mat: m,
              origColor:        m.color.clone(),
              origMap:          m.map,
              origMetalness:    m.metalness,
              origRoughness:    m.roughness,
              origMetalnessMap: m.metalnessMap,
              origRoughnessMap: m.roughnessMap,
            });
          }
        });
      });

      applyColorNow(currentColor);
      scene.add(currentModel);
    },
    undefined,
    err => console.error('[preview3d] load error', err)
    );
  },

  setColor(hexOrOriginal) {
    currentColor = hexOrOriginal;
    applyColorNow(hexOrOriginal);
  },


  setWindowVariant(variant) {
    /* variant: 'large' | 'medium' | 'small' */
    Object.values(infillMeshes).forEach(m => m.visible = false);
    (INFILL_NAMES[variant] ?? []).forEach(n => {
      if (infillMeshes[n]) infillMeshes[n].visible = true;
    });
    if (infillMat) {
      infillMat.color.set(currentColor === 'original' ? 0x111111 : currentColor);
      infillMat.needsUpdate = true;
    }
  },

  setView(name) {
    if (!ready) return;
    animateCameraTo(name);
  },

  dispose() {
    cancelAnimationFrame(rafId);
    renderer?.dispose();
    ready = false;
    document.querySelector('.preview').classList.remove('glb-active');
  }
};

window.dispatchEvent(new CustomEvent('preview3d-ready'));
