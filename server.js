const express = require('express');
const fs = require('fs');
const path = require('path');

const http = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const PRESETS_DIR = path.join(__dirname, 'presets');
if (!fs.existsSync(PRESETS_DIR)) fs.mkdirSync(PRESETS_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// three.js se sirve desde node_modules (instalado por install.bat)
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));

function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'preset';
}

// Lista todos los presets guardados
app.get('/api/presets', (req, res) => {
  const list = fs.readdirSync(PRESETS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, f), 'utf8'));
        return { id: d.id, name: d.name, createdAt: d.createdAt, count: d.cubes.length };
      } catch (e) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});

// Devuelve un preset completo
app.get('/api/presets/:id', (req, res) => {
  const file = path.join(PRESETS_DIR, path.basename(req.params.id) + '.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'No existe' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

// Guarda un preset nuevo (nunca sobreescribe uno existente)
app.post('/api/presets', (req, res) => {
  const { name, cubes } = req.body || {};
  if (!Array.isArray(cubes)) return res.status(400).json({ error: 'Datos inválidos' });
  const cleanName = String(name || 'Sin nombre').trim().slice(0, 60) || 'Sin nombre';
  const base = slug(cleanName);
  let id = base, n = 2;
  while (fs.existsSync(path.join(PRESETS_DIR, id + '.json'))) id = `${base}-${n++}`;
  const data = { id, name: cleanName, createdAt: Date.now(), cubes };
  fs.writeFileSync(path.join(PRESETS_DIR, id + '.json'), JSON.stringify(data));
  res.json({ id, name: cleanName, createdAt: data.createdAt, count: cubes.length });
});


// ---------- Multijugador (salas en memoria) ----------
const rooms = new Map(); // sala -> { cubes: Map("x,y,z" -> hex), players: Map(socketId -> {name,color}) }
const COLORS = ['#ff5252','#ffb300','#66bb6a','#29b6f6','#ab47bc','#ec407a','#26a69a','#ff7043'];
const validHex = h => typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h);
const validPos = (x, y, z) => [x, y, z].every(Number.isInteger) && x >= -16 && x < 16 && z >= -16 && z < 16 && y >= 0 && y < 64;

function getRoom(name) {
  if (!rooms.has(name)) rooms.set(name, { cubes: new Map(), players: new Map() });
  return rooms.get(name);
}
const playerList = room => [...room.players.entries()].map(([id, p]) => ({ id, name: p.name, color: p.color }));

io.on('connection', socket => {
  let roomName = null;

  socket.on('join', ({ room, name }) => {
    roomName = String(room || 'principal').replace(/[^\w-]/g, '').slice(0, 30) || 'principal';
    const r = getRoom(roomName);
    const color = COLORS[r.players.size % COLORS.length];
    r.players.set(socket.id, { name: String(name || 'Jugador').slice(0, 20), color });
    socket.join(roomName);
    socket.emit('init', {
      id: socket.id, room: roomName, color,
      cubes: [...r.cubes.entries()].map(([k, hex]) => [...k.split(',').map(Number), hex]),
      players: playerList(r)
    });
    io.to(roomName).emit('players', playerList(r));
  });

  socket.on('rename', name => {
    const r = rooms.get(roomName); const p = r && r.players.get(socket.id);
    if (!p) return;
    p.name = String(name || 'Jugador').slice(0, 20);
    io.to(roomName).emit('players', playerList(r));
  });

  socket.on('place', ({ x, y, z, hex }) => {
    const r = rooms.get(roomName);
    if (!r || !validPos(x, y, z) || !validHex(hex)) return;
    r.cubes.set(`${x},${y},${z}`, hex);
    socket.to(roomName).emit('place', { x, y, z, hex });
  });

  socket.on('erase', ({ x, y, z }) => {
    const r = rooms.get(roomName);
    if (!r || !validPos(x, y, z)) return;
    r.cubes.delete(`${x},${y},${z}`);
    socket.to(roomName).emit('erase', { x, y, z });
  });

  // Reemplaza todo el mundo (limpiar o cargar un preset)
  socket.on('setWorld', cubes => {
    const r = rooms.get(roomName);
    if (!r || !Array.isArray(cubes) || cubes.length > 20000) return;
    r.cubes.clear();
    const clean = [];
    for (const c of cubes) {
      if (Array.isArray(c) && validPos(c[0], c[1], c[2]) && validHex(c[3])) {
        r.cubes.set(`${c[0]},${c[1]},${c[2]}`, c[3]);
        clean.push(c);
      }
    }
    socket.to(roomName).emit('setWorld', clean);
  });

  socket.on('cursor', pos => {
    if (!roomName) return;
    socket.to(roomName).volatile.emit('cursor', { id: socket.id, pos: pos && validPos(pos.x, pos.y, pos.z) ? pos : null });
  });

  socket.on('disconnect', () => {
    const r = rooms.get(roomName);
    if (!r) return;
    r.players.delete(socket.id);
    io.to(roomName).emit('players', playerList(r));
    io.to(roomName).emit('cursor', { id: socket.id, pos: null });
  });
});

// Arranca en PORT (o 3000); si está ocupado prueba el siguiente
function start(port, tries = 0) {
  const onError = err => {
    if (err.code === 'EADDRINUSE' && tries < 20) start(port + 1, tries + 1);
    else { console.error(err); process.exit(1); }
  };
  httpServer.once('error', onError);
  httpServer.listen(port, () => {
    httpServer.removeListener('error', onError);
    console.log('==============================================');
    console.log(`  Editor de cubos corriendo en el puerto ${port}`);
    console.log(`  Abrí:  http://localhost:${port}`);
    console.log('  Sala por defecto: "principal"  (usá ?sala=nombre para otra)');
    console.log('  (Ctrl+C para detener el servidor)');
    console.log('==============================================');
  });
}
start(parseInt(process.env.PORT, 10) || 3000);
