// Bichos: carrega os GLB, AnimationMixer e estados de animação.
// createAnimal(tipo, cor) devolve a cápsula placeholder até o modelo existir,
// com a mesma interface nos dois casos.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import gsap from 'gsap';
import { PHYSICS, POWERUPS, FX } from '../../shared/constants.js';
import { PLAYER_STATE as ST } from '../../shared/messages.js';

const templates = {}; // tipo → { scene, animations, scale, yOffset, flip, head }
const VISUAL_HEIGHT = 1.45; // altura do bicho na tela, em metros
const HEAD_Y = 1.45;

// Os nomes dos clipes variam de pack para pack: mapeia tudo num lugar só.
const CLIP_PATTERNS = {
  idle: [/idle/i, /stand/i, /breath/i],
  run: [/run/i, /gallop/i, /walk/i, /move/i],
  dash: [/jump/i, /attack/i, /dash/i, /roll/i, /run/i],
  hit: [/hit/i, /damage/i, /hurt/i, /stun/i, /death/i, /die/i, /negative/i],
  win: [/jump/i, /celebrat/i, /victory/i, /dance/i, /happy/i, /positive/i],
};

function findClip(animations, key) {
  for (const re of CLIP_PATTERNS[key]) {
    const clip = animations.find((a) => re.test(a.name));
    if (clip) return clip;
  }
  return null;
}

export async function loadAnimalModels(manifestAnimals = {}) {
  const loader = new GLTFLoader();
  await Promise.all(
    Object.entries(manifestAnimals).map(async ([type, info]) => {
      try {
        const gltf = await loader.loadAsync(info.file);
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const scale = VISUAL_HEIGHT / size.y;
        let head = null;
        if (info.headNode) head = info.headNode;
        templates[type] = {
          scene: model,
          animations: gltf.animations,
          scale,
          yOffset: -box.min.y * scale,
          flip: info.forward === '-z' ? Math.PI : info.forward === '+x' ? -Math.PI / 2 : 0,
          head,
          height: size.y * scale,
          clips: {
            idle: findClip(gltf.animations, 'idle'),
            run: findClip(gltf.animations, 'run'),
            dash: findClip(gltf.animations, 'dash'),
            hit: findClip(gltf.animations, 'hit'),
            win: findClip(gltf.animations, 'win'),
          },
        };
        if (import.meta.env.DEV) console.log(`[animals] ${type}:`, gltf.animations.map((a) => a.name).join(', '));
      } catch (err) {
        console.warn(`[animals] could not load ${type}, using placeholder`, err);
      }
    }),
  );
}

function placeholderBody(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.45, 4, 10), mat);
  body.position.y = 0.85;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.35, 8), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.0, 0.45);
  g.add(body, nose);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

// Coroa feita aqui mesmo (não há modelo CC0 de coroa nos kits): aro, 5 pontas com
// bolinhas e pedras vermelhas e azuis. Os materiais são compartilhados entre os bichos.
const CROWN_MAT = {
  gold: new THREE.MeshStandardMaterial({ color: '#ffd23f', metalness: 0.55, roughness: 0.3, emissive: '#8a6400', side: THREE.DoubleSide }),
  tip: new THREE.MeshStandardMaterial({ color: '#fff1b0', metalness: 0.5, roughness: 0.2, emissive: '#6b5a10' }),
  ruby: new THREE.MeshStandardMaterial({ color: '#e63946', metalness: 0.2, roughness: 0.15, emissive: '#5a0a10' }),
  sapphire: new THREE.MeshStandardMaterial({ color: '#4361ee', metalness: 0.2, roughness: 0.15, emissive: '#0a1450' }),
  velvet: new THREE.MeshStandardMaterial({ color: '#c1121f', roughness: 0.9, emissive: '#3a0006' }),
};
function crownMesh(propModel) {
  if (propModel) return propModel;
  const g = new THREE.Group();
  const R = 0.29;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.92, 0.16, 28, 1, true), CROWN_MAT.gold);
  band.position.y = 0.08;
  g.add(band);
  // Veludo dentro do aro: de cima (a câmera do jogo) a coroa não parece oca
  const velvet = new THREE.Mesh(new THREE.SphereGeometry(R * 0.9, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), CROWN_MAT.velvet);
  velvet.scale.y = 0.75;
  g.add(velvet);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.96, 0.028, 8, 28), CROWN_MAT.gold);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.01;
  g.add(rim);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.22, 4), CROWN_MAT.gold);
    spike.position.set(Math.cos(a) * R * 0.97, 0.26, Math.sin(a) * R * 0.97);
    g.add(spike);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), CROWN_MAT.tip);
    ball.position.set(spike.position.x, 0.39, spike.position.z);
    g.add(ball);
    const b = a + Math.PI / 5;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), i % 2 ? CROWN_MAT.sapphire : CROWN_MAT.ruby);
    gem.position.set(Math.cos(b) * (R + 0.005), 0.08, Math.sin(b) * (R + 0.005));
    gem.rotation.y = -b;
    g.add(gem);
  }
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

