// O que os modos e obstáculos desenham na arena: colina dourada, buracos no gelo,
// setas do vento, barra de neon girando e a bomba da Batata quente.
// Tudo vem do state (arena.hill, arena.holes, arena.wind, arena.sweep, arena.potato).

import * as THREE from 'three';
import gsap from 'gsap';
import { HILL, SCENARIOS } from '../../shared/constants.js';

const FLOOR_Y = 0.03;

function crackTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineCap = 'round';
  // Rachaduras saindo do meio, com galhos
  const branch = (x, y, a, len, w) => {
    if (len < 10 || w < 0.6) return;
    const nx = x + Math.cos(a) * len;
    const ny = y + Math.sin(a) * len;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(nx, ny);
    g.stroke();
    branch(nx, ny, a + (Math.random() - 0.5) * 0.9, len * 0.7, w * 0.7);
    if (Math.random() < 0.5) branch(nx, ny, a + (Math.random() < 0.5 ? 0.8 : -0.8), len * 0.5, w * 0.6);
  };
  for (let i = 0; i < 7; i++) branch(128, 128, (i / 7) * Math.PI * 2 + Math.random() * 0.4, 38, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRules(world) {
  const root = new THREE.Group();
  world.scene.add(root);

  // ---------- Colina ----------
  const hill = new THREE.Group();
  const hillDisc = new THREE.Mesh(
    new THREE.CircleGeometry(HILL.RADIUS, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.28, depthWrite: false }),
  );
  const hillRing = new THREE.Mesh(
    new THREE.RingGeometry(HILL.RADIUS - 0.12, HILL.RADIUS, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.95, depthWrite: false }),
  );
  hillDisc.position.y = FLOOR_Y;
  hillRing.position.y = FLOOR_Y + 0.005;
  hillDisc.renderOrder = hillRing.renderOrder = 1;
  hill.add(hillDisc, hillRing);
  hill.visible = false;
  root.add(hill);

  // ---------- Buracos no gelo ----------
  const crackTex = crackTexture();
  const holes = new Map(); // hid → { group, crack, hole, phase }
  function holeMesh(h) {
    const group = new THREE.Group();
    group.position.set(h.x, 0, h.z);
    const crack = new THREE.Mesh(
      new THREE.CircleGeometry(h.r * 1.15, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, opacity: 0, depthWrite: false }),
    );
    crack.position.y = FLOOR_Y + 0.01;
    const abyss = SCENARIOS.frozen.depth.abyss;
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(h.r, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: abyss, transparent: true, opacity: 0, depthWrite: false }),
    );
    hole.position.y = FLOOR_Y + 0.02;
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(h.r - 0.05, h.r + 0.12, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#cfeaff', transparent: true, opacity: 0, depthWrite: false }),
    );
    rim.position.y = FLOOR_Y + 0.025;
    crack.renderOrder = hole.renderOrder = rim.renderOrder = 1;
    group.add(crack, hole, rim);
    root.add(group);
    return { group, crack, hole, rim, phase: null };
  }
  function syncHoles(list = []) {
    const seen = new Set();
    for (const h of list) {
      seen.add(h.hid);
      let m = holes.get(h.hid);
      if (!m) {
        m = holeMesh(h);
        holes.set(h.hid, m);
      }
      if (m.phase === h.phase) continue;
      m.phase = h.phase;
      if (h.phase === 'crack') {
        gsap.to(m.crack.material, { opacity: 0.9, duration: 0.4 });
        gsap.fromTo(m.group.position, { x: h.x - 0.05 }, { x: h.x + 0.05, duration: 0.06, repeat: 12, yoyo: true });
      } else if (h.phase === 'open') {
        gsap.to(m.crack.material, { opacity: 0.4, duration: 0.2 });
        gsap.to(m.hole.material, { opacity: 0.96, duration: 0.15 });
        gsap.to(m.rim.material, { opacity: 0.9, duration: 0.15 });
        gsap.fromTo(m.hole.scale, { x: 0.3, z: 0.3 }, { x: 1, z: 1, duration: 0.25, ease: 'back.out(2)' });
      }
    }
    for (const [hid, m] of holes) {
      if (seen.has(hid)) continue;
      // Congelou de novo: some devagar
      holes.delete(hid);
      gsap.to([m.crack.material, m.hole.material, m.rim.material], {
        opacity: 0, duration: 0.6, onComplete: () => m.group.removeFromParent(),
      });
    }
  }

  // ---------- Vento ----------
  const wind = new THREE.Group();
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, 0.9);
  arrowShape.lineTo(0.6, 0);
  arrowShape.lineTo(0.22, 0);
  arrowShape.lineTo(0.22, -0.9);
  arrowShape.lineTo(-0.22, -0.9);
  arrowShape.lineTo(-0.22, 0);
  arrowShape.lineTo(-0.6, 0);
  arrowShape.closePath();
  const arrowGeo = new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2);
  const arrowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
  const arrows = [];
  for (let i = 0; i < 9; i++) {
    const a = new THREE.Mesh(arrowGeo, arrowMat);
    a.position.y = FLOOR_Y + 0.03;
    a.renderOrder = 2;
    a.userData.offset = { u: ((i % 3) - 1) * 4.5, v: (Math.floor(i / 3) - 1) * 4.5 };
    wind.add(a);
    arrows.push(a);
  }
  wind.visible = false;
  root.add(wind);
  let windT = 0;

  // ---------- Barra giratória ----------
  const sweeper = new THREE.Group();
  const barMat = new THREE.MeshStandardMaterial({ color: '#f15bb5', emissive: '#f15bb5', emissiveIntensity: 1.4, roughness: 0.4 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.45, 0.6), barMat);
  bar.position.y = 0.3;
  bar.castShadow = true;
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.65, 0.9, 24),
    new THREE.MeshStandardMaterial({ color: '#2b2550', emissive: '#4cc9f0', emissiveIntensity: 0.6 }),
  );
  hub.position.y = 0.45;
  hub.castShadow = true;
  sweeper.add(bar, hub);
  sweeper.visible = false;
  root.add(sweeper);

  // ---------- Bomba da Batata quente ----------
  const bomb = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 20, 16),
    new THREE.MeshStandardMaterial({ color: '#22202e', roughness: 0.35, metalness: 0.3, emissive: '#ff2a2a', emissiveIntensity: 0 }),
  );
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), new THREE.MeshStandardMaterial({ color: '#8d5a3b' }));
  fuse.position.set(0.12, 0.47, 0);
  fuse.rotation.z = -0.4;
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd166' }));
  spark.position.set(0.2, 0.63, 0);
  bomb.add(bombBody, fuse, spark);
  bomb.visible = false;
  root.add(bomb);

  return {
    // Chamado a cada frame com o state interpolado
    update(s, dt, { animals, colorOf, players }) {
      const a = s.arena ?? {};

      // Colina
      hill.visible = !!a.hill;
      if (a.hill) {
        const inside = s.players.filter((p) => (p.st === 'alive' || p.st === 'dashing' || p.st === 'stunned') && Math.hypot(p.x, p.z) < HILL.RADIUS);
        const color = a.hill.contested ? '#ff6b75' : inside.length === 1 ? colorOf(players[inside[0].id]) : '#ffd23f';
        hillRing.material.color.set(color);
        hillDisc.material.color.set(color);
        hillDisc.material.opacity = 0.22 + Math.sin(performance.now() / 300) * 0.06;
      }

      // Gelo
      syncHoles(a.holes);

      // Vento: setas andando na direção do vento (piscando no aviso)
      const w = a.wind;
      const on = w && (w.phase === 'warn' || w.phase === 'blow');
      wind.visible = !!on;
      if (on) {
        windT += dt * (w.phase === 'blow' ? 6 : 2);
        const ang = Math.atan2(-w.dx, -w.dz); // a ponta da seta (local -z) aponta para (dx, dz)
        arrowMat.opacity = w.phase === 'warn' ? 0.35 + 0.35 * Math.abs(Math.sin(performance.now() / 120)) : 0.75;
        for (const arrow of arrows) {
          const { u, v } = arrow.userData.offset;
          const along = ((v + windT + 13.5) % 13.5) - 6.75;
          // u = lateral, along = na direção do vento
          arrow.position.x = w.dx * along + w.dz * u;
          arrow.position.z = w.dz * along - w.dx * u;
          arrow.rotation.y = ang;
          arrow.visible = Math.hypot(arrow.position.x, arrow.position.z) < (s.arena.radius ?? 10) - 0.6;
        }
      }

      // Barra: vai do eixo até a borda atual
      sweeper.visible = typeof a.sweep === 'number';
      if (sweeper.visible) {
        const len = Math.max(0.5, (a.radius ?? 10) - 0.55);
        bar.scale.x = len;
        bar.position.x = 0.55 + len / 2;
        sweeper.rotation.y = -a.sweep;
        barMat.emissiveIntensity = 1.2 + Math.sin(performance.now() / 150) * 0.3;
      }

      // Bomba em cima de quem segura; pisca mais rápido no fim do pavio
      const pot = a.potato;
      const holder = pot && animals.get(pot.id);
      bomb.visible = !!holder && holder.root.visible;
      if (bomb.visible) {
        bomb.position.set(holder.root.position.x, holder.root.position.y + holder.headY + 1.75, holder.root.position.z);
        const rate = pot.fuse < 3 ? 60 : pot.fuse < 6 ? 140 : 280;
        const blink = Math.sin(performance.now() / rate) > 0;
        bombBody.material.emissiveIntensity = blink ? 0.9 : 0;
        bomb.scale.setScalar(1.25 + (blink ? 0.12 : 0));
        spark.visible = Math.random() > 0.2;
      }
    },

    reset() {
      for (const m of holes.values()) m.group.removeFromParent();
      holes.clear();
      hill.visible = wind.visible = sweeper.visible = bomb.visible = false;
    },
  };
}
