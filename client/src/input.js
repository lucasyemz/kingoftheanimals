// Teclado, gamepad e joystick virtual no celular. Tudo vira { x, z, jump, charge }.
// Dash: segurar carrega (charge = true enquanto segura); soltar dispara. Toque rápido = dash normal.
// x/z no plano do chão: -z é "para cima" na tela.

import nipplejs from 'nipplejs';
import { EMOTES } from '../../shared/constants.js';
import { STR } from './strings.js';

const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  dash: ['KeyE', 'ShiftLeft', 'ShiftRight', 'KeyK', 'KeyJ', 'KeyL'],
};
const EMOTE_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
const PAD_DEAD_ZONE = 0.2;

export function createInput({ onEmote, onDash, onJump, onMenu, touchRoot }) {
  const down = new Set();
  let jumpQueued = false;
  let keyCharge = false;    // segurando a tecla de dash
  let touchCharge = false;
  let padCharge = false;
  let chargeLatch = false;  // apertou desde a última leitura (um toque rápido não se perde)
  let padJumpWas = false;
  let stick = { x: 0, z: 0 };
  let padDashWas = false;
  let padEmoteWas = [false, false, false, false];
  let padStartWas = false;
  let enabled = false;

  const isTyping = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !e.repeat) {
      onMenu?.();
      return;
    }
    if (isTyping()) return;
    if (KEYS.dash.includes(e.code)) {
      e.preventDefault();
      if (!e.repeat && enabled) {
        keyCharge = true;
        chargeLatch = true;
      }
    }
    if (KEYS.jump.includes(e.code)) {
      e.preventDefault();
      if (!e.repeat && enabled) {
        jumpQueued = true;
        onJump?.();
      }
    }
    const emote = EMOTE_KEYS.indexOf(e.code);
    if (emote >= 0 && !e.repeat) onEmote(emote + 1);
    if (e.code.startsWith('Arrow')) e.preventDefault();
    down.add(e.code);
  });
  addEventListener('keyup', (e) => {
    down.delete(e.code);
    if (KEYS.dash.includes(e.code) && keyCharge && !KEYS.dash.some((k) => down.has(k))) {
      keyCharge = false;
      if (enabled) onDash?.();
    }
  });
  addEventListener('blur', () => {
    down.clear();
    keyCharge = touchCharge = false;
  });

  const held = (action) => KEYS[action].some((k) => down.has(k));

  // ---------- Celular (P2): joystick à esquerda, dash e pulo à direita, emotes embaixo ----------

  let touch = null;
  function enableTouch() {
    if (touch) return;
    touchRoot.classList.add('touch');
    const zone = touchRoot.querySelector('.stick-zone');
    const joystick = nipplejs.create({
      zone,
      mode: 'static',
      position: { left: '50%', top: '50%' },
      color: 'white',
      size: 130,
      restOpacity: 0.6,
    });
    joystick.on('move', (_, data) => {
      const f = Math.min(1, data.force);
      stick = { x: data.vector.x * f, z: -data.vector.y * f };
    });
    joystick.on('end', () => (stick = { x: 0, z: 0 }));

    const dashBtn = touchRoot.querySelector('.dash-btn');
    dashBtn.textContent = STR.dash;
    dashBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!enabled) return;
      touchCharge = true;
      chargeLatch = true;
    }, { passive: false });
    const releaseDash = (e) => {
      e.preventDefault();
      if (!touchCharge) return;
      touchCharge = false;
      if (enabled) onDash?.();
    };
    dashBtn.addEventListener('touchend', releaseDash, { passive: false });
    dashBtn.addEventListener('touchcancel', releaseDash, { passive: false });
    const jumpBtn = touchRoot.querySelector('.jump-btn');
    jumpBtn.textContent = STR.jump;
    jumpBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!enabled) return;
      jumpQueued = true;
      onJump?.();
    }, { passive: false });

    const emoteBar = touchRoot.querySelector('.emote-bar');
    for (let i = 0; i < EMOTES.COUNT; i++) {
      const b = document.createElement('button');
      b.className = 'emote-btn';
      b.textContent = STR.emotes[i];
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        onEmote(i + 1);
        touchRoot.classList.remove('emotes-open');
      }, { passive: false });
      emoteBar.append(b);
    }
    // Celular em pé: os emotes ficam num balão 💬 que abre e fecha
    touchRoot.querySelector('.emote-toggle').addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchRoot.classList.toggle('emotes-open');
    }, { passive: false });
    touch = joystick;
  }
  addEventListener('touchstart', enableTouch, { once: true, passive: true });

  // ---------- Gamepad (P2) ----------

  function readPad() {
    const pad = navigator.getGamepads?.().find((p) => p);
    if (!pad) return null;
    let x = pad.axes[0] ?? 0;
    let z = pad.axes[1] ?? 0;
    if (Math.hypot(x, z) < PAD_DEAD_ZONE) x = z = 0;
    // A pula; X, B, Y, LB ou RB dão dash
    const dash = [1, 2, 3, 4, 5].some((b) => pad.buttons[b]?.pressed);
    if (dash && !padDashWas && enabled) chargeLatch = true;
    if (!dash && padDashWas && enabled) onDash?.();
    padCharge = dash;
    padDashWas = dash;
    const jump = !!pad.buttons[0]?.pressed;
    if (jump && !padJumpWas && enabled) {
      jumpQueued = true;
      onJump?.();
    }
    padJumpWas = jump;
    // direcional: emotes 1-4 (cima, direita, baixo, esquerda)
    const dpad = [12, 15, 13, 14].map((b) => !!pad.buttons[b]?.pressed);
    dpad.forEach((p, i) => {
      if (p && !padEmoteWas[i]) onEmote(i + 1);
    });
    padEmoteWas = dpad;
    return { x, z };
  }

  return {
    // Start do controle abre/fecha o menu de pausa (chamado a cada quadro, mesmo pausado)
    pollMenu() {
      const pad = navigator.getGamepads?.().find((p) => p);
      const start = !!pad?.buttons[9]?.pressed;
      if (start && !padStartWas) onMenu?.();
      padStartWas = start;
    },
    setEnabled(on) {
      enabled = on;
      if (!on) jumpQueued = keyCharge = touchCharge = chargeLatch = false;
    },
    // Chamado a cada envio de input; o pulo é consumido aqui.
    read() {
      let x = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      let z = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
      const pad = readPad();
      if (pad && (pad.x || pad.z)) ({ x, z } = pad);
      if (stick.x || stick.z) ({ x, z } = stick);
      const len = Math.hypot(x, z);
      if (len > 1) {
        x /= len;
        z /= len;
      }
      const jump = jumpQueued && enabled;
      const charge = enabled && (keyCharge || touchCharge || padCharge || chargeLatch);
      jumpQueued = chargeLatch = false;
      return { x: enabled ? x : 0, z: enabled ? z : 0, jump, charge };
    },
    isTouch: () => !!touch,
  };
}
