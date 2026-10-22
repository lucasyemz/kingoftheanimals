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
  // definido (era 1,5 e 2,5 do GDD): rodadas com 8 bots médios duravam ~20 s.
  // Com 1,0 e 1,8 + nascer a 6 m + bots médios mais atentos à borda, ~35 s.
  PUSH_FACTOR: 1.0,           // empurrão = 1,0 × velocidade relativa
  DASH_PUSH_FACTOR: 1.8,      // quem está em dash empurra 1,8 ×
  STUN_DURATION: 0.3,
  FALL_DURATION: 1.5,
  FALL_DRAG: 0.85,            // definido: velocidade horizontal × 0,85 por tick durante a queda
  KO_CREDIT_WINDOW: 3,        // GDD: último que encostou nos 3 s antes da queda leva o crédito
  DEAD_ZONE: 0.15,            // definido: input menor que isso conta como parado
  DASH_BUFFER: 0.1,           // definido: dash apertado um pouco antes da recarga ainda vale
  // Pulo (definido): ~0,6 s no ar e ~1,1 m de altura. No ar o controle é menor e o
  // embalo se mantém; dá para pular por cima de outro bicho, da barra de neon e de
  // buraco no gelo. Só cai da arena quando aterrissa fora dela.
  JUMP_SPEED: 7.2,
  GRAVITY: 24,
  AIR_CONTROL: 0.45,          // aceleração no ar = 45 % da do chão
  AIR_FRICTION: 0.985,        // atrito por tick no ar (quase nenhum)
  JUMP_BUFFER: 0.12,          // pulo apertado um pouco antes de aterrissar ainda vale
  JUMP_OVER: 0.35,            // diferença de altura acima da qual dois bichos não se tocam:
                              // quase o pulo todo (~0,5 de 0,6 s) passa por cima de empurrão e dash
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
  SPAWN_RADIUS: 6,            // definido: nascem em círculo a 4 m da borda (com 8 m a 1ª queda vinha em 2 s)
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
  SCOREBOARD_TIME: 7.5,       // placar entre rodadas (GDD: 5 s) + ~4 s de replay do último empurrão
  // definido: se dois caem no mesmo tick, vence quem estava mais perto do centro
  SAME_TICK_TIEBREAK: 'closestToCenter',
};

// ---------- Modos de jogo (escolhidos pelo anfitrião no lobby) ----------

// Minijogos (um por rodada) e formatos de partida. 'party' sorteia um minijogo por
// rodada; 'show' também, e quem cai é eliminado até sobrar o campeão (Fall Guys).
export const MINIGAMES = ['classic', 'potato', 'hill', 'jumprope', 'hex', 'balls'];
export const FORMATS = ['party', 'show'];
export const MODES = [...MINIGAMES, ...FORMATS];
export const SHOW_POOL = ['classic', 'potato', 'jumprope', 'hex', 'balls']; // sem colina: ela não elimina ninguém

// Eliminação em fases: em cada rodada passam ~60 %; com 3 ou menos é a final.
export const SHOW = {
  QUALIFY_FRACTION: 0.6,
  FINAL_AT: 3,
};

// Pula-corda: duas barras atravessam a arena girando. A baixa se pula; a alta pega
// quem está no ar. As duas aceleram com o tempo.
export const JUMPROPE = {
  START_AT: 2,
  LOW: { speed: 0.75, accel: 0.022, max: 2.1, width: 0.3, y0: 0, y1: 0.42 },
  HIGH: { speed: -0.55, accel: -0.016, max: 1.6, width: 0.3, y0: 1.35, y1: 1.75 },
  PUSH: 7,
  HUB: 0.6,
  RING_INTERVAL_MULT: 1.6,
};

// Chão que some: a arena vira 3 andares de hexágonos; o que alguém pisa trinca e
// cai. Quem cai por um buraco aterrissa no andar de baixo; do último, sai da rodada.
export const HEX = {
  LAYERS: 3,
  LAYER_GAP: 4,               // metros entre andares
  SIZE: 0.75,                 // centro ao canto do hexágono, em metros (menor = o chão dura mais)
  GAP: 0.06,                  // fresta visual entre peças
  CRUMBLE: 1.0,               // segundos entre pisar e a peça cair
  GRACE: 1.2,                 // depois do GO, ninguém derruba peça por este tempo
};

// Chuva de bolas: bolas gigantes atravessam a arena rolando.
export const BALLS = {
  FIRST_AT: 1.5,
  INTERVAL: 2.2,
  INTERVAL_MIN: 0.7,
  INTERVAL_STEP: 0.04,        // fica mais rápido a cada bola
  RADIUS: [1.0, 1.5],
  SPEED: [5, 8.5],
  KNOCK: 4,                   // tranco extra além da velocidade da bola
  STUN: 0.3,
  RING_INTERVAL_MULT: 1.3,
};

