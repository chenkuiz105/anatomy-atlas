// 3D anatomy viewer: layers, regions, select / hide / fade / isolate, search, quizzes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from '../vendor/three-mesh-bvh.module.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------- config ----------
const LAYERS = [
  { id: 'skin',     zh: '皮膚',     color: 0xe8b796, visible: false, opacity: 0.35 },
  { id: 'muscles',  zh: '肌肉',     color: 0xb5463c, visible: true,  opacity: 1 },
  { id: 'skeleton', zh: '骨骼/關節', color: 0xeee6d2, visible: true,  opacity: 1 },
  { id: 'nervous',  zh: '神經系統', color: 0xf2cf4a, visible: false, opacity: 1 },
  { id: 'vessels',  zh: '血管',     color: 0xc62828, visible: false, opacity: 1 },
  { id: 'organs',   zh: '內臟',     color: 0xd9888a, visible: false, opacity: 1 },
];
const KIND_COLOR = { artery: 0xd32f2f, vein: 0x3f6fd8 };
const REGIONS = [
  ['head', '頭'], ['neck', '頸'], ['thorax', '胸'], ['abdomen', '腹'], ['back', '背'],
  ['upper limb', '上肢'], ['lower limb', '下肢'], ['', '其他/軀幹'],
];
const SELECT_EMISSIVE = new THREE.Color(0x1d5cff);
const FADE_OPACITY = 0.12;
const XRAY_MAT = new THREE.MeshBasicMaterial({ color: 0x3d7bff, transparent: true, opacity: 0.28, depthTest: false, depthWrite: false });

// ---------- scene ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
camera.add(key); key.position.set(80, 120, 200);
const fill = new THREE.DirectionalLight(0xffffff, 0.5);
camera.add(fill); fill.position.set(-150, -50, 50);
scene.add(camera);
const root = new THREE.Group();
scene.add(root);

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- state ----------
const parts = new Map();          // id -> { id, mesh, meta, hidden, faded }
const layerState = Object.fromEntries(LAYERS.map((l) => [l.id, { ...l }]));
const activeRegions = new Set();  // empty = all
let selected = new Set();
let multi = false;
let showLabels = false;
let mode = 'explore';
const undoStack = [];
let zh = {};
let noteIndex = null;
let terms = {};

const baseName = (en) => en.replace(/^(left|right) /, '').replace(/ of (left|right) /, ' of ').replace(/ (left|right) /, ' ');
const zhName = (p) => zh[p.meta.en] || zh[baseName(p.meta.en).toLowerCase()] || '';
const displayName = (p) => {
  const z = zhName(p);
  return z ? `${p.meta.en}（${z}）` : p.meta.en;
};

// ---------- loading ----------
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const loadingEl = $('#loading');

async function load() {
  const [meta, termData, zhData] = await Promise.all([
    fetch('models/parts.json').then((r) => r.json()),
    fetch('models/terms.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    fetch('models/zh.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  zh = zhData;
  terms = termData;
  fetch('notes/index.json').then((r) => (r.ok ? r.json() : null)).then((j) => { noteIndex = j; }).catch(() => {});
  let done = 0;
  // Load visible layers first so something shows quickly.
  const order = [...LAYERS].sort((a, b) => b.visible - a.visible);
  await Promise.all(order.map(async (L) => {
    const gltf = await loader.loadAsync(`models/${L.id}.glb`);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const id = o.name.replace(/_\d+$/, '') || o.parent?.name;
      const m = meta[id];
      if (!m) return;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      o.geometry.computeBoundsTree();
      const color = KIND_COLOR[m.k] ?? L.color;
      o.material = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0, side: THREE.DoubleSide });
      o.userData.id = id;
      parts.set(id, { id, mesh: o, meta: m, hidden: false, faded: false, baseColor: color });
    });
    root.add(gltf.scene);
    done++;
    $('#loadpct').textContent = `${done}/${LAYERS.length}`;
    applyAll();
  }));
  loadingEl.hidden = true;
  frameAll();
  buildSearchIndex();
  handleHash();
}

