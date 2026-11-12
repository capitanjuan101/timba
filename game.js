'use strict';
// Lógica pura de la Timba (sin dependencias). El servidor es la única autoridad.
const PALOS = ['oros', 'copas', 'espadas', 'bastos'];

const CFG_DEFECTO = {
  vidas: 3,
  maxJugadores: 4,
  bots: 3,
  botNivel: 'normal',            // facil | normal | dificil
  valores: { 1: 11, 10: 10, 11: 10, 12: 10 }, // el resto vale su número
  picarMin: 21,
  timbaPierdenOtros: 1,          // vidas que pierden los demás con Timba (31)
  picadorPierde: 1,              // vidas que pierde el que pica si queda el peor
  trio305: false,                // trío del mismo número = 30,5 (pendiente de confirmar)
  trio305Termina: false,         // si cantar 30,5 cierra la ronda
  pausaRonda: 6000,
  graciaDesconexion: 45000,
};

const crearBaraja = () => {
  const b = [];
  for (const palo of PALOS) for (let num = 1; num <= 12; num++) b.push({ id: palo + '-' + num, palo, num });
  return b;
};
const barajar = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const valor = (c, cfg) => (cfg.valores[c.num] !== undefined ? cfg.valores[c.num] : c.num);

function puntos3(mano, cfg) {
  const porPalo = {};
  for (const c of mano) porPalo[c.palo] = (porPalo[c.palo] || 0) + valor(c, cfg);
  let best = Math.max(...Object.values(porPalo));
  if (cfg.trio305 && mano.length === 3 && mano.every((c) => c.num === mano[0].num) && best < 30.5) best = 30.5;
  return best;
}
// Con 4 cartas (tras robar) se toma la mejor combinación de 3.
function mejor(mano, cfg) {
  if (mano.length <= 3) return { puntos: puntos3(mano, cfg), mano: mano.slice() };
  let r = null;
  for (let k = 0; k < mano.length; k++) {
    const m = mano.filter((_, i) => i !== k);
    const p = puntos3(m, cfg);
    if (!r || p > r.puntos) r = { puntos: p, mano: m };
  }
  return r;
}

class Juego {
  constructor(cfg, jugadores) {
    this.cfg = Object.assign({}, CFG_DEFECTO, cfg);
    this.p = jugadores.map((j, i) => ({
      i, nombre: j.nombre, bot: !!j.bot, nivel: j.nivel || this.cfg.botNivel, vidas: this.cfg.vidas, mano: [],
    }));
    this.fase = 'espera'; this.starter = -1; this.nRonda = 0; this.log = []; this.ganador = null;
    this.mazo = []; this.descarte = []; this.turno = -1; this.robada = false; this.prohibida = null;
    this.picador = null; this.pendientes = []; this.resultado = null;
  }
  vivos() { return this.p.filter((x) => x.vidas > 0); }
  siguienteVivo(i) { let s = i; do { s = (s + 1) % this.p.length; } while (this.p[s].vidas <= 0); return s; }
  nota(t) { this.log.push(t); if (this.log.length > 30) this.log.shift(); }

  nuevaRonda() {
    if (this.vivos().length < 2) return;
    this.nRonda++;
    this.starter = this.starter < 0 ? this.p.findIndex((x) => x.vidas > 0) : this.siguienteVivo(this.starter);
    this.mazo = barajar(crearBaraja());
    for (const x of this.p) x.mano = x.vidas > 0 ? [this.mazo.pop(), this.mazo.pop(), this.mazo.pop()] : [];
    this.descarte = [this.mazo.pop()];
    this.turno = this.starter; this.fase = 'turno'; this.robada = false; this.prohibida = null;
    this.picador = null; this.pendientes = []; this.resultado = null;
    this.nota('Ronda ' + this.nRonda + ': empieza ' + this.p[this.turno].nombre);
  }

  puntosDe(i) { return mejor(this.p[i].mano, this.cfg).puntos; }

