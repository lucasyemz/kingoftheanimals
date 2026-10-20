// Desenho dos minijogos: barras do Pula-corda, os três andares do Chão que some,
// as bolas da Chuva de bolas e o "braço" de quem está agarrando alguém.
// Tudo vem do state interpolado (arena.bars, arena.hex, arena.balls, players[].grab).

import * as THREE from 'three';
import { ARENA, HEX } from '../../shared/constants.js';
import { HEX_TILES } from '../../shared/hexgrid.js';

const LAYER_COLORS = ['#7ad3ff', '#ffd166', '#ff8fab'];
const BAR_COLORS = { low: '#f9c74f', high: '#e63946' };

function beachBallTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const colors = ['#e63946', '#ffffff', '#4361ee', '#ffffff', '#f9c74f', '#ffffff', '#43aa8b', '#ffffff'];
  colors.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect((i / colors.length) * 256, 0, 256 / colors.length + 1, 128);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createMinigamesView(world) {
  const root = new THREE.Group();
  world.scene.add(root);

  // ---------- Pula-corda: barras que atravessam a arena ----------
  const bars = [];
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.7, 2.2, 24),
    new THREE.MeshStandardMaterial({ color: '#2b2550', emissive: '#4cc9f0', emissiveIntensity: 0.5 }),
  );
  hub.position.y = 1.1;
  hub.castShadow = true;
  hub.visible = false;
  root.add(hub);
  function barMesh(kind) {
    const mat = new THREE.MeshStandardMaterial({ color: BAR_COLORS[kind] ?? '#ffffff', emissive: BAR_COLORS[kind] ?? '#ffffff', emissiveIntensity: 0.35, roughness: 0.5 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.6), mat);
    m.castShadow = true;
    root.add(m);
    return m;
  }

  // ---------- Chão que some: um InstancedMesh por andar ----------
  const tileGeo = new THREE.CylinderGeometry(HEX.SIZE - HEX.GAP, HEX.SIZE - HEX.GAP - 0.04, 0.35, 6);
  tileGeo.rotateY(Math.PI / 6); // cantos em 0°, 60°... como a grade (flat-top)
  const layers = [];
  for (let L = 0; L < HEX.LAYERS; L++) {
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, flatShading: true });
    const mesh = new THREE.InstancedMesh(tileGeo, mat, HEX_TILES.length);
    mesh.receiveShadow = true;
    mesh.castShadow = L === 0;
    mesh.visible = false;
    const base = new THREE.Color(LAYER_COLORS[L]);
    for (let i = 0; i < HEX_TILES.length; i++) {
      // cada peça com um tom levemente diferente, para o chão não parecer liso
      const c = base.clone().offsetHSL(0, 0, ((i * 37) % 7) * 0.012 - 0.03);
      mesh.setColorAt(i, c);
    }
    root.add(mesh);
    layers.push({ mesh, base, prev: '', fallAt: new Float64Array(HEX_TILES.length) });
  }
  const dummy = new THREE.Object3D();
  const white = new THREE.Color('#ffffff');
  const tmpColor = new THREE.Color();

  function drawHex(states, now) {
    const list = states.split('|');
    layers.forEach((layer, L) => {
      const st = list[L] ?? '';
      layer.mesh.visible = !!st;
      if (!st) return;
      const y = -L * HEX.LAYER_GAP - 0.175;
      for (let i = 0; i < HEX_TILES.length; i++) {
        const t = HEX_TILES[i];
        const s = st[i];
        const was = layer.prev[i];
        if (s === '2' && was !== '2') layer.fallAt[i] = now;
        let dy = 0;
        let scale = 1;
        let shake = 0;
        if (s === '1') {
          shake = 0.05;
          tmpColor.copy(layer.base).lerp(white, 0.45 + 0.25 * Math.sin(now / 50 + i));
          layer.mesh.setColorAt(i, tmpColor);
        } else if (s === '2') {
          // cai e some em 0,6 s
          const k = Math.min(1, (now - layer.fallAt[i]) / 600);
          dy = -k * k * 6;
          scale = k >= 1 ? 0 : 1 - k * 0.3;
        } else if (was === '1' || was === '2') {
          tmpColor.copy(layer.base);
          layer.mesh.setColorAt(i, tmpColor);
        }
        dummy.position.set(t.x + (shake ? (Math.random() - 0.5) * shake : 0), y + dy, t.z + (shake ? (Math.random() - 0.5) * shake : 0));
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        layer.mesh.setMatrixAt(i, dummy.matrix);
      }
      layer.prev = st;
      layer.mesh.instanceMatrix.needsUpdate = true;
      if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
    });
  }

  // ---------- Chuva de bolas ----------
  const ballTex = beachBallTexture();
  const ballMat = new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.45 });
  const balls = new Map(); // id → mesh
  function syncBalls(list = [], dt) {
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      let m = balls.get(b.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), ballMat);
        m.castShadow = true;
        root.add(m);
        balls.set(b.id, m);
      }
      m.scale.setScalar(b.r);
      m.position.set(b.x, b.r, b.z);
      // rola: gira em volta do eixo perpendicular ao movimento
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0.01) {
        const axis = new THREE.Vector3(b.vz / sp, 0, -b.vx / sp);
        m.rotateOnWorldAxis(axis, (sp * dt) / b.r);
      }
    }
    for (const [id, m] of balls) {
      if (seen.has(id)) continue;
      m.removeFromParent();
      m.geometry.dispose();
      balls.delete(id);
    }
  }

  // ---------- Agarrar: um braço na cor de quem agarra ----------
  const beams = new Map(); // grabber id → mesh
  const beamGeo = new THREE.CylinderGeometry(0.1, 0.1, 1, 8).rotateX(Math.PI / 2);
  // Laço em volta de quem foi agarrado (de longe o braço some entre os dois bichos)
  const lassoGeo = new THREE.TorusGeometry(0.72, 0.09, 8, 32).rotateX(Math.PI / 2);
  function syncBeams(players, animals, colorOf, roster) {
    const seen = new Set();
    for (const p of players) {
      if (!p.grab) continue;
      const a = animals.get(p.id);
      const b = animals.get(p.grab);
      if (!a || !b) continue;
      seen.add(p.id);
      let m = beams.get(p.id);
      if (!m) {
        const material = new THREE.MeshBasicMaterial({ color: colorOf(roster[p.id]) });
        m = new THREE.Mesh(beamGeo, material);
        m.userData.lasso = new THREE.Mesh(lassoGeo, material);
        root.add(m, m.userData.lasso);
        beams.set(p.id, m);
      }
      const from = new THREE.Vector3(a.root.position.x, a.root.position.y + a.lift.position.y + 0.65, a.root.position.z);
      const to = new THREE.Vector3(b.root.position.x, b.root.position.y + b.lift.position.y + 0.65, b.root.position.z);
      m.position.copy(from).add(to).multiplyScalar(0.5);
      m.scale.set(1, 1, Math.max(0.05, from.distanceTo(to)));
      m.lookAt(to);
      const lasso = m.userData.lasso;
      lasso.position.set(to.x, to.y - 0.1, to.z);
      lasso.rotation.y += 0.15;
      lasso.scale.setScalar(1 + Math.sin(performance.now() / 90) * 0.06);
    }
    for (const [id, m] of beams) {
      if (seen.has(id)) continue;
      m.removeFromParent();
      m.userData.lasso.removeFromParent();
      m.material.dispose();
      beams.delete(id);
    }
  }

  return {
    debug: () => ({ beams: beams.size, balls: balls.size, bars: bars.filter((m) => m.visible).length }),
    update(s, dt, { animals, colorOf, players }) {
      const a = s.arena ?? {};
      const now = performance.now();

      // Barras
      const list = a.bars ?? [];
      while (bars.length < list.length) bars.push(barMesh(list[bars.length].k));
      bars.forEach((m, i) => {
        const b = list[i];
        m.visible = !!b;
        if (!b) return;
        const len = (a.radius ?? ARENA.RADIUS) * (b.arms === 2 ? 2 : 1);
        m.scale.set(len, b.y1 - b.y0, 1);
        m.position.y = (b.y0 + b.y1) / 2;
        m.rotation.y = -b.a;
        m.material.color.set(BAR_COLORS[b.k] ?? '#ffffff');
        m.material.emissive.set(BAR_COLORS[b.k] ?? '#ffffff');
      });
      hub.visible = list.some((b) => b.arms === 2);

      // Chão de hexágonos (e a arena normal some)
      world.setArenaHidden(!!a.hex);
      if (a.hex) drawHex(a.hex, now);
      else layers.forEach((l) => (l.mesh.visible = false));

      syncBalls(a.balls, dt);
      syncBeams(s.players, animals, colorOf, players);
    },

    reset() {
      for (const l of layers) {
        l.prev = '';
        l.mesh.visible = false;
      }
      syncBalls([], 0);
      for (const m of beams.values()) {
        m.removeFromParent();
        m.userData.lasso.removeFromParent();
      }
      beams.clear();
      bars.forEach((m) => (m.visible = false));
      hub.visible = false;
      world.setArenaHidden(false);
    },
  };
}
