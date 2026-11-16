'use strict';
const express = require('express');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { Juego, decidirBot, CFG_DEFECTO } = require('./game');

const PORT = process.env.PORT || 3000;
const NUM_MESAS = 4;
const RESERVA_SILLA = 5 * 60 * 1000; // tiempo que se guarda la silla a un desconectado

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const fs = require('fs');
const path = require('path');
const carpeta = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
app.use(express.static(carpeta));

const sesiones = new Map(); // token -> { token, nombre, socketId, mesa, silla }
const mesas = Array.from({ length: NUM_MESAS }, (_, i) => ({
  id: i, nombre: 'Mesa ' + (i + 1), cfg: { ...CFG_DEFECTO }, sillas: [], juego: null, estado: 'espera',
  espectadores: new Set(), timer: null, host: null,
}));
mesas.forEach(prepararSillas);

function prepararSillas(m) {
  m.sillas = Array.from({ length: m.cfg.maxJugadores }, () => ({ token: null, nombre: null, bot: false, conectado: false, desde: 0, cerrada: false }));
}
const limpia = (s) => String(s || '').replace(/[<>]/g, '').trim().slice(0, 16);
const num = (v, min, max, def) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };

function esBotTemporal(m, s) { return s.token && !s.conectado && Date.now() - s.desde > m.cfg.graciaDesconexion; }
function controlaBot(m, i) { const s = m.sillas[i]; return s.bot || esBotTemporal(m, s); }

function resumenMesas() {
  return mesas.map((m) => ({
    id: m.id, nombre: m.nombre, estado: m.estado,
    sillas: m.sillas.map((s) => ({ nombre: s.nombre, bot: s.bot, conectado: s.conectado, cerrada: s.cerrada, libre: !s.token && !s.bot && !s.cerrada })),
    humanos: m.sillas.filter((s) => s.token).length, max: m.sillas.length,
  }));
}
function emitirLobby() { io.to('lobby').emit('mesas', resumenMesas()); }

function emitirMesa(m) {
  const base = {
    mesa: m.id, nombre: m.nombre, estado: m.estado, cfg: { vidas: m.cfg.vidas, bots: m.cfg.bots, botNivel: m.cfg.botNivel, maxJugadores: m.cfg.maxJugadores, trio305: m.cfg.trio305 },
    host: m.host,
    sillas: m.sillas.map((s, i) => ({ i, nombre: s.nombre, bot: s.bot, conectado: s.conectado, cerrada: s.cerrada, libre: !s.token && !s.bot && !s.cerrada, botTemp: esBotTemporal(m, s) })),
  };
  for (const ses of sesiones.values()) {
    if (ses.mesa !== m.id || !ses.socketId) continue;
    const sock = io.sockets.sockets.get(ses.socketId); if (!sock) continue;
    sock.emit('mesa', { ...base, esHost: m.host === ses.token, yoSilla: ses.silla, juego: m.juego ? m.juego.vista(ses.silla) : null });
  }
  emitirLobby();
}

function programar(m) {
  clearTimeout(m.timer); m.timer = null;
  const j = m.juego; if (!j) return;
  if (j.fase === 'reveal') {
    m.timer = setTimeout(() => { j.nuevaRonda(); emitirMesa(m); programar(m); }, j.cfg.pausaRonda);
  } else if (j.fase === 'fin') {
    m.estado = 'espera'; emitirMesa(m);
  } else if (j.turno >= 0) {
    const i = j.turno, s = m.sillas[i];
    if (controlaBot(m, i)) {
      m.timer = setTimeout(() => {
        if (!m.juego || m.juego.turno !== i || !controlaBot(m, i)) return programar(m);
        const d = decidirBot(j, i); j.accion(i, d.tipo, d.carta); emitirMesa(m); programar(m);
      }, 800 + Math.random() * 700);
    } else if (s.token && !s.conectado) {
      // humano desconectado: esperar a que acabe la gracia y entonces juega el bot
      m.timer = setTimeout(() => { emitirMesa(m); programar(m); }, Math.max(500, m.cfg.graciaDesconexion - (Date.now() - s.desde) + 100));
    }
  }
}

