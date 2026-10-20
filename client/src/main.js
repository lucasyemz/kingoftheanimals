// Conexão e estados de tela (home, lobby, jogo, placar, pódio).
// O cliente só manda input e desenha o state, 100 ms atrás, interpolando.

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import gsap from 'gsap';
import { io } from 'socket.io-client';
import { NET, ANIMALS, MATCH, SCENARIOS, EMOTES, POWERUPS, PLAYER_COLORS, PHYSICS, HILL, HEX, COINS, CHARGE } from '../../shared/constants.js';
import { MSG, PHASE, PLAYER_STATE as ST, EVENT } from '../../shared/messages.js';
import { Game, movePlayer } from '../../server/game.js';
import { STR } from './strings.js';
import { createWorld, IS_MOBILE } from './scene.js';
import { createAnimal, loadAnimalModels } from './animals.js';
import { createFx } from './fx.js';
import { createInput } from './input.js';
import { createUI, createLoading, displayName, colorOf } from './ui.js';
import { createRules } from './rules.js';
import { createMinigamesView } from './minigames-view.js';
import { settings, saveSettings, addStats, wallet, addCoins, stats, XP, addXp, levelOf, trackMission } from './settings.js';

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
    // Single Player: a pausa congela a simulação
    pause(on) {
      clearInterval(timer);
      timer = null;
      if (!on && game) timer = setInterval(() => game.tick(), 1000 / NET.TICK_RATE);
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
  pause(on) {
    this.backend?.pause?.(on);
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
const rules = createRules(world);
const mgView = createMinigamesView(world);
const labels = new CSS2DRenderer({ element: document.getElementById('labels') });
const resizeLabels = () => labels.setSize(innerWidth, innerHeight);
addEventListener('resize', resizeLabels);
resizeLabels();

let manifest = {};
const animals = new Map(); // id → Animal
const boxes = new Map();   // pid → mesh
let crownModel = null;

const ui = createUI({
  // Primeira vez no Single Player: passa antes pelo tutorial
  onSolo: (d) => (settings.tutorialDone ? join('solo', { ...d, code: null }) : startTutorial(d, 'solo')),
  onMulti: (d) => join('online', { ...d, code: null }),
  onQuick: (d) => join('online', { ...d, code: null, quick: true }),
  onJoin: (d) => join('online', d),
  onTutorial: (d) => startTutorial(d, 'menu'),
  onTutorialSkip: () => finishTutorial(),
  onWhatsApp: shareWhatsApp,
  onVolume: (sample) => {
    fx.applyVolume();
    if (sample) fx.sound('ding', { volume: 0.8 });
  },
  onFullscreen: toggleFullscreen,
  onHat: (id) => preview?.setHat(id),
  onAnimal: (a) => {
    home.animal = a;
    showPreview();
  },
  onName: (name) => {
    home.nickname = name;
    preview?.setLabel(previewLabel());
  },
  onLeave: () => leaveToMenu(),
  onPause: (on) => setPaused(on),
  onRestart: () => restartSolo(),
  onSettings: (d) => net.emit(MSG.SETTINGS, { bots: lobby?.bots, difficulty: lobby?.difficulty, mode: lobby?.mode, ...d }),
  onStart: () => net.emit(MSG.START, { bots: lobby?.bots, difficulty: lobby?.difficulty, mode: lobby?.mode }),
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
    fallZoom: (x, z) => {
      world.focusOn(x, z, 0.62, 0.25);
      setTimeout(() => {
        if (latest && (latest.phase === PHASE.PLAYING || latest.phase === PHASE.SUDDEN_DEATH)) world.focusOn(0, 0, 1, 0.6);
      }, 1100);
    },
    player: (id) => lobby?.players.find((p) => p.id === id),
    color: (id) => colorOf(lobby?.players.find((p) => p.id === id)),
    hitStop: (ms) => (freezeUntil = performance.now() + ms),
    wasLocalDash: (id) => id === myId && performance.now() - localDashAt < 400,
    wasLocalJump: (id) => id === myId && performance.now() - localJumpAt < 400,
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
      if (tutorial.active && tutorial.jumped) tutorial.dashed = true;
    }
  },
  onMenu: () => {
    if (ui.settingsOpen && paused) return ui.closeSettings(); // Esc fecha primeiro as configurações
    setPaused(!paused);
  },
  onJump: () => {
    const me = latest?.players.find((p) => p.id === myId);
    const a = animals.get(myId);
    if (me && a && me.st === ST.ALIVE && !(me.y > 0) && latest.phase !== PHASE.COUNTDOWN) {
      localJumpAt = performance.now();
      fx.localJump();
      if (tutorial.active && tutorial.moved > 0.6) tutorial.jumped = true;
      track('jumps');
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
let localJumpAt = -Infinity;
let matchCoins = 0;
let lastFall = null;
let replay = null;
let replayEndsAt = 0;
const replayBuf = [];   // últimos ~5 s de states, para o replay
// Replay: 1,5 s antes da última queda até 0,9 s depois, a 55 % da velocidade
const REPLAY = { BEFORE: 1500, AFTER: 900, SPEED: 0.55, DELAY: 450 };

// Moedas + XP da partida (e o resumo que aparece no pódio)
const summary = { coins: 0, xp: 0, kos: 0, roundWins: 0, rounds: 0, levelUp: false, startLevel: 1 };
function resetSummary() {
  Object.assign(summary, { coins: 0, xp: 0, kos: 0, roundWins: 0, rounds: 0, levelUp: false, startLevel: levelOf(stats.xp ?? 0).level });
}
function earn(n, xp = 0) {
  if (tutorial.active) return;
  if (n) {
    matchCoins += n;
    summary.coins += n;
    addCoins(n);
  }
  if (xp) {
    summary.xp += xp;
    if (addXp(xp)) {
      summary.levelUp = true;
      ui.toast(STR.levelUp(levelOf(stats.xp).level));
    }
  }
}
// Missões diárias: conta o evento e paga quem acabou de cumprir
function track(stat, n = 1) {
  if (tutorial.active) return;
  for (const m of trackMission(stat, n)) {
    earn(m.reward, XP.MISSION);
    setTimeout(() => ui.toast(STR.missionDone(STR.missions[m.id], m.reward)), 600);
  }
}
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

// Vaga na partida online, para voltar se a conexão cair ou a página recarregar
const SESSION_KEY = 'kota.session';
const session = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    } catch {
      return null;
    }
  },
  set(v) {
    if (v) sessionStorage.setItem(SESSION_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(SESSION_KEY);
  },
};

function join(mode, { nickname, animal, code, quick = false, rejoin = null, tutorial: isTutorial = false }) {
  if (!nickname) return ui.needName();
  localStorage.setItem('kota.nick', nickname);
  localStorage.setItem('kota.animal', animal);
  Object.assign(home, { nickname, animal });
  net.use(mode);
  const send = () => {
    myId = net.id; // o lobby pode chegar antes da resposta do join
    const debug = isTutorial ? { ...DEBUG_OPTS, tutorial: true } : DEBUG_OPTS;
    net.emit(MSG.JOIN, { code, nickname, animal, hat: wallet.hat, level: levelOf(stats.xp ?? 0).level, debug, quick, rejoin }, (res) => {
      if (!res?.ok) {
        myId = null;
        net.leave();
        session.set(null);
        if (tutorial.active) tutorial.active = false;
        return ui.error(STR.errors[res?.error] ?? STR.errors.notFound);
      }
      myId = res.playerId;
      if (mode === 'online') {
        history.replaceState(null, '', `?room=${res.code}${debugSuffix()}`);
        session.set({ code: res.code, token: res.token });
        if (res.rejoined) ui.toast(STR.errors.reconnected);
      }
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

// ---------- Pausa ----------
// Esc / ❚❚ / Start. No Single Player a partida congela; online ela continua (só o menu abre).

let paused = false;
function setPaused(on) {
  if (on && (screen !== 'game' || !myId)) return;
  if (on === paused) return;
  paused = on;
  if (net.mode === 'solo') {
    net.pause(on);
    // na volta, o relógio da partida ficou parado: ressincroniza a interpolação e a previsão
    if (!on) {
      states.length = 0;
      clockOffset = null;
      predict.me = null;
      predict.history.length = 0;
    }
  }
  input.setEnabled(!on && screen === 'game');
  document.body.classList.toggle('paused', on);
  if (on) ui.showPause(tutorial.active ? 'tutorial' : net.mode === 'solo' ? 'solo' : 'online');
  else ui.hidePause();
}

function closePause() {
  if (!paused) return;
  paused = false;
  document.body.classList.remove('paused');
  ui.hidePause();
}

// Recomeçar: volta para o lobby do Single Player (ou pula o tutorial)
function restartSolo() {
  closePause();
  if (tutorial.active) return finishTutorial();
  net.leave();
  myId = null;
  lobby = null;
  latest = null;
  join('solo', { nickname: home.nickname, animal: home.animal, code: null });
}

function leaveToMenu() {
  closePause();
  session.set(null);
  tutorial.active = false;
  ui.tutorialStep(null);
  document.body.classList.remove('tutorial');
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

function shareWhatsApp() {
  const text = STR.inviteMessage(lobby?.code ?? '', inviteUrl());
  open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen?.();
  document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
}

// M: liga e desliga o som em qualquer tela
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || e.repeat || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  saveSettings({ muted: !settings.muted });
  fx.applyVolume();
  ui.toast(settings.muted ? '🔇' : '🔊');
});

// ---------- Tutorial ----------
// Uma partida local com um boneco parado: andar, dar dash e empurrar o boneco para fora.

const tutorial = { active: false, then: 'menu', moved: 0, dashed: false, done: false };

function startTutorial(d, then) {
  if (!d.nickname) return ui.needName();
  Object.assign(tutorial, { active: true, then, moved: 0, jumped: false, dashed: false, done: false, started: false });
  document.body.classList.add('tutorial');
  join('solo', { ...d, code: null, tutorial: true });
}

function finishTutorial() {
  if (!tutorial.active) return;
  saveSettings({ tutorialDone: true });
  tutorial.active = false;
  ui.tutorialStep(null);
  document.body.classList.remove('tutorial');
  net.leave();
  myId = null;
  lobby = null;
  latest = null;
  if (tutorial.then === 'solo') join('solo', { nickname: home.nickname, animal: home.animal, code: null });
  else showHome();
}

function tutorialFrame(dt) {
  if (!tutorial.active || !latest) return;
  const me = latest.byId?.[myId];
  if (me && (latest.phase === PHASE.PLAYING) && Math.hypot(me.vx, me.vz) > 2) tutorial.moved += dt;
  let text = STR.tutorial.move;
  if (tutorial.done) text = STR.tutorial.done;
  else if (tutorial.dashed) text = STR.tutorial.push;
  else if (tutorial.jumped) text = STR.tutorial.dash;
  else if (tutorial.moved > 0.6) text = STR.tutorial.jump;
  if (latest.phase === PHASE.COUNTDOWN) text = STR.tutorial.title;
  ui.tutorialStep(text);
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
  const name = String(tutorial.active && p.bot ? STR.tutorial.dummy : displayName(p)).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
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
      a.onLand = (x, z, y) => fx.landDust(x, z, y);
      a.onChargeFull = () => p.id === myId && fx.chargeFull();
      animals.set(p.id, a);
      world.scene.add(a.root);
    }
    a.setLabel(labelHtml(p));
    a.setHat(p.hat ?? 'none');
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
  preview.setHat(wallet.hat);
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
  if (status === 'online' && myId && net.id !== myId && net.mode === 'online') {
    // A conexão caiu e voltou: tenta pegar o bicho de volta na mesma sala
    const sess = session.get();
    if (sess?.token && lobby?.code === sess.code) {
      states.length = 0;
      clockOffset = null;
      predict.me = null;
      predict.history.length = 0;
      net.emit(MSG.JOIN, { code: sess.code, nickname: home.nickname, animal: home.animal, rejoin: sess.token }, (res) => {
        if (res?.ok) {
          myId = res.playerId;
          session.set({ code: res.code, token: res.token });
          ui.toast(res.rejoined ? STR.errors.reconnected : STR.spectating);
          return;
        }
        session.set(null);
        home.code = sess.code;
        myId = null;
        lobby = null;
        net.leave();
        showHome();
      });
      return;
    }
    // Sem como voltar: menu com o código da sala.
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
    if (tutorial.active) {
      // Tutorial: começa direto, sem mostrar o lobby
      if (data.hostId === myId && !tutorial.started) {
        tutorial.started = true;
        net.emit(MSG.START, { bots: 1 });
      }
      return;
    }
    if (screen !== 'lobby') enterLobby();
    ui.showLobby(lobby, myId, net.mode);
    arrangeLobby();
    if (QUICK_BOTS !== null && !quickStarted && data.hostId === myId) {
      quickStarted = true;
      net.emit(MSG.START, { bots: QUICK_BOTS, difficulty: QUICK_DIFFICULTY ?? lobby.difficulty, mode: params.get('mode') ?? undefined });
    }
  } else if (screen === 'home' || screen === 'lobby') {
    // Entrou com a partida rolando: assiste
    screen = 'game';
    ui.showGame();
    world.setScenario(data.scenario ?? 'sky');
  }
});

function enterLobby() {
  closePause();
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

net.on(MSG.ROUND, ({ round, scenario, mode, format, final, qualify }) => {
  if (lobby) Object.assign(lobby, { round, scenario, roundMode: mode ?? 'classic', format });
  if (round === 1) {
    matchCoins = 0;
    resetSummary();
  }
  rules.reset();
  mgView.reset();
  replay = null;
  ui.replay(false);
  if (!tutorial.active) setTimeout(() => ui.roundIntro(mode ?? 'classic', { final, qualify }), 250);
  ui.objective(null);
  ui.hill(null);
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
  ui.clearFeed();
  ui.showGame();
  ui.scores(lobby, wins);
  input.setEnabled(!paused);
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
  replayBuf.push(s);
  if (replayBuf.length > 150) replayBuf.shift();
  latest = s;
  debugInfo.tick = s.tick;
  reconcile(s);
});

net.on(MSG.EVENT, (ev) => {
  if (ev.type === EVENT.TUTORIAL && tutorial.active) {
    tutorial.done = true;
    setTimeout(finishTutorial, 2200);
  }
  if (ev.type === EVENT.FALL && !tutorial.active && myId && latest && latest.phase !== PHASE.ROUND_END) {
    if (ev.by === myId) {
      addStats({ kos: 1 });
      earn(COINS.KO, XP.KO);
      summary.kos += 1;
      track('kos');
    }
    if (ev.id === myId) addStats({ falls: 1 });
  }
  // Replay: guarda onde e quando foi a última queda; no fim da rodada, repete ela
  if (ev.type === EVENT.FALL && latest) lastFall = { t: latest.t, x: ev.x, z: ev.z };
  if (ev.type === EVENT.ROUND_END && latest && lastFall && !tutorial.active && latest.t - lastFall.t < 2500) {
    const from = lastFall.t - REPLAY.BEFORE;
    const to = lastFall.t + REPLAY.AFTER;
    const startAt = performance.now() + interpDelay + REPLAY.DELAY;
    replay = { from, to, startAt, x: lastFall.x, z: lastFall.z, started: false };
    replayEndsAt = startAt + (to - from) / REPLAY.SPEED;
  }
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
  if (inp.jump) pm.jumpBuffer = PHYSICS.JUMP_BUFFER;
  pm.charging = !!inp.charge;
  // Rajada de vento: o servidor empurra todo mundo; a previsão faz igual
  const w = latest?.arena.wind;
  if (w?.phase === 'blow' && w.a && PREDICTABLE.has(pm.st)) {
    pm.vx += w.dx * w.a * NET.TICK_DT;
    pm.vz += w.dz * w.a * NET.TICK_DT;
  }
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
    dashBuffer: 0, pu: me.pu, puT: me.puT ?? 0, inputX: 0, inputZ: 0, potato: !!me.potato,
    y: me.y ?? 0, vy: me.vy ?? 0, jumpBuffer: 0,
    chargeT: (me.charge ?? 0) * CHARGE.TIME, chargeWas: me.charge != null, charging: false,
  };
  for (const h of predict.history) stepPredicted(h);
  predict.prev = { x: predict.me.x, z: predict.me.z, y: predict.me.y };
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
      y: (prev.y ?? pm.y) + (pm.y - (prev.y ?? pm.y)) * k,
      vx: pm.vx, vz: pm.vz, dir: pm.dir, st: pm.st,
      dashCd: pm.dashCdMax ? pm.dashCd / pm.dashCdMax : 0,
      charge: pm.chargeT > 0 ? pm.chargeT / CHARGE.TIME : undefined,
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
  const playing = myId && lobby?.players.some((p) => p.id === myId && (!p.spectator || p.eliminated));
  if (playing && score.kind === 'round') {
    addStats({ rounds: 1, roundWins: score.winner === myId ? 1 : 0 });
    const won = score.winner === myId && !score.qualified;
    const qualified = !!score.qualified?.includes(myId);
    earn(COINS.ROUND + (won ? COINS.ROUND_WIN : 0) + (qualified ? COINS.QUALIFY : 0), XP.ROUND + (won ? XP.ROUND_WIN : 0) + (qualified ? XP.QUALIFY : 0));
    summary.rounds += 1;
    if (won || (score.winner === myId && score.qualified)) {
      summary.roundWins += 1;
      track('roundWins');
      track(`win:${score.mode ?? lobby?.roundMode}`);
    }
    if (qualified) track('qualify');
  }
  if (playing && score.kind === 'match') {
    earn(COINS.MATCH + (score.champion === myId ? COINS.MATCH_WIN : 0), XP.MATCH + (score.champion === myId ? XP.MATCH_WIN : 0));
    track('matches');
    if (lobby?.mode === 'party') track('party');
  }
  if (playing && score.kind === 'match') {
    addStats({ matches: 1, matchWins: score.champion === myId ? 1 : 0 });
  }
  if (score.kind === 'round') {
    const replayLeft = replay ? replayEndsAt - performance.now() + 150 : 0;
    ui.scoreboard(score, lobby, Math.max(MATCH.ROUND_END_SLOWMO * 1000 + NET.INTERP_DELAY_MS, replayLeft));
    setTimeout(() => ui.scores(lobby, wins), NET.INTERP_DELAY_MS);
    return;
  }
  // Pódio
  setTimeout(() => {
    ui.matchSummary({ ...summary, ...levelOf(stats.xp ?? 0) });
    closePause();
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
  if (paused && net.mode === 'solo') return; // simulação congelada: não prevê nem envia
  const data = { ...input.read(), seq: ++seq };
  const now = performance.now();
  if (predict.me) {
    predict.prev = { x: predict.me.x, z: predict.me.z, y: predict.me.y };
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
  if (letter === '+') {
    // Kit de vida: cruz branca grossa, com contorno, legível de longe
    const cross = () => {
      g.beginPath();
      g.rect(48, 20, 32, 88);
      g.rect(20, 48, 88, 32);
    };
    g.lineWidth = 8;
    cross();
    g.stroke();
    g.fillRect(48, 20, 32, 88);
    g.fillRect(20, 48, 88, 32);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
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

const BOX_COLORS = { coffee: '#8d5a3b', bomb: '#e63946', heavy: '#4361ee', soap: '#4cc9f0', heal: '#2a9d5c' };
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
  return blend(states[0], states[1], renderT);
}

// Replay: procura no buffer sem descartar nada
function sampleAt(buf, t) {
  let i = 0;
  while (i < buf.length - 2 && buf[i + 1].t <= t) i++;
  return blend(buf[i], buf[i + 1], t);
}

function blend(a, b, renderT) {
  if (!a) return null;
  if (!b || renderT <= a.t) return a;
  const k = Math.min(1, (renderT - a.t) / (b.t - a.t));
  // Altura absoluta (Chão que some: y é relativa ao andar), para cair de um andar
  // para o outro sem pulo na tela
  const gap = HEX.LAYER_GAP;
  return {
    ...b,
    arena: {
      ...b.arena,
      radius: lerp(a.arena.radius, b.arena.radius, k),
      sweep: typeof b.arena.sweep === 'number' && typeof a.arena.sweep === 'number' ? lerpAngle(a.arena.sweep, b.arena.sweep, k) : b.arena.sweep,
    },
    players: b.players.map((pb) => {
      const pa = a.byId[pb.id];
      if (!pa || pa.st === ST.OUT) return pb;
      const ya = (pa.y ?? 0) - (pa.layer ?? 0) * gap;
      const yb = (pb.y ?? 0) - (pb.layer ?? 0) * gap;
      const y = lerp(ya, yb, k) + (pb.layer ?? 0) * gap;
      return { ...pb, x: lerp(pa.x, pb.x, k), z: lerp(pa.z, pb.z, k), y, dir: lerpAngle(pa.dir, pb.dir, k) };
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
    crownPreview: () => preview?.setCrown(true),
    minigames: () => mgView.debug(),
  };
}
let frames = 0;
let fpsT = 0;

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  input.pollMenu();
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
    let s = sampleState(renderT);
    // Replay em câmera lenta do último empurrão
    const replaying = replay && now >= replay.startAt;
    if (replaying) {
      if (!replay.started) {
        replay.started = true;
        ui.replay(true);
        ui.hideScoreboard();
        world.focusOn(replay.x, replay.z, 0.6, 0.4);
      }
      const t = replay.from + (now - replay.startAt) * REPLAY.SPEED;
      if (t > replay.to) {
        replay = null;
        ui.replay(false);
        world.focusOn(0, 0, 1, 0.5);
      } else {
        s = sampleAt(replayBuf, t) ?? s;
      }
    }
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
        const p = sp.id === myId && sp.st !== ST.OUT && !replaying ? selfPose(sp, now, dt) : sp;
        a.apply(p, animDt);
        if (p.st === ST.DASHING && !frozen) fx.trail(sp.id, a.root.position.x, a.root.position.z, colorOf(lobby?.players.find((q) => q.id === sp.id)));
        if (a.pu !== p.pu) {
          a.pu = p.pu;
          if (p.pu) a.showIcon(STR.powerupIcons[p.pu]);
          else a.hideIcon();
        }
      }
      for (const [id, a] of animals) if (!present.has(id)) a.root.visible = false;
      spectateFrame(s, dt, replaying);
      rules.update(s, dt, { animals, colorOf, players: lobbyById() });
      mgView.update(s, dt, { animals, colorOf, players: lobbyById() });
      if (latest) {
        ui.hud(latest, lobby, myId);
        modeHud(s);
      }
      tutorialFrame(dt);
    }
  } else {
    for (const a of animals.values()) a.mixer?.update(dt);
    // Menu: o bicho fica ao lado do painel (em pé, de frente, com o nome em cima)
    const wide = innerWidth > innerHeight * 1.1;
    preview?.apply({ x: wide ? -1.3 : 0, z: wide ? 1.4 : -2.4, dir: Math.sin(now / 1500) * 0.5, vx: 0, vz: 0, st: ST.ALIVE, dashCd: 0, pu: null }, dt);
  }

  for (const m of boxes.values()) m.rotation.y += dt * 1.8;
  fx.update(animDt);
  world.render(animDt || dt * 0.0001);
  labels.render(world.scene, world.camera);

  frames += 1;
  fpsT += dt;
  if (fpsT >= 0.5) {
    debugInfo.fps = Math.round(frames / fpsT);
    autoQuality(debugInfo.fps);
    frames = 0;
    fpsT = 0;
    if (SHOW_DEBUG) {
      debugEl.textContent = `${debugInfo.status}\nfps ${debugInfo.fps} · ping ${debugInfo.ping} ms · tick ${debugInfo.tick}\n${net.transport} · phase ${latest?.phase ?? screen} · delay ${Math.round(interpDelay)} ms${predict.me ? ' · predicting' : ''}`;
    }
  }
}

// ---------- Câmera de espectador ----------
// Fora da rodada (caiu, foi eliminado ou entrou no meio): a câmera segue quem ainda
// joga. Clique, toque ou Espaço troca de bicho.

const spectate = { active: false, id: null };
const LIVE = new Set([ST.ALIVE, ST.DASHING, ST.STUNNED]);
function spectateFrame(s, dt, replaying) {
  const me = s.players.find((p) => p.id === myId);
  const playing = s.phase === PHASE.PLAYING || s.phase === PHASE.SUDDEN_DEATH;
  const out = !me || !LIVE.has(me.st) && me.st !== ST.FALLING;
  // Rei da colina: quem cai volta em 1,5 s, então a câmera fica na arena
  if (!playing || replaying || !out || tutorial.active || lobby?.roundMode === 'hill') {
    if (spectate.active) {
      spectate.active = false;
      if (playing && !replaying) world.focusOn(0, 0, 1, 0.6);
    }
    ui.watching(null);
    return;
  }
  const alive = s.players.filter((p) => LIVE.has(p.st));
  if (!alive.length) return;
  let target = alive.find((p) => p.id === spectate.id);
  if (!target) {
    target = alive[0];
    spectate.id = target.id;
  }
  spectate.active = true;
  const a = animals.get(target.id);
  world.follow(a?.root.position.x ?? target.x, a?.root.position.z ?? target.z, 0.7, dt);
  ui.watching(displayName(lobbyById()[target.id]));
}

function nextSpectate() {
  if (!spectate.active || !latest) return;
  const alive = latest.players.filter((p) => LIVE.has(p.st));
  if (!alive.length) return;
  const i = alive.findIndex((p) => p.id === spectate.id);
  spectate.id = alive[(i + 1) % alive.length].id;
}
addEventListener('pointerdown', (e) => {
  if (spectate.active && !e.target.closest('button, input, .panel')) nextSpectate();
});
addEventListener('keydown', (e) => {
  if (spectate.active && e.code === 'Space') nextSpectate();
});

// ---------- HUD dos modos ----------

let rosterCache = { src: null, map: {} };
function lobbyById() {
  if (rosterCache.src !== lobby?.players) rosterCache = { src: lobby?.players, map: Object.fromEntries((lobby?.players ?? []).map((p) => [p.id, p])) };
  return rosterCache.map;
}

function modeHud(s) {
  const players = lobbyById();
  const pot = s.arena?.potato;
  if (pot && latest?.phase !== PHASE.ROUND_END) {
    const fuse = Math.ceil(pot.fuse);
    if (pot.id === myId) ui.objective(`💣 ${STR.potatoYou} ${fuse}`, 'danger');
    else ui.objective(`💣 ${displayName(players[pot.id])} · ${fuse}s`);
  } else {
    ui.objective(null);
  }
  const hill = s.arena?.hill;
  if (hill) {
    const rows = Object.entries(hill.scores)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, v]) => ({ p: players[id], v: Math.min(1, v / HILL.TARGET), me: id === myId }));
    if (myId && !rows.some((r) => r.me) && players[myId] && !players[myId].spectator) {
      rows.push({ p: players[myId], v: Math.min(1, (hill.scores[myId] ?? 0) / HILL.TARGET), me: true });
    }
    ui.hill(rows, hill.contested, hill.moveIn);
  } else {
    ui.hill(null);
  }
}

// ---------- Qualidade automática ----------
// Em "Auto", se a partida rodar abaixo de 35 fps por uns 5 s, passa para o gráfico leve
// (e lembra disso na próxima visita).
const slowSamples = [];
function autoQuality(fps) {
  if (settings.graphics !== 'auto' || world.lowQuality || screen !== 'game' || document.hidden) return;
  slowSamples.push(fps < 35);
  if (slowSamples.length > 10) slowSamples.shift();
  if (slowSamples.length === 10 && slowSamples.filter(Boolean).length >= 8) {
    world.setLowQuality();
    saveSettings({ autoLow: true });
    ui.toast(STR.autoLowGfx);
  }
}

// ---------- Início ----------

function showHome() {
  closePause();
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
    // 80 % da barra é o download (prefetch); o resto é montar modelos e sons
    const [pd, pt] = progress.prefetch ?? [0, 0];
    loading.setProgress((pt ? (pd / pt) * 0.8 : 0) + (total ? done / total : 0) * (pt ? 0.2 : 1));
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
  // Baixa tudo antes, poucos por vez e tentando de novo: o link de prévia do Studio
  // recusa (429) quando chegam dezenas de pedidos juntos e não deixa guardar em cache.
  // Os loaders depois leem os arquivos já baixados, sem ir à rede.
  const files = await Promise.race([
    prefetchAssets(manifest, (done, total) => {
      progress.prefetch = [done, total];
      update();
    }),
    new Promise((r) => setTimeout(r, 30000)),
  ]);
  if (files) manifest = files;
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

  // Recarregou a página no meio de uma partida online: tenta voltar para o mesmo bicho
  const sess = session.get();
  if (home.code && sess?.code === home.code && sess.token && home.nickname) {
    join('online', { nickname: home.nickname, animal: home.animal, code: home.code, rejoin: sess.token });
  }

  // Atalhos: ?bots=7&difficulty=hard pula menu e lobby; ?offline=1 joga sozinho
  if (QUICK_BOTS !== null) {
    join(OFFLINE ? 'solo' : 'online', {
      nickname: home.nickname || `${STR.defaultNickname}${Math.floor(100 + Math.random() * 900)}`,
      animal: home.animal,
      code: home.code || null,
    });
  }
}

// Todos os arquivos citados no manifesto (modelos, sons, texturas)
// "?v=2" no fim força o navegador a baixar de novo um arquivo que mudou
const ASSET_RE = /\.(glb|gltf|mp3|ogg|wav|png|jpe?g|webp)(\?v=\w+)?$/i;
const MODEL_RE = /\.(glb|gltf)$/i;
const cleanPath = (url) => url.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
function assetPaths(node, out = new Set()) {
  if (typeof node === 'string') {
    if (ASSET_RE.test(node)) out.add(cleanPath(node));
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) assetPaths(v, out);
  }
  return out;
}

// Imagens que um .glb puxa de fora (ex.: Textures/colormap.png ao lado do modelo)
async function glbImages(path, blob) {
  try {
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    if (view.getUint32(0, true) !== 0x46546c67) return []; // "glTF"
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, view.getUint32(12, true))));
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    return (json.images ?? []).filter((im) => im.uri && !im.uri.startsWith('data:')).map((im) => cleanPath(dir + im.uri));
  } catch {
    return [];
  }
}