// Dash carregado: segurar o botão enche a barra; soltar dá o dash. Carga parcial joga
// o alvo mais longe; carga cheia ainda deixa ele tonto. Um toque rápido é o dash normal.
export const CHARGE = {
  TIME: 1.0,                  // segundos para encher a barra
  TAP: 0.12,                  // segurou menos que isso: dash normal (carga 0)
  MOVE_MULT: 0.45,            // carregando, anda mais devagar
  SPEED_BONUS: 0.15,          // cheio: dash 15 % mais rápido
  KNOCK_BONUS: 0.75,          // cheio: empurrão 1,75 × (parcial: proporcional); com a velocidade, ~2 ×
  DAMAGE_BONUS: 1.0,          // cheio: dano 2 ×
  COOLDOWN_BONUS: 0.6,        // cheio: recarga 60 % maior
  STUN: 1.3,                  // cheio: tonto por 1,3 s
};

// Vida (estilo Brawlhalla): cada golpe tira vida e, quanto menos vida, mais longe o
// próximo empurrão joga. Ninguém morre por vida: só caindo. Volta cheia a cada rodada.
export const HEALTH = {
  MAX: 100,
  DASH_DAMAGE: 5,
  BOMB_DAMAGE: 12,
  BALL_DAMAGE: 8,
  KNOCKBACK_FULL: 0.75,       // com vida cheia o empurrão de dash é mais fraco que antes
  KNOCKBACK_EMPTY: 1.7,       // sem vida, 1,7 ×
  // Tonto: dois bichos diferentes acertam dash no mesmo alvo em até 0,7 s
  DOUBLE_HIT_WINDOW: 0.7,
  DAZE_DURATION: 1.2,         // sem controle
  DAZE_DAMAGE: 5,             // extra no segundo golpe
  DAZE_IMMUNITY: 1.5,         // depois de ficar tonto, 1,5 s sem poder ficar tonto de novo
};

// Chapéus (comprados com moedas no menu; preço em moedas)
export const HATS = {
  none: 0, party: 30, cap: 50, flower: 70, tophat: 100, chef: 120, cowboy: 140, viking: 170, halo: 220,
};

export const COINS = {
  ROUND: 2, ROUND_WIN: 10, KO: 3, MATCH: 5, MATCH_WIN: 25, QUALIFY: 6,
};

// Batata quente: alguém segura a bomba; encostar passa adiante. Quem segura quando
// o pavio acaba explode (cai). Depois a bomba vai para outro, com pavio menor.
export const POTATO = {
  FIRST_DELAY: 2,             // segundos depois do GO até a primeira bomba
  FUSE: 10,                   // pavio da primeira bomba
  FUSE_STEP: 1.5,             // cada explosão encurta o próximo pavio
  FUSE_MIN: 5,
  PASS_COOLDOWN: 0.6,         // quem acabou de passar não recebe de volta na hora
  HOLDER_SPEED: 1.12,         // quem segura corre 12 % mais (para conseguir passar)
  BLAST: { radius: 3, impulse: 11, stun: 0.3 },
  RING_INTERVAL_MULT: 1.5,    // anéis caem mais devagar: a bomba já elimina gente
};

// Rei da colina: ficar no círculo dourado do meio enche a barra (sozinho enche
// inteiro; disputando, pela metade). Vence a rodada quem enche primeiro (ou o último
// de pé, como no clássico).
export const HILL = {
  RADIUS: 2.4,
  TARGET: 12,                 // segundos sozinho na colina para vencer
  CONTESTED_RATE: 0.5,
  // A colina muda de lugar: o próximo lugar pisca no chão antes de ela pular para lá
  MOVE_EVERY: 10,
  MOVE_WARNING: 3,
  FIRST_AT_CENTER: true,      // a primeira colina é no meio
  // Quem cai volta para a arena (só a barra decide a rodada) e perde parte da barra
  RESPAWN: 1.5,               // segundos depois de sumir no abismo
  MIN_ARENA: 5.5,             // os anéis param de cair aqui (a colina anda e precisa de espaço)
  FALL_PENALTY: 0.25,         // perde 25 % do que já tinha
  // Acabou o tempo (90 s): vence quem tem a barra mais cheia
  // No Rei da colina o mapa sempre atrapalha, em qualquer cenário: vento e buracos
  HAZARDS: [
    { type: 'wind', every: 7, warning: 1.6, duration: 2.4, accel: 7 },
    { type: 'ice', every: 3.5, crack: 1.5, open: 4.5, radius: 1.2, max: 3, firstAt: 4 },
  ],
};

// ---------- Partida rápida (salas públicas) ----------

export const QUICK = {
  AUTO_START: 20,             // segundos de espera antes de começar com bots
  START_NOW_HUMANS: 4,        // com 4 pessoas começa na hora
  MIN_TOTAL: 6,               // bots completam até 6 bichos
  DIFFICULTY: 'medium',
  MODE: 'party',              // sala pública joga a Festa (um minijogo por rodada)
  REMATCH_AFTER: 12,          // pódio → lobby sozinho depois de 12 s
};

// ---------- Reconexão ----------

