# TIMBA

Juego de cartas multijugador (variante del Treinta y Uno) con baraja española de 48 cartas.

## Instalar y jugar
1. Instala Node.js (https://nodejs.org), versión 18 o superior.
2. Haz doble clic en `iniciar.bat` (Windows). La primera vez instala las dependencias.
   En otros sistemas: `npm install` y `npm start`.
3. En el ordenador se abre `http://localhost:3000`.

## Desde el móvil
- Conecta el móvil a la misma WiFi y abre en el navegador la dirección `http://IP-DEL-PC:3000` que muestra `iniciar.bat`.
- Si Windows pregunta por el cortafuegos, permite el acceso en redes privadas.
- Para tener un acceso directo: en iPhone, Safari > Compartir > "Añadir a pantalla de inicio"; en Android, Chrome > menú > "Instalar app" o "Añadir a pantalla de inicio".

## Desde fuera de casa con Tailscale
1. Instala Tailscale en el PC y en cada móvil, con la misma cuenta o compartiendo el PC.
2. Abre en el móvil `http://100.x.x.x:3000` (la IP de Tailscale del PC).

## Reglas implementadas (ver también la configuración de la sala)
- Baraja: 48 cartas (1 a 12). Valores: 2-9 su número, 10/11/12 valen 10, As 11.
- Se puntúa solo con cartas del mismo palo (la mejor combinación). 31 con tres cartas del mismo palo = Timba.
- Turno: robar del mazo o coger la carta visible del descarte y descartar otra (siempre 3 cartas). No se puede descartar la carta que acabas de coger del descarte. No se puede pasar.
- Picar: al inicio de tu turno, con 21 o más, en lugar de robar. Cada rival juega un último turno y se comparan las manos.
- Timba: con 31 en tu turno (tengas 3 o 4 cartas) se acaba la ronda y los demás pierden una vida.
- Sin Timba: pierde una vida quien tenga la menor puntuación; si hay empate en la peor, pierden todos los empatados; si todos empatan, nadie pierde. Si el que pica queda el peor, pierde `picadorPierde` vidas (por defecto 1).
- Empieza cada ronda el siguiente vivo al que empezó la anterior.
- 30,5 (trío del mismo número): preparado y desactivado por defecto (casilla "Trío = 30,5" en la sala), pendiente de confirmar.

Los valores y reglas están en `CFG_DEFECTO` de `game.js`.

## Pruebas
`npm test` ejecuta 300 partidas simuladas con bots y comprueba reparto sin duplicados, puntuación, turnos, picar, Timba, vidas, eliminación y victoria.
