// Simulação de uma sala: lobby, rodadas, física 2D de círculos, arena, power-ups,
// placar e coroa. JavaScript puro: não depende de Node nem de Socket.io, para rodar
// também no navegador com ?offline=1. Tudo que sai daqui passa por send(msg, payload).

import {
  NET, ROOM, PHYSICS, ARENA, MATCH, POWERUPS, BOTS, EMOTES,
  SCENARIOS, SCENARIO_ORDER, ANIMALS, PLAYER_COLORS, MODES, POTATO, QUICK, RECONNECT,
} from '../shared/constants.js';
import { MSG, PHASE, PLAYER_STATE as ST, EVENT, JOIN_ERROR } from '../shared/messages.js';
import { createBrain, botThink } from './bots.js';
import { resetRoundRules, updateHazard, inOpenHole, updatePotato, potatoContact, updateHill, rulesPayload } from './modes.js';

const DIFFICULTIES = Object.keys(BOTS.DIFFICULTY);
const POWERUP_TYPES = Object.keys(POWERUPS.TYPES);
const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export const isStanding = (p) => p.st === ST.ALIVE || p.st === ST.DASHING || p.st === ST.STUNNED;

// Atalhos de debug vindos da URL de quem criou a sala.
function sanitizeDebug(d = {}) {
  const out = {};
  if (d.scenario && SCENARIOS[d.scenario]) out.scenario = d.scenario;
  const round = Math.floor(num(d.round));
  if (round >= 1 && round <= MATCH.MAX_ROUNDS) out.round = round;
  if (d.powerup && POWERUPS.TYPES[d.powerup]) out.powerup = d.powerup;
  const slowmo = num(d.slowmo);
  if (slowmo > 0 && slowmo <= 1) out.slowmo = slowmo;
  if (d.nofall) out.nofall = true;
  if (d.tutorial) out.tutorial = true;
  return out;
}

// Um passo de movimento de um bicho, sem colisão: timers, input, dash, atrito.
// É a mesma função que o cliente usa para prever o próprio bicho (sem esperar o servidor).
export function movePlayer(p, dt, { control, friction, onDash }) {
  p.stT -= dt;
  if ((p.st === ST.DASHING || p.st === ST.STUNNED) && p.stT <= 0) p.st = ST.ALIVE;
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.dashBuffer = Math.max(0, p.dashBuffer - dt);
  if (p.pu) {
    p.puT -= dt;
    if (p.puT <= 0) p.pu = null;
  }

  const coffee = p.pu === 'coffee' ? POWERUPS.TYPES.coffee : null;
  if (p.st === ST.ALIVE && control) {
    let ix = p.inputX;
    let iz = p.inputZ;
    const len = Math.hypot(ix, iz);
    if (len < PHYSICS.DEAD_ZONE) {
      ix = 0;
      iz = 0;
    } else if (len > 1) {
      ix /= len;
      iz /= len;
    }
    if (ix || iz) {
      const mult = (coffee ? coffee.speedMult : 1) * (p.potato ? POTATO.HOLDER_SPEED : 1);
      const maxSpeed = PHYSICS.MAX_SPEED * mult;
      const before = Math.hypot(p.vx, p.vz);
      p.vx += ix * PHYSICS.ACCEL * mult * dt;
      p.vz += iz * PHYSICS.ACCEL * mult * dt;
      const after = Math.hypot(p.vx, p.vz);
      // O input não passa da velocidade máxima, mas não freia um empurrão.
      const cap = Math.max(maxSpeed, before);
      if (after > cap) {
        p.vx *= cap / after;
        p.vz *= cap / after;
      }
      p.dir = Math.atan2(ix, iz);
    }
    if (p.dashBuffer > 0 && p.dashCd <= 0) {
      const dx = ix || iz ? ix : Math.sin(p.dir);
      const dz = ix || iz ? iz : Math.cos(p.dir);
      const dl = Math.hypot(dx, dz) || 1;
      p.vx = (dx / dl) * PHYSICS.DASH_SPEED;
      p.vz = (dz / dl) * PHYSICS.DASH_SPEED;
      p.dir = Math.atan2(dx, dz);
      p.st = ST.DASHING;
      p.stT = PHYSICS.DASH_DURATION;
      p.dashCdMax = PHYSICS.DASH_COOLDOWN * (coffee ? coffee.dashCooldownMult : 1);
      p.dashCd = p.dashCdMax;
      p.dashBuffer = 0;
      onDash?.(dx / dl, dz / dl);
    }
  }

  if (p.st !== ST.DASHING) {
    const f = Math.pow(friction, dt / NET.TICK_DT);
    p.vx *= f;
    p.vz *= f;
  }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
}

