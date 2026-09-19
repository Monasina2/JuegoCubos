import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const GRID = 32;            // celdas por lado
const HALF = GRID / 2;      // x,z van de -16 a 15
const MAX_H = 64;

// ---------- Escena ----------
const viewport = document.getElementById('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1d23);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.minDistance = 3;
controls.maxDistance = 150;
controls.maxPolarAngle = Math.PI * 0.499;

function resetCamera() {
  camera.position.set(22, 20, 26);
  controls.target.set(0, 2, 0);
  controls.update();
}
resetCamera();

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(20, 40, 15);
scene.add(sun);

const grid = new THREE.GridHelper(GRID, GRID, 0x666b7a, 0x3a3e4a);
scene.add(grid);

// Plano invisible del suelo para el raycast
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(GRID, GRID).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ visible: false })
);
scene.add(floor);

// ---------- Cubos ----------
const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const edgeGeo = new THREE.EdgesGeometry(cubeGeo);
const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
const matCache = new Map();
const cubes = new Map();       // "x,y,z" -> mesh
const cubeGroup = new THREE.Group();
scene.add(cubeGroup);

const key = (x, y, z) => `${x},${y},${z}`;
const inBounds = (x, y, z) => x >= -HALF && x < HALF && z >= -HALF && z < HALF && y >= 0 && y < MAX_H;

function getMat(hex) {
  if (!matCache.has(hex)) matCache.set(hex, new THREE.MeshLambertMaterial({ color: hex }));
  return matCache.get(hex);
}

function addCube(x, y, z, hex) {
  if (!inBounds(x, y, z)) return;
  const k = key(x, y, z);
  const old = cubes.get(k);
  if (old) {
    if (old.userData.hex === hex) return;
    removeCube(x, y, z);
  }
  const m = new THREE.Mesh(cubeGeo, getMat(hex));
  m.add(new THREE.LineSegments(edgeGeo, edgeMat));
  m.position.set(x + 0.5, y + 0.5, z + 0.5);
  m.userData = { x, y, z, hex };
  cubeGroup.add(m);
  cubes.set(k, m);
  updateCount();
}

function removeCube(x, y, z) {
  const k = key(x, y, z);
  const m = cubes.get(k);
  if (!m) return;
  cubeGroup.remove(m);
  cubes.delete(k);
  updateCount();
}

function clearAll() {
  for (const m of cubes.values()) cubeGroup.remove(m);
  cubes.clear();
  updateCount();
}

function updateCount() {
  document.getElementById('count').textContent = `${cubes.size} cubo${cubes.size === 1 ? '' : 's'}`;
}

// ---------- UI: herramienta y color ----------
let tool = 'place';
let color = '#4caf50';
const colorInput = document.getElementById('color');
const colorHex = document.getElementById('colorHex');

function setTool(t) {
  tool = t;
  document.getElementById('tool-place').classList.toggle('active', t === 'place');
  document.getElementById('tool-erase').classList.toggle('active', t === 'erase');
  ghostMat.color.set(t === 'erase' ? 0xff3b3b : color);
  ghost.visible = false;
}
function setColor(c) {
  color = c;
  colorInput.value = c;
  colorHex.textContent = c;
  if (tool === 'place') ghostMat.color.set(c);
  [...palette.children].forEach(d => d.classList.toggle('sel', d.dataset.c === c));
}

const PALETTE = ['#e53935','#fb8c00','#fdd835','#4caf50','#00897b','#29b6f6','#3949ab','#8e24aa',
                 '#ec407a','#795548','#ffffff','#bdbdbd','#757575','#212121','#c5e1a5','#ffcc80'];
const palette = document.getElementById('palette');
PALETTE.forEach(c => {
  const d = document.createElement('div');
  d.style.background = c; d.dataset.c = c;
  d.onclick = () => setColor(c);
  palette.appendChild(d);
});

document.getElementById('tool-place').onclick = () => setTool('place');
document.getElementById('tool-erase').onclick = () => setTool('erase');
colorInput.addEventListener('input', e => setColor(e.target.value));
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'b' || e.key === 'B') setTool('place');
  if (e.key === 'e' || e.key === 'E') setTool('erase');
});