// ---------- visibility ----------
function regionOk(p) {
  return activeRegions.size === 0 || activeRegions.has(p.meta.r);
}
function isShown(p) {
  return layerState[p.meta.l].visible && regionOk(p) && !p.hidden;
}
function apply(p) {
  const L = layerState[p.meta.l];
  const m = p.mesh;
  m.visible = isShown(p);
  const op = p.faded ? FADE_OPACITY : L.opacity;
  m.material.opacity = op;
  m.material.transparent = op < 1;
  m.material.depthWrite = op >= 1;
  m.renderOrder = op < 1 ? 1 : 0;
  m.material.emissive.copy(selected.has(p.id) ? SELECT_EMISSIVE : new THREE.Color(0));
  m.material.emissiveIntensity = selected.has(p.id) ? 0.55 : 0;
  // X-ray overlay so a selected structure stays visible behind others.
  const sel = selected.has(p.id) && m.visible;
  if (sel && !p.xray) {
    p.xray = new THREE.Mesh(m.geometry, XRAY_MAT);
    p.xray.renderOrder = 10;
    p.xray.raycast = () => {};
    m.add(p.xray);
  }
  if (p.xray) p.xray.visible = sel;
}
function applyAll() { parts.forEach(apply); updateLabels(); }

function snapshot() {
  undoStack.push([...parts.values()].map((p) => [p.id, p.hidden, p.faded]));
  if (undoStack.length > 100) undoStack.shift();
}
function undo() {
  const s = undoStack.pop();
  if (!s) return;
  for (const [id, h, f] of s) { const p = parts.get(id); p.hidden = h; p.faded = f; }
  applyAll();
}

// ---------- camera helpers ----------
function boxOf(ids) {
  const box = new THREE.Box3();
  for (const id of ids) {
    const p = parts.get(id);
    if (p) box.expandByObject(p.mesh);
  }
  return box;
}
function frameBox(box, dir) {
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const d = dir ? dir.clone() : camera.position.clone().sub(controls.target).normalize();
  const dist = Math.max(size * 1.1, 15) / Math.tan((camera.fov * Math.PI) / 360) * 0.6;
  tweenCamera(c, c.clone().add(d.multiplyScalar(dist)));
}
function frameAll(dir) {
  const ids = [...parts.values()].filter(isShown).map((p) => p.id);
  frameBox(boxOf(ids.length ? ids : parts.keys()), dir);
}
let tween = null;
function tweenCamera(target, pos) {
  tween = { t0: performance.now(), from: [controls.target.clone(), camera.position.clone()], to: [target, pos] };
}
const VIEWS = {
  front: new THREE.Vector3(0, 0, 1), back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(1, 0, 0), right: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, 1, 0.001), bottom: new THREE.Vector3(0, -1, 0.001),
};

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
const ndc = new THREE.Vector2();
function pick(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const targets = [];
  parts.forEach((p) => { if (p.mesh.visible && p.mesh.material.opacity > 0.3) targets.push(p.mesh); });
  const hit = raycaster.intersectObjects(targets, false)[0];
  return hit ? parts.get(hit.object.userData.id) : null;
}

let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  const p = pick(e);
  if (mode === 'find') return quizClick(p);
  if (!p) { if (!multi && !e.shiftKey) select([]); return; }
  if (multi || e.shiftKey || e.metaKey || e.ctrlKey) {
    const s = new Set(selected);
    s.has(p.id) ? s.delete(p.id) : s.add(p.id);
    select([...s]);
  } else select([p.id]);
});
const hoverEl = $('#hover');
let hoverRAF = 0;
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || e.buttons) { hoverEl.hidden = true; return; }
  if (hoverRAF) return;
  hoverRAF = requestAnimationFrame(() => {
    hoverRAF = 0;
    const p = mode === 'explore' ? pick(e) : null;
    if (!p) { hoverEl.hidden = true; return; }
    const r = canvas.getBoundingClientRect();
    hoverEl.textContent = displayName(p);
    hoverEl.style.left = `${e.clientX - r.left}px`;
    hoverEl.style.top = `${e.clientY - r.top}px`;
    hoverEl.hidden = false;
  });
});
canvas.addEventListener('pointerleave', () => { hoverEl.hidden = true; });

