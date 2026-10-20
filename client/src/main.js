// Conexão e estados de tela (home, lobby, jogo, placar, pódio).
// O cliente só manda input e desenha o state, 100 ms atrás, interpolando.

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import gsap from 'gsap';
import { io } from 'socket.io-client';
import { NET, ANIMALS, MATCH, SCENARIOS, EMOTES, POWERUPS, PLAYER_COLORS, PHYSICS } from '../../shared/constants.js';
import { MSG, PHASE, PLAYER_STATE as ST } from '../../shared/messages.js';
import { Game, movePlayer } from '../../server/game.js';
import { STR } from './strings.js';
import { createWorld, IS_MOBILE } from './scene.js';
import { createAnimal, loadAnimalModels } from './animals.js';
import { createFx } from './fx.js';
import { createInput } from './input.js';
import { createUI, createLoading, displayName, colorOf } from './ui.js';

// ---------- Atalhos de debug (GDD: fora de produção ou com ?debug=1) ----------

const params = new URLSearchParams(location.search);
const SHOW_DEBUG = params.has('debug');
const SHORTCUTS = import.meta.env.DEV || SHOW_DEBUG;
const OFFLINE = params.get('offline') === '1';
const DEBUG_OPTS = SHORTCUTS
  ? {
      scenario: params.get('scenario') ?? undefined,
      round: params.get('round') ?? undefined,
      powerup: params.get('powerup') ?? undefined,
      slowmo: params.get('slowmo') ?? undefined,
      nofall: params.get('nofall') === '1',
    }
  : {};
const QUICK_BOTS = SHORTCUTS && params.has('bots') ? Number(params.get('bots')) : null;
const QUICK_DIFFICULTY = params.get('difficulty') ?? undefined;
const IN_MATCH = new Set([PHASE.COUNTDOWN, PHASE.PLAYING, PHASE.SUDDEN_DEATH, PHASE.ROUND_END]);

document.title = STR.title;

// ---------- Rede: Socket.io (Multiplayer) ou o game.js rodando aqui mesmo (Single Player) ----------

const netHandlers = {};
const dispatch = (msg, payload) => {
  for (const fn of netHandlers[msg] ?? []) fn(payload);
};