// Cámara
function zoom(f) {
  const off = camera.position.clone().sub(controls.target).multiplyScalar(f);
  const len = THREE.MathUtils.clamp(off.length(), controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(off.setLength(len));
}
document.getElementById('zoomIn').onclick = () => zoom(0.8);
document.getElementById('zoomOut').onclick = () => zoom(1.25);
document.getElementById('resetCam').onclick = resetCamera;

document.getElementById('settingsBtn').onclick = () => {
  const menu = document.getElementById('settingsMenu');
  menu.hidden = !menu.hidden;
};
document.getElementById('clear').onclick = () => {
  if (cubes.size && confirm('¿Limpiar la escena para TODOS los jugadores de la sala? (los juegos guardados no se tocan)')) { clearAll(); socket.emit('setWorld', []); document.getElementById('settingsMenu').hidden = true; }
};

// ---------- Cursor fantasma + click ----------
const ghostMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 });
const ghost = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), ghostMat);
ghost.visible = false;
scene.add(ghost);

const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const targets = [...cubes.values()];
  if (tool === 'place') targets.push(floor);
  const hit = ray.intersectObjects(targets, false)[0];
  if (!hit) return null;

  if (hit.object === floor) {
    return { x: Math.floor(hit.point.x), y: 0, z: Math.floor(hit.point.z) };
  }
  const { x, y, z } = hit.object.userData;
  if (tool === 'erase') return { x, y, z };
  const n = hit.face.normal;
  return { x: x + Math.round(n.x), y: y + Math.round(n.y), z: z + Math.round(n.z) };
}

renderer.domElement.addEventListener('pointermove', ev => {
  const p = pick(ev);
  if (p && inBounds(p.x, p.y, p.z)) {
    ghost.position.set(p.x + 0.5, p.y + 0.5, p.z + 0.5);
    ghost.visible = true;
    sendCursor(p);
  } else { ghost.visible = false; sendCursor(null); }
});
renderer.domElement.addEventListener('pointerleave', () => { ghost.visible = false; sendCursor(null); });

// Click (sin arrastrar) = usar herramienta; arrastrar = rotar cámara
let down = null;
renderer.domElement.addEventListener('pointerdown', ev => { down = { x: ev.clientX, y: ev.clientY, b: ev.button }; });
renderer.domElement.addEventListener('pointerup', ev => {
  if (!down || down.b !== 0) { down = null; return; }
  const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
  down = null;
  if (moved > 5) return;
  const p = pick(ev);
  if (!p) return;
  if (tool === 'place') { addCube(p.x, p.y, p.z, color); socket.emit('place', { x: p.x, y: p.y, z: p.z, hex: color }); }
  else { removeCube(p.x, p.y, p.z); socket.emit('erase', { x: p.x, y: p.y, z: p.z }); }
  ghost.visible = false;
});
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());


// ---------- Multijugador ----------
const socket = io();
const params = new URLSearchParams(location.search);
const roomWanted = params.get('sala') || 'principal';
const nameInput = document.getElementById('playerName');
nameInput.value = localStorage.getItem('playerName') || 'Jugador-' + Math.floor(Math.random() * 900 + 100);
const others = new Map(); // id -> { group, name }
let lastCursor = 0;

function sendCursor(p) {
  const now = performance.now();
  if (p && now - lastCursor < 60) return;
  lastCursor = now;
  socket.emit('cursor', p);
}

function makeLabel(text, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = color; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
  spr.scale.set(3, 0.75, 1); spr.position.y = 1.3;
  return spr;
}