// ---------- selection & info ----------
function select(ids) {
  selected = new Set(ids);
  applyAll();
  renderInfo();
}
function renderInfo() {
  const info = $('#info');
  if (!selected.size || mode !== 'explore') { info.hidden = true; return; }
  info.hidden = false;
  const ps = [...selected].map((id) => parts.get(id));
  if (ps.length === 1) {
    const p = ps[0];
    $('#infoName').textContent = p.meta.en;
    const L = layerState[p.meta.l];
    $('#infoSub').textContent = [zhName(p), L.zh, REGIONS.find((r) => r[0] === p.meta.r)?.[1]].filter(Boolean).join(' · ');
    const g = $('#infoGroups'); g.innerHTML = '';
    for (const name of p.meta.g.slice(0, 18)) {
      const b = document.createElement('button');
      b.textContent = name;
      b.title = '選取整組';
      b.onclick = () => selectGroup(name);
      g.append(b);
    }
    renderNoteLinks(baseName(p.meta.en));
  } else {
    $('#infoName').textContent = `已選 ${ps.length} 個結構`;
    $('#infoSub').textContent = ps.slice(0, 6).map((p) => p.meta.en).join('、') + (ps.length > 6 ? '…' : '');
    $('#infoGroups').innerHTML = '';
    $('#infoNotes').innerHTML = '';
  }
}
function renderNoteLinks(term) {
  const box = $('#infoNotes');
  box.innerHTML = '';
  if (!noteIndex) return;
  const t = term.toLowerCase();
  const words = [t, t.split(' ').slice(-2).join(' '), t.split(' ').pop()].filter((w) => w.length > 3);
  const hits = [];
  for (const n of noteIndex.pages) {
    const w = words.find((w) => n.text.includes(w));
    if (w) hits.push([n, w]);
    if (hits.length >= 8) break;
  }
  if (!hits.length) return;
  box.innerHTML = '<b>相關筆記</b>';
  for (const [n, w] of hits) {
    const a = document.createElement('a');
    a.href = `notes/${n.slug}.html#:~:text=${encodeURIComponent(w)}`;
    a.textContent = n.title;
    box.append(a);
  }
}
function selectGroup(name) {
  const ids = [...parts.values()].filter((p) => p.meta.g.includes(name) && isShown(p)).map((p) => p.id);
  const all = ids.length ? ids : [...parts.values()].filter((p) => p.meta.g.includes(name)).map((p) => p.id);
  select(all);
}

function hideSel() { if (!selected.size) return; snapshot(); selected.forEach((id) => { parts.get(id).hidden = true; }); select([]); }
function fadeSel() {
  if (!selected.size) return; snapshot();
  const allFaded = [...selected].every((id) => parts.get(id).faded);
  selected.forEach((id) => { parts.get(id).faded = !allFaded; });
  applyAll();
}
function isolateSel() {
  if (!selected.size) return; snapshot();
  parts.forEach((p) => { p.hidden = !selected.has(p.id); p.faded = false; });
  // make sure the isolated parts' layers are on
  selected.forEach((id) => { layerState[parts.get(id).meta.l].visible = true; });
  activeRegions.clear();
  renderLayerUI(); renderRegionUI();
  applyAll();
  frameBox(boxOf(selected));
}
function focusSel() { if (selected.size) frameBox(boxOf(selected)); else frameAll(); }
function showAll() { snapshot(); parts.forEach((p) => { p.hidden = false; p.faded = false; }); applyAll(); }

