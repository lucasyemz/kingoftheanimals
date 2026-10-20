// Salas: criar, entrar e sair. Cada sala tem um Game e um loop de 30 Hz.

import { NET, ROOM } from '../shared/constants.js';
import { MSG, JOIN_ERROR } from '../shared/messages.js';
import { Game } from './game.js';

const rooms = new Map(); // code → { game, timer }

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM.CODE_LENGTH; i++) {
      code += ROOM.CODE_ALPHABET[Math.floor(Math.random() * ROOM.CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
}

function createRoom(io, debug) {
  const code = newCode();
  // O state sai como volatile: se a conexão de alguém engasgar, os states velhos são
  // descartados em vez de enfileirar (só o mais novo importa).
  const send = (msg, payload) => (msg === MSG.STATE ? io.to(code).volatile.emit(msg, payload) : io.to(code).emit(msg, payload));
  const game = new Game({ code, debug, send });
  const timer = setInterval(() => game.tick(), 1000 / NET.TICK_RATE);
  const room = { game, timer };
  rooms.set(code, room);
  return room;
}

function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  clearInterval(room.timer);
  rooms.delete(code);
}

export function attachRooms(io) {
  io.on('connection', (socket) => {
    let room = null;

    socket.on(MSG.JOIN, (data = {}, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (room) return reply({ ok: false, error: JOIN_ERROR.FULL });
      const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : null;
      const target = code ? rooms.get(code) : createRoom(io, data.debug);
      if (!target) return reply({ ok: false, error: JOIN_ERROR.NOT_FOUND });

      socket.join(target.game.code);
      const res = target.game.addHuman(socket.id, data);
      if (!res.ok) {
        socket.leave(target.game.code);
        if (!code && target.game.humans.length === 0) closeRoom(target.game.code);
        return reply(res);
      }
      room = target;
      reply(res);
    });

    socket.on(MSG.SETTINGS, (data) => room?.game.applySettings(socket.id, data));
    socket.on(MSG.START, (data) => room?.game.startMatch(socket.id, data));
    socket.on(MSG.REMATCH, () => room?.game.rematch());
    socket.on(MSG.EMOTE, (data) => room?.game.emote(socket.id, data));
    socket.on(MSG.INPUT, (data, ack) => {
      room?.game.setInput(socket.id, data);
      if (typeof ack === 'function') ack(Date.now());
    });

    socket.on('disconnect', () => {
      if (!room) return;
      const left = room.game.removeHuman(socket.id);
      if (left === 0) closeRoom(room.game.code);
      room = null;
    });
  });
}
