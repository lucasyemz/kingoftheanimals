// Three.js: renderer, câmera fixa a 55°, luz, arena em anéis e o cenário atual.
// Trocar de cenário é trocar a configuração (céu, chão, luz, neblina, props),
// sem carregar outra cena.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
import gsap from 'gsap';
import { ARENA, CAMERA, SCENARIOS, MOBILE } from '../../shared/constants.js';
import { seeded, rockWallGeometry, canyon, rockColumn, abyssBottom } from './scenery.js';
import { settings } from './settings.js';

export const IS_MOBILE = matchMedia('(pointer: coarse)').matches;
const PORTRAIT_ASPECT = 0.8;
// Gráfico leve: sem sombra, sem bloom, metade dos props e partículas. Automático no celular.
// autoLow: numa visita anterior o aparelho engasgou e o jogo baixou a qualidade sozinho
export const LOW_GFX = settings.graphics === 'low' || (settings.graphics === 'auto' && (IS_MOBILE || settings.autoLow));

const RING_COUNT = Math.round((ARENA.RADIUS - ARENA.MIN_RADIUS) / ARENA.RING_WIDTH);
const WARNING_COLOR = new THREE.Color('#ff2a2a');

const SKY_SHADER = {
  vertexShader: `
    varying vec3 vPos;
    void main() {
      vPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 top;
    uniform vec3 bottom;
    varying vec3 vPos;
    void main() {
      float h = normalize(vPos).y;
      gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.35, 0.6, h)), 1.0);
    }`,
};