$('#actHide').onclick = hideSel;
$('#actFade').onclick = fadeSel;
$('#actIsolate').onclick = isolateSel;
$('#actFocus').onclick = focusSel;
$('#infoClose').onclick = () => select([]);
$('#undo').onclick = undo;
$('#showAll').onclick = showAll;
$('#multi').onclick = (e) => { multi = !multi; e.currentTarget.setAttribute('aria-pressed', multi); };
$('#labels').onclick = (e) => { showLabels = !showLabels; e.currentTarget.setAttribute('aria-pressed', showLabels); updateLabels(); };
$('#reset').onclick = () => {
  snapshot();
  parts.forEach((p) => { p.hidden = false; p.faded = false; });
  LAYERS.forEach((l) => Object.assign(layerState[l.id], l));
  activeRegions.clear();
  renderLayerUI(); renderRegionUI(); select([]); frameAll(VIEWS.front);
};
addEventListener('keydown', (e) => {
  if (e.target.matches('input')) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
  const k = e.key.toLowerCase();
  if (k === 'h') hideSel();
  else if (k === 'f') fadeSel();
  else if (k === 'i') isolateSel();
  else if (k === ' ') { e.preventDefault(); focusSel(); }
  else if (k === 'escape') select([]);
});

// ---------- labels ----------
const labelLayer = document.createElement('div');
labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
canvas.after(labelLayer);
let labelEls = [];
function updateLabels() {
  labelEls.forEach((l) => l.el.remove());
  labelEls = [];
  if (!showLabels) return;
  for (const id of selected) {
    const p = parts.get(id);
    const el = document.createElement('div');
    el.className = 'label3d';
    el.textContent = displayName(p);
    labelLayer.append(el);
    const c = new THREE.Box3().setFromObject(p.mesh).getCenter(new THREE.Vector3());
    labelEls.push({ el, pos: c });
  }
}
function positionLabels() {
  const r = canvas.getBoundingClientRect();
  for (const { el, pos } of labelEls) {
    const v = pos.clone().project(camera);
    el.style.left = `${((v.x + 1) / 2) * r.width}px`;
    el.style.top = `${((1 - v.y) / 2) * r.height}px`;
    el.style.display = v.z < 1 ? '' : 'none';
  }
}

// ---------- layer & region UI ----------
function renderLayerUI() {
  const box = $('#layers');
  box.innerHTML = '';
  for (const L of LAYERS) {
    const s = layerState[L.id];
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.innerHTML = `<input type="checkbox" ${s.visible ? 'checked' : ''} aria-label="${L.zh}">
      <span><i class="swatch" style="background:#${L.color.toString(16).padStart(6, '0')}"></i>${L.zh}</span>
      <input type="range" min="0.05" max="1" step="0.05" value="${s.opacity}" aria-label="${L.zh} 透明度">`;
    const [cb, , rg] = row.children;
    cb.onchange = () => { s.visible = cb.checked; applyAll(); };
    rg.oninput = () => { s.opacity = +rg.value; if (!s.visible) { s.visible = true; cb.checked = true; } applyAll(); };
    box.append(row);
  }
}
function renderRegionUI() {
  const box = $('#regions');
  box.innerHTML = '';
  const all = document.createElement('button');
  all.textContent = '全身';
  all.className = activeRegions.size ? '' : 'on';
  all.onclick = () => { activeRegions.clear(); renderRegionUI(); applyAll(); frameAll(); };
  box.append(all);
  for (const [id, label] of REGIONS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = activeRegions.has(id) ? 'on' : '';
    b.onclick = (e) => {
      if (!(e.shiftKey || multi)) activeRegions.clear();
      activeRegions.has(id) ? activeRegions.delete(id) : activeRegions.add(id);
      renderRegionUI(); applyAll(); frameAll();
    };
    box.append(b);
  }
}
$$('[data-view]').forEach((b) => { b.onclick = () => focusView(b.dataset.view); });
function focusView(v) {
  const ids = selected.size ? selected : [...parts.values()].filter(isShown).map((p) => p.id);
  frameBox(boxOf(ids), VIEWS[v]);
}
$$('.panel-toggle').forEach((b) => { b.onclick = () => $('#' + b.dataset.target).classList.toggle('collapsed'); });
if (matchMedia('(max-width: 760px)').matches) $('#leftPanel').classList.add('collapsed');

