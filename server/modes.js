// Regras extras de cada rodada: obstáculos do cenário (vento, gelo que racha, barra
// giratória) e os modos Batata quente e Rei da colina. Funções puras sobre o Game,
// chamadas pelo tick; também rodam no navegador (Single Player e tutorial).

import { PHYSICS, POTATO, HILL } from '../shared/constants.js';
import { PLAYER_STATE as ST, EVENT } from '../shared/messages.js';

const r2 = (v) => Math.round(v * 100) / 100;
const standing = (p) => p.st === ST.ALIVE || p.st === ST.DASHING || p.st === ST.STUNNED;

// ---------- Estado da rodada ----------

export function resetRoundRules(game, hazard) {
  game.hazard = hazard ?? null;
  game.wind = { phase: 'idle', t: 0, dx: 0, dz: 0, next: hazard?.type === 'wind' ? hazard.every : 0 };
  game.holes = [];
  game.nextHoleId = 1;
  game.holeTimer = hazard?.type === 'ice' ? hazard.every - (hazard.firstAt ?? hazard.every) : 0;
  game.sweep = hazard?.type === 'sweeper' ? { angle: 0, t: 0 } : null;
  game.potato = null;
  game.potatoWait = POTATO.FIRST_DELAY;
  game.potatoFuse = POTATO.FUSE;
  game.hillScores = {};
  game.hillContested = false;
  for (const p of game.participants) p.potato = false;
}

// ---------- Obstáculos ----------

export function updateHazard(game, dt) {
  const h = game.hazard;
  if (!h || game.debug.tutorial) return;
  if (h.type === 'wind') updateWind(game, h, dt);
  if (h.type === 'ice') updateIce(game, h, dt);
  if (h.type === 'sweeper') updateSweeper(game, h, dt);
}

function updateWind(game, h, dt) {
  const w = game.wind;
  w.t += dt;
  if (w.phase === 'idle' && w.t >= w.next) {
    const a = game.rng() * Math.PI * 2;
    Object.assign(w, { phase: 'warn', t: 0, dx: r2(Math.cos(a)), dz: r2(Math.sin(a)) });
    game.event(EVENT.WIND, { phase: 'warn', dx: w.dx, dz: w.dz });
  } else if (w.phase === 'warn' && w.t >= h.warning) {
    Object.assign(w, { phase: 'blow', t: 0 });
    game.event(EVENT.WIND, { phase: 'blow', dx: w.dx, dz: w.dz });
  } else if (w.phase === 'blow') {
    for (const p of game.participants) {
      if (!standing(p)) continue;
      const k = h.accel * dt * game.pushTaken(p);
      p.vx += w.dx * k;
      p.vz += w.dz * k;
    }
    if (w.t >= h.duration) {
      Object.assign(w, { phase: 'idle', t: 0, next: h.every });
      game.event(EVENT.WIND, { phase: 'stop', dx: w.dx, dz: w.dz });
    }
  }
}

function updateIce(game, h, dt) {
  for (const hole of game.holes) {
    hole.t += dt;
    if (hole.phase === 'crack' && hole.t >= h.crack) {
      hole.phase = 'open';
      hole.t = 0;
      game.event(EVENT.ICE, { hid: hole.hid, phase: 'open', x: hole.x, z: hole.z, r: hole.r });
    } else if (hole.phase === 'open' && hole.t >= h.open) {
      hole.phase = 'closed';
      game.event(EVENT.ICE, { hid: hole.hid, phase: 'close', x: hole.x, z: hole.z, r: hole.r });
    }
  }
  game.holes = game.holes.filter((x) => x.phase !== 'closed');

  game.holeTimer += dt;
  if (game.holeTimer < h.every || game.holes.length >= h.max) return;
  game.holeTimer = 0;
  // Longe da borda e (no Rei da colina) fora da colina
  const minR = game.mode === 'hill' ? HILL.RADIUS + h.radius + 0.3 : 0.5;
  const maxR = game.arena.radius - h.radius - 0.6;
  if (maxR <= minR) return;
  for (let tries = 0; tries < 8; tries++) {
    const r = minR + Math.sqrt(game.rng()) * (maxR - minR);
    const a = game.rng() * Math.PI * 2;
    const x = r2(Math.cos(a) * r);
    const z = r2(Math.sin(a) * r);
    if (game.holes.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + h.radius + 1)) continue;
    const hole = { hid: game.nextHoleId++, x, z, r: h.radius, phase: 'crack', t: 0 };
    game.holes.push(hole);
    game.event(EVENT.ICE, { hid: hole.hid, phase: 'crack', x, z, r: hole.r });
    return;
  }
}

// Caiu num buraco aberto? (o centro do bicho dentro do buraco)
export function inOpenHole(game, p) {
  return game.holes.some((h) => h.phase === 'open' && Math.hypot(p.x - h.x, p.z - h.z) < h.r - PHYSICS.ANIMAL_RADIUS * 0.3);
}

