'use strict';
const assert = require('assert');
const { Juego, decidirBot, crearBaraja, puntos3, CFG_DEFECTO } = require('./game');
const c = (palo, num) => ({ id: palo + '-' + num, palo, num });
const cfg = CFG_DEFECTO;

// Baraja y puntuación
assert.strictEqual(crearBaraja().length, 48);
assert.strictEqual(new Set(crearBaraja().map((x) => x.id)).size, 48);
assert.strictEqual(puntos3([c('oros', 1), c('oros', 12), c('oros', 10)], cfg), 31);
assert.strictEqual(puntos3([c('oros', 1), c('oros', 12), c('copas', 7)], cfg), 21);
assert.strictEqual(puntos3([c('oros', 2), c('copas', 9), c('espadas', 5)], cfg), 9);
assert.strictEqual(puntos3([c('oros', 7), c('copas', 7), c('espadas', 7)], { ...cfg, trio305: true }), 30.5);
assert.strictEqual(puntos3([c('oros', 7), c('copas', 7), c('espadas', 7)], cfg), 7);

// Simulación de partidas completas con bots
let timbas = 0, picadas = 0;
for (let g = 0; g < 300; g++) {
  const n = 2 + (g % 5);
  const niveles = ['facil', 'normal', 'dificil'];
  const j = new Juego({ vidas: 3 }, Array.from({ length: n }, (_, i) => ({ nombre: 'B' + i, bot: true, nivel: niveles[i % 3] })));
  let guard = 0;
  while (j.fase !== 'fin' && guard++ < 20000) {
    if (j.fase === 'espera' || j.fase === 'reveal') { j.nuevaRonda(); }
    // Sin duplicados y 48 cartas en total
    const todas = [...j.mazo, ...j.descarte, ...j.p.flatMap((x) => x.mano)].map((x) => x.id);
    assert.strictEqual(new Set(todas).size, todas.length, 'cartas duplicadas');
    assert.strictEqual(todas.length, 48);
    const t = j.turno; assert(t >= 0 && j.p[t].vidas > 0);
    const otro = (t + 1) % n; if (j.p[otro].vidas > 0) assert(!j.accion(otro, 'robar_mazo').ok);
    const d = decidirBot(j, t);
    if (d.tipo === 'timba') timbas++; if (d.tipo === 'picar') picadas++;
    assert(j.accion(t, d.tipo, d.carta).ok, 'bot hizo jugada ilegal: ' + JSON.stringify(d));
  }
  assert.strictEqual(j.fase, 'fin', 'la partida no termina');
  assert.strictEqual(j.vivos().length <= 1, true);
}

// Vista: nunca filtra cartas ajenas durante la ronda
const j = new Juego({}, [{ nombre: 'A' }, { nombre: 'B' }]); j.nuevaRonda();
const v = j.vista(0); assert.strictEqual(v.mano.length, 3);
assert(v.jugadores.every((x) => x.cartas === null));
assert.strictEqual(JSON.stringify(v).includes(j.p[1].mano[0].id + '"'), JSON.stringify(v).includes(j.descarte[0].id + '"') && j.p[1].mano[0].id === j.descarte[0].id);

// Timba manual: 31 termina la ronda y los demás pierden una vida
const t = new Juego({}, [{ nombre: 'A' }, { nombre: 'B' }, { nombre: 'C' }]); t.nuevaRonda();
t.p[t.turno].mano = [c('oros', 1), c('oros', 12), c('oros', 11)];
const q = t.turno; assert(t.acciones(q).includes('timba')); t.accion(q, 'timba');
assert.strictEqual(t.fase, 'reveal');
t.p.forEach((x) => assert.strictEqual(x.vidas, x.i === q ? 3 : 2));
// No se puede cantar Timba sin 31
const u = new Juego({}, [{ nombre: 'A' }, { nombre: 'B' }]); u.nuevaRonda();
u.p[u.turno].mano = [c('oros', 2), c('copas', 3), c('espadas', 4)];
assert(!u.accion(u.turno, 'timba').ok);
// Picar exige 21+ y abre última vuelta
u.p[u.turno].mano = [c('oros', 1), c('oros', 12), c('copas', 3)];
const pi = u.turno; assert(u.accion(pi, 'picar').ok); assert.strictEqual(u.fase, 'ultima');
assert.notStrictEqual(u.turno, pi);
console.log('OK · 300 partidas simuladas · timbas:', timbas, '· picadas:', picadas);
