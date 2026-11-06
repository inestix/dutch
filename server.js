const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { Game } = require('./game');

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 6;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map(); // code -> room
const tokens = new Map(); // token -> { code, pid }

const newId = () => crypto.randomBytes(8).toString('hex');
function newCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => L[Math.floor(Math.random() * L.length)]).join(''); } while (rooms.has(c));
  return c;
}
const cleanName = (n) => String(n || '').trim().slice(0, 16) || 'Joueur';

function addPlayer(room, name, socket) {
  const p = { id: newId(), token: newId(), name: cleanName(name), socketId: socket.id, connected: true };
  room.players.push(p);
  tokens.set(p.token, { code: room.code, pid: p.id });
  bind(socket, room, p);
  return p;
}

function bind(socket, room, p) {
  p.socketId = socket.id;
  p.connected = true;
  socket.data.code = room.code;
  socket.data.pid = p.id;
}

function stateFor(room, p) {
  return {
    code: room.code,
    me: p.id,
    hostId: room.hostId,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    lobby: room.players.map((x) => ({ id: x.id, name: x.name, connected: x.connected })),
    game: room.game ? room.game.view(p.id) : null,
  };
}

function broadcast(room) {
  if (room.game) {
    for (const ev of room.game.takeEvents()) {
      if (ev.to === 'all') io.to(room.code).emit(ev.type, ev.data);
      else {
        const p = room.players.find((x) => x.id === ev.to);
        if (p && p.connected) io.to(p.socketId).emit(ev.type, ev.data);
      }
    }
  }
  for (const p of room.players) if (p.connected) io.to(p.socketId).emit('state', stateFor(room, p));
}

function ctx(socket) {
  const room = rooms.get(socket.data.code);
  if (!room) return {};
  return { room, p: room.players.find((x) => x.id === socket.data.pid) };
}

io.on('connection', (socket) => {
  socket.on('create', ({ name } = {}, cb = () => {}) => {
    const room = { code: newCode(), players: [], hostId: null, game: null };
    rooms.set(room.code, room);
    const p = addPlayer(room, name, socket);
    room.hostId = p.id;
    socket.join(room.code);
    cb({ ok: true, token: p.token });
    broadcast(room);
  });

  socket.on('join', ({ code, name } = {}, cb = () => {}) => {
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return cb({ error: 'Salon introuvable' });
    if (room.game) return cb({ error: 'La partie a déjà commencé' });
    if (room.players.length >= MAX_PLAYERS) return cb({ error: 'Le salon est complet (6 joueurs)' });
    const p = addPlayer(room, name, socket);
    socket.join(room.code);
    cb({ ok: true, token: p.token });
    broadcast(room);
  });

  socket.on('resume', ({ token } = {}, cb = () => {}) => {
    const t = tokens.get(token);
    const room = t && rooms.get(t.code);
    const p = room && room.players.find((x) => x.id === t.pid);
    if (!p) return cb({ error: 'Session expirée' });
    bind(socket, room, p);
    socket.join(room.code);
    cb({ ok: true });
    broadcast(room);
  });

  socket.on('leave', () => {
    const { room, p } = ctx(socket);
    if (!room || !p) return;
    socket.leave(room.code);
    socket.data = {};
    if (!room.game) {
      room.players = room.players.filter((x) => x !== p);
      tokens.delete(p.token);
      if (room.hostId === p.id) room.hostId = room.players[0]?.id || null;
      if (!room.players.length) rooms.delete(room.code);
    } else {
      p.connected = false;
    }
    broadcast(room);
  });

  socket.on('start', (_, cb = () => {}) => {
    const { room, p } = ctx(socket);
    if (!room || room.hostId !== p.id) return cb({ error: "Seul l'hôte peut lancer la partie" });
    if (room.game && room.game.phase !== 'gameOver') return cb({ error: 'Partie déjà en cours' });
    const present = room.players.filter((x) => x.connected);
    if (present.length < MIN_PLAYERS) return cb({ error: `Il faut au moins ${MIN_PLAYERS} joueurs` });
    room.players = present;
    room.game = new Game(present);
    cb({ ok: true });
    broadcast(room);
  });

  socket.on('action', (a, cb = () => {}) => {
    const { room, p } = ctx(socket);
    if (!room || !room.game || !p) return cb({ error: 'Pas de partie en cours' });
    let err;
    if (a && a.type === 'nextRound') {
      err = room.hostId === p.id ? room.game.nextRound() : "Seul l'hôte peut lancer la manche suivante";
    } else if (a && a.type === 'force') {
      err = room.hostId === p.id ? room.game.force() : "Seul l'hôte peut faire ça";
    } else {
      err = room.game.act(p.id, a);
    }
    cb(err ? { error: err } : { ok: true });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const { room, p } = ctx(socket);
    if (!room || !p || p.socketId !== socket.id) return;
    p.connected = false;
    if (room.players.every((x) => !x.connected)) {
      // Salon vide : on le supprime après 30 minutes sans retour
      setTimeout(() => {
        if (rooms.get(room.code) === room && room.players.every((x) => !x.connected)) {
          for (const x of room.players) tokens.delete(x.token);
          rooms.delete(room.code);
        }
      }, 30 * 60 * 1000);
    }
    if (room.hostId === p.id) {
      const other = room.players.find((x) => x.connected);
      if (other) room.hostId = other.id;
    }
    broadcast(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Dutch en ligne sur http://localhost:${PORT}`));
