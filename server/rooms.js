// Salas: criar, entrar e sair. Cada sala tem um Game e um loop de 30 Hz.

import { NET, ROOM, RECONNECT } from '../shared/constants.js';
import { MSG, PHASE, JOIN_ERROR } from '../shared/messages.js';
import { Game } from './game.js';

const rooms = new Map(); // code → { game, timer, closeTimer }

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM.CODE_LENGTH; i++) {
      code += ROOM.CODE_ALPHABET[Math.floor(Math.random() * ROOM.CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
}

function createRoom(io, debug, isPublic = false) {
  const code = newCode();
  // O state sai como volatile: se a conexão de alguém engasgar, os states velhos são
  // descartados em vez de enfileirar (só o mais novo importa).
  const send = (msg, payload) => (msg === MSG.STATE ? io.to(code).volatile.emit(msg, payload) : io.to(code).emit(msg, payload));
  const game = new Game({ code, debug, send, isPublic });
  const timer = setInterval(() => game.tick(), 1000 / NET.TICK_RATE);
  const room = { game, timer };
  rooms.set(code, room);
  return room;
}

function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  clearInterval(room.timer);
  clearTimeout(room.closeTimer);
  rooms.delete(code);
}

// Partida rápida: a sala pública com mais gente esperando no lobby, ou uma nova
function findPublicRoom(io) {
  let best = null;
  for (const room of rooms.values()) {
    const g = room.game;
    if (!g.public || g.phase !== PHASE.LOBBY || g.humans.length >= ROOM.MAX_PLAYERS) continue;
    if (!best || g.humans.length > best.game.humans.length) best = room;
  }
  return best ?? createRoom(io, {}, true);
}

const inMatch = (g) => g.phase !== PHASE.LOBBY && g.phase !== PHASE.PODIUM;

export function attachRooms(io) {
  io.on('connection', (socket) => {
    let room = null;
    let pid = socket.id; // id do jogador na sala (o antigo, se voltou depois de cair)

    socket.on(MSG.JOIN, (data = {}, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (room) return reply({ ok: false, error: JOIN_ERROR.FULL });
      const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : null;
      const target = data.quick ? findPublicRoom(io) : code ? rooms.get(code) : createRoom(io, data.debug);
      if (!target) return reply({ ok: false, error: JOIN_ERROR.NOT_FOUND });

      socket.join(target.game.code);
      // Voltando depois de a conexão cair: pega o bicho de volta
      const back = target.game.reclaim(typeof data.rejoin === 'string' ? data.rejoin : null);
      const res = back ?? target.game.addHuman(socket.id, data);
      if (!res.ok) {
        socket.leave(target.game.code);
        if (!code && target.game.humans.length === 0) closeRoom(target.game.code);
        return reply(res);
      }
      clearTimeout(target.closeTimer);
      target.closeTimer = null;
      pid = res.playerId;
      const player = target.game.players.get(pid);
      if (back && player.socket && player.socket !== socket.id) io.sockets.sockets.get(player.socket)?.disconnect(true);
      player.socket = socket.id;
      room = target;
      reply(res);
    });

    socket.on(MSG.SETTINGS, (data) => room?.game.applySettings(pid, data));
    socket.on(MSG.START, (data) => room?.game.startMatch(pid, data));
    socket.on(MSG.REMATCH, () => room?.game.rematch());
    socket.on(MSG.EMOTE, (data) => room?.game.emote(pid, data));
    socket.on(MSG.INPUT, (data, ack) => {
      room?.game.setInput(pid, data);
      if (typeof ack === 'function') ack(Date.now());
    });

    socket.on('disconnect', () => {
      if (!room) return;
      const r = room;
      room = null;
      // Esta conexão já foi substituída por uma nova (o jogador voltou): não mexe no bicho
      if (r.game.players.get(pid)?.socket !== socket.id) return;
      const left = r.game.removeHuman(pid);
      // Sala vazia no meio da partida fica aberta um pouco, esperando alguém voltar
      if (left === 0) {
        if (inMatch(r.game)) {
          clearTimeout(r.closeTimer);
          r.closeTimer = setTimeout(() => r.game.humans.length === 0 && closeRoom(r.game.code), RECONNECT.EMPTY_ROOM_GRACE * 1000);
        } else {
          closeRoom(r.game.code);
        }
      }
    });
  });
}