  acciones(i) {
    if (this.turno !== i || (this.fase !== 'turno' && this.fase !== 'ultima')) return [];
    const a = [];
    if (!this.robada) {
      a.push('robar_mazo', 'robar_descarte');
      if (this.fase === 'turno' && this.puntosDe(i) >= this.cfg.picarMin) a.push('picar');
    } else a.push('descartar');
    const p = this.puntosDe(i);
    if (p === 31 || (this.cfg.trio305 && this.cfg.trio305Termina && p === 30.5)) a.push('timba');
    return a;
  }

  _rebarajar() {
    if (this.mazo.length === 0 && this.descarte.length > 1) {
      const top = this.descarte.pop();
      this.mazo = barajar(this.descarte); this.descarte = [top];
    }
  }

  accion(i, tipo, cartaId) {
    if (!this.acciones(i).includes(tipo)) return { ok: false, error: 'Acción no permitida' };
    const x = this.p[i];
    if (tipo === 'robar_mazo') {
      this._rebarajar();
      if (!this.mazo.length) return { ok: false, error: 'No quedan cartas' };
      x.mano.push(this.mazo.pop()); this.robada = true; this.prohibida = null;
    } else if (tipo === 'robar_descarte') {
      const c = this.descarte.pop(); x.mano.push(c); this.robada = true; this.prohibida = c.id;
    } else if (tipo === 'descartar') {
      const k = x.mano.findIndex((c) => c.id === cartaId);
      if (k < 0) return { ok: false, error: 'Esa carta no es tuya' };
      if (cartaId === this.prohibida) return { ok: false, error: 'No puedes descartar la carta que acabas de coger' };
      this.descarte.push(x.mano.splice(k, 1)[0]);
      this._finTurno();
    } else if (tipo === 'picar') {
      this.fase = 'ultima'; this.picador = i; this.pendientes = [];
      for (let s = this.siguienteVivo(i); s !== i; s = this.siguienteVivo(s)) this.pendientes.push(s);
      this.turno = this.pendientes[0];
      this.nota(x.nombre + ' pica con ' + this.puntosDe(i) + '. Última vuelta');
    } else if (tipo === 'timba') {
      const m = mejor(x.mano, this.cfg);
      for (const c of x.mano) if (!m.mano.includes(c)) this.descarte.push(c);
      x.mano = m.mano; this.nota(x.nombre + ' canta TIMBA (' + m.puntos + ')');
      this._resolver(i);
    }
    return { ok: true };
  }

  _finTurno() {
    this.robada = false; this.prohibida = null;
    if (this.fase === 'ultima') {
      this.pendientes.shift();
      if (!this.pendientes.length) return this._resolver(null);
      this.turno = this.pendientes[0];
    } else this.turno = this.siguienteVivo(this.turno);
  }

  _resolver(timbaDe) {
    const vivos = this.vivos();
    const pts = {}; for (const x of vivos) pts[x.i] = this.puntosDe(x.i);
    const manos = {}; for (const x of vivos) manos[x.i] = x.mano.slice();
    const perdieron = {};
    if (timbaDe !== null) {
      for (const x of vivos) if (x.i !== timbaDe) perdieron[x.i] = this.cfg.timbaPierdenOtros;
    } else {
      const v = Object.values(pts), min = Math.min(...v), max = Math.max(...v);
      if (min !== max) for (const x of vivos) if (pts[x.i] === min) perdieron[x.i] = x.i === this.picador ? this.cfg.picadorPierde : 1;
    }
    for (const k of Object.keys(perdieron)) {
      const x = this.p[k]; x.vidas = Math.max(0, x.vidas - perdieron[k]);
      this.nota(x.nombre + ' pierde ' + perdieron[k] + ' vida' + (perdieron[k] > 1 ? 's' : '') + (x.vidas <= 0 ? ' y queda eliminado' : ''));
    }
    if (!Object.keys(perdieron).length) this.nota('Empate total: nadie pierde vida');
    this.resultado = { tipo: timbaDe !== null ? 'timba' : 'normal', timbaDe, picador: this.picador, puntos: pts, manos, perdieron };
    this.turno = -1;
    const quedan = this.vivos();
    if (quedan.length <= 1) { this.fase = 'fin'; this.ganador = quedan.length ? quedan[0].i : null; this.nota('Gana ' + (quedan[0] ? quedan[0].nombre : 'nadie')); }
    else this.fase = 'reveal';
  }