function updateSweeper(game, h, dt) {
  const s = game.sweep;
  s.t += dt;
  if (s.t < h.startAt) return;
  s.angle = (s.angle + h.speed * dt) % (Math.PI * 2);
  const ux = Math.cos(s.angle);
  const uz = Math.sin(s.angle);
  // Para onde a barra anda (giro anti-horário visto de cima, no plano x/z)
  const nx = -uz;
  const nz = ux;
  for (const p of game.participants) {
    if (!standing(p)) continue;
    const rad = game.radiusOf(p);
    const along = p.x * ux + p.z * uz;
    // O eixo do meio: empurra para fora dele
    const dc = Math.hypot(p.x, p.z);
    if (dc < h.hub + rad) {
      const k = (h.hub + rad) / Math.max(dc, 1e-3);
      p.x *= k;
      p.z *= k;
    }
    if (along < 0 || along > game.arena.radius + rad) continue;
    const side = p.x * nx + p.z * nz;
    const reach = h.width + rad;
    if (Math.abs(side) >= reach) continue;
    if (side >= 0) {
      // Na frente da barra: é varrido junto, com um tranco
      p.x += nx * (reach - side);
      p.z += nz * (reach - side);
      const vn = p.vx * nx + p.vz * nz;
      const target = h.speed * along * 1.25 + h.push * 0.4;
      if (vn < target) {
        p.vx += nx * (target - vn);
        p.vz += nz * (target - vn);
      }
    } else {
      // Atrás da barra: não atravessa
      p.x -= nx * (reach + side);
      p.z -= nz * (reach + side);
      const vn = p.vx * nx + p.vz * nz;
      if (vn > 0) {
        p.vx -= nx * vn;
        p.vz -= nz * vn;
      }
    }
  }
}

// ---------- Batata quente ----------

export function updatePotato(game, dt) {
  if (game.mode !== 'potato') return;
  const pot = game.potato;
  if (!pot) {
    game.potatoWait -= dt;
    if (game.potatoWait > 0) return;
    const list = game.participants.filter(standing);
    if (list.length < 2) return;
    givePotato(game, list[Math.floor(game.rng() * list.length)], null);
    return;
  }
  const holder = game.players.get(pot.id);
  if (!holder || !standing(holder)) {
    // Quem segurava caiu: a bomba volta daqui a pouco com o mesmo pavio
    dropPotato(game);
    return;
  }
  pot.fuse -= dt;
  if (pot.fuse <= 0) explode(game, holder);
}

function givePotato(game, p, from) {
  for (const q of game.participants) q.potato = false;
  p.potato = true;
  game.potato = { id: p.id, from: from?.id ?? null, fuse: game.potato?.fuse ?? game.potatoFuse, passT: game.simTime };
  game.event(EVENT.POTATO, { id: p.id, from: from?.id ?? null, fuse: r2(game.potato.fuse) });
}

function dropPotato(game) {
  for (const q of game.participants) q.potato = false;
  game.potato = null;
  game.potatoWait = 1.5;
}

function explode(game, holder) {
  const cfg = POTATO.BLAST;
  const hit = [];
  for (const q of game.participants) {
    if (q === holder || !standing(q)) continue;
    const dx = q.x - holder.x;
    const dz = q.z - holder.z;
    const d = Math.hypot(dx, dz);
    if (d > cfg.radius) continue;
    const k = cfg.impulse * (1 - d / cfg.radius * 0.5) * game.pushTaken(q);
    q.vx += (dx / (d || 1)) * k;
    q.vz += (dz / (d || 1)) * k;
    q.st = ST.STUNNED;
    q.stT = cfg.stun;
    hit.push(q.id);
  }
  const from = game.potato.from;
  game.event(EVENT.POTATO_BOOM, { id: holder.id, x: r2(holder.x), z: r2(holder.z), hit });
  // Crédito para quem passou a bomba por último
  if (from && game.players.has(from)) game.touch(holder, game.players.get(from));
  game.fall(holder, Math.hypot(holder.x, holder.z), false, 'boom');
  game.potatoFuse = Math.max(POTATO.FUSE_MIN, game.potatoFuse - POTATO.FUSE_STEP);
  dropPotato(game);
  game.potatoWait = 1.2;
}

// Dois bichos encostaram: a bomba passa de um para o outro
export function potatoContact(game, a, b) {
  const pot = game.potato;
  if (game.mode !== 'potato' || !pot) return;
  if (game.simTime - pot.passT < POTATO.PASS_COOLDOWN) return;
  const holder = a.id === pot.id ? a : b.id === pot.id ? b : null;
  if (!holder) return;
  const other = holder === a ? b : a;
  if (!standing(other)) return;
  givePotato(game, other, holder);
}

// ---------- Rei da colina ----------

export function updateHill(game, dt) {
  if (game.mode !== 'hill') return null;
  const inside = game.participants.filter((p) => standing(p) && Math.hypot(p.x, p.z) < HILL.RADIUS);
  game.hillContested = inside.length > 1;
  // Sozinho conta inteiro; disputando, cada um conta pela metade
  const rate = inside.length > 1 ? HILL.CONTESTED_RATE : 1;
  let winner = null;
  for (const p of inside) {
    game.hillScores[p.id] = (game.hillScores[p.id] ?? 0) + dt * rate;
    if (game.hillScores[p.id] >= HILL.TARGET && (!winner || game.hillScores[p.id] > game.hillScores[winner.id])) winner = p;
  }
  return winner;
}

// ---------- O que vai no state ----------

export function rulesPayload(game) {
  const out = {};
  if (game.hazard?.type === 'wind') out.wind = { phase: game.wind.phase, dx: game.wind.dx, dz: game.wind.dz };
  if (game.hazard?.type === 'ice') out.holes = game.holes.map((h) => ({ hid: h.hid, x: h.x, z: h.z, r: h.r, phase: h.phase }));
  if (game.sweep) out.sweep = r2(game.sweep.angle);
  if (game.mode === 'potato') out.potato = game.potato ? { id: game.potato.id, fuse: r2(Math.max(0, game.potato.fuse)) } : null;
  if (game.mode === 'hill') {
    out.hill = {
      scores: Object.fromEntries(Object.entries(game.hillScores).map(([k, v]) => [k, r2(v)])),
      contested: game.hillContested,
    };
  }
  return out;
}