function onlineBackend() {
  // WebSocket primeiro; se o caminho não aceitar (ex.: link do Studio), cai para long-polling
  const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
  socket.onAny((msg, payload) => dispatch(msg, payload));
  socket.on('connect', () => dispatch('status', 'online'));
  socket.on('disconnect', () => dispatch('status', 'offline'));
  return {
    get id() {
      return socket.id;
    },
    get transport() {
      return socket.io.engine?.transport?.name ?? '';
    },
    emit: (msg, data, ack) => (ack ? socket.emit(msg, data, ack) : socket.emit(msg, data)),
    close() {
      socket.offAny();
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}

function soloBackend() {
  const id = 'me';
  let game = null;
  let timer = null;
  const send = (msg, payload) => dispatch(msg, JSON.parse(JSON.stringify(payload))); // igual a passar pela rede
  queueMicrotask(() => dispatch('status', 'local'));
  return {
    id,
    emit(msg, data = {}, ack) {
      if (msg === MSG.JOIN) {
        game = new Game({ code: 'SOLO', debug: data.debug, send });
        timer = setInterval(() => game.tick(), 1000 / NET.TICK_RATE);
        return ack?.(game.addHuman(id, data));
      }
      if (!game) return;
      if (msg === MSG.SETTINGS) game.applySettings(id, data);
      if (msg === MSG.START) game.startMatch(id, data);
      if (msg === MSG.REMATCH) game.rematch();
      if (msg === MSG.EMOTE) game.emote(id, data);
      if (msg === MSG.INPUT) {
        game.setInput(id, data);
        ack?.(Date.now());
      }
    },
    close() {
      clearInterval(timer);
      game = null;
    },
  };
}

// Mesma interface para os dois modos; troca de modo sem recarregar a página.
const net = {
  mode: null, // 'solo' | 'online'
  backend: null,
  get id() {
    return this.backend?.id ?? null;
  },
  get transport() {
    return this.backend?.transport ?? 'local';
  },
  on(msg, fn) {
    (netHandlers[msg] ||= []).push(fn);
  },
  emit(msg, data, ack) {
    this.backend?.emit(msg, data, ack);
  },
  use(mode) {
    if (this.mode === mode && this.backend) return;
    this.leave();
    this.mode = mode;
    this.backend = mode === 'solo' ? soloBackend() : onlineBackend();
  },
  leave() {
    this.backend?.close();
    this.backend = null;
    this.mode = null;
  },
};

// ---------- Cena ----------

const canvas = document.getElementById('game');
const world = createWorld(canvas);
const labels = new CSS2DRenderer({ element: document.getElementById('labels') });
const resizeLabels = () => labels.setSize(innerWidth, innerHeight);
addEventListener('resize', resizeLabels);
resizeLabels();

let manifest = {};
const animals = new Map(); // id → Animal
const boxes = new Map();   // pid → mesh
let crownModel = null;

const ui = createUI({
  onSolo: (d) => join('solo', { ...d, code: null }),
  onMulti: (d) => join('online', { ...d, code: null }),
  onJoin: (d) => join('online', d),
  onAnimal: (a) => {
    home.animal = a;
    showPreview();
  },
  onName: (name) => {
    home.nickname = name;
    preview?.setLabel(previewLabel());
  },
  onLeave: () => leaveToMenu(),
  onSettings: (d) => net.emit(MSG.SETTINGS, { bots: lobby?.bots, difficulty: lobby?.difficulty, ...d }),
  onStart: () => net.emit(MSG.START, { bots: lobby?.bots, difficulty: lobby?.difficulty }),
  onRematch: () => net.emit(MSG.REMATCH, {}),
  onCopyLink: copyLink,
  onClick: () => {
    fx.unlockAudio();
    fx.sound('click', { volume: 0.5 });
  },
});

const fx = createFx({
  world,
  ui,
  hooks: {
    animal: (id) => animals.get(id),
    myId: () => myId,
    hitStop: (ms) => (freezeUntil = performance.now() + ms),
    wasLocalDash: (id) => id === myId && performance.now() - localDashAt < 400,
    emoteBubble: (id, text, seconds) => animals.get(id)?.showEmote(text, seconds),
    vibrate: (ms) => navigator.userActivation?.hasBeenActive && navigator.vibrate?.(ms),
  },
});

let lastEmote = -Infinity;
const input = createInput({
  touchRoot: document.getElementById('touch'),
  onEmote: (n) => {
    if (!lobby || performance.now() - lastEmote < EMOTES.COOLDOWN * 1000) return;
    lastEmote = performance.now();
    net.emit(MSG.EMOTE, { n });
  },
  onDash: () => {
    const me = latest?.players.find((p) => p.id === myId);
    const a = animals.get(myId);
    if (me && a && me.st === ST.ALIVE && me.dashCd <= 0 && latest.phase !== PHASE.COUNTDOWN) {
      localDashAt = performance.now();
      fx.localDash(a); // GDD: mostrar o dash local na hora
    }
  },
});

// ---------- Estado do cliente ----------

let myId = null;
let lobby = null;
let latest = null;      // último state recebido
let screen = 'home';
let wins = {};
let quickStarted = false;
let localDashAt = -Infinity;
let freezeUntil = 0;
let frozenT = 0;
const states = [];      // buffer para interpolar
let clockOffset = null; // performance.now() - t do servidor (melhor caso)
const debugInfo = { status: '', ping: '-', tick: 0, fps: 0 };

const home = {
  nickname: localStorage.getItem('kota.nick') ?? '',
  animal: ANIMALS.includes(localStorage.getItem('kota.animal')) ? localStorage.getItem('kota.animal') : ANIMALS[Math.floor(Math.random() * ANIMALS.length)],
  code: (params.get('room') ?? '').toUpperCase(),
};

const debugSuffix = () => (SHOW_DEBUG ? '&debug=1' : '');

function join(mode, { nickname, animal, code }) {
  if (!nickname) return ui.needName();
  localStorage.setItem('kota.nick', nickname);
  localStorage.setItem('kota.animal', animal);
  Object.assign(home, { nickname, animal });
  net.use(mode);
  const send = () => {
    myId = net.id; // o lobby pode chegar antes da resposta do join
    net.emit(MSG.JOIN, { code, nickname, animal, debug: DEBUG_OPTS }, (res) => {
      if (!res?.ok) {
        myId = null;
        net.leave();
        return ui.error(STR.errors[res?.error] ?? STR.errors.notFound);
      }
      myId = res.playerId;
      if (mode === 'online') history.replaceState(null, '', `?room=${res.code}${debugSuffix()}`);
    });
  };
  // Online: espera o socket conectar para já saber o próprio id
  if (mode === 'online' && !net.id) waitOnline(send);
  else send();
}

function waitOnline(fn) {
  const check = (status) => {
    if (status !== 'online') return;
    netHandlers.status = netHandlers.status.filter((f) => f !== check);
    fn();
  };
  net.on('status', check);
}

function leaveToMenu() {
  net.leave();
  myId = null;
  lobby = null;
  latest = null;
  home.code = '';
  history.replaceState(null, '', `${location.pathname}${SHOW_DEBUG ? '?debug=1' : ''}`);
  showHome();
}

function inviteUrl() {
  return `${location.origin}${location.pathname}?room=${lobby?.code ?? ''}`;
}

function copyLink() {
  const url = inviteUrl();
  // No celular, abre o menu de compartilhar do sistema (WhatsApp etc.)
  if (IS_MOBILE && navigator.share) {
    navigator.share({ title: STR.title, text: STR.inviteText, url }).catch(() => {});
    return;
  }
  navigator.clipboard?.writeText(url).then(ui.linkCopied, () => ui.toast(url));
}

// ---------- Bichos na cena ----------

function labelHtml(p) {
  const badge = p.bot ? `<span class="badge">${STR.botBadge}</span>` : '';
  const king = lobby && p.id === lobby.kingId && p.kingStreak > 1 ? `<span class="streak">${STR.kingStreak(p.kingStreak)}</span>` : '';
  const name = String(displayName(p)).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<span class="tag" style="--c:${colorOf(p)}">${name}${badge}${king}</span>`;
}

function syncRoster() {
  const ids = new Set(lobby.players.map((p) => p.id));
  for (const [id, a] of animals) {
    if (!ids.has(id) || a.type !== lobby.players.find((p) => p.id === id).animal) {
      a.dispose();
      animals.delete(id);
    }
  }
  for (const p of lobby.players) {
    let a = animals.get(p.id);
    if (!a) {
      a = createAnimal(p.animal, colorOf(p), { crownModel: crownModel?.clone(), debug: SHOW_DEBUG });
      animals.set(p.id, a);
      world.scene.add(a.root);
    }
    a.setLabel(labelHtml(p));
    a.setCrown(p.id === lobby.kingId);
  }
  clearPreview();
}

// Lobby: todos em semicírculo, virados para a câmera
function arrangeLobby() {
  const list = lobby.players;
  list.forEach((p, i) => {
    const a = animals.get(p.id);
    if (!a) return;
    const spread = Math.min(1.2, 0.35 * (list.length - 1));
    const t = list.length === 1 ? 0 : (i / (list.length - 1) - 0.5) * 2 * spread;
    a.resetPose();
    a.onState(ST.ALIVE);
    a.apply({ x: Math.sin(t) * 3.2, z: -Math.cos(t) * 3.2 + 3.2, dir: 0, vx: 0, vz: 0, st: ST.ALIVE, dashCd: 0, pu: null }, 0);
  });
}

// Home: o bicho escolhido sozinho no meio, tocando idle
let preview = null;
function showPreview() {
  clearPreview();
  preview = createAnimal(home.animal, PLAYER_COLORS[0], {});
  preview.setLabel(previewLabel());
  world.scene.add(preview.root);
}
function previewLabel() {
  const name = (home.nickname || '').trim();
  if (!name) return `<span class="tag empty">${STR.namePlaceholder}</span>`;
  const safe = name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<span class="tag" style="--c:${PLAYER_COLORS[0]}">${safe}</span>`;
}
function clearPreview() {
  preview?.dispose();
  preview = null;
}

// ---------- Mensagens do servidor ----------

net.on('status', (status) => {
  debugInfo.status = STR.debug[status] ?? status;
  if (status === 'offline' && myId) ui.toast(STR.errors.disconnected);
  if (status === 'online' && myId && net.id !== myId) {
    // A conexão caiu e voltou com outro id: volta para o menu com o código da sala.
    home.code = lobby?.code ?? home.code;
    myId = null;
    lobby = null;
    net.leave();
    showHome();
  }
});

net.on(MSG.LOBBY, (data) => {
  lobby = data;
  syncRoster();
  ui.scores(lobby, wins);
  if (data.phase === PHASE.LOBBY) {
    if (screen !== 'lobby') enterLobby();
    ui.showLobby(lobby, myId, net.mode);
    arrangeLobby();
    if (QUICK_BOTS !== null && !quickStarted && data.hostId === myId) {
      quickStarted = true;
      net.emit(MSG.START, { bots: QUICK_BOTS, difficulty: QUICK_DIFFICULTY ?? lobby.difficulty });
    }
  } else if (screen === 'home' || screen === 'lobby') {
    // Entrou com a partida rolando: assiste
    screen = 'game';
    ui.showGame();
    world.setScenario(data.scenario ?? 'sky');
  }
});

function enterLobby() {
  screen = 'lobby';
  document.body.classList.remove('in-game');
  wins = {};
  input.setEnabled(false);
  world.setScenario('sky');
  fx.setAmbient(null);
  world.resetArena();
  world.setSoap(false);
  world.focusOn(0, 4.5, 0.5, 0.6);
  clearBoxes();
  fx.playMusic('lobby');
}

net.on(MSG.ROUND, ({ round, scenario }) => {
  if (lobby) Object.assign(lobby, { round, scenario });
  screen = 'game';
  states.length = 0;
  clockOffset = null;
  predict.me = null;
  predict.history.length = 0;
  selfView.source = null;
  world.setScenario(scenario);
  fx.setAmbient(SCENARIOS[scenario]?.particles ?? null);
  world.resetArena();
  world.setSoap(false);
  world.focusOn(0, 0, 1, 0.4);
  clearBoxes();
  for (const a of animals.values()) a.resetPose();
  ui.hideScoreboard();
  ui.showGame();
  ui.scores(lobby, wins);
  input.setEnabled(true);
  document.body.classList.add('in-game');
  fx.playMusic('match');
});

// Atraso de interpolação adaptativo: mede o quanto os states chegam atrasados em
// relação ao melhor caso e desenha os outros bichos atrás o suficiente para nunca faltar state.
let interpDelay = NET.INTERP_DELAY_MS;
const lateness = [];
function adaptDelay(late) {
  if (net.mode !== 'online') return; // sem rede no Single Player: fica nos 100 ms
  lateness.push(late);
  if (lateness.length > 90) lateness.shift();
  const sorted = [...lateness].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const target = Math.min(NET.MAX_INTERP_DELAY_MS, Math.max(NET.INTERP_DELAY_MS, p90 + 1000 / NET.TICK_RATE));
  // sobe rápido (para não travar) e desce devagar (para não oscilar)
  interpDelay += (target - interpDelay) * (target > interpDelay ? 0.2 : 0.02);
}

net.on(MSG.STATE, (s) => {
  const now = performance.now();
  const sample = now - s.t;
  clockOffset = clockOffset === null ? sample : Math.min(sample, clockOffset + 0.5);
  adaptDelay(sample - clockOffset);
  s.byId = Object.fromEntries(s.players.map((p) => [p.id, p]));
  states.push(s);
  if (states.length > 90) states.shift();
  latest = s;
  debugInfo.tick = s.tick;
  reconcile(s);
});

net.on(MSG.EVENT, (ev) => {
  // Os efeitos saem no mesmo atraso da imagem interpolada (os do próprio dash já saíram na hora)
  setTimeout(() => fx.handle(ev), interpDelay);
});

// ---------- Previsão do próprio bicho ----------
// O navegador roda a mesma física do servidor para o seu bicho, sem esperar a rede.
// Quando chega um state, volta para a posição do servidor e reaplica os inputs que ele
// ainda não processou. A diferença que sobra é diluída em poucos frames.

const PREDICTABLE = new Set([ST.ALIVE, ST.DASHING, ST.STUNNED]);
const predict = { me: null, prev: null, history: [], stepAt: 0 };
const selfView = { x: 0, z: 0, errX: 0, errZ: 0, source: null };

function predictionAllowed(s) {
  if (net.mode !== 'online' || DEBUG_OPTS.slowmo || params.get('predict') === '0') return false;
  const me = s?.byId?.[myId];
  return !!me && PREDICTABLE.has(me.st) && (s.phase === PHASE.PLAYING || s.phase === PHASE.SUDDEN_DEATH);
}

function predictionFriction() {
  if (latest?.arena.soap) return POWERUPS.TYPES.soap.friction;
  return SCENARIOS[lobby?.scenario]?.physics.FRICTION ?? PHYSICS.FRICTION;
}

function stepPredicted(inp) {
  const pm = predict.me;
  pm.inputX = inp.x;
  pm.inputZ = inp.z;
  if (inp.dash) pm.dashBuffer = PHYSICS.DASH_BUFFER;
  movePlayer(pm, NET.TICK_DT, { control: true, friction: predictionFriction() });
  // ?nofall=1: o servidor segura na borda; a previsão faz o mesmo
  const r = Math.hypot(pm.x, pm.z);
  const radius = latest?.arena.radius ?? Infinity;
  if (DEBUG_OPTS.nofall && r > radius) {
    pm.x *= radius / r;
    pm.z *= radius / r;
  }
}

function reconcile(s) {
  if (!predictionAllowed(s)) {
    predict.me = null;
    predict.history.length = 0;
    return;
  }
  const me = s.byId[myId];
  predict.history = predict.history.filter((h) => h.seq > (me.seq ?? 0));
  predict.me = {
    x: me.x, z: me.z, vx: me.vx, vz: me.vz, dir: me.dir,
    st: me.st, stT: me.stT ?? 0,
    dashCdMax: me.dashCdMax || PHYSICS.DASH_COOLDOWN,
    dashCd: (me.dashCd ?? 0) * (me.dashCdMax || PHYSICS.DASH_COOLDOWN),
    dashBuffer: 0, pu: me.pu, puT: me.puT ?? 0, inputX: 0, inputZ: 0,
  };
  for (const h of predict.history) stepPredicted(h);
  predict.prev = { x: predict.me.x, z: predict.me.z };
  // A correção do servidor não pula na tela: vira um erro que some em poucos frames
  if (selfView.source === 'predicted') {
    selfView.errX = selfView.x - predict.me.x;
    selfView.errZ = selfView.z - predict.me.z;
  }
}

// Posição do próprio bicho na tela: prevista (presente) ou interpolada (passado),
// sem pulo na troca entre as duas
function selfPose(p, now, dt) {
  let src = p;
  let source = 'server';
  if (predict.me) {
    const k = Math.min(1, (now - predict.stepAt) / (1000 / NET.INPUT_RATE));
    const pm = predict.me;
    const prev = predict.prev ?? pm;
    src = {
      ...p,
      x: prev.x + (pm.x - prev.x) * k,
      z: prev.z + (pm.z - prev.z) * k,
      vx: pm.vx, vz: pm.vz, dir: pm.dir, st: pm.st,
      dashCd: pm.dashCdMax ? pm.dashCd / pm.dashCdMax : 0,
    };
    source = 'predicted';
  }
  if (selfView.source && selfView.source !== source) {
    selfView.errX = selfView.x - src.x;
    selfView.errZ = selfView.z - src.z;
  }
  selfView.source = source;
  const decay = Math.exp(-NET.SELF_ERROR_DECAY * dt);
  selfView.errX *= decay;
  selfView.errZ *= decay;
  if (Math.hypot(selfView.errX, selfView.errZ) > NET.SELF_SNAP_DISTANCE) selfView.errX = selfView.errZ = 0;
  selfView.x = src.x + selfView.errX;
  selfView.z = src.z + selfView.errZ;
  return { ...src, x: selfView.x, z: selfView.z };
}

net.on(MSG.SCORE, (score) => {
  wins = score.wins ?? wins;
  if (score.kind === 'round') {
    ui.scoreboard(score, lobby, MATCH.ROUND_END_SLOWMO * 1000 + NET.INTERP_DELAY_MS);
    setTimeout(() => ui.scores(lobby, wins), NET.INTERP_DELAY_MS);
    return;
  }
  // Pódio
  setTimeout(() => {
    screen = 'podium';
    document.body.classList.remove('in-game');
    input.setEnabled(false);
    ui.hideScoreboard();
    ui.podium(score, lobby);
    clearBoxes();
    world.resetArena();
    world.setSoap(false);
    for (const [id, a] of animals) {
      a.resetPose();
      a.root.visible = id === score.champion;
    }
    const champ = animals.get(score.champion);
    if (champ) {
      champ.onState(ST.ALIVE);
      champ.apply({ x: 0, z: 0, dir: 0, vx: 0, vz: 0, st: ST.ALIVE, dashCd: 0, pu: null }, 0);
      champ.crown.visible = false;
      champ.setCrown(true);
      champ.celebrate(true);
    }
    world.focusOn(0, 0.5, 0.35, 0.8);
  }, NET.INTERP_DELAY_MS);
});

// ---------- Input: 30 por segundo ----------

let seq = 0;
let lastPing = 0;
setInterval(() => {
  if (!myId || !latest || !IN_MATCH.has(latest.phase) || screen !== 'game') return;
  const data = { ...input.read(), seq: ++seq };
  const now = performance.now();
  if (predict.me) {
    predict.prev = { x: predict.me.x, z: predict.me.z };
    predict.history.push(data);
    stepPredicted(data);
    predict.stepAt = now;
  }
  if (now - lastPing > NET.PING_INTERVAL_MS) {
    lastPing = now;
    net.emit(MSG.INPUT, data, () => (debugInfo.ping = Math.round(performance.now() - now)));
  } else {
    net.emit(MSG.INPUT, data);
  }
}, 1000 / NET.INPUT_RATE);

// ---------- Power-ups na arena ----------

function letterTexture(letter, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#1d1b2f';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 118, 118);
  g.fillStyle = '#ffffff';
  g.font = '700 84px Fredoka, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeText(letter, 64, 70);
  g.fillText(letter, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const BOX_COLORS = { coffee: '#8d5a3b', bomb: '#e63946', heavy: '#4361ee', soap: '#4cc9f0' };
const boxMaterials = {};
function boxMesh(type) {
  boxMaterials[type] ||= new THREE.MeshStandardMaterial({ map: letterTexture(POWERUPS.ICON_LETTER[type], BOX_COLORS[type]) });
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), boxMaterials[type]);
  m.castShadow = true;
  return m;
}

function syncBoxes(list) {
  const seen = new Set();
  for (const b of list) {
    seen.add(b.pid);
    if (boxes.has(b.pid)) continue;
    const m = boxMesh(b.type);
    m.position.set(b.x, 9, b.z);
    world.scene.add(m);
    gsap.to(m.position, { y: 0.55, duration: 0.9, ease: 'bounce.out' }); // cai do céu e quica
    boxes.set(b.pid, m);
  }
  for (const [pid, m] of boxes) {
    if (seen.has(pid)) continue;
    gsap.to(m.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.15, onComplete: () => m.removeFromParent() });
    boxes.delete(pid);
  }
}

function clearBoxes() {
  for (const m of boxes.values()) m.removeFromParent();
  boxes.clear();
}

// ---------- Interpolação ----------

const lerp = (a, b, k) => a + (b - a) * k;
function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function sampleState(renderT) {
  while (states.length > 2 && states[1].t <= renderT) states.shift();
  const a = states[0];
  const b = states[1];
  if (!a) return null;
  if (!b || renderT <= a.t) return a;
  const k = Math.min(1, (renderT - a.t) / (b.t - a.t));
  return {
    ...b,
    arena: { ...b.arena, radius: lerp(a.arena.radius, b.arena.radius, k) },
    players: b.players.map((pb) => {
      const pa = a.byId[pb.id];
      if (!pa || pa.st === ST.OUT) return pb;
      return { ...pb, x: lerp(pa.x, pb.x, k), z: lerp(pa.z, pb.z, k), dir: lerpAngle(pa.dir, pb.dir, k) };
    }),
  };
}

// ---------- Loop de desenho ----------

const debugEl = document.getElementById('debug');
debugEl.hidden = !SHOW_DEBUG;
// ?debug=1: deixa o estado à mão no console (e para testes automatizados)
if (SHOW_DEBUG) {
  window.kota = {
    state: () => latest,
    lobby: () => lobby,
    me: () => myId,
    screen: () => screen,
    delay: () => interpDelay,
    transport: () => net.transport,
    render: () => ({ ...world.renderer.info.render }),
    predict: () => ({ me: predict.me && { x: predict.me.x, z: predict.me.z, st: predict.me.st }, hist: predict.history.length, view: { ...selfView } }),
    view: () => Object.fromEntries([...animals].map(([id, a]) => [id, [a.root.position.x, a.root.position.z]])),
  };
}
let frames = 0;
let fpsT = 0;

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const frozen = now < freezeUntil;
  const animDt = frozen ? 0 : dt;

  if (screen === 'game' && clockOffset !== null) {
    // Faltou state para desenhar (a rede engasgou): aumenta o atraso um pouco
    const newest = states[states.length - 1];
    if (net.mode === 'online' && newest && now - clockOffset - interpDelay > newest.t + 1000 / NET.TICK_RATE) {
      interpDelay = Math.min(NET.MAX_INTERP_DELAY_MS, interpDelay + 10);
    }
    let renderT = now - clockOffset - interpDelay;
    if (frozen) renderT = frozenT;
    else frozenT = renderT;
    const s = sampleState(renderT);
    if (s) {
      world.setArenaRadius(s.arena.radius);
      world.syncArena(s.arena.radius);
      world.setSoap(s.arena.soap);
      syncBoxes(s.powerups);
      const present = new Set();
      for (const sp of s.players) {
        const a = animals.get(sp.id);
        if (!a) continue;
        present.add(sp.id);
        const p = sp.id === myId && sp.st !== ST.OUT ? selfPose(sp, now, dt) : sp;
        a.apply(p, animDt);
        if (a.pu !== p.pu) {
          a.pu = p.pu;
          if (p.pu) a.showIcon(STR.powerupIcons[p.pu]);
          else a.hideIcon();
        }
      }
      for (const [id, a] of animals) if (!present.has(id)) a.root.visible = false;
      if (latest) ui.hud(latest, lobby, myId);
    }
  } else {
    for (const a of animals.values()) a.mixer?.update(dt);
    // Menu: o bicho fica ao lado do painel (em pé, de frente, com o nome em cima)
    const wide = innerWidth > innerHeight * 1.1;
    preview?.apply({ x: wide ? -1.3 : 0, z: wide ? 0.4 : -2.4, dir: Math.sin(now / 1500) * 0.5, vx: 0, vz: 0, st: ST.ALIVE, dashCd: 0, pu: null }, dt);
  }

  for (const m of boxes.values()) m.rotation.y += dt * 1.8;
  fx.update(animDt);
  world.render(animDt || dt * 0.0001);
  labels.render(world.scene, world.camera);

  frames += 1;
  fpsT += dt;
  if (fpsT >= 0.5) {
    debugInfo.fps = Math.round(frames / fpsT);
    frames = 0;
    fpsT = 0;
    if (SHOW_DEBUG) {
      debugEl.textContent = `${debugInfo.status}\nfps ${debugInfo.fps} · ping ${debugInfo.ping} ms · tick ${debugInfo.tick}\n${net.transport} · phase ${latest?.phase ?? screen} · delay ${Math.round(interpDelay)} ms${predict.me ? ' · predicting' : ''}`;
    }
  }
}