  // Lo que ve un asiento concreto (-1 = espectador). Nunca incluye cartas ajenas antes de tiempo.
  vista(i) {
    const rev = this.fase === 'reveal' || this.fase === 'fin';
    return {
      fase: this.fase, ronda: this.nRonda, turno: this.turno, picador: this.picador, ganador: this.ganador,
      mazo: this.mazo.length, descarte: this.descarte.length ? this.descarte[this.descarte.length - 1] : null,
      robada: this.robada, prohibida: i === this.turno ? this.prohibida : null,
      yo: i, acciones: i >= 0 ? this.acciones(i) : [],
      miPuntos: i >= 0 && this.p[i].mano.length ? this.puntosDe(i) : null,
      mano: i >= 0 ? this.p[i].mano : [],
      jugadores: this.p.map((x) => ({
        i: x.i, nombre: x.nombre, vidas: x.vidas, bot: x.bot, nCartas: x.mano.length,
        cartas: rev && this.resultado && this.resultado.manos[x.i] ? this.resultado.manos[x.i] : null,
      })),
      resultado: rev ? this.resultado : null, log: this.log.slice(-6), cfg: { vidas: this.cfg.vidas, picarMin: this.cfg.picarMin },
    };
  }
}

// ---------- Bots: solo usan su mano, el descarte visible y su situación de vidas ----------
function decidirBot(juego, i) {
  const x = juego.p[i], cfg = juego.cfg, nivel = x.nivel, acc = juego.acciones(i);
  const r = Math.random();
  if (acc.includes('timba')) return { tipo: 'timba' };
  if (acc.includes('picar')) {
    const p = juego.puntosDe(i);
    const apuros = x.vidas === 1;
    if (nivel === 'facil' && p >= 21 && r < 0.6) return { tipo: 'picar' };
    if (nivel === 'normal' && (p >= 25 || (p >= 22 && r < 0.5))) return { tipo: 'picar' };
    if (nivel === 'dificil' && (p >= (apuros ? 27 : 24) || (p >= 22 && r < 0.25 && !apuros))) return { tipo: 'picar' };
  }
  if (acc.includes('robar_mazo')) {
    const top = juego.descarte[juego.descarte.length - 1];
    const actual = mejor(x.mano, cfg).puntos;
    const conTop = mejor(x.mano.concat([top]), cfg).puntos;
    let cogeTop = conTop > actual;
    if (nivel === 'facil') cogeTop = r < 0.4 ? !cogeTop : cogeTop && r < 0.8;
    return { tipo: cogeTop ? 'robar_descarte' : 'robar_mazo' };
  }
  // descartar: la carta cuya salida deja la mejor mano
  let mejorK = -1, mejorP = -1, valK = 99;
  x.mano.forEach((c, k) => {
    if (c.id === juego.prohibida) return;
    const resto = x.mano.filter((_, j) => j !== k);
    const p = puntos3(resto, cfg);
    const v = valor(c, cfg);
    if (p > mejorP || (p === mejorP && v < valK)) { mejorP = p; mejorK = k; valK = v; }
  });
  if (nivel === 'facil' && r < 0.3) {
    const opciones = x.mano.filter((c) => c.id !== juego.prohibida);
    return { tipo: 'descartar', carta: opciones[Math.floor(Math.random() * opciones.length)].id };
  }
  return { tipo: 'descartar', carta: x.mano[mejorK].id };
}

module.exports = { Juego, decidirBot, CFG_DEFECTO, crearBaraja, puntos3, mejor, valor, PALOS };
