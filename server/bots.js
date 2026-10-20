// Input dos bots. Um bot é um jogador comum cujo input vem daqui, e não da rede.
// Prioridade (GDD): fugir da borda → pegar power-up → caçar → dar dash.
// O tempo de reação é um atraso entre decidir e aplicar o input.

import { PHYSICS, ARENA, BOTS, HILL, HEALTH } from '../shared/constants.js';
import { PHASE, PLAYER_STATE as ST } from '../shared/messages.js';
import { timeToBar, hexIntact } from './minigames.js';
import { HEX_TILES } from '../shared/hexgrid.js';

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
    hexDir: null,            // Chão que some: direção em que está indo
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

// Pular: por cima das barras baixas que vêm vindo (sem pular quando vem uma alta),
// de buraco no chão à frente, de um dash na direção dele, de quem está com a bomba,
// e de vez em quando só por diversão.
function wantsJump(game, p, cfg, brain) {
  if (p.y > 0 || p.st !== ST.ALIVE) return false;
  const rng = brain.rng;
  const react = cfg.reactionMs / 1000;
  const bars = [...(game.bars ?? []), game.sweep?.bar].filter(Boolean);
  const r = Math.hypot(p.x, p.z);
  for (const bar of bars) {
    if (bar.y0 < 1 || r < (bar.hub ?? 0) + 0.3) continue;
    const t = timeToBar(bar, p.x, p.z, game.arena.radius);
    if (t > react - 0.05 && t < react + 0.75) return false; // barra alta vindo: fica no chão
  }
  for (const bar of bars) {
    if (bar.y1 > 0.6 || r < (bar.hub ?? 0) + 0.4) continue;
    const t = timeToBar(bar, p.x, p.z, game.arena.radius);
    if (t > react && t < react + 0.2) return rng() < cfg.jumpSkill;
  }
  // Chão que some: buraco logo à frente na direção em que anda
  if (game.hex && Math.hypot(p.vx, p.vz) > 2) {
    const v = unit(p.vx, p.vz);
    const look = 0.9 + react * 3;
    const L = p.layer ?? 0;
    if (!hexIntact(game, p.x + v.x * look, p.z + v.z * look, L) && hexIntact(game, p.x + v.x * (look + 1.6), p.z + v.z * (look + 1.6), L)) {
      return rng() < cfg.jumpSkill;
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
  return !game.hex && rng() < 0.004;
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

  // 1c. Chuva de bolas: sai da frente de bola vindo
  for (const b of game.balls ?? []) {
    const rx = p.x - b.x;
    const rz = p.z - b.z;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp < 0.1) continue;
    const vx = b.vx / sp;
    const vz = b.vz / sp;
    const ahead = rx * vx + rz * vz;          // à frente da bola (metros)
    const lateral = rx * -vz + rz * vx;      // de lado (com sinal)
    if (ahead < -1 || ahead > sp * 1.6) continue;
    if (Math.abs(lateral) > b.r + PHYSICS.ANIMAL_RADIUS + 0.8) continue;
    let side = lateral >= 0 ? { x: -vz, z: vx } : { x: vz, z: -vx };
    // não foge para fora da arena
    if ((p.x + side.x * 2) ** 2 + (p.z + side.z * 2) ** 2 > (edge - 1) ** 2) side = { x: -side.x, z: -side.z };
    return { ...side, dash: dashReady && ahead < sp * 0.5 && rng() < cfg.dodgeChance + 0.2 };
  }

  // 1d. Chão que some: nunca para (parado, a peça cai). Olha em 12 direções e vai
  //     para onde há mais chão inteiro seguido, longe da borda e dos outros.
  if (game.hex) {
    let best = null;
    let bestScore = -Infinity;
    const prev = brain.hexDir;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      let run = 0;
      for (let step = 0.8; step <= 4.4; step += 0.4) { // começa depois da peça em que está
        if (!hexIntact(game, p.x + dx * step, p.z + dz * step, p.layer ?? 0)) break;
        run = step;
      }
      const ex = p.x + dx * 2;
      const ez = p.z + dz * 2;
      let crowd = 0;
      for (const q of others) if ((q.layer ?? 0) === (p.layer ?? 0)) crowd += Math.max(0, 2.5 - Math.hypot(q.x - ex, q.z - ez));
      const keep = prev ? (dx * prev.x + dz * prev.z) * 0.6 : 0; // não fica mudando de ideia
      const score = run * 2 - Math.max(0, Math.hypot(ex, ez) - (edge - cfg.edgeSense - 1)) * 2 - crowd + keep + rng() * 0.2;
      if (score > bestScore) {
        bestScore = score;
        best = { x: dx, z: dz };
      }
    }
    brain.hexDir = best;
    // devagar gasta menos chão (os melhores bots andam mais devagar)
    const pace = { easy: 0.75, medium: 0.45, hard: 0.35 }[brain.difficulty] ?? 0.6;
    if (best) return { x: best.x * pace, z: best.z * pace, dash: false };
  }

  // 1e. Modos
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
  if (game.mode === 'hill' && game.hill) {
    // A colina anda: os bots mais espertos já vão para o próximo lugar antes da troca
    const hill = game.hill;
    const early = hill.next && HILL.MOVE_EVERY - hill.t < 0.8 + cfg.positionChance * 1.5;
    const hc = early ? hill.next : hill;
    const inHill = (q) => Math.hypot(q.x - hc.x, q.z - hc.z) < HILL.RADIUS;
    const rivals = others.filter(inHill);
    if (!inHill(p)) {
      // Vai para a colina; se tem alguém lá, empurra no caminho
      const t = rivals[0];
      if (t && dashReady && Math.hypot(t.x - p.x, t.z - p.z) < BOTS.DASH_RANGE + 1 && rng() < 0.5) {
        return { ...unit(t.x - p.x, t.z - p.z), dash: true };
      }
      return toward(hc.x, hc.z);
    }
    if (rivals.length) {
      const t = rivals.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      const dash = dashReady && Math.hypot(t.x - p.x, t.z - p.z) < BOTS.DASH_RANGE + 1;
      return { ...unit(t.x - p.x, t.z - p.z), dash };
    }
    // Sozinho na colina: fica perto do meio dela
    if (Math.hypot(p.x - hc.x, p.z - hc.z) > HILL.RADIUS * 0.5) return toward(hc.x, hc.z);
    return { x: 0, z: 0, dash: false };
  }

  // 2. Power-up mais perto dele do que de qualquer outro
  let box = null;
  let boxDist = Infinity;
  for (const b of game.powerups) {
    const dMe = Math.hypot(b.x - p.x, b.z - p.z);
    const dOther = Math.min(Infinity, ...others.map((q) => Math.hypot(b.x - q.x, b.z - q.z)));
    // Kit de vida: com vida cheia não vale a viagem; com pouca, corre mesmo se alguém estiver mais perto
    const hurt = 1 - (p.hp ?? HEALTH.MAX) / HEALTH.MAX;
    if (b.type === 'heal' && hurt < 0.25) continue;
    const reach = b.type === 'heal' ? 1 + hurt * cfg.positionChance : 1;
    if (dMe >= dOther * reach) continue;
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
    // Médio e difícil preferem quem tem pouca vida (voa mais longe)
    const weak = Math.pow(game.knockback(q), cfg.positionChance);
    const score = ((edgeness + 0.5) / (1 + dist)) * (q.id === game.kingId ? BOTS.KING_TARGET_WEIGHT : 1) * weak;
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