function iniciarPartida(m) {
  const humanos = m.sillas.filter((s) => s.token).length;
  let botsPorPoner = Math.min(m.cfg.bots, m.sillas.length - humanos);
  if (humanos + botsPorPoner < 2) botsPorPoner = 2 - humanos;
  for (const s of m.sillas) {
    if (s.token) continue;
    if (botsPorPoner > 0) { s.bot = true; s.nombre = 'Bot ' + (m.sillas.indexOf(s) + 1); s.cerrada = false; botsPorPoner--; }
    else { s.cerrada = true; s.bot = false; s.nombre = null; }
  }
  const jugadores = m.sillas.map((s) => ({ nombre: s.nombre || '—', bot: s.bot, nivel: m.cfg.botNivel }));
  m.juego = new Juego(m.cfg, jugadores);
  // las sillas cerradas se eliminan del juego
  m.juego.p.forEach((p, i) => { if (m.sillas[i].cerrada) p.vidas = 0; });
  m.estado = 'jugando'; m.juego.nuevaRonda();
  emitirMesa(m); programar(m);
}

function salirDeMesa(ses) {
  if (ses.mesa === null) return;
  const m = mesas[ses.mesa];
  if (ses.silla >= 0) {
    const s = m.sillas[ses.silla];
    if (m.estado === 'jugando') { s.conectado = false; s.desde = Date.now(); s.reserva = Date.now() + RESERVA_SILLA; }
    else { s.token = null; s.nombre = null; s.conectado = false; }
  }
  if (m.host === ses.token) m.host = (m.sillas.find((s) => s.token && s.token !== ses.token) || {}).token || null;
  const sock = io.sockets.sockets.get(ses.socketId);
  if (sock) { sock.leave('mesa' + m.id); sock.join('lobby'); }
  ses.mesa = null; ses.silla = -1;
  emitirMesa(m); programar(m);
}

