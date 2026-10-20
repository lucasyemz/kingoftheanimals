// Input dos bots. Um bot é um jogador comum cujo input vem daqui, e não da rede.
// Prioridade (GDD): fugir da borda → pegar power-up → caçar → dar dash.
// O tempo de reação é um atraso entre decidir e aplicar o input.

import { PHYSICS, ARENA, BOTS, HILL } from '../shared/constants.js';
import { PHASE, PLAYER_STATE as ST } from '../shared/messages.js';

const DEG = Math.PI / 180;
const standing = (p) => p.st === ST.ALIVE || p.st === ST.DASHING || p.st === ST.STUNNED;

export function createBrain(difficulty, rng = Math.random) {
  return {
    difficulty,
    rng,
    nextThink: 0,
    queue: [],               // decisões esperando o tempo de reação
    ignored: new Map(),      // pid → ignorou esse power-up?
    seenDashes: new Set(),   // dashes alheios já avaliados para desvio
    targetId: null,
    positioning: false,
    rerollAt: 0,
  };
}

export function botThink(game, p, now) {
  const brain = p.bot;
  if (brain.difficulty === 'dummy') return; // boneco do tutorial: fica parado
  while (brain.queue.length && brain.queue[0].at <= now) {
    const d = brain.queue.shift();
    p.inputX = d.x;
    p.inputZ = d.z;
    if (d.dash) p.dashBuffer = PHYSICS.DASH_BUFFER;
    if (d.jump) p.jumpBuffer = PHYSICS.JUMP_BUFFER;
  }
  if (now < brain.nextThink) return;
  brain.nextThink = now + BOTS.THINK_INTERVAL;
  const cfg = BOTS.DIFFICULTY[brain.difficulty] ?? BOTS.DIFFICULTY.medium;
  const d = decide(game, p, cfg, brain, now);
  d.jump = !d.dash && wantsJump(game, p, cfg, brain);
  brain.queue.push({ at: now + cfg.reactionMs / 1000, ...d });
}

