// Todas as constantes do jogo: física, tempos, power-ups, bots, cenários.
// Unidades: metros, segundos e m/s, salvo quando o nome diz outra coisa (_MS, _DEG).
// Valores marcados "GDD" vêm direto das tabelas; "definido" foi escolhido aqui
// porque o GDD não fixa o número. Ajuste jogando.

// ---------- Rede e sala ----------

export const NET = {
  TICK_RATE: 30,              // GDD: servidor a 30 Hz
  TICK_DT: 1 / 30,
  INPUT_RATE: 30,             // GDD: input 30/s
  INTERP_DELAY_MS: 100,       // GDD: cliente desenha 100 ms atrás
  // definido: se a conexão engasga (states chegando em rajadas), o atraso cresce
  // sozinho até este teto para os outros bichos não travarem; volta a 100 ms quando melhora.
  MAX_INTERP_DELAY_MS: 400,
  // definido: o próprio bicho é previsto no navegador; a correção do servidor
  // é diluída (decai 12× por segundo) e só "teleporta" se o erro passar de 3 m.
  SELF_ERROR_DECAY: 12,
  SELF_SNAP_DISTANCE: 3,
  PING_INTERVAL_MS: 1000,     // definido: 1 input por segundo pede ack para medir o ping
  // definido: heartbeat do Socket.io (padrão 25 s). O link público do Studio corta
  // requisições com mais de 10 s e não aceita WebSocket, então a conexão cai para
  // long-polling; com 5 s cada poll volta antes do corte. No deploy (Render etc.)
  // o WebSocket funciona e isso não atrapalha.
  SOCKET_PING_INTERVAL_MS: 5000,
  SOCKET_PING_TIMEOUT_MS: 5000,
};

export const ROOM = {
  MAX_PLAYERS: 8,             // GDD: 2 a 8 por sala, somando bots
  MIN_PLAYERS: 2,             // GDD: dá para começar sozinho com 1 bot
  CODE_LENGTH: 4,             // GDD: código de 4 letras
  CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // definido: sem I e O, que confundem com 1 e 0
  NICKNAME_MAX: 12,           // definido
  // definido: quem entra no meio da partida assiste como espectador e joga a partir do Rematch
  JOIN_MID_MATCH_AS_SPECTATOR: true,
};

// GDD: cor fixa pela ordem de entrada na sala
export const PLAYER_COLORS = [
  '#E63946', // vermelho
  '#F4A261', // laranja
  '#F9C74F', // amarelo
  '#43AA8B', // verde
  '#4CC9F0', // ciano
  '#4361EE', // azul
  '#9B5DE5', // roxo
  '#F15BB5', // rosa
];

// Ids dos bichos. O nome de tela fica em strings.js e o arquivo .glb é mapeado
// em animals.js depois de baixar o pack (Kenney Cube Pets, CC0).
export const ANIMALS = ['duck', 'pig', 'cow', 'penguin', 'panda', 'bunny', 'cat', 'dog'];

// ---------- Física (GDD: tabela de Mecânicas) ----------

export const PHYSICS = {
  ANIMAL_RADIUS: 0.6,
  MAX_SPEED: 6,
  ACCEL: 30,
  // Multiplicador da velocidade por tick de 1/30 s. Com ?slowmo, use
  // Math.pow(FRICTION, dt / NET.TICK_DT) para o atrito não mudar com o dt.
  FRICTION: 0.88,
  DASH_SPEED: 16,
  DASH_DURATION: 0.15,        // durante o dash não há atrito nem controle
  DASH_COOLDOWN: 1.2,
  PUSH_FACTOR: 1.5,           // empurrão = 1,5 × velocidade relativa
  DASH_PUSH_FACTOR: 2.5,      // quem está em dash empurra 2,5 ×
  STUN_DURATION: 0.3,
  FALL_DURATION: 1.5,
  FALL_DRAG: 0.85,            // definido: velocidade horizontal × 0,85 por tick durante a queda
  KO_CREDIT_WINDOW: 3,        // GDD: último que encostou nos 3 s antes da queda leva o crédito
  DEAD_ZONE: 0.15,            // definido: input menor que isso conta como parado
  DASH_BUFFER: 0.1,           // definido: dash apertado um pouco antes da recarga ainda vale
  // definido: o impulso da colisão é dividido entre os dois bichos pelo "quanto
  // aceita ser empurrado" (1 normal, 0,25 Heavyweight). Dois iguais: metade cada.
};

