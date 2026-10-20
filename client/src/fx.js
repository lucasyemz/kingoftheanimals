// Partículas, tremor e sons, ligados aos eventos do servidor.
// Uma função por linha do "Mapa de eventos", todas registradas na tabela HANDLERS.

import * as THREE from 'three';
import {
  BatchedRenderer, ParticleSystem, RenderMode,
  ConstantValue, IntervalValue, ConstantColor, Gradient, PiecewiseBezier, Bezier,
  SphereEmitter, SizeOverLife, ColorOverLife, ApplyForce,
  Vector3 as QVector3, Vector4 as QVector4,
} from 'three.quarks';
import { Howl, Howler } from 'howler';
import gsap from 'gsap';
import confetti from 'canvas-confetti';
import { ARENA, FX, MOBILE, EMOTES, PLAYER_COLORS } from '../../shared/constants.js';
import { EVENT } from '../../shared/messages.js';
import { STR } from './strings.js';
import { IS_MOBILE } from './scene.js';

const PARTICLE_SCALE = IS_MOBILE ? MOBILE.PARTICLE_SCALE : 1;
const rand = (a, b) => a + Math.random() * (b - a);

// Textura de reserva: bolinha suave desenhada num canvas
function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createFx({ world, ui, hooks }) {
  const batch = new BatchedRenderer();
  world.scene.add(batch);

  const textures = {};
  const materials = {};
  const fallback = softDot();
  const sounds = {};
  const music = {};
  let currentMusic = null;
  let ambient = null;

  function material(key, additive = false) {
    const id = `${key}:${additive}`;
    if (!materials[id]) {
      materials[id] = new THREE.MeshBasicMaterial({
        map: textures[key] ?? fallback,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
    }
    return materials[id];
  }

  function color4(hex, a = 1) {
    const c = new THREE.Color(hex);
    return new QVector4(c.r, c.g, c.b, a);
  }

  function makeSystem({
    tex = 'smoke', additive = false, count = 12, rate = 0, looping = false,
    life = [0.4, 0.8], speed = [1, 3], size = [0.3, 0.6], color = '#ffffff',
    radius = 0.3, gravity = 0, lift = 0, fade = true, shrink = true,
  }) {
    const c = new THREE.Color(color);
    const ps = new ParticleSystem({
      duration: looping ? 1 : 0.2,
      looping,
      autoDestroy: !looping,
      worldSpace: true,
      startLife: new IntervalValue(life[0], life[1]),
      startSpeed: new IntervalValue(speed[0], speed[1]),
      startSize: new IntervalValue(size[0], size[1]),
      startColor: new ConstantColor(color4(color)),
      emissionOverTime: new ConstantValue(rate * PARTICLE_SCALE),
      emissionBursts: count
        ? [{ time: 0, count: new ConstantValue(Math.max(1, Math.round(count * PARTICLE_SCALE))), cycle: 1, interval: 0.01, probability: 1 }]
        : [],
      shape: new SphereEmitter({ radius }),
      material: material(tex, additive),
      renderMode: RenderMode.BillBoard,
      renderOrder: 3,
    });
    if (shrink) ps.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.9, 0.6, 0.1), 0]])));
    if (fade) {
      ps.addBehavior(new ColorOverLife(new Gradient(
        [[new QVector3(c.r, c.g, c.b), 0], [new QVector3(c.r, c.g, c.b), 1]],
        [[1, 0], [0, 1]],
      )));
    }
    if (gravity) ps.addBehavior(new ApplyForce(new QVector3(0, -1, 0), new ConstantValue(gravity)));
    if (lift) ps.addBehavior(new ApplyForce(new QVector3(0, 1, 0), new ConstantValue(lift)));
    batch.addSystem(ps);
    world.scene.add(ps.emitter);
    return ps;
  }

  function burst(x, y, z, opts) {
    const ps = makeSystem(opts);
    ps.emitter.position.set(x, y, z);
    return ps;
  }

  // ---------- Áudio (Howler) ----------

  function sound(key, { rate, volume = 0.8 } = {}) {
    const list = sounds[key];
    if (!list?.length) return;
    const howl = list[Math.floor(Math.random() * list.length)];
    const id = howl.play();
    howl.volume(volume, id);
    if (rate) howl.rate(rate, id);
  }

  function playMusic(key) {
    if (currentMusic === key) return;
    if (currentMusic && music[currentMusic]) music[currentMusic].fade(music[currentMusic].volume(), 0, 600).once('fade', function stop() { this.stop(); });
    currentMusic = key;
    const m = music[key];
    if (m) {
      m.volume(0);
      m.play();
      m.fade(0, 0.35, 800);
    }
  }

  // ---------- Carregar assets do manifesto ----------

  // onAudio(carregados, total): alimenta a barra da tela de carregamento
  async function load(manifest, onAudio) {
    const loader = new THREE.TextureLoader();
    const audio = [];
    let loaded = 0;
    const howl = (opts) => {
      const h = new Howl({ preload: true, ...opts });
      audio.push(new Promise((resolve) => {
        const finish = () => {
          loaded += 1;
          onAudio?.(loaded, audio.length);
          resolve();
        };
        h.once('load', finish);
        h.once('loaderror', finish);
      }));
      return h;
    };
    for (const [key, files] of Object.entries(manifest.sounds ?? {})) {
      sounds[key] = files.map((f) => howl({ src: [f] }));
    }
    for (const [key, file] of Object.entries(manifest.music ?? {})) {
      music[key] = howl({ src: [file], loop: true, volume: 0 });
    }
    onAudio?.(0, audio.length);
    await Promise.all([
      ...Object.entries(manifest.particles ?? {}).map(async ([key, file]) => {
        try {
          const t = await loader.loadAsync(file);
          t.colorSpace = THREE.SRGBColorSpace;
          textures[key] = t;
        } catch {
          // fica a bolinha de reserva
        }
      }),
      ...audio,
    ]);
  }

  // ---------- Partículas de ambiente por cenário ----------

  function setAmbient(kind) {
    if (ambient) {
      ambient.endEmit();
      const old = ambient;
      setTimeout(() => {
        batch.deleteSystem(old);
        old.emitter.removeFromParent();
      }, 8000);
      ambient = null;
    }
    if (!kind) return;
    const presets = {
      snow: { tex: 'circle', rate: 40, life: [6, 9], speed: [0, 0.4], size: [0.12, 0.25], color: '#ffffff', radius: 16, gravity: 0.6, y: 14, fade: false, shrink: false },
      embers: { tex: 'circle', additive: true, rate: 30, life: [3, 5], speed: [0, 0.5], size: [0.1, 0.22], color: '#ff7a2a', radius: 14, lift: 1.2, y: -8 },
      stars: { tex: 'star', additive: true, rate: 12, life: [3, 6], speed: [0, 0.05], size: [0.2, 0.5], color: '#cfd8ff', radius: 45, y: 10, shrink: false },
    };
    const p = presets[kind];
    if (!p) return;
    ambient = makeSystem({ ...p, looping: true, count: 0 });
    ambient.emitter.position.set(0, p.y, 0);
  }

  // ---------- Mapa de eventos ----------

  const animal = (id) => hooks.animal(id);
  const isMe = (id) => id === hooks.myId();

  const HANDLERS = {
    [EVENT.COUNTDOWN]: ({ n }) => {
      sound(n > 0 ? 'beep' : 'go', { volume: 0.7 });
      ui.countdown(STR.countdown[n] ?? '');
    },

    [EVENT.DASH]: ({ id }) => {
      const a = animal(id);
      if (!a) return;
      if (!hooks.wasLocalDash(id)) {
        sound('whoosh', { volume: isMe(id) ? 0.6 : 0.3, rate: rand(0.9, 1.15) });
        a.dashStretch();
      }
      const { x, z } = a.root.position;
      burst(x, 0.2, z, { tex: 'smoke', count: 10, life: [0.3, 0.6], speed: [0.5, 1.5], size: [0.25, 0.5], color: '#d9c7a7' });
    },

    [EVENT.DASH_HIT]: ({ id, target, x, z }) => {
      sound('boing', { rate: rand(...FX.BOING_RATE), volume: 0.9 });
      hooks.hitStop(FX.HIT_STOP_MS);
      world.shakeCamera(FX.SHAKE_HIT);
      burst(x, 0.9, z, { tex: 'star', additive: true, count: 10, life: [0.3, 0.6], speed: [2, 4], size: [0.25, 0.45], color: '#ffe066' });
      animal(target)?.squash();
      if (isMe(id) || isMe(target)) hooks.vibrate?.(40);
    },

    [EVENT.FALL]: ({ id, x, z }) => {
      sound('scream', { rate: rand(...FX.VOICE_RATE) });
      // poeira na beirada de onde caiu
      burst(x, 0, z, { tex: 'smoke', count: 12, life: [0.4, 0.8], speed: [1, 2.5], size: [0.4, 0.8], color: '#e8dcc8', radius: 0.5 });
      const a = animal(id);
      if (!a) return;
      a.label.visible = false;
      // "poof" lá embaixo, onde o bicho some no abismo
      setTimeout(() => {
        const p = new THREE.Vector3();
        a.body.getWorldPosition(p);
        sound('poof', { volume: 0.6 });
        burst(p.x, p.y, p.z, { tex: 'smoke', count: 26, life: [0.6, 1.2], speed: [2, 4.5], size: [1, 2], color: '#ffffff', radius: 0.8 });
      }, 1350);
    },

    [EVENT.RING_WARNING]: ({ ring }) => {
      sound('alarm', { volume: 0.5 });
      world.setWarning(ring);
    },

    [EVENT.RING_DROP]: ({ ring }) => {
      sound('rumble', { volume: 0.9 });
      world.dropRing(ring);
      world.shakeCamera(FX.SHAKE_RING);
      const outer = ARENA.RADIUS - ring * ARENA.RING_WIDTH;
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        burst(Math.cos(a) * outer, 0, Math.sin(a) * outer, { tex: 'smoke', count: 4, life: [0.5, 1], speed: [0.5, 1.5], size: [0.5, 0.9], color: '#c8b89a' });
      }
    },

    [EVENT.SUDDEN_DEATH]: () => {
      sound('alarm', { volume: 0.7, rate: 1.2 });
      ui.banner(STR.suddenDeath, 'danger');
    },

    [EVENT.POWERUP_SPAWN]: ({ x, z }) => {
      sound('pop', { volume: 0.6 });
      burst(x, 0.4, z, { tex: 'spark', additive: true, count: 14, life: [0.6, 1.2], speed: [0.2, 0.8], size: [0.15, 0.3], color: '#fff3a0', lift: 3, radius: 0.4 });
    },

    [EVENT.POWERUP_PICK]: ({ id, pu }) => {
      sound('ding', { volume: isMe(id) ? 0.9 : 0.5 });
      const a = animal(id);
      if (!a) return;
      a.hop();
      ui.powerupToast?.(id, pu);
    },

    [EVENT.PUSH_BOMB]: ({ x, z }) => {
      sound('explosion', { volume: 1 });
      world.shakeCamera(FX.SHAKE_BOMB);
      // onda de choque em anel
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, depthWrite: false }),
      );
      ring.position.set(x, 0.1, z);
      world.scene.add(ring);
      gsap.to(ring.scale, { x: 3.2, z: 3.2, duration: 0.45, ease: 'power2.out' });
      gsap.to(ring.material, { opacity: 0, duration: 0.45, ease: 'power1.in', onComplete: () => ring.removeFromParent() });
      burst(x, 0.5, z, { tex: 'spark', additive: true, count: 26, life: [0.3, 0.7], speed: [4, 8], size: [0.3, 0.6], color: '#ff9f1c' });
    },

    [EVENT.ROUND_END]: ({ winner }) => {
      sound('fanfare', { volume: 0.8 });
      const a = animal(winner);
      if (a) {
        world.focusOn(a.root.position.x, a.root.position.z, 0.55, 0.5);
        a.celebrate(false);
      }
    },

    [EVENT.EMOTE]: ({ id, n }) => {
      sound(`emote${n}`, { volume: 0.7 });
      hooks.emoteBubble(id, STR.emotes[n - 1], EMOTES.SHOW_TIME);
    },

    [EVENT.PODIUM]: () => {
      playMusic(null);
      sound('victory', { volume: 0.9 });
      setTimeout(() => playMusic('lobby'), 2500);
      podiumConfetti();
    },

    [EVENT.KINGSLAYER]: () => {
      sound('kingslayer', { volume: 0.9 });
      ui.banner(STR.kingslayerBanner, 'gold');
    },

    [EVENT.LONG_LIVE_KING]: () => {
      ui.banner(STR.longLiveKing, 'gold');
    },
  };

  function handle(ev) {
    HANDLERS[ev.type]?.(ev);
  }

  function podiumConfetti() {
    const colors = PLAYER_COLORS;
    const end = Date.now() + 2500;
    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors });
      confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
    confetti({ particleCount: 150, spread: 100, origin: { y: 0.45 }, colors });
  }

  function update(dt) {
    batch.update(dt);
  }

  return {
    load, handle, update, sound, playMusic, setAmbient, burst,
    localDash(a) {
      sound('whoosh', { volume: 0.6, rate: rand(0.9, 1.15) });
      a.dashStretch();
    },
    unlockAudio() {
      if (Howler.ctx?.state === 'suspended') Howler.ctx.resume();
    },
  };
}