// ---------- Início ----------

function showHome() {
  screen = 'home';
  document.body.classList.remove('in-game');
  input.setEnabled(false);
  for (const a of animals.values()) a.dispose();
  animals.clear();
  world.setScenario('sky');
  world.focusOn(0, 0, 0.24, 0);
  fx.setAmbient(null);
  world.resetArena();
  clearBoxes();
  ui.showHome(home);
  showPreview();
  fx.playMusic('lobby');
}

async function boot() {
  // Tela de carregamento: barra com o progresso real dos modelos, texturas e sons
  const loading = createLoading();
  const progress = { three: [0, 0], audio: [0, 0] };
  const update = () => {
    const done = progress.three[0] + progress.audio[0];
    const total = progress.three[1] + progress.audio[1];
    loading.setProgress(total ? done / total : 0);
  };
  THREE.DefaultLoadingManager.onProgress = (_, loaded, total) => {
    progress.three = [loaded, total];
    update();
  };
  const shownAt = performance.now();

  try {
    manifest = await (await fetch('/assets.json')).json();
  } catch {
    manifest = {};
  }
  const assets = Promise.all([
    loadAnimalModels(manifest.animals),
    world.loadProps(manifest.props),
    fx.load(manifest, (loaded, total) => {
      progress.audio = [loaded, total];
      update();
    }),
    document.fonts?.ready,
  ]);
  // Se algum arquivo travar, o jogo abre mesmo assim (com placeholders)
  await Promise.race([assets, new Promise((r) => setTimeout(r, 15000))]);
  if (manifest.props?.crown) crownModel = world.propModel('crown');
  document.body.classList.toggle('mobile', IS_MOBILE);

  loading.setProgress(1);
  await new Promise((r) => setTimeout(r, Math.max(0, 700 - (performance.now() - shownAt))));
  requestAnimationFrame(frame);
  showHome();
  loading.done();
  addEventListener('pointerdown', () => {
    fx.unlockAudio();
    if (screen === 'home' || screen === 'lobby') fx.playMusic('lobby');
  }, { once: true });

  // Atalhos: ?bots=7&difficulty=hard pula menu e lobby; ?offline=1 joga sozinho
  if (QUICK_BOTS !== null) {
    join(OFFLINE ? 'solo' : 'online', {
      nickname: home.nickname || `${STR.defaultNickname}${Math.floor(100 + Math.random() * 900)}`,
      animal: home.animal,
      code: home.code || null,
    });
  }
}

boot();
