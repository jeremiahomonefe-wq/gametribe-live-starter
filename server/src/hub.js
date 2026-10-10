// Transport-agnostic event handling. Socket.IO (index.js) and the browser preview both plug into this,
// so the rules in game-engine.js are the only place game logic lives.
// A "socket" here is { id, join(room), emit(event, data) }.
export const HUB_EVENTS = [
  'host:create', 'host:reconnect', 'player:join', 'player:reconnect', 'projector:watch',
  'host:start', 'host:reveal', 'host:next', 'host:end', 'player:answer'
];

export function createHub({ engine, broadcast, sendTo, now = () => Date.now(), setTimer = setTimeout, maxAttempts = 12, windowMs = 30000, revealDelayMs = 2000, instanceId = '' }) {
  const hosts = new Map();
  const members = new Map();
  const attempts = new Map();

  const roomOf = (pin) => `game:${pin}`;
  const fail = (socket, event, message, code) => socket.emit('app:error', { event, message: message || 'Something went wrong.', ...(code ? { code } : {}) });
  // The one failure that means "your game is not on this server": it restarted, or you reached another copy.
  const notHere = (socket, event) => fail(socket, event, `Game not found on this server${instanceId ? ` (server ${instanceId})` : ''}. The server may have restarted, or you reached a different copy of it.`, 'game_not_found');

  // Limits PIN guessing and token guessing per connection.
  function tooMany(socket) {
    const t = now();
    const recent = (attempts.get(socket.id) || []).filter((x) => t - x < windowMs);
    recent.push(t);
    attempts.set(socket.id, recent);
    return recent.length > maxAttempts;
  }
  function publish(pin) {
    const state = engine.getPublicState(pin);
    if (state) broadcast(roomOf(pin), 'game:state', state);
  }
  function sendResults(pin) {
    for (const p of engine.getPlayerSockets(pin)) {
      if (!p.socketId) continue;
      const result = engine.getPlayerResult(pin, p.id);
      if (result) sendTo(p.socketId, 'player:result', result);
    }
  }
  // The server, not the host or the browser, closes and reveals a question when its deadline passes.
  function scheduleLock(pin) {
    const state = engine.getPublicState(pin);
    if (!state || state.phase !== 'question') return;
    const questionIndex = state.questionIndex;
    setTimer(() => {
      if (!engine.lockExpired({ pin, questionIndex }).ok) return;
      publish(pin);
      // After a short "time is up" beat the server reveals the answer too. The host can still reveal sooner.
      if (revealDelayMs === null) return;
      setTimer(() => {
        if (!engine.revealLocked({ pin, questionIndex }).ok) return;
        publish(pin);
        sendResults(pin);
      }, revealDelayMs);
    }, Math.max(0, state.questionEndsAt - now()) + 40);
  }
  // The host token (a secret only the host's browser holds) is what proves who the host is, not the
  // connection. So a host whose connection dropped and came back is still the host. Any valid command
  // makes the sending connection the current host connection.
  function adoptHost(socket, pin, hostToken) {
    if (hosts.get(socket.id)?.pin === pin) return;
    socket.join(roomOf(pin));
    hosts.set(socket.id, { pin, hostToken });
    engine.attachHost({ pin, hostToken, socketId: socket.id });
  }
  function hostCommand(socket, event, data, run, after) {
    const pin = String(data.pin ?? '').trim();
    if (!engine.hasSession(pin)) return notHere(socket, event);
    const result = run({ pin, hostToken: data.hostToken });
    if (!result.ok) return fail(socket, event, result.error);
    adoptHost(socket, pin, data.hostToken);
    publish(pin);
    after?.(pin);
  }

  const handlers = {
    'host:create': (socket, data) => {
      try {
        const created = engine.createSession({ quiz: data.quiz });
        engine.attachHost({ pin: created.pin, hostToken: created.hostToken, socketId: socket.id });
        socket.join(roomOf(created.pin));
        hosts.set(socket.id, { pin: created.pin, hostToken: created.hostToken });
        socket.emit('host:created', created);
        publish(created.pin);
      } catch (error) { fail(socket, 'host:create', error.message); }
    },
    'host:reconnect': (socket, data) => {
      if (tooMany(socket)) return fail(socket, 'host:reconnect', 'Too many attempts. Wait a moment and try again.');
      const pin = String(data.pin ?? '').trim();
      if (!engine.hasSession(pin)) return notHere(socket, 'host:reconnect');
      const result = engine.attachHost({ pin, hostToken: data.hostToken, socketId: socket.id });
      if (!result.ok) return fail(socket, 'host:reconnect', result.error);
      socket.join(roomOf(pin));
      hosts.set(socket.id, { pin, hostToken: data.hostToken });
      socket.emit('host:reconnected', { pin, hostToken: data.hostToken, state: result.state });
      publish(pin);
    },
    'player:join': (socket, data) => {
      if (tooMany(socket)) return fail(socket, 'player:join', 'Too many attempts. Wait a moment and try again.');
      const pin = String(data.pin ?? '').trim();
      const result = engine.joinSession({ pin, nickname: data.nickname, socketId: socket.id });
      if (!result.ok) return fail(socket, 'player:join', result.error);
      socket.join(roomOf(pin));
      members.set(socket.id, { pin, playerId: result.player.id });
      socket.emit('player:joined', { ...result.player, pin });
      publish(pin);
    },
    'player:reconnect': (socket, data) => {
      if (tooMany(socket)) return fail(socket, 'player:reconnect', 'Too many attempts. Wait a moment and try again.');
      const pin = String(data.pin ?? '').trim();
      if (!engine.hasSession(pin)) return notHere(socket, 'player:reconnect');
      const result = engine.reconnectPlayer({ pin, reconnectToken: data.reconnectToken, socketId: socket.id });
      if (!result.ok) return fail(socket, 'player:reconnect', result.error);
      socket.join(roomOf(pin));
      members.set(socket.id, { pin, playerId: result.player.id });
      socket.emit('player:reconnected', { ...result.player, pin });
      socket.emit('game:state', result.state);
      if (['reveal', 'finished'].includes(result.state.phase)) {
        const own = engine.getPlayerResult(pin, result.player.id);
        if (own) socket.emit('player:result', own);
      }
      publish(pin);
    },
    // Read-only display: receives public state only, can never send host commands.
    'projector:watch': (socket, data) => {
      if (tooMany(socket)) return fail(socket, 'projector:watch', 'Too many attempts. Wait a moment and try again.');
      const pin = String(data.pin ?? '').trim();
      const state = engine.getPublicState(pin);
      if (!state) return fail(socket, 'projector:watch', 'That PIN was not found. Check it and try again.');
      socket.join(roomOf(pin));
      socket.emit('game:state', state);
    },
    'host:start': (socket, data) => hostCommand(socket, 'host:start', data, (a) => engine.startGame(a), scheduleLock),
    'host:reveal': (socket, data) => hostCommand(socket, 'host:reveal', data, (a) => engine.revealAnswer(a), sendResults),
    'host:next': (socket, data) => hostCommand(socket, 'host:next', data, (a) => engine.nextQuestion(a), scheduleLock),
    'host:end': (socket, data) => hostCommand(socket, 'host:end', data, (a) => engine.endGame(a), sendResults),
    'player:answer': (socket, data) => {
      const member = members.get(socket.id);
      if (!engine.hasSession(String(data.pin ?? '').trim())) return notHere(socket, 'player:answer');
      if (!member || member.pin !== String(data.pin)) return fail(socket, 'player:answer', 'Join the game before answering.');
      const result = engine.submitAnswer({ ...member, socketId: socket.id, answerIndex: data.answerIndex, questionIndex: data.questionIndex });
      if (!result.ok) return fail(socket, 'player:answer', result.error);
      socket.emit('player:answer-accepted', { accepted: true, questionIndex: data.questionIndex });
      publish(member.pin);
    }
  };

  return {
    events: HUB_EVENTS,
    handle(socket, event, payload) {
      const handler = handlers[event];
      if (!handler) return;
      handler(socket, payload && typeof payload === 'object' ? payload : {});
    },
    onDisconnect(socket) {
      const member = members.get(socket.id);
      if (member && engine.removePlayer({ ...member, socketId: socket.id })) publish(member.pin);
      members.delete(socket.id);
      const host = hosts.get(socket.id);
      if (host && engine.detachHost({ pin: host.pin, socketId: socket.id })) publish(host.pin);
      hosts.delete(socket.id);
      attempts.delete(socket.id);
    }
  };
}