// ---------- Arena (GDD: raio 10 m, anel de 1,5 m a cada 15 s) ----------

export const ARENA = {
  RADIUS: 10,
  RING_WIDTH: 1.5,
  RING_INTERVAL: 15,
  RING_WARNING: 2,            // o anel pisca vermelho 2 s antes de cair
  // definido: os anéis param quando sobra um miolo de 1 m (10 - 6 × 1,5).
  // Só a morte súbita come o miolo.
  MIN_RADIUS: 1,
  SPAWN_RADIUS: 8,            // definido: todos nascem em círculo no anel de dentro da borda
  SUDDEN_DEATH_SHRINK: 0.5,   // definido: m/s de encolhimento contínuo depois dos 90 s
};

// ---------- Partida e rodadas ----------

export const MATCH = {
  WINS_TO_WIN: 3,             // GDD: primeiro a 3 vitórias
  MAX_ROUNDS: 5,              // GDD: melhor de 5
  // PROPOSTA, aguardando o "ok": com 3+ jogadores pode não haver 3 vitórias em
  // 5 rodadas. Aí vence quem tem mais; se empatar, rodadas extras (cenários
  // continuam na ordem) até alguém ficar na frente sozinho.
  TIEBREAK_EXTRA_ROUNDS: true,
  COUNTDOWN: 3,               // GDD: "3, 2, 1, GO!" — 1 s por número
  GO_HOLD: 0.6,               // definido: tempo do "GO!" na tela; o jogo já roda
  ROUND_MAX_TIME: 90,         // GDD: depois disso, morte súbita
  ROUND_END_SLOWMO: 0.5,      // GDD: câmera lenta de 0,5 s no fim da rodada
  ROUND_END_SLOWMO_SCALE: 0.3, // definido: velocidade da simulação durante a câmera lenta
  SCOREBOARD_TIME: 5,         // GDD: placar entre rodadas
  // definido: se dois caem no mesmo tick, vence quem estava mais perto do centro
  SAME_TICK_TIEBREAK: 'closestToCenter',
};

// ---------- Power-ups (GDD: tabela de Power-ups) ----------

export const POWERUPS = {
  SPAWN_INTERVAL: 8,
  MAX_ON_ARENA: 2,
  BOX_RADIUS: 0.4,            // definido: pega quando encosta (raio do bicho + raio da caixa)
  SPAWN_MARGIN: 2,            // definido: nasce a 2 m da borda atual, longe do anel que vai cair
  DEBUG_SPAWN_INTERVAL: 2,    // GDD: ?powerup=... aparece a cada 2 s
  TYPES: {
    coffee: { weight: 35, duration: 5, speedMult: 1.5, dashCooldownMult: 0.5 }, // velocidade máx. e aceleração
    bomb:   { weight: 25, duration: 0, radius: 3, impulse: 14, stun: 0.3 },     // impulse definido; conta como derrubada
    heavy:  { weight: 20, duration: 6, scale: 1.5, pushTakenMult: 0.25 },       // raio de colisão também × 1,5; pushTakenMult definido
    soap:   { weight: 20, duration: 6, friction: 0.97 },                        // vale para todos; GDD: "chão escorregadio usa 0,97"
  },
  ICON_LETTER: { coffee: 'C', bomb: 'B', heavy: 'H', soap: 'S' }, // placeholder: cubo com a letra
};

// ---------- Bots (GDD: tabela de Bots) ----------

