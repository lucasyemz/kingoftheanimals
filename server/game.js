// Simulação de uma sala: lobby, rodadas, física 2D de círculos, arena, power-ups,
// placar e coroa. JavaScript puro: não depende de Node nem de Socket.io, para rodar
// também no navegador com ?offline=1. Tudo que sai daqui passa por send(msg, payload).

import {
  NET, ROOM, PHYSICS, ARENA, MATCH, POWERUPS, BOTS, EMOTES,
  SCENARIOS, SCENARIO_ORDER, ANIMALS, PLAYER_COLORS, MODES, POTATO, QUICK, RECONNECT,
  MINIGAMES, FORMATS, SHOW_POOL, SHOW, JUMPROPE, BALLS, HATS, HILL, HEALTH, CHARGE,
} from '../shared/constants.js';
import { MSG, PHASE, PLAYER_STATE as ST, EVENT, JOIN_ERROR } from '../shared/messages.js';
import { createBrain, botThink } from './bots.js';
import { resetRoundRules, updateHazard, inOpenHole, updatePotato, potatoContact, updateHill, rulesPayload } from './modes.js';
import { resetMinigame, updateMinigame, onMissingFloor, minigamePayload } from './minigames.js';

const LEVELS = Object.keys(BOTS.DIFFICULTY); // easy, medium, hard
const DIFFICULTIES = [...LEVELS, 'auto'];   // auto: os bots se ajustam a quem está jogando
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
export function movePlayer(p, dt, { control, friction, onDash, onJump }) {
  p.stT -= dt;
  p.jumpBuffer = Math.max(0, (p.jumpBuffer ?? 0) - dt);
  const airborne = p.y > 0;
  if ((p.st === ST.DASHING || p.st === ST.STUNNED) && p.stT <= 0) p.st = ST.ALIVE;
  if (p.st === ST.ALIVE) p.dashCharge = 0;
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.dashBuffer = Math.max(0, p.dashBuffer - dt);
  // Dash carregado: enche enquanto segura (com o dash pronto); ao soltar, dispara
  const held = !!p.charging && control;
  let release = -1;
  if (p.st !== ST.ALIVE || !control) p.chargeT = 0;
  else if (held && p.dashCd <= 0) p.chargeT = Math.min(CHARGE.TIME, (p.chargeT ?? 0) + dt);
  if (!held && p.chargeWas) {
    if ((p.chargeT ?? 0) > 0) release = Math.max(0, ((p.chargeT ?? 0) - CHARGE.TAP) / (CHARGE.TIME - CHARGE.TAP));
    else p.dashBuffer = PHYSICS.DASH_BUFFER; // soltou durante a recarga: vale como toque
    p.chargeT = 0;
  }
  p.chargeWas = held;
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
      const charging = (p.chargeT ?? 0) > CHARGE.TAP ? CHARGE.MOVE_MULT : 1;
      const mult = (coffee ? coffee.speedMult : 1) * (p.potato ? POTATO.HOLDER_SPEED : 1) * (airborne ? PHYSICS.AIR_CONTROL : 1) * charging;
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
    if ((p.dashBuffer > 0 || release >= 0) && p.dashCd <= 0) {
      const c = Math.max(0, release); // 0 = dash normal, 1 = carga cheia
      const dx = ix || iz ? ix : Math.sin(p.dir);
      const dz = ix || iz ? iz : Math.cos(p.dir);
      const dl = Math.hypot(dx, dz) || 1;
      const speed = PHYSICS.DASH_SPEED * (1 + CHARGE.SPEED_BONUS * c);
      p.vx = (dx / dl) * speed;
      p.vz = (dz / dl) * speed;
      p.dir = Math.atan2(dx, dz);
      p.st = ST.DASHING;
      p.stT = PHYSICS.DASH_DURATION;
      p.dashCharge = c;
      p.dashCdMax = PHYSICS.DASH_COOLDOWN * (coffee ? coffee.dashCooldownMult : 1) * (1 + CHARGE.COOLDOWN_BONUS * c);
      p.dashCd = p.dashCdMax;
      p.dashBuffer = 0;
      onDash?.(dx / dl, dz / dl, c);
    }
    if (p.jumpBuffer > 0 && !airborne && p.st === ST.ALIVE) {
      p.vy = PHYSICS.JUMP_SPEED;
      p.y = 1e-3;
      p.jumpBuffer = 0;
      onJump?.();
    }
  }

  if (p.st !== ST.DASHING) {
    const f = Math.pow(p.y > 0 ? PHYSICS.AIR_FRICTION : friction, dt / NET.TICK_DT);
    p.vx *= f;
    p.vz *= f;
  }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  // Altura: sobe e desce com gravidade, em qualquer estado (atordoado no ar também cai)
  if (p.y > 0 || p.vy > 0) {
    p.vy -= PHYSICS.GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0;
      p.vy = 0;
    }
  }
}