// Formas simples enquanto os modelos dos props não carregam (ou se faltarem).
function placeholderProp(key) {
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true });
  const g = new THREE.Group();
  switch (key) {
    case 'tree':
    case 'pine': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.8, 6), mat('#7a5230'));
      trunk.position.y = 0.4;
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.8, 7), mat(key === 'pine' ? '#2f6b4f' : '#4caf50'));
      top.position.y = 1.6;
      g.add(trunk, top);
      break;
    }
    case 'cactus': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.8, 7), mat('#3f9b4a'));
      body.position.y = 0.9;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.7, 6), mat('#3f9b4a'));
      arm.position.set(0.35, 1.1, 0);
      g.add(body, arm);
      break;
    }
    case 'crystal': {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), mat('#9b5de5'));
      c.scale.y = 1.8;
      c.position.y = 1;
      g.add(c);
      break;
    }
    default: {
      const color = key === 'snowRock' ? '#e8f1f7' : key === 'darkRock' ? '#3b3333' : '#8d8d8d';
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7), mat(color));
      r.position.y = 0.4;
      r.scale.set(1.2, 0.8, 1);
      g.add(r);
    }
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW_GFX, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, LOW_GFX ? 1.5 : 2));
  renderer.shadowMap.enabled = !LOW_GFX || MOBILE.SHADOWS;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.FOV, 1, 0.1, 400);

  // Céu em gradiente
  const skyMat = new THREE.ShaderMaterial({
    ...SKY_SHADER,
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 24, 12), skyMat);
  scene.add(sky);

  // Luz
  const hemi = new THREE.HemisphereLight('#ffffff', '#445566', 0.8);
  const sun = new THREE.DirectionalLight('#ffffff', 2);
  sun.position.set(8, 18, 6);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 50 });
  const under = new THREE.PointLight('#ff6a3d', 0, 110, 1.1); // luz vinda de baixo (Lava Pit)
  under.position.set(0, -24, 0);
  scene.add(hemi, sun, under);

  // Arena: miolo + anéis separados, para cada um poder cair sozinho.
  // Cada anel é um pedaço de coluna de pedra que desce até sumir na névoa do abismo.
  const arena = new THREE.Group();
  scene.add(arena);
  const topMats = [];
  const wallMats = [];
  const edgeMats = [];
  const rings = [];
  let arenaShape = '';

  function buildArena(depth) {
    const key = `${depth.shape}:${depth.pillar}:${depth.taper}`;
    if (key === arenaShape) return;
    arenaShape = key;
    arena.clear();
    rings.length = 0;
    topMats.length = 0;
    wallMats.length = 0;
    edgeMats.length = 0;
    for (let i = 0; i <= RING_COUNT; i++) {
      // i = 0 é o anel de fora; o último é o miolo
      const outer = ARENA.RADIUS - i * ARENA.RING_WIDTH;
      const inner = i === RING_COUNT ? 0 : outer - ARENA.RING_WIDTH;
      const top = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
      const wall = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide });
      const edge = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 });
      const capGeo = inner > 0 ? new THREE.RingGeometry(inner, outer, 48, 1) : new THREE.CircleGeometry(outer, 48);
      capGeo.rotateX(-Math.PI / 2);
      const cap = new THREE.Mesh(capGeo, top);
      cap.receiveShadow = true;
      const side = new THREE.Mesh(
        rockWallGeometry({ radius: outer, depth: depth.pillar * (1 - i * 0.04), taper: depth.taper, seed: 101 + i * 17, jag: i === 0 ? 0.5 : 0.3 }),
        wall,
      );
      side.receiveShadow = true;
      const rim = new THREE.Mesh(new THREE.RingGeometry(outer - 0.09, outer, 64, 1).rotateX(-Math.PI / 2), edge);
      rim.position.y = 0.02;
      const group = new THREE.Group();
      group.add(cap, side, rim);
      group.userData = { index: i, shade: i % 2 ? 0.94 : 1, rim };
      topMats.push(top);
      wallMats.push(wall);
      edgeMats.push(edge);
      rings.push(group);
      arena.add(group);
    }
  }

  // Em volta: paredões ou ilhas, pilares no abismo, fundo e props (refeito a cada cenário)
  const surround = new THREE.Group();
  scene.add(surround);
  const propModels = {};
  const tintedCache = {};
  const gltfLoader = new GLTFLoader();
  const DETAIL = LOW_GFX ? 0.5 : 1;

  // Pós-processamento (bloom só em Lava Pit e Neon Night, nunca no celular)
  let composer = null;
  if (!LOW_GFX || MOBILE.BLOOM) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new EffectPass(camera, new BloomEffect({ intensity: 1.2, luminanceThreshold: 0.55, mipmapBlur: true })));
  }

  const world = {
    renderer, scene, camera, arena, rings,
    scenarioId: null,
    bloom: false,
    targetRadius: ARENA.RADIUS,
    viewRadius: ARENA.RADIUS,
    shake: { power: 0 },
    focus: new THREE.Vector3(),
    focusZoom: 1,
    focusY: 0,       // altura que a câmera mira (Chão que some: o andar mais alto com gente)
    targetFocusY: 0,
    time: 0,
  };

  world.loadProps = async (manifestProps = {}) => {
    await Promise.all(
      Object.entries(manifestProps).map(async ([key, file]) => {
        try {
          const gltf = await gltfLoader.loadAsync(file);
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          // altura 1 m; cada cenário escala para a altura que quiser (a coroa mede 0,6 m)
          const scale = key === 'crown' ? 0.6 / Math.max(size.x, size.y, size.z) : 1 / size.y;
          model.scale.setScalar(scale);
          model.position.y = -box.min.y * scale;
          const holder = new THREE.Group();
          holder.add(model);
          propModels[key] = holder;
        } catch {
          // fica o placeholder
        }
      }),
    );
    if (world.scenarioId) buildSurround(SCENARIOS[world.scenarioId], world.scenarioId);
  };

  world.propModel = (key) => (propModels[key] ? propModels[key].clone() : placeholderProp(key));

  // Prop com a altura pedida e, se o cenário pedir, coberto de neve/cinza
  function prop(key, height, tint) {
    let src = propModels[key];
    if (src && tint) {
      const id = `${key}|${tint[0]}|${tint[1]}`;
      if (!tintedCache[id]) {
        const t = src.clone();
        const color = new THREE.Color(tint[0]);
        t.traverse((o) => {
          if (!o.isMesh) return;
          o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
          for (const m of [].concat(o.material)) m.color?.lerp(color, tint[1]);
        });
        tintedCache[id] = t;
      }
      src = tintedCache[id];
    }
    const p = src ? src.clone() : placeholderProp(key);
    p.scale.setScalar(src ? height : height / 2);
    return p;
  }

  function buildSurround(sc, id) {
    surround.traverse((o) => gsap.killTweensOf(o.position));
    surround.clear();
    const d = sc.depth;
    const rand = seeded(id.length * 7919 + 13);
    const placeProps = (count, where) => {
      for (let i = 0; i < count; i++) {
        const [key, h] = d.props[Math.floor(rand() * d.props.length)];
        const spot = where();
        if (!spot) continue;
        const p = prop(key, h * (0.6 + rand() * 0.45), d.tint);
        p.position.set(spot.x, spot.y, spot.z);
        p.rotation.y = rand() * Math.PI * 2;
        surround.add(p);
      }
    };

    if (d.walls) {
      const c = canyon({ seed: id.length * 31 + 7, rock: d.rock, rim: d.rim, abyss: d.abyss, strata: d.strata, segs: LOW_GFX ? 56 : 80 });
      surround.add(c.mesh);
      // props no topo dos paredões dos lados e do fundo (na frente ficariam enormes, perto da câmera)
      placeProps(Math.round(80 * DETAIL), () => {
        const a = rand() * Math.PI * 2;
        if (Math.cos(a) > 0.3) return null;
        const r = c.edge(a) + 1.4 + rand() * 9;
        return { x: Math.sin(a) * r, y: c.top(a), z: Math.cos(a) * r };
      });
      // pilares saindo do abismo entre a arena e os paredões (profundidade em camadas)
      for (let i = 0; i < Math.round(12 * DETAIL); i++) {
        const a = Math.PI * (0.3 + rand() * 1.4); // dos lados e atrás, nunca na frente da câmera
        const r = 13 + rand() * Math.max(1, c.edge(a) - 15.5);
        const radius = 0.8 + rand() * 1.4;
        const col = rockColumn({ radius, depth: 60, taper: 0.15, seed: 500 + i, rock: d.rock, topColor: d.rim });
        col.position.set(Math.sin(a) * r, -6 - rand() * 16, Math.cos(a) * r);
        surround.add(col);
        if (rand() < 0.7) {
          const [key, h] = d.props[Math.floor(rand() * d.props.length)];
          const p = prop(key, h * 0.8, d.tint);
          p.position.copy(col.position);
          surround.add(p);
        }
      }
    } else {
      // ilhas flutuantes em várias profundidades: quanto mais funda, menor
      const islands = Math.round(22 * DETAIL);
      for (let i = 0; i < islands; i++) {
        const a = rand() * Math.PI * 2;
        const front = (Math.cos(a) + 1) / 2;
        const r = 14 + rand() * 34;
        const y = -2 - rand() * 26 - front * 8;
        const radius = Math.max(1.2, 4.2 - (-y / 30) * 2.4 + rand() * 1.2);
        const island = rockColumn({ radius, depth: radius * 2.6, taper: 0.85, seed: 900 + i, rock: d.rock, topColor: d.rim });
        island.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
        surround.add(island);
        const n = 1 + Math.floor(rand() * Math.min(4, radius));
        for (let k = 0; k < n; k++) {
          const [key, h] = d.props[Math.floor(rand() * d.props.length)];
          const p = prop(key, h * (0.7 + rand() * 0.4), d.tint);
          const pa = rand() * Math.PI * 2;
          const pr = rand() * radius * 0.6;
          p.position.set(island.position.x + Math.sin(pa) * pr, y, island.position.z + Math.cos(pa) * pr);
          p.rotation.y = rand() * 6.28;
          surround.add(p);
        }
        // balanço lento: as ilhas "flutuam"
        const bob = [island, ...surround.children.slice(-n)];
        for (const o of bob) gsap.to(o.position, { y: o.position.y + 0.5, duration: 3 + (i % 4), yoyo: true, repeat: -1, ease: 'sine.inOut' });
      }
    }

    surround.add(abyssBottom(d.bottom, { abyss: d.abyss, glow: sc.edgeGlow ?? '#4cc9f0', rand }));
  }

  world.setScenario = (id) => {
    const sc = SCENARIOS[id] ?? SCENARIOS.sky;
    world.scenarioId = id;
    skyMat.uniforms.top.value.set(sc.sky[0]);
    skyMat.uniforms.bottom.value.set(sc.sky[1]);
    scene.fog = new THREE.Fog(sc.fog.color, sc.fog.near, sc.fog.far);
    hemi.intensity = sc.light.ambient;
    hemi.groundColor.set(sc.fog.color);
    sun.color.set(sc.light.color);
    sun.intensity = sc.light.intensity;
    under.intensity = sc.light.fromBelow ? 220 : 0;
    buildArena(sc.depth);
    const base = new THREE.Color(sc.ground);
    rings.forEach((m, i) => {
      topMats[i].color.copy(base).multiplyScalar(m.userData.shade);
      wallMats[i].color.set(sc.depth.rock).lerp(new THREE.Color('#ffffff'), 0.12); // um tom acima dos paredões
      wallMats[i].emissive.set(sc.edgeGlow ?? '#000000');
      wallMats[i].emissiveIntensity = sc.edgeGlow ? 0.15 : 0;
      edgeMats[i].color.set(sc.edgeGlow ?? '#000000');
      m.userData.rim.visible = !!sc.edgeGlow;
    });
    world.bloom = !!sc.bloom && !!composer && !world.lowQuality;
    buildSurround(sc, id);
  };

  // Volta todos os anéis para o lugar (começo de rodada)
  world.resetArena = () => {
    for (const m of rings) {
      gsap.killTweensOf(m.position);
      gsap.killTweensOf(m.rotation);
      m.visible = true;
      m.position.set(0, 0, 0);
      m.rotation.set(0, 0, 0);
      m.scale.set(1, 1, 1);
    }
    world.warningRing = -1;
    world.setArenaRadius(ARENA.RADIUS, true);
  };

  // Chão que some: a arena de anéis some e os hexágonos aparecem no lugar
  world.setArenaHidden = (hidden) => {
    arena.visible = !hidden;
  };

  world.setWarning = (index) => {
    world.warningRing = index;
  };

  world.dropRing = (index) => {
    const m = rings[index];
    if (!m) return;
    world.warningRing = -1;
    gsap.to(m.position, { y: -70, duration: 2.4, ease: 'power2.in' });
    gsap.to(m.rotation, { x: (Math.random() - 0.5) * 0.25, z: (Math.random() - 0.5) * 0.25, duration: 2.4, ease: 'power1.in', onComplete: () => (m.visible = false) });
  };

  // Morte súbita: o miolo encolhe até sumir
  world.syncArena = (radius) => {
    const core = rings[RING_COUNT];
    const s = Math.max(0.001, Math.min(1, radius / ARENA.MIN_RADIUS));
    core.scale.set(s, 1, s);
    core.visible = radius > 0.02;
    // garante que anéis que já caíram somem (ex.: quem entrou no meio da rodada)
    rings.forEach((m, i) => {
      if (i < RING_COUNT && ARENA.RADIUS - i * ARENA.RING_WIDTH > radius + 0.01 && !gsap.isTweening(m.position)) m.visible = false;
    });
  };

  // Soap Floor: chão brilhante e azulado enquanto vale
  world.setSoap = (on) => {
    if (world.soap === on) return;
    world.soap = on;
    for (const m of topMats) {
      m.roughness = on ? 0.15 : 0.9;
      m.metalness = on ? 0.25 : 0;
    }
  };

  world.setArenaRadius = (r, instant = false) => {
    world.targetRadius = Math.max(r, 3.5);
    if (instant) world.viewRadius = world.targetRadius;
  };

  world.shakeCamera = ({ duration, strength }) => {
    gsap.killTweensOf(world.shake);
    world.shake.power = strength;
    gsap.to(world.shake, { power: 0, duration, ease: 'power2.out' });
  };

  // Foco da câmera (zoom no vencedor da rodada / no pódio)
  world.focusOn = (x, z, zoom, duration = 0.5) => {
    gsap.to(world.focus, { x, z, duration, ease: 'power2.out', overwrite: true });
    gsap.to(world, { focusZoom: zoom, duration, ease: 'power2.out', overwrite: true });
  };

  // Qualidade automática: corta sombra, bloom e resolução sem recarregar a página
  world.lowQuality = LOW_GFX;
  world.setLowQuality = () => {
    if (world.lowQuality) return;
    world.lowQuality = true;
    world.bloom = false;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
    renderer.shadowMap.enabled = false;
    sun.castShadow = false;
    scene.traverse((o) => {
      if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true));
    });
    world.resize();
  };

  // Câmera de espectador: segue um ponto suavemente, a cada quadro
  world.follow = (x, z, zoom, dt) => {
    gsap.killTweensOf(world.focus);
    gsap.killTweensOf(world, 'focusZoom');
    const k = Math.min(1, dt * 4);
    world.focus.x += (x - world.focus.x) * k;
    world.focus.z += (z - world.focus.z) * k;
    world.focusZoom += (zoom - world.focusZoom) * k;
  };

  // Chão que some: a câmera desce junto com o andar mais alto que ainda tem bicho
  world.setFocusY = (y, instant = false) => {
    world.targetFocusY = y;
    if (instant) world.focusY = y;
  };

  world.resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    // Celular em pé: a arena sobe um pouco, longe dos botões de baixo
    if (camera.aspect < PORTRAIT_ASPECT) camera.setViewOffset(w, h, 0, h * 0.04, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', world.resize);
  world.resize();

  const tilt = THREE.MathUtils.degToRad(CAMERA.TILT_DEG);
  world.render = (dt) => {
    world.time += dt;
    world.viewRadius += (world.targetRadius - world.viewRadius) * Math.min(1, dt / CAMERA.ZOOM_TWEEN * 3);
    const half = THREE.MathUtils.degToRad(CAMERA.FOV / 2);
    // em pé a largura é o limite: a arena ocupa mais da tela para os bichos não ficarem minúsculos
    const fit = world.viewRadius * (camera.aspect < PORTRAIT_ASPECT ? CAMERA.FRAME_MARGIN_PORTRAIT : CAMERA.FRAME_MARGIN);
    // De cima a 55°, a profundidade da arena aparece encurtada (× sen 55°)
    const fitV = fit * Math.sin(tilt) * 1.15;
    const dist = Math.max(fitV / Math.tan(half), fit / (Math.tan(half) * camera.aspect)) * world.focusZoom;
    world.focusY += (world.targetFocusY - world.focusY) * Math.min(1, dt * 3);
    const s = world.shake.power;
    camera.position.set(
      world.focus.x + (Math.random() - 0.5) * s,
      world.focusY + Math.sin(tilt) * dist + (Math.random() - 0.5) * s,
      world.focus.z + Math.cos(tilt) * dist,
    );
    camera.lookAt(world.focus.x, world.focusY, world.focus.z);

    // Anel piscando vermelho antes de cair
    rings.forEach((m, i) => {
      const on = i === world.warningRing && Math.sin(world.time * 18) > 0;
      if (on) topMats[i].emissive.copy(WARNING_COLOR);
      else topMats[i].emissive.setRGB(0, world.soap ? 0.12 : 0, world.soap ? 0.3 : 0);
      topMats[i].emissiveIntensity = on || world.soap ? 0.9 : 0;
    });

    if (world.bloom) composer.render(dt);
    else renderer.render(scene, camera);
  };

  world.setScenario('sky');
  return world;
}

export { RING_COUNT };
