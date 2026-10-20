// HUD, lobby, placar, pódio e emotes. HTML por cima do canvas.

import gsap from 'gsap';
import { ANIMALS, PLAYER_COLORS, BOTS, ROOM, MATCH, AWARDS, FX, MODES } from '../../shared/constants.js';
import { PHASE } from '../../shared/messages.js';
import { STR } from './strings.js';
import { settings, saveSettings, stats } from './settings.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function displayName(p) {
  if (!p) return '?';
  if (p.bot && p.botName !== null && p.botName !== undefined && !p.nickname) {
    return `${STR.botAdjectives[p.botName % STR.botAdjectives.length]} ${STR.animals[p.animal] ?? ''}`;
  }
  return p.nickname || STR.animals[p.animal] || '?';
}

export const colorOf = (p) => PLAYER_COLORS[p?.color] ?? '#ffffff';

function nameTag(p) {
  const badge = p.bot ? `<span class="badge">${STR.botBadge}</span>` : '';
  return `<span class="name" style="color:${colorOf(p)}">${esc(displayName(p))}</span>${badge}`;
}

export function createUI(handlers) {
  const root = $('#ui');
  root.innerHTML = `
    <section class="screen home" hidden>
      <h1 class="game-title"><img class="logo" src="/logo.webp" alt="${STR.title}" width="1200" height="664" /></h1>
      <div class="panel menu">
        <label class="field"><span>${STR.yourName}</span>
          <input class="nickname" maxlength="${ROOM.NICKNAME_MAX}" placeholder="${STR.namePlaceholder}" autocomplete="off" spellcheck="false" enterkeyhint="go" />
        </label>
        <div class="field-label">${STR.pickAnimal}</div>
        <div class="animal-grid"></div>
        <button class="btn primary join-link" hidden></button>
        <div class="mode-row">
          <button class="btn mode solo"><span class="mode-name">${STR.singlePlayer}</span><span class="mode-hint">${STR.singlePlayerHint}</span></button>
          <button class="btn mode quick"><span class="mode-name">${STR.quickPlay}</span><span class="mode-hint">${STR.quickPlayHint}</span></button>
          <button class="btn mode multi"><span class="mode-name">${STR.multiplayer}</span><span class="mode-hint">${STR.multiplayerHint}</span></button>
        </div>
        <div class="menu-foot">
          <details class="code-entry">
            <summary>${STR.haveCode}</summary>
            <div class="join-row">
              <input class="code" maxlength="${ROOM.CODE_LENGTH}" placeholder="${STR.roomCodePlaceholder}" autocomplete="off" spellcheck="false" />
              <button class="btn join">${STR.joinRoom}</button>
            </div>
          </details>
          <button class="link-btn how">${STR.howToPlay}</button>
        </div>
        <div class="error" aria-live="polite"></div>
      </div>
      <div class="home-stats" aria-label="${STR.statsTitle}"></div>
    </section>

    <section class="screen lobby" hidden>
      <div class="panel lobby-panel">
        <div class="lobby-head">
          <button class="btn small leave">${STR.backToMenu}</button>
          <strong class="lobby-title"></strong>
        </div>
        <div class="invite">
          <div class="room-code">
            <span class="field-label">${STR.room}</span>
            <strong class="code-text outlined"></strong>
            <button class="btn copy">${STR.copyLink}</button>
            <button class="btn whatsapp">${STR.whatsapp}</button>
          </div>
          <div class="hint invite-hint">${STR.inviteHint}</div>
        </div>
        <div class="field-label">${STR.players}</div>
        <ul class="player-list"></ul>
        <div class="host-controls">
          <div class="setting mode-setting">
            <span class="field-label">${STR.mode}</span>
            <div class="segmented">
              ${MODES.map((m) => `<button class="btn small game-mode" data-mode="${m}">${STR.modes[m]}</button>`).join('')}
            </div>
          </div>
          <div class="hint mode-hint-text"></div>
          <div class="setting">
            <span class="field-label">${STR.bots}</span>
            <div class="stepper">
              <button class="btn small bots-minus" aria-label="fewer bots">−</button>
              <strong class="bots-count"></strong>
              <button class="btn small bots-plus" aria-label="more bots">+</button>
            </div>
          </div>
          <div class="setting">
            <span class="field-label">${STR.difficulty}</span>
            <div class="segmented">
              ${Object.keys(BOTS.DIFFICULTY).map((d) => `<button class="btn small diff" data-diff="${d}">${STR.difficulties[d]}</button>`).join('')}
            </div>
          </div>
          <button class="btn primary start">${STR.start}</button>
          <div class="hint start-hint"></div>
        </div>
        <div class="guest-note"></div>
        <div class="hint auto-start" hidden></div>
      </div>
    </section>

    <section class="hud" hidden>
      <div class="hud-left outlined"><div class="hud-round"></div><div class="hud-scenario"></div></div>
      <div class="hud-timer outlined"></div>
      <div class="hud-scores"></div>
      <div class="hud-emotes">${STR.emotes.map((e, i) => `<span><kbd>${i + 1}</kbd>${esc(e)}</span>`).join('')}</div>
      <div class="hud-spectating outlined" hidden>${STR.spectating}</div>
      <ul class="hud-feed"></ul>
      <div class="hud-objective outlined" hidden></div>
      <div class="hud-hill" hidden></div>
      <div class="tutorial-box" hidden><div class="tutorial-step outlined"></div><button class="btn small tutorial-skip">${STR.tutorial.skip}</button></div>
      <div class="hurt-flash"></div>
    </section>

    <div class="center-text outlined"></div>
    <div class="banner outlined"></div>

    <section class="overlay scoreboard" hidden>
      <div class="panel">
        <div class="score-title outlined"></div>
        <ul class="score-list"></ul>
        <div class="score-highlight"></div>
      </div>
    </section>

    <section class="overlay podium" hidden>
      <div class="podium-head">
        <div class="field-label">${STR.awards.champion}</div>
        <div class="champion outlined"></div>
      </div>
      <div class="panel awards"></div>
      <div class="podium-actions">
        <button class="btn to-menu">${STR.backToMenu}</button>
        <button class="btn primary rematch">${STR.rematch}</button>
      </div>
    </section>

    <button class="icon-btn gear" aria-label="${STR.settings}" title="${STR.settings}">⚙</button>
    <section class="overlay settings-modal" hidden>
      <div class="panel settings-panel">
        <strong class="settings-title">${STR.settings}</strong>
        <label class="slider"><span>${STR.music}</span><input type="range" class="vol-music" min="0" max="1" step="0.05" /></label>
        <label class="slider"><span>${STR.effects}</span><input type="range" class="vol-sfx" min="0" max="1" step="0.05" /></label>
        <label class="check"><input type="checkbox" class="mute" /> <span>${STR.mute}</span></label>
        <div class="setting">
          <span class="field-label">${STR.graphics}</span>
          <div class="segmented">
            ${Object.keys(STR.graphicsModes).map((g) => `<button class="btn small gfx" data-gfx="${g}">${STR.graphicsModes[g]}</button>`).join('')}
          </div>
        </div>
        <div class="gfx-reload" hidden><span>${STR.graphicsReload}</span> <button class="btn small do-reload">${STR.reload}</button></div>
        <button class="btn fullscreen">${STR.fullscreen}</button>
        <div class="hint">${STR.muteHint}</div>
        <button class="btn primary close-settings">${STR.close}</button>
      </div>
    </section>
    <div class="toast"></div>
    <div class="rotate-hint"><div class="outlined">${STR.rotatePhone}</div></div>
  `;

  const screens = {
    home: $('.home', root),
    lobby: $('.lobby', root),
    hud: $('.hud', root),
    scoreboard: $('.scoreboard', root),
    podium: $('.podium', root),
    settings: $('.settings-modal', root),
  };

  // ---------- Home ----------
  const nickInput = $('.nickname', root);
  const codeInput = $('.code', root);
  const grid = $('.animal-grid', root);
  let animal = null;

  ANIMALS.forEach((id, i) => {
    const b = document.createElement('button');
    b.className = 'btn animal';
    b.dataset.animal = id;
    b.textContent = STR.animals[id] ?? id;
    b.style.setProperty('--c', PLAYER_COLORS[i % PLAYER_COLORS.length]);
    b.addEventListener('click', () => selectAnimal(id, true));
    grid.append(b);
  });

  function selectAnimal(id, fromUser) {
    animal = id;
    grid.querySelectorAll('.animal').forEach((b) => b.classList.toggle('selected', b.dataset.animal === id));
    if (fromUser) handlers.onAnimal?.(id);
  }

  let linkCode = '';
  const homeData = () => ({ nickname: nickInput.value.trim(), animal });
  $('.solo', root).addEventListener('click', () => handlers.onSolo(homeData()));
  $('.multi', root).addEventListener('click', () => handlers.onMulti(homeData()));
  $('.quick', root).addEventListener('click', () => handlers.onQuick(homeData()));
  $('.how', root).addEventListener('click', () => handlers.onTutorial(homeData()));
  $('.join-link', root).addEventListener('click', () => handlers.onJoin({ ...homeData(), code: linkCode }));
  $('.join', root).addEventListener('click', () => handlers.onJoin({ ...homeData(), code: codeInput.value.trim().toUpperCase() }));
  codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '')));
  codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && $('.join', root).click());
  nickInput.addEventListener('input', () => {
    nickInput.classList.remove('invalid');
    $('.error', root).textContent = '';
    handlers.onName?.(nickInput.value);
  });
  nickInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    nickInput.blur();
    if (linkCode) $('.join-link', root).click();
  });

  // ---------- Lobby ----------
  let lobbyState = null;
  $('.copy', root).addEventListener('click', () => handlers.onCopyLink());
  $('.whatsapp', root).addEventListener('click', () => handlers.onWhatsApp());
  root.querySelectorAll('.game-mode').forEach((b) => b.addEventListener('click', () => handlers.onSettings({ mode: b.dataset.mode })));
  $('.tutorial-skip', root).addEventListener('click', () => handlers.onTutorialSkip());

  // ---------- Configurações ----------
  const settingsEl = $('.settings-modal', root);
  const volMusic = $('.vol-music', root);
  const volSfx = $('.vol-sfx', root);
  const muteBox = $('.mute', root);
  const startGfx = settings.graphics;
  function syncSettings() {
    volMusic.value = settings.music;
    volSfx.value = settings.sfx;
    muteBox.checked = settings.muted;
    root.querySelectorAll('.gfx').forEach((b) => b.classList.toggle('selected', b.dataset.gfx === settings.graphics));
    $('.gfx-reload', root).hidden = settings.graphics === startGfx;
    $('.gear', root).classList.toggle('muted', settings.muted);
  }
  $('.gear', root).addEventListener('click', () => {
    syncSettings();
    settingsEl.hidden = false;
  });
  $('.close-settings', root).addEventListener('click', () => (settingsEl.hidden = true));
  settingsEl.addEventListener('click', (e) => e.target === settingsEl && (settingsEl.hidden = true));
  volMusic.addEventListener('input', () => {
    saveSettings({ music: Number(volMusic.value) });
    handlers.onVolume?.();
  });
  volSfx.addEventListener('input', () => saveSettings({ sfx: Number(volSfx.value) }));
  volSfx.addEventListener('change', () => handlers.onVolume?.(true)); // toca um som de exemplo
  muteBox.addEventListener('change', () => {
    saveSettings({ muted: muteBox.checked });
    handlers.onVolume?.();
    syncSettings();
  });
  root.querySelectorAll('.gfx').forEach((b) => b.addEventListener('click', () => {
    saveSettings({ graphics: b.dataset.gfx });
    syncSettings();
  }));
  $('.do-reload', root).addEventListener('click', () => location.reload());
  const fsBtn = $('.fullscreen', root);
  fsBtn.hidden = !document.fullscreenEnabled;
  fsBtn.addEventListener('click', () => handlers.onFullscreen?.());
  syncSettings();
  $('.bots-minus', root).addEventListener('click', () => handlers.onSettings({ bots: (lobbyState?.bots ?? 0) - 1 }));
  $('.bots-plus', root).addEventListener('click', () => handlers.onSettings({ bots: (lobbyState?.bots ?? 0) + 1 }));
  root.querySelectorAll('.diff').forEach((b) => b.addEventListener('click', () => handlers.onSettings({ difficulty: b.dataset.diff })));
  $('.start', root).addEventListener('click', () => handlers.onStart());
  $('.rematch', root).addEventListener('click', () => handlers.onRematch());
  $('.to-menu', root).addEventListener('click', () => handlers.onLeave());
  $('.leave', root).addEventListener('click', () => handlers.onLeave());

  // Som de clique em todo botão (também destrava o áudio)
  root.addEventListener('click', (e) => {
    if (e.target.closest('button')) handlers.onClick?.();
  });

  function show(name, on = true) {
    screens[name].hidden = !on;
  }

  function only(...names) {
    for (const k of Object.keys(screens)) show(k, names.includes(k));
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('.toast', root);
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 1800);
  }

  return {
    showHome({ nickname, animal: a, code }) {
      only('home');
      gsap.fromTo($('.home .logo', root), { scale: 0.6, opacity: 0, rotate: -4 }, { scale: 1, opacity: 1, rotate: 0, duration: 0.7, ease: 'back.out(2.2)' });
      nickInput.value = nickname ?? '';
      nickInput.classList.remove('invalid');
      codeInput.value = '';
      selectAnimal(a ?? ANIMALS[0], false);
      // Chegou por um link de convite: o botão principal é entrar na sala
      linkCode = code ?? '';
      const joinLink = $('.join-link', root);
      joinLink.hidden = !linkCode;
      joinLink.textContent = STR.joinRoomCode(linkCode);
      $('.error', root).textContent = '';
      const st = $('.home-stats', root);
      st.hidden = !stats.rounds;
      st.innerHTML = `<span class="stats-title">${STR.statsTitle}</span>` +
        STR.statsLine(stats).map(([icon, n, label]) => `<span class="stat"><b>${icon} ${n}</b> ${label}</span>`).join('');
      if (!nickname && !matchMedia('(pointer: coarse)').matches) setTimeout(() => nickInput.focus(), 300);
    },

    // Sem nome: chacoalha o campo e pede o nome
    needName() {
      nickInput.classList.add('invalid');
      gsap.fromTo(nickInput, { x: -10 }, { x: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.3)' });
      nickInput.focus();
      $('.error', root).textContent = STR.errors.badNickname;
    },

    error(text) {
      $('.error', root).textContent = text;
      toast(text);
    },

    showLobby(lobby, myId, mode) {
      lobbyState = lobby;
      only('lobby');
      const solo = mode === 'solo';
      $('.lobby-title', root).textContent = solo ? STR.singlePlayer : lobby.public ? STR.publicRoom : STR.multiplayer;
      const gameMode = lobby.mode ?? 'classic';
      root.querySelectorAll('.game-mode').forEach((b) => b.classList.toggle('selected', b.dataset.mode === gameMode));
      $('.mode-hint-text', root).textContent = STR.modeHints[gameMode];
      const auto = $('.auto-start', root);
      auto.hidden = !lobby.public || lobby.autoStartIn == null;
      auto.textContent = lobby.autoStartIn == null ? '' : STR.autoStart(Math.ceil(lobby.autoStartIn));
      $('.invite', root).hidden = solo;
      $('.code-text', root).textContent = lobby.code;
      const isHost = lobby.hostId === myId;
      const humans = lobby.players.filter((p) => !p.bot);
      $('.player-list', root).innerHTML = humans
        .map((p) => {
          const king = p.id === lobby.kingId ? `<span class="crown-tag">👑 ${STR.kingStreak(p.kingStreak)}</span>` : '';
          const host = p.id === lobby.hostId ? `<span class="badge host">${STR.hostBadge}</span>` : '';
          const you = p.id === myId ? ` ${STR.you}` : '';
          return `<li><span class="dot" style="background:${colorOf(p)}"></span>${nameTag(p)}${esc(you)}${host}${king}<span class="animal-name">${esc(STR.animals[p.animal])}</span></li>`;
        })
        .join('');
      const maxBots = Math.min(BOTS.MAX, ROOM.MAX_PLAYERS - humans.length);
      $('.bots-count', root).textContent = lobby.bots;
      $('.bots-minus', root).disabled = lobby.bots <= 0;
      $('.bots-plus', root).disabled = lobby.bots >= maxBots;
      root.querySelectorAll('.diff').forEach((b) => b.classList.toggle('selected', b.dataset.diff === lobby.difficulty));
      const canStart = humans.length + lobby.bots >= ROOM.MIN_PLAYERS;
      $('.start', root).disabled = !canStart;
      $('.start-hint', root).textContent = canStart ? '' : solo ? STR.needBot : STR.needTwo;
      $('.host-controls', root).hidden = !isHost;
      const guest = $('.guest-note', root);
      guest.hidden = isHost;
      const me = lobby.players.find((p) => p.id === myId);
      guest.textContent = me?.spectator
        ? STR.spectatorNote
        : `${STR.waitingHost}  ${STR.modes[gameMode]} · ${STR.bots}: ${lobby.bots} · ${STR.difficulties[lobby.difficulty]}`;
    },

    showGame() {
      only('hud');
    },

    hud(state, lobby, myId) {
      $('.hud-round', root).textContent = `${STR.round(state.round)}`;
      $('.hud-scenario', root).textContent = STR.scenarios[lobby?.scenario] ?? '';
      const t = state.timeLeft;
      $('.hud-timer', root).textContent =
        state.phase === PHASE.SUDDEN_DEATH ? STR.suddenDeath : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      $('.hud-timer', root).classList.toggle('danger', state.phase === PHASE.SUDDEN_DEATH || t <= 10);
      const me = state.players.find((p) => p.id === myId);
      $('.hud-spectating', root).hidden = !(me ? me.st === 'out' || me.st === 'falling' : true);
    },

    scores(lobby, wins = {}) {
      const list = lobby.players.filter((p) => !p.spectator);
      $('.hud-scores', root).innerHTML = list
        .map((p) => {
          const n = wins[p.id] ?? p.wins ?? 0;
          const pips = Array.from({ length: MATCH.WINS_TO_WIN }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
          const crown = p.id === lobby.kingId ? '👑' : '';
          return `<div class="score-row"><span class="dot" style="background:${colorOf(p)}"></span><span class="name outlined">${crown}${esc(displayName(p))}</span><span class="pips" style="--c:${colorOf(p)}">${pips}</span></div>`;
        })
        .join('');
    },

    countdown(text) {
      const el = $('.center-text', root);
      el.textContent = text;
      gsap.killTweensOf(el);
      gsap.fromTo(el, { scale: 2.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2.5)' });
      gsap.to(el, { opacity: 0, scale: 0.8, duration: 0.25, delay: 0.7 });
    },

    banner(text, kind = '') {
      const el = $('.banner', root);
      el.textContent = text;
      el.className = `banner outlined ${kind}`;
      gsap.killTweensOf(el);
      gsap.fromTo(el, { y: -40, opacity: 0, scale: 0.7 }, { y: 0, opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2)' });
      gsap.to(el, { opacity: 0, y: -20, duration: 0.4, delay: 2.2 });
    },

    scoreboard(score, lobby, delay = 0) {
      const byId = Object.fromEntries(lobby.players.map((p) => [p.id, p]));
      const winner = byId[score.winner];
      $('.score-title', root).textContent = STR.winsRound(displayName(winner));
      const rows = Object.entries(score.wins)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => {
          const p = byId[id];
          if (!p) return '';
          const pips = Array.from({ length: MATCH.WINS_TO_WIN }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
          return `<li class="${id === score.winner ? 'winner' : ''}"><span class="dot" style="background:${colorOf(p)}"></span>${nameTag(p)}<span class="pips" style="--c:${colorOf(p)}">${pips}</span></li>`;
        });
      $('.score-list', root).innerHTML = rows.join('');
      const h = score.highlight;
      const hp = byId[h?.id];
      let line = '';
      if (h?.type === 'knockouts') line = STR.knockedOut(displayName(hp), h.n);
      else if (h?.type === 'selfKo') line = `${STR.fellAlone(displayName(hp))} · ${STR.selfKo}`;
      $('.score-highlight', root).textContent = line;
      setTimeout(() => {
        show('scoreboard', true);
        gsap.fromTo(screens.scoreboard.firstElementChild, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'back.out(2)' });
      }, delay);
    },

    hideScoreboard() {
      show('scoreboard', false);
    },

    podium(score, lobby) {
      const byId = Object.fromEntries(lobby.players.map((p) => [p.id, p]));
      only('podium');
      $('.champion', root).innerHTML = esc(STR.championIs(displayName(byId[score.champion])));
      $('.awards', root).innerHTML = AWARDS.map((key) => {
        const id = score.awards[key];
        const p = byId[id];
        const who = p ? nameTag(p) : `<span class="name muted">${STR.nobody}</span>`;
        return `<div class="award"><div class="award-name">${STR.awards[key]}</div><div class="award-who">${who}</div><div class="award-hint">${STR.awardHints[key]}</div></div>`;
      }).join('');
      gsap.fromTo(root.querySelectorAll('.award'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.12, duration: 0.4, delay: 0.6, ease: 'back.out(2)' });
    },

    // Lista de derrubadas no canto: "Fulano knocked off Ciclano" (some depois de 4 s)
    feed(victim, killer, myId, why = null) {
      const list = $('.hud-feed', root);
      const li = document.createElement('li');
      li.className = 'outlined';
      if (myId && (victim?.id === myId || killer?.id === myId)) li.classList.add('mine');
      const who = (p) => `<span class="name" style="color:${colorOf(p)}">${esc(displayName(p))}</span>`;
      li.innerHTML = killer
        ? `${who(killer)} <span class="feed-verb">${why === 'boom' ? STR.feedBoom : STR.feedKo}</span> ${who(victim)}`
        : `${who(victim)} <span class="feed-verb">${why === 'boom' ? STR.feedBoom : STR.feedSelf}</span>`;
      list.prepend(li);
      while (list.children.length > FX.FEED_MAX) list.lastElementChild.remove();
      gsap.fromTo(li, { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.25, ease: 'back.out(2)' });
      gsap.to(li, { opacity: 0, duration: 0.4, delay: 4, onComplete: () => li.remove() });
    },

    clearFeed() {
      $('.hud-feed', root).replaceChildren();
    },

    // Texto do objetivo do modo (bomba, colina) logo abaixo do relógio
    objective(text, kind = '') {
      const el = $('.hud-objective', root);
      el.hidden = !text;
      if (!text) return;
      el.textContent = text;
      el.className = `hud-objective outlined ${kind}`;
    },

    // Rei da colina: barras de quem está mais perto de vencer
    hill(rows, contested) {
      const el = $('.hud-hill', root);
      el.hidden = !rows;
      if (!rows) return;
      el.innerHTML = `<div class="hill-title outlined">${STR.hillTitle}${contested ? ` · <span class="contested">${STR.hillContested}</span>` : ''}</div>` +
        rows.map(({ p, v, me }) => `<div class="hill-row${me ? ' mine' : ''}"><span class="name outlined" style="color:${colorOf(p)}">${esc(displayName(p))}</span><span class="bar"><i style="width:${Math.round(v * 100)}%;background:${colorOf(p)}"></i></span></div>`).join('');
    },

    tutorialStep(text) {
      const box = $('.tutorial-box', root);
      box.hidden = !text;
      if (!text) return;
      const el = $('.tutorial-step', root);
      if (el.textContent === text) return;
      el.textContent = text;
      gsap.fromTo(el, { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' });
    },

    // Borda vermelha piscando quando o seu bicho cai
    hurtFlash() {
      const el = $('.hurt-flash', root);
      gsap.killTweensOf(el);
      gsap.fromTo(el, { opacity: 1 }, { opacity: 0, duration: 0.7, ease: 'power2.in' });
    },

    toast,
    linkCopied: () => toast(STR.linkCopied),
    hideAll: () => only(),
  };
}

// Tela de carregamento: já está no index.html (aparece antes do JS); aqui só o texto e a barra.
export function createLoading() {
  const el = $('#loading');
  const bar = $('.loading-bar i', el);
  const pct = $('.loading-pct', el);
  const tip = $('.loading-tip', el);
  let i = Math.floor(Math.random() * STR.loadingTips.length);
  const showTip = () => {
    tip.textContent = STR.loadingTips[i++ % STR.loadingTips.length];
    gsap.fromTo(tip, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4 });
  };
  showTip();
  const timer = setInterval(showTip, 2600);
  el.classList.add('ready');
  let shown = 0;
  return {
    setProgress(f) {
      const target = Math.max(shown, Math.min(1, f));
      shown = target;
      gsap.to(bar, { scaleX: target, duration: 0.3, ease: 'power1.out', overwrite: true });
      pct.textContent = `${STR.loading} ${Math.round(target * 100)}%`;
    },
    done() {
      clearInterval(timer);
      gsap.to(el, { opacity: 0, duration: 0.5, ease: 'power1.out', onComplete: () => el.remove() });
    },
  };
}