export class Game {
  constructor({ code, send, debug, rng = Math.random, isPublic = false }) {
    this.code = code;
    this.send = send;
    this.debug = sanitizeDebug(debug);
    this.rng = rng;
    this.public = isPublic;   // Partida rápida: começa sozinha e volta ao lobby sozinha
    this.autoStartT = null;   // segundos até começar (só sala pública)
    this.mode = 'classic';     // minijogo da rodada atual
    this.format = 'normal';    // 'normal' | 'party' | 'show'
    this.pool = [];

    this.players = new Map();
    this.hostId = null;
    this.phase = PHASE.LOBBY;
    // Single Player começa na dificuldade automática
    this.settings = { bots: BOTS.DEFAULT_COUNT, difficulty: code === 'SOLO' ? 'auto' : BOTS.DEFAULT_DIFFICULTY, mode: 'party' };
    if (isPublic) Object.assign(this.settings, { difficulty: QUICK.DIFFICULTY, mode: QUICK.MODE });
    this.kingId = null;

    this.tickCount = 0;
    this.simTime = 0;     // segundos de simulação (anda mais devagar com slowmo)
    this.phaseTime = 0;   // segundos reais desde o começo da fase
    this.round = 0;
    this.nextBotId = 1;
    this.nextPowerupId = 1;
    this.resetArena();
    resetRoundRules(this, []);
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
      x: 0, z: 0, vx: 0, vz: 0, dir: 0, y: 0, vy: 0, jumpBuffer: 0,
      st: ST.OUT, stT: 0,
      dashCd: 0, dashCdMax: PHYSICS.DASH_COOLDOWN, dashBuffer: 0, dashCount: 0,
      inputX: 0, inputZ: 0, inputSeq: 0, ackSeq: 0,
      pu: null, puT: 0,
      lastToucher: null, touchT: -Infinity,
      roundKos: 0, roundSelfKo: false, fallR: 0,
      lastEmote: -Infinity,
      potato: false,
      hat: 'none',
      hp: HEALTH.MAX,        // vida: quanto menos, mais longe o empurrão joga
      hits: [],              // últimos dashes recebidos { by, t } (dois seguidos = tonto)
      dazedUntil: -Infinity,
      eliminated: false,     // Eliminação: caiu numa fase e assiste até o fim
      token: null,           // segredo para voltar à partida se a conexão cair
      ...fields,
    };
    this.players.set(id, p);
    return p;
  }

  addHuman(id, { nickname, animal, hat: hatId, level: lvl } = {}) {
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
    const hat = typeof hatId === 'string' && Object.hasOwn(HATS, hatId) ? hatId : 'none';
    const level = clamp(Math.floor(num(lvl, 1)), 1, 999);
    this.newPlayer(id, { nickname: name, animal, spectator: midMatch && ROOM.JOIN_MID_MATCH_AS_SPECTATOR, token, hat, level });
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
  // Trocar de bicho ou de chapéu sem sair da sala (só fora da partida)
  setProfile(id, { animal, hat } = {}) {
    const p = this.players.get(id);
    if (!p || p.bot || (this.phase !== PHASE.LOBBY && this.phase !== PHASE.PODIUM)) return;
    if (ANIMALS.includes(animal)) p.animal = animal;
    if (typeof hat === 'string' && Object.hasOwn(HATS, hat)) p.hat = hat;
    this.sendLobby();
  }

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
    for (const b of this.bots) b.bot = createBrain(this.concreteDifficulty(), this.rng);

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
        bot: createBrain(this.concreteDifficulty(), this.rng),
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
    this.format = FORMATS.includes(this.settings.mode) ? this.settings.mode : 'normal';
    this.pool = [];
    this.showFinal = false;
    for (const p of this.players.values()) {
      Object.assign(p, { wins: 0, kos: 0, selfKos: 0, aliveTime: 0, spectator: false, eliminated: false });
    }
    this.kingslayerId = null;
    this.autoLevel = BOTS.AUTO.START;
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
      p.eliminated = false;
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

  // Festa e Eliminação: um minijogo diferente por rodada, sem repetir até passar por todos
  pickMode() {
    if (this.format === 'normal') return this.settings.mode;
    if (!this.pool.length) {
      const list = this.format === 'show' ? [...SHOW_POOL] : [...MINIGAMES];
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      if (list[0] === this.mode && list.length > 1) list.push(list.shift());
      this.pool = list;
    }
    return this.pool.shift();
  }

  startRound() {
    this.round += 1;
    this.mode = this.debug.tutorial ? 'classic' : this.pickMode();
    this.scenario = this.debug.scenario ?? SCENARIO_ORDER[(this.round - 1) % SCENARIO_ORDER.length];
    const sc = SCENARIOS[this.scenario].physics;
    this.friction = sc.FRICTION ?? PHYSICS.FRICTION;
    const ringMult = { potato: POTATO.RING_INTERVAL_MULT, jumprope: JUMPROPE.RING_INTERVAL_MULT, balls: BALLS.RING_INTERVAL_MULT, hex: Infinity }[this.mode] ?? 1;
    this.ringInterval = (sc.RING_INTERVAL ?? ARENA.RING_INTERVAL) * ringMult;
    this.resetArena();
    // Obstáculos do cenário só nos modos clássicos; os minijogos já mudam a arena
    const scenarioHazard = ['classic', 'potato', 'hill'].includes(this.mode) ? SCENARIOS[this.scenario].hazard : null;
    // No Rei da colina, vento e buracos em qualquer cenário (sem repetir o do cenário)
    const extra = this.mode === 'hill' ? HILL.HAZARDS.filter((h) => h.type !== scenarioHazard?.type) : [];
    resetRoundRules(this, this.debug.tutorial ? [] : [scenarioHazard, ...extra]);
    resetMinigame(this);
    // Eliminação: quantos passam desta fase (com poucos, é a final)
    const alive = this.participants.length;
    this.showFinal = this.format === 'show' && alive <= SHOW.FINAL_AT;
    this.qualify = this.format === 'show' && !this.showFinal ? Math.max(2, Math.min(alive - 1, Math.ceil(alive * SHOW.QUALIFY_FRACTION))) : 1;

    const list = this.participants;
    list.forEach((p, i) => {
      const a = (i / list.length) * Math.PI * 2;
      Object.assign(p, {
        x: Math.cos(a) * ARENA.SPAWN_RADIUS,
        z: Math.sin(a) * ARENA.SPAWN_RADIUS,
        vx: 0, vz: 0, y: 0, vy: 0, jumpBuffer: 0,
        layer: 0, hp: HEALTH.MAX, hits: [], dazedUntil: -Infinity,
        chargeT: 0, charging: false, chargeWas: false, dashCharge: 0,
        dir: Math.atan2(-Math.cos(a), -Math.sin(a)), // virado para o centro
        st: ST.ALIVE, stT: 0,
        dashCd: 0, dashBuffer: 0,
        inputX: 0, inputZ: 0,
        pu: null, puT: 0,
        lastToucher: null, touchT: -Infinity,
        roundKos: 0, roundSelfKo: false,
      });
      if (p.bot) p.bot = createBrain(this.botDifficulty(i, list.length, p.bot.difficulty), this.rng);
    });
    if (this.debug.tutorial) this.placeTutorial();
    this.fallOrder = [];

    this.send(MSG.ROUND, {
      round: this.round, scenario: this.scenario, mode: this.mode, format: this.format,
      final: this.showFinal, qualify: this.format === 'show' && !this.showFinal ? this.qualify : null,
    });
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
        updateMinigame(this, dt);
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
        else if (this.mode === 'hill') this.respawnFallen();
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
    if (this.mode === 'hill' && a.radius - ARENA.RING_WIDTH < HILL.MIN_ARENA) return; // a colina precisa de espaço
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
    if (box.type === 'heal') {
      const before = p.hp ?? HEALTH.MAX;
      p.hp = Math.min(HEALTH.MAX, before + cfg.amount);
      this.event(EVENT.POWERUP_PICK, { id: p.id, pid: box.pid, pu: box.type, healed: Math.round(p.hp - before) });
      return;
    }
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
        if (this.tryBlock(q)) continue;
        const k = cfg.impulse * this.pushTaken(q);
        this.damage(q, HEALTH.BOMB_DAMAGE);
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

  // Peso do bicho (Heavy empurra mais e é empurrado menos)
  heaviness(p) {
    return p.pu === 'heavy' ? POWERUPS.TYPES.heavy.pushTakenMult : 1;
  }

  // Quanto um golpe joga o bicho longe: peso × vida (sem vida, HEALTH.KNOCKBACK_EMPTY ×)
  knockback(p) {
    const lost = 1 - clamp(p.hp ?? HEALTH.MAX, 0, HEALTH.MAX) / HEALTH.MAX;
    return HEALTH.KNOCKBACK_FULL + (HEALTH.KNOCKBACK_EMPTY - HEALTH.KNOCKBACK_FULL) * lost;
  }

  pushTaken(p) {
    return this.heaviness(p) * this.knockback(p);
  }

  // Escudo: segura um golpe e some. Retorna true se bloqueou.
  tryBlock(p, by = null) {
    if (p.pu !== 'shield') return false;
    p.pu = null;
    p.puT = 0;
    this.event(EVENT.SHIELD_BLOCK, { id: p.id, by: by?.id ?? null, x: r2(p.x), z: r2(p.z) });
    return true;
  }

  damage(p, n) {
    if (this.debug.tutorial || n <= 0) return;
    p.hp = Math.max(0, (p.hp ?? HEALTH.MAX) - n * (p.pu === 'heavy' ? 0.5 : 1));
  }

  touch(victim, by) {
    victim.lastToucher = by.id;
    victim.touchT = this.simTime;
  }

  // ---------- Física ----------

  setInput(id, { x, z, dash, jump, charge, seq } = {}) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    p.inputX = clamp(num(x), -1, 1);
    p.inputZ = clamp(num(z), -1, 1);
    p.inputSeq = Math.max(p.inputSeq ?? 0, Math.floor(num(seq)));
    if (dash) p.dashBuffer = PHYSICS.DASH_BUFFER;
    if (jump) p.jumpBuffer = PHYSICS.JUMP_BUFFER;
    p.charging = !!charge;
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
        onDash: (dx, dz, c) => {
          p.dashCount += 1;
          this.event(EVENT.DASH, { id: p.id, dx: r2(dx), dz: r2(dz), c: c ? r2(c) : undefined });
        },
        onJump: () => this.event(EVENT.JUMP, { id: p.id }),
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
        if (Math.abs((a.y ?? 0) - (b.y ?? 0)) > PHYSICS.JUMP_OVER) continue; // um passou por cima do outro
        if ((a.layer ?? 0) !== (b.layer ?? 0)) continue; // andares diferentes (Chão que some)
        if (d < 1e-4) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        const nx = dx / d;
        const nz = dz / d;
        const ta = this.heaviness(a);
        const tb = this.heaviness(b);
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
        // o empurrão de dash cresce com a vida perdida de quem leva
        let ka = bDash ? this.knockback(a) * (1 + CHARGE.KNOCK_BONUS * (b.dashCharge ?? 0)) : 1;
        let kb = aDash ? this.knockback(b) * (1 + CHARGE.KNOCK_BONUS * (a.dashCharge ?? 0)) : 1;
        // Escudo: quem tem quase não se mexe e quem deu o dash é rebatido
        const S = POWERUPS.TYPES.shield;
        if (aDash && b.pu === 'shield') [kb, ka] = [0.15, Math.max(ka, S.bounce)];
        if (bDash && a.pu === 'shield') [ka, kb] = [0.15, Math.max(kb, S.bounce)];
        a.vx -= nx * J * wa * ka;
        a.vz -= nz * J * wa * ka;
        b.vx += nx * J * wb * kb;
        b.vz += nz * J * wb * kb;
        this.touch(a, b);
        this.touch(b, a);

        if (aDash) this.dashHit(a, b);
        if (bDash) this.dashHit(b, a);
      }
    }
  }

  dashHit(attacker, target) {
    const charge = attacker.dashCharge ?? 0;
    const full = charge >= 1;
    attacker.st = ST.ALIVE;
    attacker.stT = 0;
    attacker.dashCharge = 0;
    if (this.tryBlock(target, attacker)) {
      attacker.st = ST.STUNNED;
      attacker.stT = POWERUPS.TYPES.shield.attackerStun;
      return;
    }
    // Dois bichos diferentes acertam o mesmo alvo em pouco tempo: ele fica tonto
    const now = this.simTime;
    target.hits = (target.hits ?? []).filter((h) => now - h.t < HEALTH.DOUBLE_HIT_WINDOW && h.by !== attacker.id);
    const dazed = target.hits.length > 0 && now - (target.dazedUntil ?? -Infinity) > HEALTH.DAZE_IMMUNITY;
    target.hits.push({ by: attacker.id, t: now });
    this.damage(target, HEALTH.DASH_DAMAGE * (1 + CHARGE.DAMAGE_BONUS * charge) + (dazed ? HEALTH.DAZE_DAMAGE : 0));
    target.st = ST.STUNNED;
    target.chargeT = 0;
    if (full) {
      // Carga cheia: tonto garantido (não conta a imunidade do golpe duplo)
      target.stT = Math.max(target.stT ?? 0, CHARGE.STUN);
      target.dazedUntil = now + CHARGE.STUN;
      target.hits = [];
    } else if (dazed) {
      target.stT = HEALTH.DAZE_DURATION;
      target.dazedUntil = now + HEALTH.DAZE_DURATION;
      target.hits = [];
    } else {
      target.stT = Math.max(target.stT ?? 0, PHYSICS.STUN_DURATION);
    }
    this.event(EVENT.DASH_HIT, {
      id: attacker.id,
      target: target.id,
      x: r2((attacker.x + target.x) / 2),
      z: r2((attacker.z + target.z) / 2),
      dazed: dazed || full || undefined,
      charge: charge ? r2(charge) : undefined,
    });
  }

  // ---------- Quedas e fim de rodada ----------

  checkFalls(afterRound = false) {
    this.fellThisTick = [];
    for (const p of this.participants) {
      if (!isStanding(p) || p.y > 0) continue; // no ar ainda não caiu: só se aterrissar fora
      const r = Math.hypot(p.x, p.z);
      if (r <= this.arena.radius) {
        if (inOpenHole(this, p)) this.fall(p, r, afterRound, 'hole');
        else if (onMissingFloor(this, p)) this.fall(p, r, afterRound, 'floor');
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
    if (this.mode === 'hill' && !afterRound) {
      // Rei da colina: volta para a arena daqui a pouco, com a barra menor
      p.respawnAt = this.simTime + PHYSICS.FALL_DURATION + HILL.RESPAWN;
      this.hillScores[p.id] = (this.hillScores[p.id] ?? 0) * (1 - HILL.FALL_PENALTY);
    }
    const credited = p.lastToucher && this.simTime - p.touchT <= PHYSICS.KO_CREDIT_WINDOW;
    const by = credited && this.players.has(p.lastToucher) ? p.lastToucher : null;
    if (!afterRound) {
      this.fellThisTick.push(p);
      this.fallOrder?.push(p.id);
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
    if (this.format === 'show' && !this.showFinal) {
      // Eliminação: a fase acaba quando sobram só os que passam
      if (standing.length > this.qualify) return;
      const extra = [...this.fellThisTick].sort((a, b) => a.fallR - b.fallR);
      const qualified = [...standing, ...extra].slice(0, this.qualify);
      if (!qualified.length) return;
      this.endRound(qualified[0], qualified);
      return;
    }
    if (standing.length > 1) return;
    let winner = standing[0];
    if (!winner) {
      // GDD: rodada nunca empata. Caíram juntos: vence quem estava mais perto do centro.
      winner = [...this.fellThisTick].sort((a, b) => a.fallR - b.fallR)[0];
    }
    if (!winner) return;
    this.endRound(winner);
  }

  endRound(winner, qualified = null) {
    this.setPhase(PHASE.ROUND_END);
    this.arena.warning = false;
    winner.wins += 1;
    this.roundWinner = winner.id;
    this.qualified = qualified ? qualified.map((p) => p.id) : null;
    this.adjustAutoLevel(winner);
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
      mode: this.mode,
      format: this.format,
      qualified: this.qualified,
      eliminated: this.qualified ? this.participants.filter((p) => !this.qualified.includes(p.id)).map((p) => p.id) : null,
      next: this.format === 'normal' ? null : this.pool[0] ?? null,
    });
  }

  // A dificuldade de verdade de um bot novo ('auto' vira o degrau atual)
  concreteDifficulty() {
    if (this.settings.difficulty !== 'auto') return this.settings.difficulty;
    return LEVELS[Math.round(this.autoLevel ?? BOTS.AUTO.START)];
  }

  // Dificuldade automática: cada bot fica fácil, médio ou difícil conforme o nível
  // (0 a 2, com fração: parte dos bots um degrau acima)
  botDifficulty(i, n, current) {
    if (this.settings.difficulty !== 'auto' || current === 'dummy') return current;
    const base = Math.floor(this.autoLevel);
    const up = (i * 0.618) % 1 < this.autoLevel - base ? 1 : 0;
    return LEVELS[Math.min(LEVELS.length - 1, base + up)];
  }

  // Depois de cada rodada: as pessoas foram bem? bots mais fortes; foram mal? mais fracos
  adjustAutoLevel(winner) {
    if (this.settings.difficulty !== 'auto') return;
    const humans = this.participants.filter((p) => !p.bot);
    if (!humans.length) return;
    const A = BOTS.AUTO;
    let delta;
    if (!winner.bot) delta = A.WIN_STEP;
    else {
      const early = Math.ceil(this.participants.length / 2);
      const outEarly = humans.some((h) => this.fallOrder.indexOf(h.id) >= 0 && this.fallOrder.indexOf(h.id) < early);
      delta = outEarly ? -A.LOSE_STEP : -A.LOSE_STEP / 3;
    }
    this.autoLevel = clamp(this.autoLevel + delta, 0, LEVELS.length - 1);
  }

  winsTable() {
    return Object.fromEntries(this.participants.map((p) => [p.id, p.wins]));
  }

  nextRoundOrPodium() {
    if (this.format === 'show') {
      if (this.showFinal || !this.qualified) return this.podium(this.players.get(this.roundWinner));
      // Quem não passou vira espectador até o fim da partida
      for (const p of this.participants) {
        if (this.qualified.includes(p.id)) continue;
        p.eliminated = true;
        p.spectator = true;
        p.st = ST.OUT;
      }
      if (this.participants.length <= 1) return this.podium(this.participants[0] ?? this.players.get(this.roundWinner));
      this.sendLobby();
      return this.startRound();
    }
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
    const list = [...this.players.values()].filter((p) => !p.spectator || p.eliminated);
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

  // Rei da colina: quem caiu volta num lugar seguro, longe da colina e dos buracos
  respawnFallen() {
    for (const p of this.participants) {
      if (p.st !== ST.OUT || !(p.respawnAt <= this.simTime)) continue;
      const maxR = Math.max(1, this.arena.radius - 1.5);
      let spot = { x: 0, z: 0 };
      for (let i = 0; i < 12; i++) {
        const r = maxR * (0.6 + 0.4 * this.rng());
        const a = this.rng() * Math.PI * 2;
        spot = { x: Math.cos(a) * r, z: Math.sin(a) * r };
        const bad = this.holes.some((h) => Math.hypot(h.x - spot.x, h.z - spot.z) < h.r + 1) ||
          Math.hypot(spot.x - this.hill.x, spot.z - this.hill.z) < HILL.RADIUS + 1;
        if (!bad) break;
      }
      Object.assign(p, {
        ...spot, vx: 0, vz: 0, y: 0, vy: 0, st: ST.ALIVE, stT: 0, layer: 0,
        dir: Math.atan2(-spot.x, -spot.z), lastToucher: null, respawnAt: null,
        potato: false, hp: HEALTH.MAX, hits: [], dazedUntil: -Infinity,
        chargeT: 0, charging: false, chargeWas: false, dashCharge: 0,
      });
      this.event(EVENT.RESPAWN, { id: p.id, x: r2(p.x), z: r2(p.z) });
    }
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
      Object.assign(p, { ...home, vx: 0, vz: 0, y: 0, vy: 0, st: ST.ALIVE, stT: 0, lastToucher: null });
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
        hat: p.hat,
        level: p.bot ? null : p.level ?? 1,
        eliminated: p.eliminated,
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
        ...minigamePayload(this),
      },
      players: this.participants.map((p) => ({
        id: p.id,
        x: r2(p.x),
        z: r2(p.z),
        vx: r2(p.vx),
        vz: r2(p.vz),
        dir: r2(p.dir),
        y: r2(p.y),
        vy: r2(p.vy),
        st: p.st,
        dashCd: p.dashCdMax ? r2(p.dashCd / p.dashCdMax) : 0,
        dashCdMax: r2(p.dashCdMax),
        stT: r2(Math.max(0, p.stT)),
        pu: p.pu,
        puT: r2(Math.max(0, p.puT)),
        seq: p.bot ? undefined : p.ackSeq ?? 0,
        potato: p.potato || undefined,
        hp: Math.round(p.hp),
        charge: p.chargeT > 0 ? r2(p.chargeT / CHARGE.TIME) : undefined, // fração de CHARGE.TIME
        layer: p.layer || undefined,
      })),
      powerups: this.powerups,
    };
  }
}