export class Game {
  constructor({ code, send, debug, rng = Math.random, isPublic = false }) {
    this.code = code;
    this.send = send;
    this.debug = sanitizeDebug(debug);
    this.rng = rng;
    this.public = isPublic;   // Partida rápida: começa sozinha e volta ao lobby sozinha
    this.autoStartT = null;   // segundos até começar (só sala pública)
    this.mode = 'classic';

    this.players = new Map();
    this.hostId = null;
    this.phase = PHASE.LOBBY;
    this.settings = { bots: BOTS.DEFAULT_COUNT, difficulty: BOTS.DEFAULT_DIFFICULTY, mode: 'classic' };
    if (isPublic) this.settings.difficulty = QUICK.DIFFICULTY;
    this.kingId = null;

    this.tickCount = 0;
    this.simTime = 0;     // segundos de simulação (anda mais devagar com slowmo)
    this.phaseTime = 0;   // segundos reais desde o começo da fase
    this.round = 0;
    this.nextBotId = 1;
    this.nextPowerupId = 1;
    this.resetArena();
    resetRoundRules(this, null);
  }

  // ---------- Jogadores ----------

  get humans() {
    return [...this.players.values()].filter((p) => !p.bot);
  }

  get bots() {
    return [...this.players.values()].filter((p) => p.bot);
  }

  get participants() {
    return [...this.players.values()].filter((p) => !p.spectator);
  }

  freeColor() {
    const used = new Set([...this.players.values()].map((p) => p.color));
    return PLAYER_COLORS.findIndex((_, i) => !used.has(i));
  }

  newPlayer(id, fields) {
    const p = {
      id,
      nickname: '',
      animal: ANIMALS[0],
      color: this.freeColor(),
      bot: null,
      connected: true,
      spectator: false,
      kingStreak: 0,
      // partida
      wins: 0, kos: 0, selfKos: 0, aliveTime: 0,
      // rodada
      x: 0, z: 0, vx: 0, vz: 0, dir: 0,
      st: ST.OUT, stT: 0,
      dashCd: 0, dashCdMax: PHYSICS.DASH_COOLDOWN, dashBuffer: 0, dashCount: 0,
      inputX: 0, inputZ: 0, inputSeq: 0, ackSeq: 0,
      pu: null, puT: 0,
      lastToucher: null, touchT: -Infinity,
      roundKos: 0, roundSelfKo: false, fallR: 0,
      lastEmote: -Infinity,
      potato: false,
      token: null,           // segredo para voltar à partida se a conexão cair
      ...fields,
    };
    this.players.set(id, p);
    return p;
  }

  addHuman(id, { nickname, animal } = {}) {
    const name = String(nickname ?? '').trim().slice(0, ROOM.NICKNAME_MAX);
    if (!name) return { ok: false, error: JOIN_ERROR.BAD_NICKNAME };
    if (!ANIMALS.includes(animal)) return { ok: false, error: JOIN_ERROR.BAD_ANIMAL };

    if (this.players.size >= ROOM.MAX_PLAYERS) {
      // No lobby, um bot cede a vaga para uma pessoa.
      const bot = this.phase === PHASE.LOBBY && this.bots.find((b) => b.id !== this.kingId);
      if (!bot) return { ok: false, error: JOIN_ERROR.FULL };
      this.players.delete(bot.id);
    }

    const midMatch = this.phase !== PHASE.LOBBY && this.phase !== PHASE.PODIUM;
    const token = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    this.newPlayer(id, { nickname: name, animal, spectator: midMatch && ROOM.JOIN_MID_MATCH_AS_SPECTATOR, token });
    if (!this.hostId) this.hostId = id;
    this.clampBotSetting();
    if (this.public && this.phase === PHASE.LOBBY && this.autoStartT === null) this.autoStartT = QUICK.AUTO_START;
    this.sendLobby();
    return { ok: true, playerId: id, code: this.code, token };
  }