function makeLabel(className) {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

// Anel no pé: mostra a recarga do dash
const RING_SEGMENTS = 40;
function cooldownRing(color) {
  const geo = new THREE.RingGeometry(PHYSICS.ANIMAL_RADIUS + 0.02, PHYSICS.ANIMAL_RADIUS + 0.14, RING_SEGMENTS, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }));
  mesh.position.y = 0.03;
  mesh.renderOrder = 2;
  return mesh;
}

export class Animal {
  constructor(type, color, { crownModel, debug } = {}) {
    this.type = type;
    this.color = new THREE.Color(color);
    this.root = new THREE.Group();   // posição no chão e rumo
    this.body = new THREE.Group();   // achatar/esticar, giro da queda
    this.root.add(this.body);
    this.state = ST.ALIVE;
    this.anim = null;
    this.baseScale = 1;

    const tpl = templates[type];
    if (tpl) {
      const model = cloneSkinned(tpl.scene);
      model.scale.setScalar(tpl.scale);
      model.position.y = tpl.yOffset;
      model.rotation.y = tpl.flip;
      model.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      this.body.add(model);
      this.mixer = new THREE.AnimationMixer(model);
      this.clips = tpl.clips;
      this.headY = Math.min(HEAD_Y + 0.3, tpl.height);
    } else {
      this.body.add(placeholderBody(this.color));
      this.mixer = null;
      this.clips = {};
      this.headY = HEAD_Y;
    }

    // Disco na cor do jogador, para achar o seu bicho na bagunça
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(PHYSICS.ANIMAL_RADIUS, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    disc.position.y = 0.02;
    this.disc = disc;
    this.root.add(disc);

    this.ring = cooldownRing(this.color);
    this.root.add(this.ring);

    if (debug) {
      const circle = new THREE.Mesh(
        new THREE.RingGeometry(PHYSICS.ANIMAL_RADIUS - 0.02, PHYSICS.ANIMAL_RADIUS, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#ff00ff', depthWrite: false }),
      );
      circle.position.y = 0.05;
      this.debugCircle = circle;
      this.root.add(circle);
    }

    // Coroa do King
    this.crown = crownMesh(crownModel);
    this.crown.position.y = this.headY;
    this.crown.visible = false;
    this.body.add(this.crown);

    // Estrelinhas do atordoamento
    this.stars = new THREE.Group();
    const starMat = new THREE.MeshBasicMaterial({ color: '#ffe066' });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), starMat);
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
      this.stars.add(s);
    }
    this.stars.position.y = this.headY + 0.25;
    this.stars.visible = false;
    this.root.add(this.stars);

    // Etiquetas HTML sobre a cabeça: nome, ícone do power-up, balão do emote
    this.labelEl = makeLabel('animal-label');
    this.label = new CSS2DObject(this.labelEl);
    this.label.position.y = this.headY + 0.55;
    this.root.add(this.label);

    this.iconEl = makeLabel('animal-icon');
    this.icon = new CSS2DObject(this.iconEl);
    this.icon.position.y = this.headY + 1.05;
    this.icon.visible = false;
    this.root.add(this.icon);

    this.bubbleEl = makeLabel('emote-bubble');
    this.bubble = new CSS2DObject(this.bubbleEl);
    this.bubble.position.y = this.headY + 1.15;
    this.bubble.visible = false;
    this.root.add(this.bubble);