export const BOTS = {
  MAX: 7,
  DEFAULT_COUNT: 3,           // definido
  DEFAULT_DIFFICULTY: 'medium',
  REPLACE_LEAVER: 'medium',   // GDD: bot médio assume quem sai
  THINK_INTERVAL: 0.1,        // definido: reavalia 10 × por segundo; o atraso real vem de reactionMs
  DASH_RANGE: 2.4,            // = DASH_SPEED × DASH_DURATION
  DASH_LINE_MAX_DEG: 30,      // definido: "alvo na linha para fora" = ângulo bot→alvo vs centro→alvo
  KING_TARGET_WEIGHT: 2,      // GDD: o rei conta como 2 alvos
  POSITION_OFFSET: 1.6,       // definido: fica 1,6 m entre o alvo e o centro antes do dash
  POSITION_REROLL: 1.5,       // definido: "às vezes" é sorteado de novo a cada 1,5 s
  DODGE_RANGE: 4,             // definido: só desvia de dash vindo a menos de 4 m
  DODGE_ANGLE_DEG: 25,        // definido: e apontado para ele
  NAME_ADJECTIVE_COUNT: 12,   // strings.botAdjectives precisa ter 12 itens ("Brakeless", "Turbo"...)
  DIFFICULTY: {
    //               reação  mira±  borda  ignora PU  posiciona  desvia
    easy:   { reactionMs: 600, aimErrorDeg: 35, edgeSense: 1,   ignorePowerup: 0.6, positionChance: 0,   dodgeChance: 0 },
    medium: { reactionMs: 300, aimErrorDeg: 15, edgeSense: 2,   ignorePowerup: 0.3, positionChance: 0.5, dodgeChance: 0.3 },
    hard:   { reactionMs: 120, aimErrorDeg: 5,  edgeSense: 3.5, ignorePowerup: 0,   positionChance: 1,   dodgeChance: 0.7 },
  },
};

// ---------- Emotes e coroa ----------

export const EMOTES = {
  COUNT: 4,                   // 1 "LOL", 2 "Come at me!", 3 "Noooo", 4 "GG" (texto em strings.js)
  SHOW_TIME: 2,
  COOLDOWN: 3,
};

export const AWARDS = ['champion', 'bully', 'kamikaze', 'survivor', 'kingslayer'];

// ---------- Cenários (GDD: um por rodada, sempre nesta ordem) ----------

export const SCENARIO_ORDER = ['sky', 'frozen', 'desert', 'lava', 'neon'];
export const SCENARIO_ORDER_SHORT = ['sky', 'frozen', 'lava']; // GDD: corte por tempo

// physics: só as constantes que mudam (o resto vem de PHYSICS / ARENA).
// depth: o cenário em volta da arena, para a queda parecer funda.
//   shape   'pillar' (coluna de pedra no meio de um cânion) | 'island' (ilha flutuante)
//   pillar  quantos metros a arena desce até sumir na névoa; taper = quanto afina embaixo
//   rock    cor da pedra; rim = topo dos paredões; abyss = cor lá no fundo (neblina)
//   walls   paredões do cânion em volta (false = ilhas flutuantes soltas no vazio)
//   bottom  o que há no fundo: 'clouds' | 'mist' | 'lava' | 'grid'
//   props   modelos CC0 da Kenney (chave do assets.json, altura em metros)
//   tint    cobre os props com uma cor (neve, cinza) na proporção indicada
// Cores e alturas são ponto de partida para o scene.js; ajuste ao ver na tela.
export const SCENARIOS = {
  sky: {
    physics: {},
    sky: ['#5BB8F5', '#CFEFFF'],  // topo, horizonte
    ground: '#7BC96F',
    fog: { color: '#BFE6FF', near: 32, far: 110 },
    light: { color: '#FFFFFF', intensity: 2.2, ambient: 0.8 },
    depth: {
      shape: 'island', pillar: 16, taper: 0.82, rock: '#9A7553', rim: '#7BC96F', abyss: '#BFE6FF',
      walls: false, bottom: 'clouds',
      props: [['nk_tree_oak', 3.6], ['nk_tree_default', 4.4], ['nk_tree_fat', 3.2], ['nk_plant_bushLarge', 1.1], ['nk_flower_redA', 0.6], ['nk_rock_largeA', 1.2]],
    },
    particles: null,
    bloom: false,
  },
  frozen: {
    physics: { FRICTION: 0.94 },  // GDD: chão escorregadio
    sky: ['#6FA3D8', '#123563'],
    ground: '#DDEFF8',
    fog: { color: '#0A2142', near: 40, far: 130 },
    light: { color: '#E8F4FF', intensity: 2.2, ambient: 1.0 },
    depth: {
      shape: 'pillar', pillar: 46, taper: 0.22, rock: '#5C86BC', rim: '#EAF4FF', abyss: '#0A2142',
      walls: true, bottom: 'mist',
      props: [['nk_tree_pineTallA_detailed', 5.5], ['nk_tree_pineRoundC', 4], ['nk_tree_pineSmallA', 2.6], ['nk_stone_tallA', 2.4], ['nk_stone_largeA', 1.4]],
      tint: ['#F2F8FF', 0.3],
    },
    particles: 'snow',
    bloom: false,
  },
  desert: {
    physics: {},
    sky: ['#F08A4B', '#FFD59E'],
    ground: '#E6C27A',
    fog: { color: '#3F1A10', near: 40, far: 130 },
    light: { color: '#FFC58A', intensity: 2.4, ambient: 0.7 },
    depth: {
      shape: 'pillar', pillar: 46, taper: 0.18, rock: '#C46A3C', rim: '#E9B97C', abyss: '#3F1A10',
      walls: true, bottom: 'mist', strata: true,
      props: [['cactus', 3.2], ['nk_cactus_short', 1.8], ['nk_rock_tallB', 2.8], ['nk_stump_old', 0.9], ['nk_stone_largeD', 1.6]],
    },
    particles: null,
    bloom: false,
  },
  lava: {
    physics: { RING_INTERVAL: 12 }, // GDD: arena encolhe mais rápido
    sky: ['#1A0B0B', '#5A1A0E'],
    ground: '#4A4040',
    fog: { color: '#2E0A04', near: 40, far: 130 },
    light: { color: '#FFB08A', intensity: 2.0, ambient: 0.7, fromBelow: true },
    depth: {
      shape: 'pillar', pillar: 40, taper: 0.25, rock: '#5A3A30', rim: '#3A2C2A', abyss: '#2E0A04',
      walls: true, bottom: 'lava',
      props: [['nk_tree_thin_dark', 3.8], ['nk_stone_tallC', 3.2], ['nk_stone_largeD', 1.8], ['crystal', 1.4], ['nk_statue_columnDamaged', 2.8]],
      tint: ['#2E2626', 0.55],
    },
    particles: 'embers',
    bloom: true,
  },
  neon: {
    physics: {},
    sky: ['#05030F', '#1B0F3A'],
    ground: '#2B2550',
    edgeGlow: '#4CC9F0',
    fog: { color: '#120A2E', near: 32, far: 105 },
    light: { color: '#D2C6FF', intensity: 2.4, ambient: 1.1 },
    depth: {
      shape: 'island', pillar: 30, taper: 0.5, rock: '#2A2350', rim: '#2B2550', abyss: '#120A2E',
      walls: false, bottom: 'grid',
      props: [['nk_statue_column', 3.4], ['nk_statue_obelisk', 3.2], ['crystal', 1.6], ['nk_statue_columnDamaged', 2.4]],
    },
    particles: 'stars',
    bloom: true,
  },
};