// ---------- search ----------
let searchList = [];
function buildSearchIndex() {
  searchList = [...parts.values()].map((p) => ({ p, hay: `${p.meta.en} ${zhName(p)}`.toLowerCase() }));
}
function search(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  return searchList.filter((s) => terms.every((t) => s.hay.includes(t)))
    .sort((a, b) => a.hay.length - b.hay.length).slice(0, 40).map((s) => s.p);
}
const searchEl = $('#search');
const resultsEl = $('#searchResults');
function searchTerms(q) {
  q = q.trim().toLowerCase();
  if (q.length < 3) return [];
  return Object.keys(terms).filter((t) => terms[t].length > 1 && t.includes(q))
    .sort((a, b) => a.length - b.length).slice(0, 6);
}
searchEl.addEventListener('input', () => {
  resultsEl.innerHTML = '';
  for (const t of searchTerms(searchEl.value)) {
    const li = document.createElement('li');
    li.innerHTML = `<b>${t}</b> <small>整組 ${terms[t].length} 個</small>`;
    li.onclick = () => gotoTerm(t);
    resultsEl.append(li);
  }
  for (const p of search(searchEl.value)) {
    const li = document.createElement('li');
    li.innerHTML = `${p.meta.en} <small>${zhName(p)} · ${layerState[p.meta.l].zh}</small>`;
    li.onclick = () => gotoPart(p.id);
    resultsEl.append(li);
  }
});
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const r = search(searchEl.value); if (r.length) gotoPart(r[0].id, e.shiftKey ? r.map((p) => p.id) : null); }
});
function gotoTerm(t) {
  const ids = (terms[t] || []).filter((i) => parts.has(i));
  if (!ids.length) return false;
  gotoPart(ids[0], ids);
  if (ids.length > 1) { $('#infoName').textContent = `${t}（${ids.length} 個部分）`; renderNoteLinks(t); }
  return true;
}
function gotoPart(id, ids) {
  const sel = (ids || [id]).filter((i) => parts.has(i));
  if (!sel.length) return;
  sel.forEach((i) => { const p = parts.get(i); p.hidden = false; layerState[p.meta.l].visible = true; });
  activeRegions.clear();
  renderLayerUI(); renderRegionUI();
  select(sel);
  frameBox(boxOf(sel));
}

// ---------- deep links: #q=femur  #id=FMA24474  #iso=FMA1,FMA2 ----------
function handleHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('id')) gotoPart(h.get('id'));
  else if (h.get('t') && gotoTerm(h.get('t'))) searchEl.value = h.get('t');
  else if (h.get('q')) {
    searchEl.value = h.get('q');
    searchEl.dispatchEvent(new Event('input'));
    const r = search(h.get('q'));
    if (r.length) gotoPart(r[0].id, h.has('all') ? r.map((p) => p.id) : null);
  }
  if (['find', 'name'].includes(h.get('mode'))) setMode(h.get('mode'));
  if (h.get('iso')) { select(h.get('iso').split(',').filter((i) => parts.has(i))); isolateSel(); }
}
addEventListener('hashchange', handleHash);