function setPlayers(list) {
  const ul = document.getElementById('players');
  ul.innerHTML = '';
  const ids = new Set(list.map(p => p.id));
  list.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${p.color}"></i><span></span>`;
    li.querySelector('span').textContent = p.name + (p.id === socket.id ? ' (vos)' : '');
    ul.appendChild(li);
    if (p.id === socket.id) return;
    const o = others.get(p.id);
    if (!o || o.name !== p.name || o.color !== p.color) {
      if (o) { scene.remove(o.group); }
      const group = new THREE.Group();
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06, 1.06, 1.06)), new THREE.LineBasicMaterial({ color: p.color })));
      group.add(makeLabel(p.name, p.color));
      group.visible = false;
      scene.add(group);
      others.set(p.id, { group, name: p.name, color: p.color });
    }
  });
  for (const [id, o] of others) if (!ids.has(id)) { scene.remove(o.group); others.delete(id); }
}

socket.on('connect', () => socket.emit('join', { room: roomWanted, name: nameInput.value }));
socket.on('init', d => {
  clearAll();
  d.cubes.forEach(([x, y, z, hex]) => addCube(x, y, z, hex));
  document.getElementById('roomInfo').textContent = `Sala: ${d.room} — compartí este link para jugar juntos`;
  setPlayers(d.players);
});
socket.on('players', setPlayers);
socket.on('place', ({ x, y, z, hex }) => addCube(x, y, z, hex));
socket.on('erase', ({ x, y, z }) => removeCube(x, y, z));
socket.on('setWorld', list => { clearAll(); list.forEach(([x, y, z, hex]) => addCube(x, y, z, hex)); });
socket.on('cursor', ({ id, pos }) => {
  const o = others.get(id);
  if (!o) return;
  if (!pos) { o.group.visible = false; return; }
  o.group.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
  o.group.visible = true;
});
socket.on('disconnect', () => { document.getElementById('roomInfo').textContent = 'Desconectado… reintentando'; });
nameInput.addEventListener('change', () => {
  localStorage.setItem('playerName', nameInput.value);
  socket.emit('rename', nameInput.value);
});

// ---------- Presets (servidor) ----------
const statusEl = document.getElementById('status');
const listEl = document.getElementById('presetList');
function setStatus(msg, err = false) { statusEl.textContent = msg; statusEl.className = err ? 'err' : ''; }

async function loadList() {
  try {
    const list = await (await fetch('/api/presets')).json();
    listEl.innerHTML = '';
    if (!list.length) {
      listEl.innerHTML = '<li class="empty">Todavía no hay juegos guardados.</li>';
      return;
    }
    list.forEach(p => {
      const li = document.createElement('li');
      const d = new Date(p.createdAt).toLocaleString();
      li.innerHTML = `<div><div class="n"></div><div class="m">${p.count} cubos · ${d}</div></div><span>Cargar ▸</span>`;
      li.querySelector('.n').textContent = p.name;
      li.onclick = () => loadPreset(p.id, p.name);
      listEl.appendChild(li);
    });
  } catch (e) {
    listEl.innerHTML = '<li class="empty">No se pudo conectar con el servidor.</li>';
  }
}

async function loadPreset(id, name) {
  try {
    const d = await (await fetch('/api/presets/' + encodeURIComponent(id))).json();
    clearAll();
    d.cubes.forEach(([x, y, z, hex]) => addCube(x, y, z, hex));
    socket.emit('setWorld', d.cubes);
    document.getElementById('presetName').value = d.name;
    setStatus(`Cargado: ${name}`);
  } catch (e) { setStatus('Error al cargar el juego', true); }
}

document.getElementById('save').onclick = async () => {
  if (!cubes.size) return setStatus('La escena está vacía', true);
  const name = document.getElementById('presetName').value.trim() || 'Sin nombre';
  const data = [...cubes.values()].map(m => [m.userData.x, m.userData.y, m.userData.z, m.userData.hex]);
  try {
    const r = await fetch('/api/presets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, cubes: data })
    });
    if (!r.ok) throw new Error();
    const saved = await r.json();
    setStatus(`Guardado como "${saved.name}" ✔`);
    loadList();
  } catch (e) { setStatus('Error al guardar en el servidor', true); }
};

// ---------- Loop ----------
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

setColor(color);
updateCount();
loadList();   // al cargar la página se indexan todos los presets guardados

(function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
})();