// ---------- Câmera e game feel (cliente) ----------

export const CAMERA = {
  TILT_DEG: 55,               // GDD: de cima, 55° de inclinação
  FOV: 45,                    // definido
  FRAME_MARGIN: 1.25,         // definido: enquadra o raio da arena × 1,25
  ZOOM_TWEEN: 1.0,            // definido: segundos para aproximar quando um anel cai
};

export const FX = {
  HIT_STOP_MS: 50,            // GDD
  SHAKE_HIT: { duration: 0.15, strength: 0.25 },  // GDD: 0,15 s; força definida
  SHAKE_RING: { duration: 0.3, strength: 0.1 },   // GDD: tremor leve
  SHAKE_BOMB: { duration: 0.4, strength: 0.5 },   // GDD: tremor forte
  DASH_STRETCH: 0.2,          // GDD: estica 20 % por 0,15 s
  HIT_SQUASH: 0.3,            // definido: achata 30 % no impacto
  FALL_SPIN_DEG: 720,         // GDD: gira 720° e some em 1,5 s
  FALL_DEPTH: 30,             // definido: quantos metros o bicho despenca no abismo em 1,5 s
  BOING_RATE: [0.85, 1.25],   // definido: faixa de tom aleatório do "boing"
  VOICE_RATE: [0.9, 1.15],    // definido: variação de tom dos gritos
};

export const MOBILE = {
  MIN_FPS: 30,                // GDD
  SHADOWS: false,             // GDD: sombras desligadas no celular
  BLOOM: false,               // GDD: bloom desligado no celular
  PARTICLE_SCALE: 0.5,        // definido: metade das partículas
  MIN_BUTTON_PX: 48,          // GDD: guia visual
};

// ---------- Atalhos de debug (GDD: ligados fora de produção ou com ?debug=1) ----------

export const DEBUG_PARAMS = ['debug', 'bots', 'difficulty', 'scenario', 'round', 'powerup', 'slowmo', 'nofall', 'offline'];
