// Grade de hexágonos do "Chão que some", igual no servidor e no navegador.
// Hexágonos com o lado reto em cima (flat-top), coordenadas axiais (q, r).

import { ARENA, HEX } from './constants.js';

const SQ3 = Math.sqrt(3);

export function hexCenter(q, r, size = HEX.SIZE) {
  return { x: size * 1.5 * q, z: size * SQ3 * (r + q / 2) };
}

// Todas as peças que cabem na arena: [{ i, q, r, x, z }]
export const HEX_TILES = (() => {
  const out = [];
  const n = Math.ceil(ARENA.RADIUS / (HEX.SIZE * 1.5)) + 1;
  for (let q = -n; q <= n; q++) {
    for (let r = -n * 2; r <= n * 2; r++) {
      const c = hexCenter(q, r);
      if (Math.hypot(c.x, c.z) <= ARENA.RADIUS - HEX.SIZE * 0.55) out.push({ i: out.length, q, r, ...c });
    }
  }
  return out;
})();

const INDEX = new Map(HEX_TILES.map((t) => [`${t.q},${t.r}`, t.i]));

// Peça embaixo de um ponto (ou -1 se não há peça ali)
export function hexAt(x, z, size = HEX.SIZE) {
  const qf = ((2 / 3) * x) / size;
  const rf = ((-1 / 3) * x + (SQ3 / 3) * z) / size;
  // arredondamento cúbico
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return INDEX.get(`${q},${r}`) ?? -1;
}