  // Voltou depois de a conexão cair: devolve o bicho (um bot jogava no lugar).
  // Retorna o id antigo do jogador; a sala passa a mandar o input dele com esse id.
  reclaim(token) {
    if (!token) return null;
    const p = [...this.players.values()].find((q) => q.token === token);
    // connected ainda true: o servidor não percebeu a queda; a sala derruba a conexão velha
    if (!p || (!p.connected && this.simTime - (p.leftAt ?? 0) > RECONNECT.GRACE)) return null;
    p.bot = null;
    p.connected = true;
    p.inputX = 0;
    p.inputZ = 0;
    if (!this.hostId || !this.players.get(this.hostId) || this.players.get(this.hostId).bot) this.hostId = p.id;
    this.sendLobby();
    return { ok: true, playerId: p.id, code: this.code, token, rejoined: true };
  }

  // Retorna quantas pessoas sobraram na sala.
  removeHuman(id) {
    const p = this.players.get(id);
    if (!p || p.bot) return this.humans.length;
    const inMatch = this.phase !== PHASE.LOBBY && this.phase !== PHASE.PODIUM;
    if (inMatch && !p.spectator) {
      // GDD: um bot médio assume o lugar de quem sai no meio da partida.
      p.bot = createBrain(BOTS.REPLACE_LEAVER, this.rng);
      p.botName = Math.floor(this.rng() * BOTS.NAME_ADJECTIVE_COUNT);
      p.connected = false;
      p.leftAt = this.simTime;
    } else {
      this.players.delete(id);
    }
    if (this.hostId === id) this.hostId = this.humans[0]?.id ?? null;
    this.clampBotSetting();
    this.sendLobby();
    return this.humans.length;
  }

  clampBotSetting() {
    const max = Math.min(BOTS.MAX, ROOM.MAX_PLAYERS - this.humans.length);
    this.settings.bots = clamp(this.settings.bots, 0, max);
  }

  applySettings(id, { bots, difficulty, mode } = {}) {
    if (id !== this.hostId || this.phase !== PHASE.LOBBY) return;
    if (bots !== undefined) this.settings.bots = Math.floor(num(bots, this.settings.bots));
    if (DIFFICULTIES.includes(difficulty)) this.settings.difficulty = difficulty;
    if (MODES.includes(mode)) this.settings.mode = mode;
    this.clampBotSetting();
    this.sendLobby();
  }

  // Deixa a sala com exatamente settings.bots bots, todos na dificuldade escolhida.
  syncBots() {
    const bots = this.bots;
    const keep = bots.sort((a, b) => (b.id === this.kingId) - (a.id === this.kingId));
    for (const extra of keep.slice(this.settings.bots)) this.players.delete(extra.id);
    for (const b of this.bots) b.bot = createBrain(this.settings.difficulty, this.rng);

    const usedNames = new Set(this.bots.map((b) => b.botName));
    while (this.bots.length < this.settings.bots && this.players.size < ROOM.MAX_PLAYERS) {
      const usedAnimals = new Set([...this.players.values()].map((p) => p.animal));
      const freeAnimals = ANIMALS.filter((a) => !usedAnimals.has(a));
      const pool = freeAnimals.length ? freeAnimals : ANIMALS;
      let botName = Math.floor(this.rng() * BOTS.NAME_ADJECTIVE_COUNT);
      for (let i = 0; i < BOTS.NAME_ADJECTIVE_COUNT && usedNames.has(botName); i++) {
        botName = (botName + 1) % BOTS.NAME_ADJECTIVE_COUNT;
      }
      usedNames.add(botName);
      this.newPlayer(`bot${this.nextBotId++}`, {
        animal: pool[Math.floor(this.rng() * pool.length)],
        bot: createBrain(this.settings.difficulty, this.rng),
        botName,
        connected: false,
      });
    }
  }

  // ---------- Partida ----------

  startMatch(id, { bots, difficulty, mode } = {}) {
    if (id !== this.hostId || this.phase !== PHASE.LOBBY) return false;
    if (this.debug.tutorial) {
      // Tutorial: só um boneco parado, sem anéis caindo nem power-ups
      bots = 1;
      mode = 'classic';
    }
    this.applySettings(id, { bots, difficulty, mode });
    this.autoStartT = null;
    this.syncBots();
    if (this.debug.tutorial) for (const b of this.bots) b.bot = createBrain('dummy', this.rng);
    if (this.players.size < ROOM.MIN_PLAYERS) return false;
    this.mode = this.settings.mode;
    for (const p of this.players.values()) {
      Object.assign(p, { wins: 0, kos: 0, selfKos: 0, aliveTime: 0, spectator: false });
    }
    this.kingslayerId = null;
    this.round = this.debug.round ? this.debug.round - 1 : 0;
    this.sendLobby();
    this.startRound();
    return true;
  }

