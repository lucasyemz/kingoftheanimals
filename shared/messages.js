// Contrato de rede entre cliente e servidor. Os nomes seguem a tabela
// "Mensagens" do GDD. Mudou algo aqui? Avise a outra IA antes.
// Nenhum texto de tela sai do servidor: ele manda ids e números, e o cliente
// monta as frases com client/src/strings.js.

export const MSG = {
  // cliente → servidor
  JOIN: 'join',         // { code: 'ABCD' | null, nickname, animal, debug? }   null = criar sala nova
                        //   debug = atalhos da URL de quem cria a sala (scenario, round, powerup, slowmo, nofall)
                        //   ack(res): { ok: true, playerId, code } | { ok: false, error: JOIN_ERROR.* }
  START: 'start',       // { bots: 0..7, difficulty: 'easy' | 'medium' | 'hard' }   só o anfitrião
  INPUT: 'input',       // { x, z, dash: bool, seq }   x/z em -1..1, 30 por segundo
                        //   ack opcional (1 por segundo) devolve o tempo do servidor: é o ping do ?debug=1
  EMOTE: 'emote',       // { n: 1..4 }

  // ADIÇÕES PROPOSTAS (não estão na tabela do GDD; aguardando o "ok")
  SETTINGS: 'settings', // { bots, difficulty }   anfitrião mexeu no lobby; o servidor reenvia `lobby`
  REMATCH: 'rematch',   // {}   botão "Rematch" do pódio: a sala volta ao lobby

  // servidor → todos da sala
  LOBBY: 'lobby',       // { code, hostId, phase, bots, difficulty, kingId, round, scenario, players: [LobbyPlayer] }
  STATE: 'state',       // { tick, t, phase, timeLeft, arena, players: [StatePlayer], powerups: [StatePowerup] }   30 por segundo
  EVENT: 'event',       // { type: EVENT.*, ...dados do evento }   dispara sons e efeitos no fx.js
  SCORE: 'score',       // { kind: 'round' | 'match', ... }   placar entre rodadas ou prêmios do fim
  ROUND: 'round',       // { round, scenario: 'sky' | 'frozen' | 'desert' | 'lava' | 'neon' }   antes da contagem
};

// Fases da sala (campo `phase` de `lobby` e `state`).
export const PHASE = {
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  SUDDEN_DEATH: 'suddenDeath',
  ROUND_END: 'roundEnd',   // placar entre rodadas (5 s)
  PODIUM: 'podium',
};

// Estado de cada bicho no `state` (campo `st`). O cliente escolhe o clipe por aqui.
export const PLAYER_STATE = {
  ALIVE: 'alive',          // parado ou andando: o cliente decide pela velocidade
  DASHING: 'dashing',
  STUNNED: 'stunned',
  FALLING: 'falling',      // 1,5 s girando antes de sumir
  OUT: 'out',              // espectador
};

// Tipos da mensagem `event`, um por linha do "Mapa de eventos".
export const EVENT = {
  COUNTDOWN: 'countdown',          // { n: 3 | 2 | 1 | 0 }   0 = "GO!"
  DASH: 'dash',                    // { id, dx, dz }
  DASH_HIT: 'dashHit',             // { id, target, x, z }   id deu o dash, target levou
  FALL: 'fall',                    // { id, by: id | null, x, z }   by null = Self-KO
  RING_WARNING: 'ringWarning',     // { ring, radius }   o anel começa a piscar
  RING_DROP: 'ringDrop',           // { ring, radius }   radius = novo raio da arena
  SUDDEN_DEATH: 'suddenDeath',     // {}
  POWERUP_SPAWN: 'powerupSpawn',   // { pid, pu, x, z }   pu = tipo do power-up
  POWERUP_PICK: 'powerupPick',     // { id, pid, pu }
  PUSH_BOMB: 'pushBomb',           // { id, x, z, hit: [id] }
  ROUND_END: 'roundEnd',           // { winner: id }
  EMOTE: 'emote',                  // { id, n: 1..4 }
  PODIUM: 'podium',                // { champion: id }
  KINGSLAYER: 'kingslayer',        // { id, king }
  LONG_LIVE_KING: 'longLiveKing',  // { id, streak }
};

// Erros do ack de `join`.
export const JOIN_ERROR = {
  NOT_FOUND: 'notFound',
  FULL: 'full',
  BAD_NICKNAME: 'badNickname',
  BAD_ANIMAL: 'badAnimal',
};

/*
Formatos usados acima (referência; o JS não checa tipos):

LobbyPlayer   { id, nickname, animal, color: 0..7, bot: bool, botName: 0..n | null,
                connected: bool, spectator: bool, kingStreak: 0..n, wins: 0..n }
                bot: nome = strings.botAdjectives[botName] + nome do bicho

StatePlayer   { id, x, z, vx, vz, dir, st: PLAYER_STATE.*, dashCd: 0..1,
                pu: 'coffee' | 'heavy' | null, puT: segundos restantes }
                dir em radianos no plano (x, z); dashCd = fração da recarga que falta

StatePowerup  { pid, type: 'coffee' | 'bomb' | 'heavy' | 'soap', x, z }

arena         { radius, warning: bool, soap: bool, rings }
                radius = raio atual; warning = anel externo piscando; soap = Soap Floor ativo

score 'round' { round, winner, wins: { id: n }, highlight: { type, id, n } }
                type: 'knockouts' ("Pig knocked out 3") | 'selfKo' ("Duck fell off alone") | 'winner'
score 'match' { champion, wins: { id: n },
                awards: { champion: id, bully: id, kamikaze: id, survivor: id, kingslayer: id | null } }
*/
