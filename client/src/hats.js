// Chapéus do guarda-roupa, feitos com formas simples (nenhum modelo CC0 cobria todos).
// Cada função devolve um Group com a base em y = 0, para ficar em cima da cabeça.

import * as THREE from 'three';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

const BUILDERS = {
  party() {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 20), mat('#f15bb5'));
    cone.position.y = 0.25;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), mat('#f9c74f'));
    pom.position.y = 0.52;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 20), mat('#4cc9f0'));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.12;
    g.add(cone, pom, band);
    g.rotation.z = 0.15;
    return g;
  },
  cap() {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('#e63946'));
    dome.scale.y = 0.65;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 20, 1, false, -Math.PI / 2, Math.PI), mat('#c1121f'));
    brim.position.set(0, 0.01, 0.2);
    brim.scale.z = 1.3;
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat('#ffffff'));
    button.position.y = 0.2;
    g.add(dome, brim, button);
    return g;
  },
  flower() {
    const g = new THREE.Group();
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), mat('#f9c74f'));
    center.position.y = 0.06;
    g.add(center);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 6), mat('#ff8fab'));
      petal.scale.set(1, 0.4, 0.6);
      petal.position.set(Math.cos(a) * 0.12, 0.05, Math.sin(a) * 0.12);
      petal.rotation.y = -a;
      g.add(petal);
    }
    g.position.x = 0.12;
    g.rotation.z = -0.3;
    return g;
  },
  tophat() {
    const g = new THREE.Group();
    const black = mat('#1d1b2f', { roughness: 0.35 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 28), black);
    brim.position.y = 0.02;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.22, 0.42, 28), black);
    crown.position.y = 0.25;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.07, 28), mat('#e63946'));
    band.position.y = 0.09;
    g.add(brim, crown, band);
    return g;
  },
  chef() {
    const g = new THREE.Group();
    const white = mat('#ffffff', { roughness: 0.9 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 24), white);
    band.position.y = 0.07;
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), white);
      puff.position.set(Math.cos(a) * 0.13, 0.26, Math.sin(a) * 0.13);
      g.add(puff);
    }
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), white);
    top.position.y = 0.33;
    g.add(top);
    return g;
  },
  cowboy() {
    const g = new THREE.Group();
    const brown = mat('#8d5a3b');
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 28), brown);
    brim.scale.z = 0.8;
    brim.position.y = 0.03;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.23, 0.3, 24), brown);
    crown.position.y = 0.2;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.225, 0.05, 24), mat('#3a2418'));
    band.position.y = 0.09;
    g.add(brim, crown, band);
    return g;
  },
  viking() {
    const g = new THREE.Group();
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('#9aa5b1', { metalness: 0.6, roughness: 0.35 }));
    helm.scale.y = 0.75;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.035, 8, 24), mat('#c08b30', { metalness: 0.5 }));
    rim.rotation.x = Math.PI / 2;
    g.add(helm, rim);
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.38, 12), mat('#fff1d6'));
      horn.position.set(side * 0.33, 0.18, 0);
      horn.rotation.z = -side * 0.9;
      g.add(horn);
    }
    return g;
  },
  halo() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.04, 10, 32),
      new THREE.MeshStandardMaterial({ color: '#fff3a0', emissive: '#ffd23f', emissiveIntensity: 1.2 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.32;
    g.add(ring);
    return g;
  },
};

export function hatMesh(id) {
  const build = BUILDERS[id];
  if (!build) return null;
  const g = build();
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

// Ícones para o guarda-roupa
export const HAT_ICONS = {
  none: '🚫', party: '🥳', cap: '🧢', flower: '🌸', tophat: '🎩', chef: '👨‍🍳', cowboy: '🤠', viking: '⚔️', halo: '😇',
};