  rematch() {
    if (this.phase !== PHASE.PODIUM) return;
    this.setPhase(PHASE.LOBBY);
    if (this.public) this.autoStartT = QUICK.AUTO_START;
    for (const p of this.players.values()) {
      p.spectator = false;
      p.st = ST.OUT;
    }
    this.sendLobby();
  }

  resetArena() {
    this.arena = { radius: ARENA.RADIUS, warning: false, rings: 0 };
    this.ringTimer = 0;
    this.roundTime = 0;
    this.powerups = [];
    this.powerupTimer = 0;
    this.soapT = 0;
  }

  startRound() {
    this.round += 1;
    this.scenario = this.debug.scenario ?? SCENARIO_ORDER[(this.round - 1) % SCENARIO_ORDER.length];
    const sc = SCENARIOS[this.scenario].physics;
    this.friction = sc.FRICTION ?? PHYSICS.FRICTION;
    this.ringInterval = (sc.RING_INTERVAL ?? ARENA.RING_INTERVAL) * (this.mode === 'potato' ? POTATO.RING_INTERVAL_MULT : 1);
    this.resetArena();
    resetRoundRules(this, this.debug.tutorial ? null : SCENARIOS[this.scenario].hazard);

    const list = this.participants;
    list.forEach((p, i) => {
      const a = (i / list.length) * Math.PI * 2;
      Object.assign(p, {
        x: Math.cos(a) * ARENA.SPAWN_RADIUS,
        z: Math.sin(a) * ARENA.SPAWN_RADIUS,
        vx: 0, vz: 0,
        dir: Math.atan2(-Math.cos(a), -Math.sin(a)), // virado para o centro
        st: ST.ALIVE, stT: 0,
        dashCd: 0, dashBuffer: 0,
        inputX: 0, inputZ: 0,
        pu: null, puT: 0,
        lastToucher: null, touchT: -Infinity,
        roundKos: 0, roundSelfKo: false,
      });
      if (p.bot) p.bot = createBrain(p.bot.difficulty, this.rng);
    });
    if (this.debug.tutorial) this.placeTutorial();

    this.send(MSG.ROUND, { round: this.round, scenario: this.scenario, mode: this.mode });
    this.setPhase(PHASE.COUNTDOWN);
    this.lastCount = null;
  }

  setPhase(phase) {
    this.phase = phase;
    this.phaseTime = 0;
  }

  // ---------- Loop de 30 Hz ----------

  tick() {
    const realDt = NET.TICK_DT;
    this.tickCount += 1;
    this.phaseTime += realDt;

    let scale = this.debug.slowmo ?? 1;
    if (this.phase === PHASE.ROUND_END && this.phaseTime < MATCH.ROUND_END_SLOWMO) {
      scale *= MATCH.ROUND_END_SLOWMO_SCALE;
    }
    const dt = realDt * scale;
    this.simTime += dt;

    switch (this.phase) {
      case PHASE.LOBBY:
        this.tickAutoStart(realDt);
        return;
      case PHASE.PODIUM:
        if (this.public && this.phaseTime >= QUICK.REMATCH_AFTER) this.rematch();
        return;

      case PHASE.COUNTDOWN: {
        const n = Math.ceil(MATCH.COUNTDOWN - this.phaseTime);
        if (n !== this.lastCount && n > 0) {
          this.lastCount = n;
          this.event(EVENT.COUNTDOWN, { n });
        }
        if (n <= 0) {
          this.event(EVENT.COUNTDOWN, { n: 0 });
          this.setPhase(PHASE.PLAYING);
        }
        this.physics(dt, false);
        break;
      }

      case PHASE.PLAYING:
      case PHASE.SUDDEN_DEATH: {
        this.roundTime += dt;
        if (!this.debug.tutorial) {
          this.updateArena(dt);
          this.updatePowerups(dt);
        }
        updateHazard(this, dt);
        updatePotato(this, dt);
        this.thinkBots(dt);
        this.physics(dt, true);
        this.checkFalls();
        if (this.debug.tutorial) {
          this.tickTutorial();
          break;
        }
        const hillWinner = updateHill(this, dt);
        if (hillWinner) this.endRound(hillWinner);
        else this.checkRoundEnd();
        break;
      }

      case PHASE.ROUND_END:
        this.thinkBots(dt);
        this.physics(dt, true);
        this.checkFalls(true);
        if (this.phaseTime >= MATCH.ROUND_END_SLOWMO + MATCH.SCOREBOARD_TIME) this.nextRoundOrPodium();
        break;
    }

    if (this.phase !== PHASE.LOBBY && this.phase !== PHASE.PODIUM) this.send(MSG.STATE, this.statePayload());
  }