io.on('connection', (socket) => {
  let ses = null;
  socket.join('lobby');

  socket.on('entrar', (d = {}) => {
    const prev = d.token && sesiones.get(d.token);
    if (prev) {
      ses = prev; ses.socketId = socket.id; ses.nombre = limpia(d.nombre) || ses.nombre;
    } else {
      const token = crypto.randomBytes(16).toString('hex');
      ses = { token, nombre: limpia(d.nombre) || 'Jugador', socketId: socket.id, mesa: null, silla: -1 };
      sesiones.set(token, ses);
    }
    socket.emit('sesion', { token: ses.token, nombre: ses.nombre, enPartida: ses.mesa !== null && ses.silla >= 0 });
    if (ses.mesa !== null) {
      const m = mesas[ses.mesa]; socket.leave('lobby'); socket.join('mesa' + m.id);
      if (ses.silla >= 0 && !m.sillas[ses.silla].conectado) { /* espera "volver" */ socket.emit('puedeVolver', { mesa: m.id }); }
      else emitirMesa(m);
    } else socket.emit('mesas', resumenMesas());
  });

  const mesaDe = () => (ses && ses.mesa !== null ? mesas[ses.mesa] : null);

  socket.on('volver', () => { // VOLVER AL JUEGO
    if (!ses || ses.mesa === null || ses.silla < 0) return;
    const m = mesas[ses.mesa], s = m.sillas[ses.silla];
    if (s.token !== ses.token) return;
    s.conectado = true; socket.join('mesa' + m.id); socket.leave('lobby');
    emitirMesa(m); programar(m);
  });

  socket.on('unirse', ({ mesa, silla } = {}) => {
    if (!ses || ses.mesa !== null) return;
    const m = mesas[num(mesa, 0, NUM_MESAS - 1, -1)]; if (!m) return;
    let i = silla === undefined || silla === null || silla === -1 ? -1 : num(silla, 0, m.sillas.length - 1, -2);
    if (i === -2) return;
    if (i >= 0) {
      const s = m.sillas[i];
      const libre = !s.token && !s.cerrada && (!s.bot || m.estado === 'jugando');
      const reservaVencida = s.token && !s.conectado && s.reserva && Date.now() > s.reserva;
      if (!libre && !reservaVencida) return socket.emit('aviso', 'Esa silla está ocupada');
      if (s.token) { const viejo = sesiones.get(s.token); if (viejo) { viejo.mesa = null; viejo.silla = -1; } }
      s.token = ses.token; s.nombre = ses.nombre; s.bot = false; s.conectado = true; s.reserva = 0;
      if (m.juego) m.juego.p[i].nombre = ses.nombre, m.juego.p[i].bot = false;
      if (!m.host || !sesiones.get(m.host) || sesiones.get(m.host).mesa !== m.id) m.host = ses.token;
    }
    ses.mesa = m.id; ses.silla = i;
    socket.leave('lobby'); socket.join('mesa' + m.id);
    emitirMesa(m); programar(m);
  });

  socket.on('configurar', (c = {}) => {
    const m = mesaDe(); if (!m || m.estado !== 'espera' || m.host !== ses.token) return;
    const max = num(c.maxJugadores, 2, 8, m.cfg.maxJugadores);
    if (max !== m.sillas.length && !m.sillas.some((s, i) => i >= max && s.token)) {
      while (m.sillas.length < max) m.sillas.push({ token: null, nombre: null, bot: false, conectado: false, desde: 0, cerrada: false });
      m.sillas.length = max; m.cfg.maxJugadores = max;
    }
    m.cfg.vidas = num(c.vidas, 1, 10, m.cfg.vidas);
    m.cfg.bots = num(c.bots, 0, 7, m.cfg.bots);
    if (['facil', 'normal', 'dificil'].includes(c.botNivel)) m.cfg.botNivel = c.botNivel;
    if (typeof c.trio305 === 'boolean') m.cfg.trio305 = c.trio305;
    emitirMesa(m);
  });

  socket.on('iniciar', () => {
    const m = mesaDe(); if (!m || m.estado === 'jugando' || m.host !== ses.token || ses.silla < 0) return;
    // al repetir partida se limpian los bots y sillas cerradas de la anterior
    for (const s of m.sillas) if (!s.token) { s.bot = false; s.cerrada = false; s.nombre = null; }
    iniciarPartida(m);
  });

  socket.on('accion', ({ tipo, carta } = {}) => {
    const m = mesaDe(); if (!m || !m.juego || m.estado !== 'jugando' || ses.silla < 0) return;
    const s = m.sillas[ses.silla]; if (s.token !== ses.token || !s.conectado) return;
    const r = m.juego.accion(ses.silla, String(tipo), String(carta || ''));
    if (!r.ok) return socket.emit('aviso', r.error);
    emitirMesa(m); programar(m);
  });

  socket.on('salir', () => { if (ses) { salirDeMesa(ses); socket.emit('mesas', resumenMesas()); } });

  socket.on('disconnect', () => {
    if (!ses || ses.socketId !== socket.id) return;
    ses.socketId = null;
    if (ses.mesa === null) return;
    const m = mesas[ses.mesa];
    if (ses.silla >= 0) {
      const s = m.sillas[ses.silla]; s.conectado = false; s.desde = Date.now(); s.reserva = Date.now() + RESERVA_SILLA;
      if (m.estado === 'espera') setTimeout(() => { if (!s.conectado && s.token === ses.token && m.estado === 'espera') { s.token = null; s.nombre = null; ses.mesa = null; ses.silla = -1; emitirMesa(m); } }, 30000);
    }
    emitirMesa(m); programar(m);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  TIMBA en marcha  ->  http://localhost:' + PORT);
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log('  Desde el móvil   ->  http://' + n.address + ':' + PORT);
  console.log('');
});
