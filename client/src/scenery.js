// Cenário em volta da arena, para a queda parecer funda: a arena vira uma coluna de pedra,
// com paredões de cânion (ou ilhas flutuantes) em volta, pilares saindo do abismo,
// névoa / nuvens / lava lá embaixo e props CC0 da Kenney nos topos.
// Tudo low-poly e gerado aqui, com semente fixa: o mesmo cenário em todas as telas.

import * as THREE from 'three';
import gsap from 'gsap';

// Números pseudoaleatórios com semente (mulberry32)
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ruído suave em volta do círculo (soma de senos): -1..1
function circleNoise(rand, octaves = 4) {
  const phases = Array.from({ length: octaves }, () => rand() * Math.PI * 2);
  return (a) => {
    let v = 0;
    let norm = 0;
    for (let k = 1; k <= octaves; k++) {
      v += Math.sin(a * k + phases[k - 1]) / k;
      norm += 1 / k;
    }
    return v / norm;
  };
}

function finish(positions, colors) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals(); // sem índice: cada face com a própria normal (low-poly)
  return geo;
}

// Parede de pedra irregular: cilindro torto que afina para baixo e escurece com a profundidade.
// A cor final é a do material × este cinza; a neblina leva o fundo para a cor do abismo.
export function rockWallGeometry({ radius, depth, taper, seed, segs = 48, rows = 8, jag = 0.45 }) {
  const rand = seeded(seed);
  const jitter = Array.from({ length: segs * (rows + 1) }, () => rand() - 0.5);
  const point = (i, j) => {
    const t = j / rows;
    const a = ((i % segs) / segs) * Math.PI * 2;
    const y = j === 0 ? 0 : j === 1 ? -0.45 : -depth * Math.pow(t, 1.05);
    let r = radius * (1 - taper * Math.pow(t, 1.3));
    if (j === 1) r += 0.12; // beirada levemente para fora
    if (j > 0) r += jitter[(i % segs) + j * segs] * 2 * jag * Math.min(1, radius / 3);
    const shade = 1 - 0.9 * Math.pow(t, 0.6);
    return [Math.sin(a) * r, y, Math.cos(a) * r, shade];
  };
  const pos = [];
  const col = [];
  const push = (p) => {
    pos.push(p[0], p[1], p[2]);
    col.push(p[3], p[3], p[3]);
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < segs; i++) {
      const p00 = point(i, j);
      const p10 = point(i + 1, j);
      const p01 = point(i, j + 1);
      const p11 = point(i + 1, j + 1);
      push(p00); push(p01); push(p10); // normal para fora
      push(p10); push(p01); push(p11);
    }
  }
  return finish(pos, col);
}

// Paredões do cânion em volta da arena. Mais baixos do lado da câmera (+z) para não tapar o jogo.
export function canyon({ seed, rock, rim, abyss, strata, segs = 80 }) {
  const rand = seeded(seed);
  const edgeNoise = circleNoise(rand);
  const topNoise = circleNoise(rand, 5);
  const jag = Array.from({ length: segs * 12 }, () => rand() - 0.5);
  const cRock = new THREE.Color(rock);
  const cRim = new THREE.Color(rim);
  const cAbyss = new THREE.Color(abyss);

  // Beirada longe o bastante para sobrar um vão de abismo entre a arena e os paredões
  const edge = (a) => 23 + edgeNoise(a) * 3.5;
  const top = (a) => {
    const front = (Math.cos(a) + 1) / 2; // 1 = lado da câmera
    return THREE.MathUtils.lerp(5, -14, Math.pow(front, 1.2)) + topNoise(a) * 1.6;
  };

  // [raio, altura, cor] de fora para dentro e depois descendo pelo paredão
  const rowsAt = (a, i) => {
    const r0 = edge(a);
    const h = top(a);
    const n = (k) => jag[(i % segs) + k * segs];
    const rockAt = (t) => cRock.clone().lerp(cAbyss, t);
    const band = (k, t) => (strata ? rockAt(t).multiplyScalar(k % 2 ? 0.86 : 1.06) : rockAt(t));
    return [
      [90, h + 4, cRim],
      [36, h + 1.5 + n(0) * 1.5, cRim],
      [r0 + 10, h + n(1) * 0.4, cRim],
      [r0 + 1.4, h, cRim],
      [r0 + 0.4 + n(2) * 0.4, h - 0.8, band(0, 0.05)],
      [r0 + 0.8 + n(3) * 1.2, h - 5, band(1, 0.3)],
      [r0 - 0.3 + n(4) * 1.4, h - 11, band(2, 0.6)],
      [r0 + 0.6 + n(5) * 1.4, Math.min(h - 16, -20), band(3, 0.85)],
      [r0 + 1.6 + n(6) * 1.6, -32, band(4, 0.97)],
      [r0 + 3 + n(7) * 2, -48, cAbyss],
      [r0 + 5, -80, cAbyss],
    ];
  };

  const grid = [];
  for (let i = 0; i <= segs; i++) {
    const a = ((i % segs) / segs) * Math.PI * 2;
    grid.push(rowsAt(a, i).map(([r, y, c]) => [Math.sin(a) * r, y, Math.cos(a) * r, c]));
  }
  const pos = [];
  const col = [];
  const push = (p) => {
    pos.push(p[0], p[1], p[2]);
    col.push(p[3].r, p[3].g, p[3].b);
  };
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < grid[i].length - 1; j++) {
      const p00 = grid[i][j];
      const p10 = grid[i + 1][j];
      const p01 = grid[i][j + 1];
      const p11 = grid[i + 1][j + 1];
      push(p00); push(p10); push(p01); // topo para cima, paredão virado para a arena
      push(p10); push(p11); push(p01);
    }
  }
  const mesh = new THREE.Mesh(
    finish(pos, col),
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide }),
  );
  return { mesh, edge, top };
}