  thinkBots(dt) {
    for (const p of this.participants) {
      if (p.bot && isStanding(p)) botThink(this, p, this.simTime, dt);
    }
  }

  // ---------- Arena ----------

  updateArena(dt) {
    const a = this.arena;
    if (this.phase === PHASE.PLAYING && this.roundTime >= MATCH.ROUND_MAX_TIME) {
      this.setPhase(PHASE.SUDDEN_DEATH);
      a.warning = false;
      this.event(EVENT.SUDDEN_DEATH, {});
    }
    if (this.phase === PHASE.SUDDEN_DEATH) {
      a.radius = Math.max(0, a.radius - ARENA.SUDDEN_DEATH_SHRINK * dt);
      return;
    }
    if (a.radius - ARENA.RING_WIDTH < ARENA.MIN_RADIUS - 1e-6) return; // só sobrou o miolo
    this.ringTimer += dt;
    if (!a.warning && this.ringTimer >= this.ringInterval - ARENA.RING_WARNING) {
      a.warning = true;
      this.event(EVENT.RING_WARNING, { ring: a.rings, radius: r2(a.radius) });
    }
    if (this.ringTimer >= this.ringInterval) {
      this.ringTimer = 0;
      a.warning = false;
      a.rings += 1;
      a.radius = Math.max(ARENA.MIN_RADIUS, a.radius - ARENA.RING_WIDTH);
      this.event(EVENT.RING_DROP, { ring: a.rings - 1, radius: r2(a.radius) });
    }
  }

  // ---------- Power-ups ----------

  updatePowerups(dt) {
    this.soapT = Math.max(0, this.soapT - dt);
    this.powerups = this.powerups.filter((b) => Math.hypot(b.x, b.z) < this.arena.radius);

    const interval = this.debug.powerup ? POWERUPS.DEBUG_SPAWN_INTERVAL : POWERUPS.SPAWN_INTERVAL;
    this.powerupTimer += dt;
    if (this.powerupTimer >= interval && this.phase === PHASE.PLAYING) {
      this.powerupTimer = 0;
      if (this.powerups.length < POWERUPS.MAX_ON_ARENA) this.spawnPowerup();
    }

    for (const p of this.participants) {
      if (!isStanding(p)) continue;
      for (const box of this.powerups) {
        if (Math.hypot(p.x - box.x, p.z - box.z) < this.radiusOf(p) + POWERUPS.BOX_RADIUS) {
          this.powerups = this.powerups.filter((b) => b !== box);
          this.pickPowerup(p, box);
          break;
        }
      }
    }
  }

  spawnPowerup() {
    const maxR = this.arena.radius - POWERUPS.SPAWN_MARGIN;
    if (maxR <= 0) return;
    const r = Math.sqrt(this.rng()) * maxR;
    const a = this.rng() * Math.PI * 2;
    const type = this.debug.powerup ?? this.rollPowerup();
    const box = { pid: this.nextPowerupId++, type, x: r2(Math.cos(a) * r), z: r2(Math.sin(a) * r) };
    this.powerups.push(box);
    this.event(EVENT.POWERUP_SPAWN, { pid: box.pid, pu: type, x: box.x, z: box.z });
  }

  rollPowerup() {
    let roll = this.rng() * POWERUP_TYPES.reduce((s, t) => s + POWERUPS.TYPES[t].weight, 0);
    for (const t of POWERUP_TYPES) {
      roll -= POWERUPS.TYPES[t].weight;
      if (roll <= 0) return t;
    }
    return POWERUP_TYPES[0];
  }