// Sons trocam o caminho pelo arquivo já baixado ("#.mp3" no fim: o Howler descobre
// o formato pela extensão; o blob ignora o #). Modelos e texturas mantêm o caminho
// (o .glb acha a textura ao lado dele) e o three.js troca na hora de pedir.
function swapPaths(node, blobs) {
  if (typeof node === 'string') {
    const b = !MODEL_RE.test(node) && blobs.get(cleanPath(node));
    return b ? `${b}#.${node.match(ASSET_RE)[1]}` : node;
  }
  if (Array.isArray(node)) return node.map((v) => swapPaths(v, blobs));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, swapPaths(v, blobs)]));
  }
  return node;
}

// Baixa poucos arquivos por vez e tenta de novo quando o servidor recusa.
// Devolve o manifesto apontando para os arquivos já baixados.
async function prefetchAssets(manifest, onProgress) {
  const queue = [...assetPaths(manifest)];
  const seen = new Set(queue);
  const blobs = new Map();
  let done = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function get(path) {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(`/${path}`);
        if (res.ok) {
          const blob = await res.blob();
          blobs.set(path, URL.createObjectURL(blob));
          if (MODEL_RE.test(path)) {
            for (const img of await glbImages(path, blob)) {
              if (!seen.has(img)) {
                seen.add(img);
                queue.push(img);
              }
            }
          }
          return;
        }
        if (res.status !== 429 && res.status < 500) return;
        const after = Number(res.headers.get('retry-after'));
        await wait(after > 0 ? after * 1000 : 400 * 2 ** attempt);
      } catch {
        await wait(400 * 2 ** attempt);
      }
    }
  }
  async function worker() {
    while (queue.length) {
      await get(queue.shift());
      onProgress(++done, seen.size);
    }
  }
  onProgress(0, seen.size);
  await Promise.all(Array.from({ length: 4 }, worker));
  THREE.DefaultLoadingManager.setURLModifier((url) => blobs.get(cleanPath(url)) ?? url);
  return swapPaths(manifest, blobs);
}

boot();
