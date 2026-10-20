// Todo texto de tela, em inglês. O servidor manda ids; o cliente traduz aqui.

export const STR = {
  title: 'King of The Animals',

  debug: {
    connecting: 'server: connecting…',
    online: 'server: online',
    offline: 'server: offline',
    local: 'offline mode (local)',
  },

  // Ids de ANIMALS em shared/constants.js
  animals: {
    duck: 'Duck',
    pig: 'Pig',
    cow: 'Cow',
    penguin: 'Penguin',
    panda: 'Panda',
    bunny: 'Bunny',
    cat: 'Cat',
    dog: 'Dog',
  },

  // BOTS.NAME_ADJECTIVE_COUNT itens. Nome do bot = adjetivo + bicho ("Brakeless Duck").
  botAdjectives: [
    'Brakeless', 'Turbo', 'Wobbly', 'Sneaky', 'Grumpy', 'Clumsy',
    'Spicy', 'Sleepy', 'Chonky', 'Bouncy', 'Dizzy', 'Fearless',
  ],
  botBadge: 'BOT',
  hostBadge: 'HOST',
  you: '(you)',

  scenarios: {
    sky: 'Sky Island',
    frozen: 'Frozen Lake',
    desert: 'Desert Mesa',
    lava: 'Lava Pit',
    neon: 'Neon Night',
  },

  // Emotes 1 a 4
  emotes: ['LOL', 'Come at me!', 'Noooo', 'GG'],

  powerups: {
    coffee: 'Coffee',
    bomb: 'Push Bomb',
    heavy: 'Heavyweight',
    soap: 'Soap Floor',
  },

  powerupIcons: {
    coffee: '☕',
    bomb: '💣',
    heavy: '🏋️',
    soap: '🧼',
  },

  awards: {
    champion: 'Champion',
    bully: 'Bully',
    kamikaze: 'Kamikaze',
    survivor: 'Survivor',
    kingslayer: 'Kingslayer',
  },
  awardHints: {
    champion: 'most rounds won',
    bully: 'most knockouts',
    kamikaze: 'most falls alone',
    survivor: 'longest time standing',
    kingslayer: 'took down the King',
  },
  nobody: 'nobody',

  difficulties: { easy: 'Easy', medium: 'Medium', hard: 'Hard' },

  // Carregamento
  loading: 'Loading',
  loadingTips: [
    'Dash into others to knock them off the island!',
    'A ring falls every 15 seconds. Stay near the middle.',
    'Grab the boxes for power-ups.',
    'Push Bomb sends everyone near you flying.',
    'Last one standing wins the round. First to 3 wins the match.',
    'Beat the King to become the Kingslayer.',
  ],

  // Menu
  yourName: 'Your name',
  namePlaceholder: 'Type your name',
  pickAnimal: 'Pick your animal',
  singlePlayer: 'Single Player',
  singlePlayerHint: 'You vs bots',
  multiplayer: 'Multiplayer',
  multiplayerHint: 'Invite friends with a link',
  quickPlay: 'Quick Play',
  quickPlayHint: 'Join anyone online',
  howToPlay: 'How to play',
  rejoin: (code) => `Rejoin match ${code}`,
  joinRoomCode: (code) => `Join room ${code}`,
  haveCode: 'Have a room code?',
  joinRoom: 'Join',
  roomCodePlaceholder: 'CODE',
  defaultNickname: 'Player',
  backToMenu: 'Menu',

  // Lobby
  room: 'Room',
  copyLink: 'Copy link',
  linkCopied: 'Link copied! Send it to your friends.',
  inviteHint: 'Send the link to your friends. They join right here.',
  inviteText: 'Come play King of The Animals with me!',
  inviteMessage: (code, url) => `👑 Come play King of The Animals with me! Room ${code}: ${url}`,
  whatsapp: 'WhatsApp',
  mode: 'Mode',
  modes: { classic: 'Classic', potato: 'Hot Potato', hill: 'King of the Hill' },
  modeHints: {
    classic: 'Last one standing wins the round',
    potato: 'Pass the bomb by bumping into someone. Don\'t be holding it when it blows!',
    hill: 'Stand in the golden circle alone. First to fill the bar wins',
  },
  publicRoom: 'Public match',
  autoStart: (s) => `Starting in ${s}s — bots fill empty spots`,
  waitingPlayers: 'Looking for players…',
  players: 'Players',
  bots: 'Bots',
  difficulty: 'Difficulty',
  start: 'Start',
  needTwo: 'Add a bot or a friend to start',
  needBot: 'Add at least one bot to start',
  waitingHost: 'Waiting for the host to start…',
  spectatorNote: 'Match in progress — you play from the next rematch',

  // Jogo
  round: (n) => `Round ${n}`,
  countdown: ['GO!', '1', '2', '3'], // índice = n do evento countdown
  suddenDeath: 'Sudden death!',
  spectating: 'Spectating',
  winsRound: (name) => `${name} wins the round!`,
  knockedOut: (name, n) => `${name} knocked out ${n}`,
  fellAlone: (name) => `${name} fell off alone`,
  selfKo: 'Self-KO',
  feedKo: 'knocked off',     // "Turbo Duck knocked off Lucas"
  feedSelf: 'fell off',      // "Lucas fell off"
  kingslayerBanner: 'Kingslayer!',
  longLiveKing: 'Long live the King!',
  kingStreak: (n) => `×${n}`,
  potatoYou: 'You have the bomb! Bump someone!',
  potatoBoom: (name) => `${name} blew up!`,
  feedBoom: 'blew up',
  hillTitle: 'Hill',
  hillContested: 'Contested!',
  windWarning: 'Wind incoming!',
  iceCrack: 'The ice is cracking!',
  winsToGo: 'First to 3 wins',

  // Pódio
  rematch: 'Rematch',
  championIs: (name) => `${name} is the King!`,

  // Erros
  errors: {
    notFound: 'Room not found',
    full: 'Room is full',
    badNickname: 'Type a name first',
    badAnimal: 'Pick an animal',
    disconnected: 'Connection lost — reconnecting…',
    reconnected: 'Back in the match!',
  },

  // Configurações
  settings: 'Settings',
  music: 'Music',
  effects: 'Effects',
  mute: 'Mute all',
  graphics: 'Graphics',
  graphicsModes: { auto: 'Auto', high: 'High', low: 'Light' },
  graphicsReload: 'Graphics change after a reload. Reload now?',
  reload: 'Reload',
  fullscreen: 'Fullscreen',
  close: 'Close',
  muteHint: 'Press M to mute anytime',

  // Estatísticas
  statsTitle: 'Your stats',
  statsLine: (s) => [
    ['🏆', s.matchWins, 'crowns'],
    ['⭐', s.roundWins, 'rounds won'],
    ['💥', s.kos, 'knockouts'],
    ['🎮', s.matches, 'matches'],
  ],

  // Tutorial
  tutorial: {
    title: 'How to play',
    move: 'Move with WASD / arrows (or the joystick)',
    dash: 'Press SPACE to dash (or the DASH button)',
    push: 'Dash into the dummy to push it off!',
    done: 'You\'re ready! 👑',
    skip: 'Skip',
    dummy: 'Dummy',
  },

  rotatePhone: 'Turn your phone sideways to play',
  dash: 'DASH',
};
