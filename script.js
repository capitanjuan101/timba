'use strict';
const $ = (id) => document.getElementById(id);
const socket = io();
const ls = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
let sonido = ls.get('timba_sonido', '1') === '1', anim = ls.get('timba_anim', '1') === '1';
let estado = null, seleccion = null, vistasIds = new Set(), prev = null, audioCtx = null;

// ---------- utilidades ----------
const NOMBRES = { 1: 'As', 10: 'Sota', 11: 'Caballo', 12: 'Rey' };
const SVG = {
  oros: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="#e0b43a" stroke="#8a6a12" stroke-width="2"/><circle cx="20" cy="20" r="9" fill="none" stroke="#8a6a12" stroke-width="2"/></svg>',
  copas: '<svg viewBox="0 0 40 40"><path d="M9 7h22c0 11-4 15-11 15S9 18 9 7zM18 22h4v9h-4zM11 32h18v3H11z" fill="#c0322d" stroke="#6b1118" stroke-width="1.5"/></svg>',
  espadas: '<svg viewBox="0 0 40 40"><path d="M20 2l5 21H15z" fill="#2a4d8f"/><rect x="9" y="23" width="22" height="4" rx="2" fill="#1b3366"/><rect x="18" y="27" width="4" height="10" fill="#2a4d8f"/></svg>',
  bastos: '<svg viewBox="0 0 40 40"><rect x="16" y="3" width="8" height="34" rx="4" transform="rotate(25 20 20)" fill="#6b8e2d" stroke="#3b5216" stroke-width="1.5"/><circle cx="14" cy="14" r="3" fill="#3b5216"/><circle cx="26" cy="27" r="3" fill="#3b5216"/></svg>',
};
const cartaEl = (c, extra = '') => `<div class="carta ${c.palo} ${extra}" data-id="${c.id}"><span class="num">${c.num}</span>${SVG[c.palo]}<span class="nom">${NOMBRES[c.num] || ''}</span></div>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
const pantalla = (n) => { for (const s of document.querySelectorAll('.pantalla')) s.hidden = s.id !== 's-' + n; };
const vidasTxt = (n, max) => '♥'.repeat(Math.max(0, n)) + '<span style="opacity:.25">' + '♥'.repeat(Math.max(0, max - n)) + '</span>';
function toast(t) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (e.hidden = true), 2200); }

// ---------- sonido (solo tras interacción, opcional) ----------
function pitido(f = 440, d = 0.08, tipo = 'sine', v = 0.06) {
  if (!sonido) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = tipo; o.frequency.value = f; g.gain.value = v; o.connect(g); g.connect(audioCtx.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d);
  } catch (e) {}
}
const sonidos = {
  carta: () => pitido(520, 0.06, 'triangle'), turno: () => { pitido(660, 0.1); }, pica: () => { pitido(300, 0.18, 'square'); },
  timba: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => pitido(f, 0.18, 'triangle', 0.08), i * 110)); },
  vida: () => pitido(200, 0.25, 'sawtooth', 0.05), gana: () => sonidos.timba(),
};

// ---------- conexión y sesión ----------
function entrar() { socket.emit('entrar', { token: ls.get('timba_token', ''), nombre: ls.get('timba_nombre', '') }); }
socket.on('connect', () => { if (ls.get('timba_nombre', '')) entrar(); });
socket.on('disconnect', () => toast('Conexión perdida, reconectando…'));
socket.on('sesion', (s) => { ls.set('timba_token', s.token); ls.set('timba_nombre', s.nombre); $('quien').textContent = s.nombre; if (!estado && pantallaActual() === 'nombre') pantalla('salon'); });
socket.on('aviso', toast);
socket.on('puedeVolver', () => { $('volver').hidden = false; });
const pantallaActual = () => (document.querySelector('.pantalla:not([hidden])') || {}).id?.slice(2);

$('nombre').value = ls.get('timba_nombre', '');
$('b-entrar').onclick = () => { const n = $('nombre').value.trim(); if (!n) return $('nombre').focus(); ls.set('timba_nombre', n); sonidos.carta(); entrar(); pantalla('salon'); };
$('b-volver').onclick = () => { $('volver').hidden = true; socket.emit('volver'); };

// ---------- salón ----------
socket.on('mesas', (ms) => {
  estado = null; if (pantallaActual() !== 'nombre') pantalla('salon');
  $('mesas').innerHTML = ms.map((m) => `
    <div class="mesa-card"><h3>${esc(m.nombre)}</h3>
      <div class="est">${m.estado === 'jugando' ? 'Partida en curso' : 'Esperando jugadores'} · ${m.humanos}/${m.max} personas</div>
      <div class="sillas">${m.sillas.map((s, i) => s.cerrada ? '' : `<button class="silla ${s.libre ? 'libre' : 'ocupada'}" data-m="${m.id}" data-s="${i}">${s.libre ? 'Sentarse' : esc(s.nombre || '—') + (s.bot ? ' (bot)' : '')}</button>`).join('')}</div>
      <button class="btn mini" data-m="${m.id}" data-s="-1">Mirar</button></div>`).join('');
});
$('mesas').onclick = (e) => {
  const b = e.target.closest('button[data-m]'); if (!b) return;
  const bot = b.classList.contains('ocupada') && !/\(bot\)/.test(b.textContent);
  if (bot) return toast('Esa silla está ocupada');
  socket.emit('unirse', { mesa: +b.dataset.m, silla: +b.dataset.s });
};

// ---------- sala de espera ----------
function pintarEspera(d) {
  pantalla('espera'); $('esp-titulo').textContent = d.nombre;
  $('esp-sillas').innerHTML = '<div class="sillas">' + d.sillas.filter((s) => !s.cerrada).map((s) => `<span class="silla ${s.libre ? '' : 'ocupada'}">${s.libre ? 'Libre' : esc(s.nombre || '—')}${s.bot ? ' (bot)' : ''}</span>`).join('') + '</div>';
  $('esp-cfg').hidden = !d.esHost; $('b-iniciar').hidden = !d.esHost || d.yoSilla < 0;
  if (d.esHost && document.activeElement.closest('#esp-cfg') === null) {
    $('c-vidas').value = d.cfg.vidas; $('c-max').value = d.cfg.maxJugadores; $('c-bots').value = d.cfg.bots; $('c-nivel').value = d.cfg.botNivel; $('c-trio').checked = d.cfg.trio305;
  }
  $('esp-msg').textContent = d.yoSilla < 0 ? 'Estás mirando.' : d.esHost ? 'Los huecos libres se rellenan con bots al empezar.' : 'Esperando a que el anfitrión empiece.';
}
const enviarCfg = () => socket.emit('configurar', { vidas: $('c-vidas').value, maxJugadores: $('c-max').value, bots: $('c-bots').value, botNivel: $('c-nivel').value, trio305: $('c-trio').checked });
['c-vidas', 'c-max', 'c-bots', 'c-nivel', 'c-trio'].forEach((id) => ($(id).onchange = enviarCfg));
$('b-iniciar').onclick = () => socket.emit('iniciar');
$('b-salir1').onclick = () => socket.emit('salir');

// ---------- mesa ----------
socket.on('mesa', (d) => {
  const antes = estado; estado = d;
  if (!d.juego || (d.estado === 'espera' && d.juego.fase === 'fin' && pantallaActual() !== 'juego')) return pintarEspera(d);
  if (d.estado === 'espera' && !d.juego) return pintarEspera(d);
  pantalla('juego'); pintarJuego(d, antes);
});

function pintarJuego(d, antes) {
  const j = d.juego, yo = j.yo, turnoMio = j.turno === yo && yo >= 0;
  const nombreTurno = j.turno >= 0 ? j.jugadores[j.turno].nombre : '';
  $('j-info').textContent = j.fase === 'fin' ? 'Fin de la partida' : 'Ronda ' + j.ronda + (j.fase === 'ultima' ? ' · última vuelta' : '');
  $('j-vidas-yo').innerHTML = yo >= 0 ? vidasTxt(j.jugadores[yo].vidas, j.cfg.vidas) : 'Mirando';

  // rivales (todos menos yo)
  $('rivales').innerHTML = j.jugadores.filter((x) => x.i !== yo && !(x.vidas <= 0 && x.nCartas === 0 && x.nombre === '—')).map((x) => `
    <div class="rival ${j.turno === x.i ? 'turno' : ''} ${x.vidas <= 0 ? 'fuera' : ''}">
      ${j.picador === x.i ? '<span class="picador">PICÓ</span>' : ''}
      <div class="n">${esc(x.nombre)}${x.bot ? ' 🤖' : ''}</div><div class="v">${x.vidas > 0 ? vidasTxt(x.vidas, j.cfg.vidas) : 'Eliminado'}</div>
      <div class="mini-cartas">${x.cartas ? x.cartas.map((c) => cartaEl(c)).join('') : '<div class="dorso"></div>'.repeat(x.nCartas)}</div></div>`).join('');

  // mazo y descarte
  $('mazo-n').textContent = 'Mazo (' + j.mazo + ')';
  $('desc-carta').innerHTML = j.descarte ? cartaEl(j.descarte) : '<div class="carta vacia"></div>';
  const puedeRobar = j.acciones.includes('robar_mazo');
  $('mazo').classList.toggle('activa', puedeRobar); $('descarte').classList.toggle('activa', puedeRobar);

  // mensaje
  let msg = '';
  if (j.fase === 'fin') msg = j.ganador === yo ? '¡Has ganado!' : 'Gana ' + esc(j.jugadores[j.ganador]?.nombre || '—');
  else if (j.fase === 'reveal') msg = 'Recuento…';
  else if (turnoMio) msg = j.robada ? 'Elige una carta para descartar' : 'Tu turno: roba del mazo o coge el descarte';
  else msg = 'Juega ' + esc(nombreTurno);
  $('msg').innerHTML = msg;

  // mano
  const nuevas = j.mano.filter((c) => !vistasIds.has(c.id));
  j.mano.forEach((c) => vistasIds.add(c.id));
  if (j.fase === 'turno' && j.ronda !== (antes?.juego?.ronda)) vistasIds = new Set(j.mano.map((c) => c.id));
  if (!j.mano.some((c) => c.id === seleccion)) seleccion = null;
  $('mano').innerHTML = j.mano.map((c) => cartaEl(c, (c.id === seleccion ? 'sel ' : '') + (anim && nuevas.includes(c) ? 'nueva' : ''))).join('');
  $('mi-puntos').textContent = j.miPuntos !== null && yo >= 0 ? 'Tus puntos: ' + String(j.miPuntos).replace('.', ',') : '';

  // acciones
  const a = j.acciones, bt = [];
  if (a.includes('timba')) bt.push('<button class="btn oro grande" data-a="timba">¡TIMBA!</button>');
  if (a.includes('picar')) bt.push('<button class="btn oro" data-a="picar">Picar</button>');
  if (a.includes('descartar')) bt.push(`<button class="btn oro" data-a="descartar" ${seleccion ? '' : 'disabled'}>Descartar</button>`);
  $('acciones').innerHTML = bt.join('');

  efectos(j, antes?.juego, turnoMio);
  if (j.fase === 'reveal' || j.fase === 'fin') pintarResultado(j); else $('resultado').hidden = true;
}

function efectos(j, a, turnoMio) {
  const banner = (t, cls) => { const b = $('banner'); b.className = cls; b.innerHTML = '<span>' + t + '</span>'; b.hidden = false; clearTimeout(banner.t); banner.t = setTimeout(() => (b.hidden = true), anim ? 1000 : 600); };
  if (a) {
    if (j.picador !== null && a.picador === null) { banner('¡PICA!', 'pica'); sonidos.pica(); }
    if (j.resultado && !a.resultado && j.resultado.tipo === 'timba') { banner('¡TIMBA!', ''); sonidos.timba(); }
    else if (j.resultado && !a.resultado && Object.keys(j.resultado.perdieron).length) sonidos.vida();
    if (j.descarte && a.descarte && j.descarte.id !== a.descarte.id) sonidos.carta();
    if (turnoMio && a.turno !== j.turno) sonidos.turno();
    if (j.fase === 'fin' && a.fase !== 'fin') sonidos.gana();
  }
}

function pintarResultado(j) {
  const r = j.resultado; if (!r) return;
  const filas = j.jugadores.filter((x) => r.manos[x.i]).map((x) => `
    <div class="res-fila ${r.perdieron[x.i] ? 'perdio' : ''}"><span class="n">${esc(x.nombre)}${r.timbaDe === x.i ? ' · TIMBA' : ''}${r.picador === x.i ? ' · picó' : ''}</span>
    ${r.manos[x.i].map((c) => cartaEl(c)).join('')}<span class="pt">${String(r.puntos[x.i]).replace('.', ',')}</span>
    ${r.perdieron[x.i] ? '<span>−' + r.perdieron[x.i] + '♥</span>' : ''}</div>`).join('');
  const fin = j.fase === 'fin';
  $('resultado').innerHTML = `<h2 style="margin:0;color:var(--oro2);font-size:30px">${fin ? (j.ganador === j.yo ? '¡Has ganado!' : 'Gana ' + esc(j.jugadores[j.ganador]?.nombre || '—')) : r.tipo === 'timba' ? '¡TIMBA!' : 'Recuento'}</h2>${filas}
    ${fin ? '<button id="b-fin" class="btn oro grande">Volver a la sala</button>' : '<p class="sub">Siguiente ronda en unos segundos…</p>'}`;
  $('resultado').hidden = false;
  const bf = $('b-fin'); if (bf) bf.onclick = () => { $('resultado').hidden = true; if (estado) { estado.juego = null; pintarEspera(estado); } };
}

// ---------- interacción ----------
$('mazo').onclick = () => socket.emit('accion', { tipo: 'robar_mazo' });
$('descarte').onclick = () => socket.emit('accion', { tipo: 'robar_descarte' });
$('mano').onclick = (e) => {
  const c = e.target.closest('.carta'); if (!c || !estado?.juego?.acciones.includes('descartar')) return;
  seleccion = seleccion === c.dataset.id ? null : c.dataset.id; sonidos.carta(); pintarJuego(estado, estado);
};
$('acciones').onclick = (e) => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const tipo = b.dataset.a;
  if (tipo === 'descartar') { if (!seleccion) return; socket.emit('accion', { tipo, carta: seleccion }); seleccion = null; }
  else socket.emit('accion', { tipo });
};

// ---------- menú ----------
function pintarOpciones() { $('o-sonido').textContent = 'Sonido: ' + (sonido ? 'sí' : 'no'); $('o-anim').textContent = 'Animaciones: ' + (anim ? 'sí' : 'no'); document.body.classList.toggle('sin-anim', !anim); }
$('b-menu').onclick = () => { $('menu').hidden = false; };
$('o-cerrar').onclick = () => { $('menu').hidden = true; };
$('o-sonido').onclick = () => { sonido = !sonido; ls.set('timba_sonido', sonido ? '1' : '0'); pintarOpciones(); sonidos.carta(); };
$('o-anim').onclick = () => { anim = !anim; ls.set('timba_anim', anim ? '1' : '0'); pintarOpciones(); };
$('o-salir').onclick = () => { $('menu').hidden = true; $('resultado').hidden = true; vistasIds = new Set(); socket.emit('salir'); };
pintarOpciones();
if ('serviceWorker' in navigator) { /* sin service worker: el juego necesita conexión con el servidor */ }