    this.play('idle');
  }

  setLabel(html) {
    if (this.labelHtml !== html) {
      this.labelHtml = html;
      this.labelEl.innerHTML = html;
    }
  }

  setCrown(on) {
    if (on === this.crown.visible) return;
    this.crown.visible = on;
    if (on) gsap.fromTo(this.crown.position, { y: this.headY + 2.5 }, { y: this.headY, duration: 0.8, ease: 'bounce.out' });
  }

  play(key, { timeScale = 1, fade = 0.15 } = {}) {
    if (!this.mixer) return;
    const clip = this.clips[key] ?? this.clips.idle;
    if (!clip) return;
    const action = this.mixer.clipAction(clip);
    action.timeScale = timeScale;
    if (this.anim === action) return;
    action.reset().play();
    if (this.anim) this.anim.crossFadeTo(action, fade, false);
    this.anim = action;
  }

  // Estado que vem do servidor (já interpolado)
  apply(p, dt) {
    this.root.position.set(p.x, 0, p.z);
    this.root.rotation.y = p.dir;
    const fraction = Math.max(0, Math.min(1, p.dashCd));
    this.ring.geometry.setDrawRange(0, Math.round((1 - fraction) * RING_SEGMENTS) * 6);
    this.ring.material.opacity = fraction > 0 ? 0.45 : 0.95;

    const heavy = p.pu === 'heavy' ? POWERUPS.TYPES.heavy.scale : 1;
    if (heavy !== this.baseScale) {
      this.baseScale = heavy;
      gsap.to(this.root.scale, { x: heavy, y: heavy, z: heavy, duration: 0.3, ease: 'back.out(3)' });
    }

    if (p.st !== this.state) this.onState(p.st);
    if (p.st === ST.ALIVE) {
      const speed = Math.hypot(p.vx, p.vz);
      if (speed > 0.6) this.play('run', { timeScale: 0.6 + (speed / PHYSICS.MAX_SPEED) * 0.9 });
      else this.play('idle');
    }
    if (this.stars.visible) this.stars.rotation.y += dt * 8;
    this.mixer?.update(dt);
  }

  onState(st) {
    const prev = this.state;
    this.state = st;
    this.stars.visible = st === ST.STUNNED;
    this.root.visible = st !== ST.OUT;
    if (st === ST.DASHING) this.play('dash', { fade: 0.05, timeScale: 1.6 });
    if (st === ST.STUNNED) this.play('hit', { fade: 0.05 });
    if (st === ST.FALLING) this.fallSpin();
    if (st === ST.ALIVE && (prev === ST.FALLING || prev === ST.OUT)) this.resetPose();
  }

  // GDD: estica 20% na direção do dash por 0,15 s
  dashStretch() {
    gsap.killTweensOf(this.body.scale);
    gsap.fromTo(
      this.body.scale,
      { x: 1 - FX.DASH_STRETCH / 2, y: 1 - FX.DASH_STRETCH / 2, z: 1 + FX.DASH_STRETCH },
      { x: 1, y: 1, z: 1, duration: PHYSICS.DASH_DURATION * 2, ease: 'power2.out' },
    );
  }

  // Achata no impacto
  squash() {
    gsap.killTweensOf(this.body.scale);
    gsap.fromTo(
      this.body.scale,
      { x: 1 + FX.HIT_SQUASH, y: 1 - FX.HIT_SQUASH, z: 1 + FX.HIT_SQUASH },
      { x: 1, y: 1, z: 1, duration: 0.45, ease: 'elastic.out(1.2, 0.4)' },
    );
  }

  hop() {
    gsap.fromTo(this.body.position, { y: 0 }, { y: 0.6, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out' });
  }

  // GDD: gira 720° e encolhe até sumir em 1,5 s
  fallSpin() {
    this.play('hit', { fade: 0.05, timeScale: 1.5 });
    gsap.killTweensOf(this.body.scale);
    gsap.killTweensOf(this.body.rotation);
    gsap.killTweensOf(this.body.position);
    const t = PHYSICS.FALL_DURATION;
    gsap.to(this.body.rotation, { y: `+=${(FX.FALL_SPIN_DEG * Math.PI) / 180}`, x: 0.8, duration: t, ease: 'power1.in' });
    // Despenca no abismo; a perspectiva já faz ele diminuir, então encolhe só um pouco
    gsap.to(this.body.position, { y: -FX.FALL_DEPTH, duration: t, ease: 'power2.in' });
    gsap.to(this.body.scale, { x: 0.6, y: 0.6, z: 0.6, duration: t, ease: 'power1.in' });
    this.label.visible = false;
    this.icon.visible = false;
    // o disco e o anel do chão ficam lá em cima: some com eles
    this.disc.visible = false;
    this.ring.visible = false;
  }

  resetPose() {
    gsap.killTweensOf(this.body.scale);
    gsap.killTweensOf(this.body.rotation);
    gsap.killTweensOf(this.body.position);
    this.body.scale.set(1, 1, 1);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.label.visible = true;
    this.disc.visible = true;
    this.ring.visible = true;
    this.root.visible = true;
  }

  // Comemoração no pódio / fim de rodada
  celebrate(loop = true) {
    this.play('win', { timeScale: 1 });
    gsap.killTweensOf(this.body.position);
    gsap.fromTo(this.body.position, { y: 0 }, { y: 0.7, duration: 0.3, yoyo: true, repeat: loop ? -1 : 1, ease: 'power2.out' });
  }

  showIcon(text, seconds) {
    this.iconEl.textContent = text;
    this.icon.visible = true;
    clearTimeout(this.iconTimer);
    if (seconds) this.iconTimer = setTimeout(() => (this.icon.visible = false), seconds * 1000);
    gsap.fromTo(this.iconEl, { scale: 0.3 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' });
  }

  hideIcon() {
    this.icon.visible = false;
  }

  // Balão do emote: sobe e estoura
  showEmote(text, seconds) {
    this.bubbleEl.textContent = text;
    this.bubble.visible = true;
    gsap.killTweensOf(this.bubbleEl);
    gsap.fromTo(this.bubbleEl, { scale: 0.2, y: 20, opacity: 1 }, { scale: 1, y: 0, duration: 0.35, ease: 'back.out(3)' });
    gsap.to(this.bubbleEl, {
      scale: 1.4,
      opacity: 0,
      duration: 0.2,
      delay: seconds - 0.2,
      onComplete: () => (this.bubble.visible = false),
    });
  }

  dispose() {
    gsap.killTweensOf(this.body.scale);
    gsap.killTweensOf(this.body.rotation);
    gsap.killTweensOf(this.body.position);
    this.root.removeFromParent();
    // CSS2DObject: remove os elementos HTML junto
    for (const o of [this.label, this.icon, this.bubble]) o.element.remove();
  }
}

export function createAnimal(type, color, opts) {
  return new Animal(type, color, opts);
}
