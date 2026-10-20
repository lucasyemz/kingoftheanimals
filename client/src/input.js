// Teclado, gamepad e joystick virtual no celular. Tudo vira { x, z, dash }.
// x/z no plano do chão: -z é "para cima" na tela.

import nipplejs from 'nipplejs';
import { EMOTES } from '../../shared/constants.js';
import { STR } from './strings.js';

const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  dash: ['Space'],
};
const EMOTE_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
const PAD_DEAD_ZONE = 0.2;

export function createInput({ onEmote, onDash, touchRoot }) {
  const down = new Set();
  let dashQueued = false;
  let stick = { x: 0, z: 0 };
  let padDashWas = false;
  let padEmoteWas = [false, false, false, false];
  let enabled = false;

  const isTyping = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

  addEventListener('keydown', (e) => {
    if (isTyping()) return;
    if (KEYS.dash.includes(e.code)) {
      e.preventDefault();
      if (!e.repeat && enabled) {
        dashQueued = true;
        onDash?.();
      }
    }
    const emote = EMOTE_KEYS.indexOf(e.code);
    if (emote >= 0 && !e.repeat) onEmote(emote + 1);
    if (e.code.startsWith('Arrow')) e.preventDefault();
    down.add(e.code);
  });
  addEventListener('keyup', (e) => down.delete(e.code));
  addEventListener('blur', () => down.clear());

  const held = (action) => KEYS[action].some((k) => down.has(k));

  // ---------- Celular (P2): joystick à esquerda, dash à direita, emotes no topo ----------

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
      dashQueued = true;
      onDash?.();
    }, { passive: false });

    const emoteBar = touchRoot.querySelector('.emote-bar');
    for (let i = 0; i < EMOTES.COUNT; i++) {
      const b = document.createElement('button');
      b.className = 'emote-btn';
      b.textContent = STR.emotes[i];
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        onEmote(i + 1);
      }, { passive: false });
      emoteBar.append(b);
    }
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
    const dash = !!(pad.buttons[0]?.pressed || pad.buttons[2]?.pressed);
    if (dash && !padDashWas && enabled) {
      dashQueued = true;
      onDash?.();
    }
    padDashWas = dash;
    // direcional: emotes 1-4 (cima, direita, baixo, esquerda)
    const dpad = [12, 15, 13, 14].map((b) => !!pad.buttons[b]?.pressed);
    dpad.forEach((p, i) => {
      if (p && !padEmoteWas[i]) onEmote(i + 1);
    });
    padEmoteWas = dpad;
    return { x, z };
  }

  return {
    setEnabled(on) {
      enabled = on;
      if (!on) dashQueued = false;
    },
    // Chamado a cada envio de input; o dash é consumido aqui.
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
      const dash = dashQueued && enabled;
      dashQueued = false;
      return { x: enabled ? x : 0, z: enabled ? z : 0, dash };
    },
    isTouch: () => !!touch,
  };
}