// ---------- quiz ----------
const quiz = { target: null, tries: 0, right: 0, total: 0 };
$$('[data-mode]').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
function setMode(m) {
  mode = m;
  $$('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  document.body.classList.toggle('quiz-mode', m !== 'explore');
  $('#quiz').hidden = m === 'explore';
  quiz.right = quiz.total = 0;
  select([]);
  if (m !== 'explore') nextQuestion();
}
function pool() {
  // Visible, reasonably sized parts so questions are answerable on screen.
  return [...parts.values()].filter((p) => isShown(p) && !p.faded && p.mesh.geometry.boundingSphere?.radius > 1.2);
}
function nextQuestion() {
  parts.forEach((p) => { p.mesh.material.color.setHex(p.baseColor); });
  const P = pool();
  if (P.length < 4) { $('#quizPrompt').textContent = '可見的結構太少，請先打開更多系統層或區域。'; $('#quizChoices').innerHTML = ''; return; }
  const t = P[Math.floor(Math.random() * P.length)];
  quiz.target = t; quiz.tries = 0;
  if (mode === 'find') {
    $('#quizPrompt').textContent = `請點出：${displayName(t)}`;
    $('#quizChoices').innerHTML = '';
    select([]);
  } else {
    $('#quizPrompt').textContent = '藍色標示的是哪個結構？';
    selected = new Set([t.id]); applyAll();
    frameBox(boxOf([t.id]).expandByScalar(15));
    const cand = P.filter((p) => p !== t && p.meta.l === t.meta.l && baseName(p.meta.en) !== baseName(t.meta.en));
    const near = cand.filter((p) => p.meta.r === t.meta.r);
    const picks = [];
    for (const p of [...shuffle(near), ...shuffle(cand)]) {
      if (picks.length === 3) break;
      if (!picks.some((q) => baseName(q.meta.en) === baseName(p.meta.en))) picks.push(p);
    }
    const opts = shuffle([t, ...picks]);
    const box = $('#quizChoices'); box.innerHTML = '';
    for (const o of opts) {
      const b = document.createElement('button');
      b.textContent = displayName(o);
      b.onclick = () => {
        if (quiz.tries < 0) return;
        const ok = o === t;
        b.classList.add(ok ? 'right' : 'wrong');
        if (!ok) [...box.children][opts.indexOf(t)].classList.add('right');
        score(ok); quiz.tries = -1;
      };
      box.append(b);
    }
  }
  renderScore();
}
function quizClick(p) {
  if (!quiz.target || quiz.tries < 0) return;
  if (p === quiz.target) {
    p.mesh.material.color.set(0x2ecc71);
    $('#quizPrompt').textContent = `✓ 正確：${displayName(p)}`;
    score(quiz.tries === 0); quiz.tries = -1;
  } else {
    quiz.tries++;
    if (p) { p.mesh.material.color.set(0xff5252); setTimeout(() => p.mesh.material.color.setHex(p.baseColor), 700); }
    $('#quizPrompt').textContent = `✗ 你點的是 ${p ? displayName(p) : '空白處'}，再試一次：${displayName(quiz.target)}`;
    if (quiz.tries >= 2) {
      quiz.target.mesh.material.color.set(0x2ecc71);
      selected = new Set([quiz.target.id]); applyAll();
      $('#quizPrompt').textContent = `答案在這裡：${displayName(quiz.target)}`;
      score(false); quiz.tries = -1;
    }
  }
}
function score(ok) { quiz.total++; if (ok) quiz.right++; renderScore(); }
function renderScore() { $('#quizScore').textContent = `得分 ${quiz.right} / ${quiz.total}`; }
$('#quizNext').onclick = nextQuestion;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------- loop ----------
camera.position.set(0, 100, 320);
controls.target.set(0, 90, 0);
renderer.setAnimationLoop((now) => {
  if (tween) {
    const k = Math.min(1, (now - tween.t0) / 450);
    const e = 1 - (1 - k) ** 3;
    controls.target.lerpVectors(tween.from[0], tween.to[0], e);
    camera.position.lerpVectors(tween.from[1], tween.to[1], e);
    if (k >= 1) tween = null;
  }
  controls.update();
  renderer.render(scene, camera);
  if (labelEls.length) positionLabels();
});

renderLayerUI();
renderRegionUI();
load().catch((err) => { loadingEl.textContent = '模型載入失敗：' + err.message; console.error(err); });

window.atlas = { parts, select, gotoPart, frameAll };