  pickPowerup(p, box) {
    const cfg = POWERUPS.TYPES[box.type];
    // GDD: um por vez; pegar outro substitui. Bomb e Soap ficam como ícone enquanto valem.
    p.pu = box.type;
    p.puT = cfg.duration || 1;
    this.event(EVENT.POWERUP_PICK, { id: p.id, pid: box.pid, pu: box.type });

    if (box.type === 'soap') this.soapT = cfg.duration;
    if (box.type === 'bomb') {
      const hit = [];
      for (const q of this.participants) {
        if (q === p || !isStanding(q)) continue;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > cfg.radius) continue;
        const nx = d > 1e-4 ? dx / d : Math.cos(this.rng() * 7);
        const nz = d > 1e-4 ? dz / d : Math.sin(this.rng() * 7);
        const k = cfg.impulse * this.pushTaken(q);
        q.vx += nx * k;
        q.vz += nz * k;
        q.st = ST.STUNNED;
        q.stT = cfg.stun;
        this.touch(q, p);
        hit.push(q.id);
      }
      this.event(EVENT.PUSH_BOMB, { id: p.id, x: r2(p.x), z: r2(p.z), hit });
    }
  }

  radiusOf(p) {
    return PHYSICS.ANIMAL_RADIUS * (p.pu === 'heavy' ? POWERUPS.TYPES.heavy.scale : 1);
  }

  pushTaken(p) {
    return p.pu === 'heavy' ? POWERUPS.TYPES.heavy.pushTakenMult : 1;
  }

  touch(victim, by) {
    victim.lastToucher = by.id;
    victim.touchT = this.simTime;
  }

  // ---------- Física ----------

  setInput(id, { x, z, dash, seq } = {}) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    p.inputX = clamp(num(x), -1, 1);
    p.inputZ = clamp(num(z), -1, 1);
    p.inputSeq = Math.max(p.inputSeq ?? 0, Math.floor(num(seq)));
    if (dash) p.dashBuffer = PHYSICS.DASH_BUFFER;
  }

  physics(dt, control) {
    const friction = this.soapT > 0 ? POWERUPS.TYPES.soap.friction : this.friction;
    const list = this.participants;
    const counting = control && (this.phase === PHASE.PLAYING || this.phase === PHASE.SUDDEN_DEATH);

    for (const p of list) {
      if (p.st === ST.OUT) continue;
      if (p.st === ST.FALLING) {
        // perde o embalo horizontal: despenca perto da borda, onde dá para ver a queda
        const drag = Math.pow(PHYSICS.FALL_DRAG, dt / NET.TICK_DT);
        p.vx *= drag;
        p.vz *= drag;
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.stT -= dt;
        if (p.stT <= 0) p.st = ST.OUT;
        continue;
      }
      if (counting) p.aliveTime += dt;
      if (control && !p.bot) p.ackSeq = p.inputSeq; // último input aplicado (o cliente reconcilia a partir dele)
      movePlayer(p, dt, {
        control,
        friction,
        onDash: (dx, dz) => {
          p.dashCount += 1;
          this.event(EVENT.DASH, { id: p.id, dx: r2(dx), dz: r2(dz) });
        },
      });
    }

    this.collide(list.filter(isStanding));
  }

  collide(list) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        const min = this.radiusOf(a) + this.radiusOf(b);
        if (d >= min) continue;
        if (d < 1e-4) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        const nx = dx / d;
        const nz = dz / d;
        const ta = this.pushTaken(a);
        const tb = this.pushTaken(b);
        const wa = ta / (ta + tb);
        const wb = tb / (ta + tb);

        potatoContact(this, a, b);
        const overlap = min - Math.min(d, min);
        a.x -= nx * overlap * wa;
        a.z -= nz * overlap * wa;
        b.x += nx * overlap * wb;
        b.z += nz * overlap * wb;

        const vrel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (vrel <= 0) continue;
        const aDash = a.st === ST.DASHING;
        const bDash = b.st === ST.DASHING;
        const J = (aDash || bDash ? PHYSICS.DASH_PUSH_FACTOR : PHYSICS.PUSH_FACTOR) * vrel;
        a.vx -= nx * J * wa;
        a.vz -= nz * J * wa;
        b.vx += nx * J * wb;
        b.vz += nz * J * wb;
        this.touch(a, b);
        this.touch(b, a);

        if (aDash) this.dashHit(a, b);
        if (bDash) this.dashHit(b, a);
      }
    }
  }

  dashHit(attacker, target) {
    attacker.st = ST.ALIVE;
    attacker.stT = 0;
    target.st = ST.STUNNED;
    target.stT = PHYSICS.STUN_DURATION;
    this.event(EVENT.DASH_HIT, {
      id: attacker.id,
      target: target.id,
      x: r2((attacker.x + target.x) / 2),
      z: r2((attacker.z + target.z) / 2),
    });
  }

  // ---------- Quedas e fim de rodada ----------

  checkFalls(afterRound = false) {
    this.fellThisTick = [];
    for (const p of this.participants) {
      if (!isStanding(p)) continue;
      const r = Math.hypot(p.x, p.z);
      if (r <= this.arena.radius) {
        if (inOpenHole(this, p)) this.fall(p, r, afterRound, 'hole');
        continue;
      }
      if (this.debug.nofall) {
        const k = this.arena.radius / r;
        p.x *= k;
        p.z *= k;
        const out = (p.vx * p.x + p.vz * p.z) / (r * k);
        if (out > 0) {
          p.vx -= (out * p.x) / (r * k);
          p.vz -= (out * p.z) / (r * k);
        }
        continue;
      }
      this.fall(p, r, afterRound);
    }
  }

  fall(p, r, afterRound, why = null) {
    p.st = ST.FALLING;
    p.stT = PHYSICS.FALL_DURATION;
    p.fallR = r;
    const credited = p.lastToucher && this.simTime - p.touchT <= PHYSICS.KO_CREDIT_WINDOW;
    const by = credited && this.players.has(p.lastToucher) ? p.lastToucher : null;
    if (!afterRound) {
      this.fellThisTick.push(p);
      if (by) {
        const k = this.players.get(by);
        k.kos += 1;
        k.roundKos += 1;
      } else {
        p.selfKos += 1;
        p.roundSelfKo = true;
      }
    }
    p.potato = false;
    this.event(EVENT.FALL, { id: p.id, by, x: r2(p.x), z: r2(p.z), why });
    if (by && p.id === this.kingId && !afterRound) {
      if (!this.kingslayerId) this.kingslayerId = by;
      this.event(EVENT.KINGSLAYER, { id: by, king: p.id });
    }
  }

  checkRoundEnd() {
    const standing = this.participants.filter(isStanding);
    if (standing.length > 1) return;
    let winner = standing[0];
    if (!winner) {
      // GDD: rodada nunca empata. Caíram juntos: vence quem estava mais perto do centro.
      winner = [...this.fellThisTick].sort((a, b) => a.fallR - b.fallR)[0];
    }
    if (!winner) return;
    this.endRound(winner);
  }

  endRound(winner) {
    this.setPhase(PHASE.ROUND_END);
    this.arena.warning = false;
    winner.wins += 1;
    this.roundWinner = winner.id;
    this.event(EVENT.ROUND_END, { winner: winner.id });

    const list = this.participants;
    const topKo = [...list].sort((a, b) => b.roundKos - a.roundKos)[0];
    const selfKo = list.find((p) => p.roundSelfKo);
    let highlight = { type: 'winner', id: winner.id };
    if (topKo && topKo.roundKos > 0) highlight = { type: 'knockouts', id: topKo.id, n: topKo.roundKos };
    else if (selfKo) highlight = { type: 'selfKo', id: selfKo.id };

    this.send(MSG.SCORE, {
      kind: 'round',
      round: this.round,
      winner: winner.id,
      wins: this.winsTable(),
      highlight,
    });
  }

  winsTable() {
    return Object.fromEntries(this.participants.map((p) => [p.id, p.wins]));
  }

  nextRoundOrPodium() {
    const list = this.participants;
    const best = Math.max(...list.map((p) => p.wins));
    const leaders = list.filter((p) => p.wins === best);
    const decided = best >= MATCH.WINS_TO_WIN || (this.round >= MATCH.MAX_ROUNDS && leaders.length === 1);
    if (!decided && this.round >= MATCH.MAX_ROUNDS && !MATCH.TIEBREAK_EXTRA_ROUNDS) {
      return this.podium(leaders[0]);
    }
    if (decided) return this.podium(leaders[0]);
    this.startRound();
  }

  podium(champion) {
    this.setPhase(PHASE.PODIUM);
    const list = this.participants;
    const most = (key) => {
      const top = [...list].sort((a, b) => b[key] - a[key])[0];
      return top && top[key] > 0 ? top.id : null;
    };

    const previousKing = this.kingId;
    if (previousKing === champion.id) {
      champion.kingStreak += 1;
      this.event(EVENT.LONG_LIVE_KING, { id: champion.id, streak: champion.kingStreak });
    } else {
      const old = this.players.get(previousKing);
      if (old) old.kingStreak = 0;
      champion.kingStreak = 1;
    }
    this.kingId = champion.id;

    this.send(MSG.SCORE, {
      kind: 'match',
      champion: champion.id,
      wins: this.winsTable(),
      awards: {
        champion: champion.id,
        bully: most('kos'),
        kamikaze: most('selfKos'),
        survivor: most('aliveTime'),
        kingslayer: this.kingslayerId ?? null,
      },
    });
    this.event(EVENT.PODIUM, { champion: champion.id });
    this.sendLobby();
  }

  // ---------- Partida rápida ----------

  tickAutoStart(dt) {
    if (!this.public || this.autoStartT === null) return;
    const humans = this.humans.length;
    if (humans === 0) {
      this.autoStartT = null;
      return;
    }
    const before = Math.ceil(this.autoStartT);
    this.autoStartT = Math.max(0, this.autoStartT - dt);
    if (this.autoStartT <= 0 || humans >= QUICK.START_NOW_HUMANS) {
      this.autoStartT = null;
      const bots = Math.max(0, Math.min(BOTS.MAX, QUICK.MIN_TOTAL - humans));
      this.startMatch(this.hostId, { bots, difficulty: QUICK.DIFFICULTY });
      return;
    }
    if (Math.ceil(this.autoStartT) !== before) this.sendLobby();
  }

  // ---------- Tutorial ----------

  placeTutorial() {
    const me = this.humans[0];
    const dummy = this.bots[0];
    if (me) Object.assign(me, { x: 0, z: 3, vx: 0, vz: 0, dir: Math.PI });
    if (dummy) Object.assign(dummy, { x: 0, z: -3.5, vx: 0, vz: 0, dir: 0 });
  }

  tickTutorial() {
    const me = this.humans[0];
    const dummy = this.bots[0];
    if (!this.tutorialDone && dummy && (dummy.st === ST.FALLING || dummy.st === ST.OUT)) {
      this.tutorialDone = true;
      this.event(EVENT.TUTORIAL, { step: 'done' });
    }
    // Quem cai volta para o meio (no tutorial ninguém perde)
    for (const p of [me, dummy]) {
      if (!p || p.st !== ST.OUT) continue;
      const home = p === me ? { x: 0, z: 3 } : { x: 0, z: -3.5 };
      Object.assign(p, { ...home, vx: 0, vz: 0, st: ST.ALIVE, stT: 0, lastToucher: null });
    }
  }

  // ---------- Emotes ----------

  emote(id, { n } = {}) {
    const p = this.players.get(id);
    const k = Math.floor(num(n));
    if (!p || k < 1 || k > EMOTES.COUNT) return;
    const now = this.tickCount * NET.TICK_DT;
    if (now - p.lastEmote < EMOTES.COOLDOWN) return;
    p.lastEmote = now;
    this.event(EVENT.EMOTE, { id, n: k });
  }

  // ---------- Saída ----------

  event(type, data) {
    this.send(MSG.EVENT, { ...data, type });
  }

  sendLobby() {
    this.send(MSG.LOBBY, this.lobbyPayload());
  }

  lobbyPayload() {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      bots: this.settings.bots,
      difficulty: this.settings.difficulty,
      mode: this.settings.mode,
      public: this.public,
      autoStartIn: this.autoStartT,
      kingId: this.kingId,
      round: this.round,
      scenario: this.scenario ?? null,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        animal: p.animal,
        color: p.color,
        bot: !!p.bot,
        botName: p.bot ? p.botName : null,
        connected: p.connected,
        spectator: p.spectator,
        kingStreak: p.kingStreak,
        wins: p.wins,
      })),
    };
  }

  statePayload() {
    return {
      tick: this.tickCount,
      t: Math.round(this.tickCount * NET.TICK_DT * 1000),
      phase: this.phase,
      round: this.round,
      timeLeft: Math.max(0, Math.ceil(MATCH.ROUND_MAX_TIME - this.roundTime)),
      arena: {
        radius: r2(this.arena.radius),
        warning: this.arena.warning,
        soap: this.soapT > 0,
        rings: this.arena.rings,
        ...rulesPayload(this),
      },
      players: this.participants.map((p) => ({
        id: p.id,
        x: r2(p.x),
        z: r2(p.z),
        vx: r2(p.vx),
        vz: r2(p.vz),
        dir: r2(p.dir),
        st: p.st,
        dashCd: p.dashCdMax ? r2(p.dashCd / p.dashCdMax) : 0,
        dashCdMax: r2(p.dashCdMax),
        stT: r2(Math.max(0, p.stT)),
        pu: p.pu,
        puT: r2(Math.max(0, p.puT)),
        seq: p.bot ? undefined : p.ackSeq ?? 0,
        potato: p.potato || undefined,
      })),
      powerups: this.powerups,
    };
  }
}