export const RECONNECT = {
  GRACE: 60,                  // segundos que a vaga fica guardada (um bot joga no lugar)
  EMPTY_ROOM_GRACE: 30,       // sala sem ninguém fica aberta 30 s esperando alguém voltar
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
    heal:   { weight: 25, duration: 0, amount: 40 },                            // Kit de vida: +40 na hora; não troca o power-up que ele já tem
    shield: { weight: 15, duration: 10, bounce: 1.6, attackerStun: 0.35 },      // Escudo: bloqueia o próximo golpe (dash, bomba, bola); quem bateu volta e fica atordoado
  },
  ICON_LETTER: { coffee: 'C', bomb: 'B', heavy: 'H', soap: 'S', heal: '+', shield: 'shield' }, // placeholder: cubo com a letra
};

// ---------- Bots (GDD: tabela de Bots) ----------

export const BOTS = {
  MAX: 7,
  DEFAULT_COUNT: 3,           // definido
  DEFAULT_DIFFICULTY: 'medium',
  // Dificuldade automática: começa em médio; ganhar a rodada sobe, cair cedo desce
  AUTO: { START: 1, WIN_STEP: 0.4, LOSE_STEP: 0.4 },
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
    //               reação  mira±  borda  ignora PU  posiciona  desvia  pula na hora certa (barra, dash, bomba)  carrega o dash
    easy:   { reactionMs: 600, aimErrorDeg: 35, edgeSense: 1.5, ignorePowerup: 0.6, positionChance: 0,   dodgeChance: 0,   jumpSkill: 0.25, chargeChance: 0 },
    medium: { reactionMs: 300, aimErrorDeg: 15, edgeSense: 3,   ignorePowerup: 0.3, positionChance: 0.5, dodgeChance: 0.3, jumpSkill: 0.6,  chargeChance: 0.2 },
    hard:   { reactionMs: 120, aimErrorDeg: 5,  edgeSense: 3.5, ignorePowerup: 0,   positionChance: 1,   dodgeChance: 0.7, jumpSkill: 0.9,  chargeChance: 0.3 },
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
    // Vento: de tempos em tempos uma rajada empurra todo mundo numa direção (setas avisam)
    hazard: { type: 'wind', every: 9, warning: 1.6, duration: 2.6, accel: 7 },
  },
  frozen: {
    physics: { FRICTION: 0.93 },  // GDD: chão escorregadio (0,94 encerrava a rodada em ~20 s)
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
    // Gelo que racha: um ponto trinca (aviso) e vira buraco por alguns segundos
    hazard: { type: 'ice', every: 5, crack: 1.6, open: 5, radius: 1.3, max: 2, firstAt: 6 },
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
    // Barra de neon girando a partir do meio: empurra quem estiver no caminho
    hazard: { type: 'sweeper', speed: 0.75, hub: 0.55, width: 0.3, push: 8, startAt: 3, height: 0.4 }, // height: acima disso o pulo passa por cima
  },
};

// ---------- Câmera e game feel (cliente) ----------

export const CAMERA = {
  TILT_DEG: 55,               // GDD: de cima, 55° de inclinação
  FOV: 45,                    // definido
  FRAME_MARGIN: 1.25,         // definido: enquadra o raio da arena × 1,25
  FRAME_MARGIN_PORTRAIT: 1.1, // celular em pé: a largura limita, então a margem é menor
  ZOOM_TWEEN: 1.0,            // definido: segundos para aproximar quando um anel cai
  // Câmera perto (padrão): segue o seu bicho e enquadra quem está em volta
  FOLLOW: {
    VIEW: 7,                  // metros de raio mínimo à vista (deitado)
    VIEW_PORTRAIT: 5.5,       // celular em pé: mais perto, os bichos ficam maiores
    NEAR: 3.5,                // quem está até aqui de você entra no enquadramento
    PAD: 2,                   // folga em volta do grupo
    LEAD: 0.35,               // olha um pouco para onde você está indo (segundos de movimento)
    LEAD_MAX: 1.5,
    EDGE: 1.5,                // perto da beirada, deixa ver um pouco do vazio
    RATE: 3,                  // suavidade do movimento (maior = mais rápido)
    ZOOM_RATE: 1.5,
  },
};

export const FX = {
  HIT_STOP_MS: 50,            // GDD
  SHAKE_HIT: { duration: 0.15, strength: 0.25 },  // GDD: 0,15 s; força definida
  // definido: quando o empurrão envolve o seu bicho, o tranco é mais forte e a pausa mais longa
  SHAKE_HIT_ME: { duration: 0.22, strength: 0.45 },
  HIT_STOP_ME_MS: 80,
  TRAIL_EVERY_MS: 28,         // definido: rastro colorido do dash, um sopro a cada 28 ms
  FEED_MAX: 4,                // definido: derrubadas listadas no canto
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

export const DEBUG_PARAMS = ['debug', 'bots', 'difficulty', 'mode', 'scenario', 'round', 'powerup', 'slowmo', 'nofall', 'offline'];
