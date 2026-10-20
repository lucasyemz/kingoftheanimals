// Minijogos que mudam a arena: Pula-corda (barras girando), Chão que some
// (hexágonos que caem) e Chuva de bolas. Também a barra giratória genérica, usada
// pela barra de neon do Neon Night. Funções puras sobre o Game (rodam no navegador também).

import { PHYSICS, JUMPROPE, HEX, BALLS } from '../shared/constants.js';
import { PLAYER_STATE as ST, EVENT } from '../shared/messages.js';
import { HEX_TILES, hexAt } from '../shared/hexgrid.js';

const r2 = (v) => Math.round(v * 100) / 100;
const standing = (p) => p.st === ST.ALIVE || p.st === ST.DASHING || p.st === ST.STUNNED;
const BODY_H = 1.2; // altura do bicho, para saber se uma barra alta pega

// ---------- Barra giratória ----------
// bar: { angle, speed (rad/s, com sinal), arms: 1 | 2, hub, width, push, y0, y1 }
// arms 1 = do eixo até a borda; 2 = atravessa a arena inteira.

export function sweepBar(game, bar) {
  const ux = Math.cos(bar.angle);
  const uz = Math.sin(bar.angle);
  const spin = Math.sign(bar.speed) || 1;
  const w = Math.abs(bar.speed);
  for (const p of game.participants) {
    if (!standing(p)) continue;
    const rad = game.radiusOf(p);
    // O eixo do meio é sólido
    if (bar.hub) {
      const dc = Math.hypot(p.x, p.z);
      if (dc < bar.hub + rad && (p.y ?? 0) < 0.9) {
        const k = (bar.hub + rad) / Math.max(dc, 1e-3);
        p.x *= k;
        p.z *= k;
      }
    }
    const py = p.y ?? 0;
    if (py >= bar.y1 || py + BODY_H <= bar.y0) continue; // passou por cima ou por baixo
    const along = p.x * ux + p.z * uz;
    if (bar.arms === 1 && along < 0) continue;
    if (Math.abs(along) > game.arena.radius + rad) continue;
    // Para onde a barra anda neste ponto
    const s = spin * (along >= 0 ? 1 : -1);
    const nx = -uz * s;
    const nz = ux * s;
    const side = p.x * nx + p.z * nz;
    const reach = bar.width + rad;
    if (Math.abs(side) >= reach) continue;
    if (side >= 0) {
      // Na frente: é varrido junto, com um tranco
      p.x += nx * (reach - side);
      p.z += nz * (reach - side);
      const vn = p.vx * nx + p.vz * nz;
      const target = w * Math.abs(along) * 1.25 + bar.push * 0.4;
      if (vn < target) {
        p.vx += nx * (target - vn);
        p.vz += nz * (target - vn);
      }
      if (bar.stun && p.st === ST.ALIVE) {
        p.st = ST.STUNNED;
        p.stT = bar.stun;
      }
    } else {
      // Atrás: não atravessa
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

// Quanto tempo até uma barra passar pelo ponto (x, z)? (para os bots pularem na hora)
export function timeToBar(bar, x, z, radius) {
  const r = Math.hypot(x, z);
  if (r < 1e-3) return Infinity;
  const a = Math.atan2(z, x);
  const w = Math.abs(bar.speed);
  if (w < 1e-3) return Infinity;
  const tau = Math.PI * 2;
  let best = Infinity;
  for (let k = 0; k < bar.arms; k++) {
    const armAngle = bar.angle + k * Math.PI;
    // distância angular no sentido do giro
    let d = bar.speed > 0 ? a - armAngle : armAngle - a;
    d = ((d % tau) + tau) % tau;
    best = Math.min(best, d / w - (PHYSICS.ANIMAL_RADIUS + bar.width) / (w * Math.max(r, 0.5)));
  }
  return best;
}

// ---------- Estado da rodada ----------

export function resetMinigame(game) {
  const m = game.mode;
  game.bars = [];
  game.minigameT = 0;
  if (m === 'jumprope') {
    game.bars.push(
      { kind: 'low', angle: 0, speed: JUMPROPE.LOW.speed, arms: 2, hub: JUMPROPE.HUB, width: JUMPROPE.LOW.width, push: JUMPROPE.PUSH, y0: JUMPROPE.LOW.y0, y1: JUMPROPE.LOW.y1 },
      { kind: 'high', angle: Math.PI / 2, speed: JUMPROPE.HIGH.speed, arms: 2, hub: 0, width: JUMPROPE.HIGH.width, push: JUMPROPE.PUSH, y0: JUMPROPE.HIGH.y0, y1: JUMPROPE.HIGH.y1, stun: 0.25 },
    );
  }
  // s: 0 inteira, 1 trincando, 2 caiu; um vetor de peças por andar
  game.hex = m === 'hex' ? Array.from({ length: HEX.LAYERS }, () => HEX_TILES.map(() => ({ s: 0, t: 0 }))) : null;
  game.balls = [];
  game.nextBallId = 1;
  game.ballTimer = BALLS.INTERVAL - BALLS.FIRST_AT;
  game.ballInterval = BALLS.INTERVAL;
}

export function updateMinigame(game, dt) {
  game.minigameT += dt;
  if (game.mode === 'jumprope') updateJumpRope(game, dt);
  if (game.mode === 'hex') updateHex(game, dt);
  if (game.mode === 'balls') updateBalls(game, dt);
}

// ---------- Pula-corda ----------

function updateJumpRope(game, dt) {
  if (game.minigameT < JUMPROPE.START_AT) return;
  for (const bar of game.bars) {
    const cfg = bar.kind === 'low' ? JUMPROPE.LOW : JUMPROPE.HIGH;
    // acelera até o máximo (com o sinal do giro)
    const next = bar.speed + cfg.accel * dt;
    bar.speed = Math.sign(next) * Math.min(Math.abs(next), cfg.max);
    bar.angle = (bar.angle + bar.speed * dt) % (Math.PI * 2);
    sweepBar(game, bar);
  }
}

// ---------- Chão que some ----------

function updateHex(game, dt) {
  if (game.minigameT < HEX.GRACE) return;
  for (const p of game.participants) {
    if (!standing(p) || (p.y ?? 0) > 0) continue;
    const tiles = game.hex[p.layer ?? 0];
    const i = hexAt(p.x, p.z);
    if (i >= 0 && tiles[i].s === 0) {
      tiles[i].s = 1;
      tiles[i].t = 0;
    }
  }
  for (const layer of game.hex) {
    for (const t of layer) {
      if (t.s !== 1) continue;
      t.t += dt;
      if (t.t >= HEX.CRUMBLE) t.s = 2;
    }
  }
}

// No Chão que some, quem está no chão sem peça embaixo despenca para o andar de
// baixo; no último andar, cai de vez (retorna true).
export function onMissingFloor(game, p) {
  if (game.mode !== 'hex' || (p.y ?? 0) > 0) return false;
  const layer = p.layer ?? 0;
  const i = hexAt(p.x, p.z);
  if (i >= 0 && game.hex[layer][i].s !== 2) return false;
  if (i >= 0 && layer < HEX.LAYERS - 1) {
    p.layer = layer + 1;
    p.y = HEX.LAYER_GAP;
    p.vy = 0;
    game.event(EVENT.LAYER_DROP, { id: p.id, layer: p.layer });
    return false;
  }
  return true;
}

export function hexIntact(game, x, z, layer = 0) {
  if (!game.hex) return true;
  const i = hexAt(x, z);
  return i >= 0 && game.hex[layer][i].s === 0;
}

// ---------- Chuva de bolas ----------

function updateBalls(game, dt) {
  game.ballTimer += dt;
  if (game.minigameT >= BALLS.FIRST_AT && game.ballTimer >= game.ballInterval) {
    game.ballTimer = 0;
    game.ballInterval = Math.max(BALLS.INTERVAL_MIN, game.ballInterval - BALLS.INTERVAL_STEP * 3);
    spawnBall(game);
  }
  const R = game.arena.radius;
  for (const b of game.balls) {
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    for (const p of game.participants) {
      if (!standing(p)) continue;
      const rad = game.radiusOf(p);
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d >= b.r + rad || (p.y ?? 0) > b.r * 1.6) continue;
      const nx = d > 1e-3 ? dx / d : 1;
      const nz = d > 1e-3 ? dz / d : 0;
      p.x = b.x + nx * (b.r + rad);
      p.z = b.z + nz * (b.r + rad);
      const speed = Math.hypot(b.vx, b.vz);
      const k = (speed * 0.6 + BALLS.KNOCK) * game.pushTaken(p);
      p.vx = b.vx * 0.5 + nx * k;
      p.vz = b.vz * 0.5 + nz * k;
      if (p.st === ST.ALIVE) {
        p.st = ST.STUNNED;
        p.stT = BALLS.STUN;
      }
      if (!b.hit?.includes(p.id)) {
        (b.hit ??= []).push(p.id);
        game.event(EVENT.BALL_HIT, { id: p.id, x: r2(p.x), z: r2(p.z) });
      }
    }
  }
  game.balls = game.balls.filter((b) => Math.hypot(b.x, b.z) < R + b.r + 4);
}

function spawnBall(game) {
  const R = game.arena.radius;
  const a = game.rng() * Math.PI * 2;
  const r = BALLS.RADIUS[0] + game.rng() * (BALLS.RADIUS[1] - BALLS.RADIUS[0]);
  const sx = Math.cos(a) * (R + r + 2);
  const sz = Math.sin(a) * (R + r + 2);
  // mira num ponto perto do meio
  const ta = game.rng() * Math.PI * 2;
  const tr = game.rng() * Math.min(4, R * 0.6);
  const tx = Math.cos(ta) * tr;
  const tz = Math.sin(ta) * tr;
  const d = Math.hypot(tx - sx, tz - sz);
  const speed = BALLS.SPEED[0] + game.rng() * (BALLS.SPEED[1] - BALLS.SPEED[0]);
  const ball = { id: game.nextBallId++, x: sx, z: sz, r, vx: ((tx - sx) / d) * speed, vz: ((tz - sz) / d) * speed };
  game.balls.push(ball);
  game.event(EVENT.BALL, { id: ball.id });
}

// ---------- O que vai no state ----------

export function minigamePayload(game) {
  const out = {};
  if (game.bars.length) {
    out.bars = game.bars.map((b) => ({ a: r2(b.angle), arms: b.arms, y0: b.y0, y1: b.y1, k: b.kind }));
  }
  if (game.hex) out.hex = game.hex.map((layer) => layer.map((t) => t.s).join('')).join('|');
  if (game.mode === 'balls') out.balls = game.balls.map((b) => ({ id: b.id, x: r2(b.x), z: r2(b.z), r: r2(b.r), vx: r2(b.vx), vz: r2(b.vz) }));
  return out;
}