// Coluna/ilha solta: tampo + parede de pedra. Usada nas ilhas flutuantes e nos pilares do abismo.
export function rockColumn({ radius, depth, taper, seed, rock, topColor, segs = 14 }) {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(
    rockWallGeometry({ radius, depth, taper, seed, segs, rows: 6, jag: 0.35 }),
    new THREE.MeshStandardMaterial({ color: rock, vertexColors: true, flatShading: true, roughness: 1 }),
  );
  // tampo levemente abaulado (um disco chapado parece buraco visto de cima)
  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(radius + 0.1, Math.min(0.9, radius * 0.35), segs, 1),
    new THREE.MeshStandardMaterial({ color: topColor, flatShading: true, roughness: 0.95 }),
  );
  cap.position.y = Math.min(0.9, radius * 0.35) / 2 - 0.05;
  g.add(wall, cap);
  return g;
}

// Fundo do abismo
export function abyssBottom(kind, { abyss, glow, rand }) {
  const g = new THREE.Group();
  if (kind === 'clouds' || kind === 'mist') {
    // camadas de nuvem/névoa em profundidades diferentes: dá para ver o bicho atravessar
    const color = kind === 'clouds' ? '#ffffff' : new THREE.Color(abyss).lerp(new THREE.Color('#ffffff'), 0.25);
    const mat = new THREE.MeshStandardMaterial({
      color, flatShading: true, transparent: true, opacity: kind === 'clouds' ? 0.92 : 0.38, depthWrite: false,
    });
    const layers = kind === 'clouds' ? [-30, -42, -56] : [-18, -30, -44];
    for (const y of layers) {
      const count = kind === 'clouds' ? 12 : 10;
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2;
        const r = 4 + rand() * 45;
        const size = kind === 'clouds' ? 3 + rand() * 4 : 7 + rand() * 7;
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), mat);
        puff.position.set(Math.sin(a) * r, y + rand() * 3, Math.cos(a) * r);
        puff.scale.y = kind === 'clouds' ? 0.4 : 0.12;
        g.add(puff);
        gsap.to(puff.position, { x: puff.position.x + 2 + rand() * 3, duration: 7 + rand() * 6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      }
    }
  }
  if (kind === 'lava') {
    const lava = new THREE.Mesh(
      new THREE.CircleGeometry(140, 40).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#ff5a1f', emissive: '#ff3300', emissiveIntensity: 1.6, fog: false }),
    );
    lava.position.y = -46;
    g.add(lava);
    // manchas mais claras na lava
    const hot = new THREE.MeshBasicMaterial({ color: '#ffd166', fog: false });
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2;
      const r = 3 + rand() * 50;
      const blob = new THREE.Mesh(new THREE.CircleGeometry(0.8 + rand() * 2.4, 7).rotateX(-Math.PI / 2), hot);
      blob.position.set(Math.sin(a) * r, -45.9, Math.cos(a) * r);
      g.add(blob);
      gsap.to(blob.scale, { x: 1.5, z: 1.5, duration: 1.5 + rand() * 2, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }
  }
  if (kind === 'grid') {
    // anéis de neon cada vez mais fundos, ecoando os anéis da arena
    const mat = new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.7, fog: false });
    [[-14, 16], [-24, 26], [-36, 38], [-50, 52]].forEach(([y, r], i) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 96, 1).rotateX(-Math.PI / 2), mat);
      ring.position.y = y;
      ring.material = mat.clone();
      ring.material.opacity = 0.75 - i * 0.15;
      g.add(ring);
    });
  }
  return g;
}