// Pular: por cima da barra de neon que vem vindo, de um dash na direção dele,
// de quem está com a bomba, e de vez em quando só por diversão.
function wantsJump(game, p, cfg, brain) {
  if (p.y > 0 || p.st !== ST.ALIVE) return false;
  const rng = brain.rng;
  const react = cfg.reactionMs / 1000;
  const h = game.hazard;
  if (game.sweep && h?.type === 'sweeper' && game.sweep.t >= h.startAt) {
    const r = Math.hypot(p.x, p.z);
    if (r > h.hub + 0.4) {
      const ahead = (((Math.atan2(p.z, p.x) - game.sweep.angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const tHit = ahead / h.speed - (PHYSICS.ANIMAL_RADIUS + h.width) / (h.speed * r);
      if (tHit > react && tHit < react + 0.2) return rng() < cfg.jumpSkill;
    }
  }
  for (const q of game.participants) {
    if (q === p || !standing(q)) continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (q.st === ST.DASHING && d < 3) {
      const v = unit(q.vx, q.vz);
      if ((v.x * (p.x - q.x) + v.z * (p.z - q.z)) / (d || 1) > 0.85) return rng() < cfg.jumpSkill * 0.5;
    }
    if (game.potato?.id === q.id && d < 1.8) return rng() < cfg.jumpSkill * 0.4;
  }
  return rng() < 0.004;
}

function unit(x, z) {
  const l = Math.hypot(x, z);
  return l > 1e-4 ? { x: x / l, z: z / l } : { x: 0, z: 0 };
}

function decide(game, p, cfg, brain, now) {
  const rng = brain.rng;
  const toward = (x, z) => ({ ...unit(x - p.x, z - p.z), dash: false });
  const a = game.arena;
  if (game.phase === PHASE.SUDDEN_DEATH) return toward(0, 0);

  const edge = a.warning ? a.radius - ARENA.RING_WIDTH : a.radius;
  const r = Math.hypot(p.x, p.z);
  const others = game.participants.filter((q) => q !== p && standing(q));
  const dashReady = p.dashCd <= 0 && p.st === ST.ALIVE;

  // 0. Desviar de dash vindo na direção dele
  for (const q of others) {
    if (q.st !== ST.DASHING) continue;
    const key = `${q.id}:${q.dashCount}`;
    if (brain.seenDashes.has(key)) continue;
    const dx = p.x - q.x;
    const dz = p.z - q.z;
    const dist = Math.hypot(dx, dz);
    if (dist > BOTS.DODGE_RANGE) continue;
    const v = unit(q.vx, q.vz);
    const cos = (v.x * dx + v.z * dz) / (dist || 1);
    if (cos < Math.cos(BOTS.DODGE_ANGLE_DEG * DEG)) continue;
    brain.seenDashes.add(key);
    if (dashReady && rng() < cfg.dodgeChance) {
      // Desvia para o lado que aponta mais para o centro.
      let side = { x: -v.z, z: v.x };
      if (side.x * -p.x + side.z * -p.z < 0) side = { x: v.z, z: -v.x };
      return { ...side, dash: true };
    }
  }

  // 1. Fugir da borda, olhando onde ele vai estar quando a decisão valer
  //    (com vento soprando, a margem aumenta)
  const ahead = cfg.reactionMs / 1000 + BOTS.THINK_INTERVAL;
  const ax = p.x + p.vx * ahead;
  const az = p.z + p.vz * ahead;
  const rAhead = Math.hypot(ax, az);
  const windy = game.wind?.phase === 'blow' || game.wind?.phase === 'warn';
  if (Math.max(r, rAhead) > edge - cfg.edgeSense - (windy ? 1.2 : 0)) return toward(0, 0);

  // 1b. Fugir de buraco no gelo (trincando ou aberto)
  for (const h of game.holes ?? []) {
    const d = Math.hypot(ax - h.x, az - h.z);
    if (d < h.r + cfg.edgeSense * 0.6) return { ...unit(p.x - h.x, p.z - h.z), dash: false };
  }

  // 1c. Modos
  if (game.mode === 'potato' && game.potato) {
    const holder = game.players.get(game.potato.id);
    if (holder === p) {
      // Com a bomba: corre atrás do mais perto e dá dash quando alcança
      let near = null;
      let nd = Infinity;
      for (const q of others) {
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < nd) {
          nd = d;
          near = q;
        }
      }
      if (near) {
        const dir = unit(near.x - p.x, near.z - p.z);
        const err = (rng() * 2 - 1) * cfg.aimErrorDeg * DEG;
        const dash = dashReady && nd < BOTS.DASH_RANGE + 1 && rng() < 0.6;
        return { x: dir.x * Math.cos(err) - dir.z * Math.sin(err), z: dir.x * Math.sin(err) + dir.z * Math.cos(err), dash };
      }
    } else if (holder && standing(holder)) {
      // Sem a bomba: foge de quem está com ela, puxando para o meio
      const d = Math.hypot(p.x - holder.x, p.z - holder.z);
      if (d < 5) {
        const away = unit(p.x - holder.x, p.z - holder.z);
        const mid = unit(-p.x, -p.z);
        const w = Math.min(1, r / Math.max(edge, 1));
        const dash = dashReady && d < 1.8 && rng() < cfg.dodgeChance;
        return { ...unit(away.x + mid.x * w * 1.4, away.z + mid.z * w * 1.4), dash };
      }
    }
  }
  if (game.mode === 'hill') {
    const inHill = (q) => Math.hypot(q.x, q.z) < HILL.RADIUS;
    const rivals = others.filter(inHill);
    if (!inHill(p)) {
      // Vai para a colina; se tem alguém lá, empurra no caminho
      const t = rivals[0];
      if (t && dashReady && Math.hypot(t.x - p.x, t.z - p.z) < BOTS.DASH_RANGE + 1 && rng() < 0.5) {
        return { ...unit(t.x - p.x, t.z - p.z), dash: true };
      }
      return toward(0, 0);
    }
    if (rivals.length) {
      const t = rivals.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      const dash = dashReady && Math.hypot(t.x - p.x, t.z - p.z) < BOTS.DASH_RANGE + 1;
      return { ...unit(t.x - p.x, t.z - p.z), dash };
    }
    // Sozinho na colina: fica perto do meio
    if (r > HILL.RADIUS * 0.5) return toward(0, 0);
    return { x: 0, z: 0, dash: false };
  }

  // 2. Power-up mais perto dele do que de qualquer outro
  let box = null;
  let boxDist = Infinity;
  for (const b of game.powerups) {
    const dMe = Math.hypot(b.x - p.x, b.z - p.z);
    const dOther = Math.min(Infinity, ...others.map((q) => Math.hypot(b.x - q.x, b.z - q.z)));
    if (dMe >= dOther) continue;
    if (!brain.ignored.has(b.pid)) brain.ignored.set(b.pid, rng() < cfg.ignorePowerup);
    if (brain.ignored.get(b.pid)) continue;
    if (dMe < boxDist) {
      box = b;
      boxDist = dMe;
    }
  }
  if (box) return toward(box.x, box.z);

  // 3. Caçar: perto da borda e perto dele; o rei conta como 2 alvos
  let target = null;
  let best = -Infinity;
  for (const q of others) {
    const dist = Math.hypot(q.x - p.x, q.z - p.z);
    const edgeness = Math.hypot(q.x, q.z) / Math.max(edge, 0.1);
    const score = ((edgeness + 0.5) / (1 + dist)) * (q.id === game.kingId ? BOTS.KING_TARGET_WEIGHT : 1);
    if (score > best) {
      best = score;
      target = q;
    }
  }
  if (!target) return { ...unit(-p.x, -p.z), dash: false };

  if (brain.targetId !== target.id || now >= brain.rerollAt) {
    brain.targetId = target.id;
    brain.positioning = rng() < cfg.positionChance;
    brain.rerollAt = now + BOTS.POSITION_REROLL;
  }

  const out = unit(target.x, target.z);
  const toT = unit(target.x - p.x, target.z - p.z);
  const dist = Math.hypot(target.x - p.x, target.z - p.z);

  // 4. Dash: alvo perto e na linha para fora da arena
  const inRange = dist <= BOTS.DASH_RANGE + 2 * PHYSICS.ANIMAL_RADIUS;
  const lineCos = out.x * toT.x + out.z * toT.z;
  if (dashReady && inRange && lineCos >= Math.cos(BOTS.DASH_LINE_MAX_DEG * DEG)) {
    const err = (rng() * 2 - 1) * cfg.aimErrorDeg * DEG;
    const c = Math.cos(err);
    const s = Math.sin(err);
    return { x: toT.x * c - toT.z * s, z: toT.x * s + toT.z * c, dash: true };
  }

  if (brain.positioning) {
    const px = target.x - out.x * BOTS.POSITION_OFFSET;
    const pz = target.z - out.z * BOTS.POSITION_OFFSET;
    if (Math.hypot(px - p.x, pz - p.z) > 0.4) return toward(px, pz);
  }
  return toward(target.x, target.z);
}
