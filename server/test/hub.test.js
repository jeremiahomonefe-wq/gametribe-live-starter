import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameEngine } from '../src/game-engine.js';
import { createHub } from '../src/hub.js';

function env() {
  let t = 1_000_000;
  const now = () => t;
  const timers = [];
  const rooms = new Map();
  const sockets = new Map();
  const socket = (id) => {
    const s = { id, log: [], join(room) { if (!rooms.has(room)) rooms.set(room, new Set()); rooms.get(room).add(id); }, emit(ev, data) { s.log.push([ev, data]); } };
    sockets.set(id, s);
    return s;
  };
  const broadcast = (room, ev, data) => rooms.get(room)?.forEach((id) => sockets.get(id).emit(ev, data));
  const sendTo = (id, ev, data) => sockets.get(id)?.emit(ev, data);
  const hub = createHub({ engine: createGameEngine({ now }), broadcast, sendTo, now, setTimer: (fn, ms) => timers.push({ fn, ms }) });
  const last = (s, ev) => [...s.log].reverse().find(([e]) => e === ev)?.[1];
  return { hub, socket, timers, last, advance: (ms) => { t += ms; } };
}

function startedGame() {
  const e = env();
  const host = e.socket('h'); const player = e.socket('p1'); const screen = e.socket('screen');
  e.hub.handle(host, 'host:create');
  const created = e.last(host, 'host:created');
  e.hub.handle(player, 'player:join', { pin: created.pin, nickname: 'Ada' });
  e.hub.handle(screen, 'projector:watch', { pin: created.pin });
  const auth = { pin: created.pin, hostToken: created.hostToken };
  return { ...e, host, player, screen, created, auth };
}

test('server locks the question at the deadline with no host action', () => {
  const g = startedGame();
  g.hub.handle(g.host, 'host:start', g.auth);
  assert.equal(g.timers.length, 1);
  g.advance(16_000);
  g.timers[0].fn();
  assert.equal(g.last(g.player, 'game:state').phase, 'locked');
});

test('projector screen gets public state only and cannot run host commands', () => {
  const g = startedGame();
  const seen = JSON.stringify(g.screen.log);
  assert.equal(seen.includes('hostToken'), false);
  assert.equal(seen.includes('reconnectToken'), false);
  g.hub.handle(g.screen, 'host:start', g.auth);
  assert.equal(g.last(g.screen, 'app:error').message, 'Host authorization failed.');
});

test('players cannot use host commands', () => {
  const g = startedGame();
  g.hub.handle(g.player, 'host:end', g.auth);
  assert.equal(g.last(g.player, 'app:error').event, 'host:end');
});

test('on reveal each player privately gets their own result', () => {
  const g = startedGame();
  g.hub.handle(g.host, 'host:start', g.auth);
  g.hub.handle(g.player, 'player:answer', { pin: g.created.pin, answerIndex: 1, questionIndex: 0 });
  g.hub.handle(g.host, 'host:reveal', g.auth);
  const result = g.last(g.player, 'player:result');
  assert.equal(result.correct, true);
  assert.equal(g.screen.log.some(([e]) => e === 'player:result'), false);
});

test('PIN guessing is rate limited per connection', () => {
  const e = env();
  const guesser = e.socket('x');
  for (let i = 0; i < 13; i += 1) e.hub.handle(guesser, 'player:join', { pin: '000000', nickname: 'Eve' });
  assert.match(e.last(guesser, 'app:error').message, /too many attempts/i);
});

test('malformed payloads are handled without throwing', () => {
  const e = env();
  const s = e.socket('y');
  assert.doesNotThrow(() => { e.hub.handle(s, 'player:join', null); e.hub.handle(s, 'player:answer', 'nope'); e.hub.handle(s, 'unknown:event', {}); });
});

test('after the deadline the server locks, then reveals on its own and sends private results', () => {
  const g = startedGame();
  g.hub.handle(g.host, 'host:start', g.auth);
  g.hub.handle(g.player, 'player:answer', { pin: g.created.pin, answerIndex: 1, questionIndex: 0 });
  g.advance(16_000);
  g.timers[0].fn();
  assert.equal(g.last(g.player, 'game:state').phase, 'locked');
  assert.equal(g.timers.length, 2, 'a reveal is queued after the lock');
  g.timers[1].fn();
  assert.equal(g.last(g.player, 'game:state').phase, 'reveal');
  assert.equal(g.last(g.player, 'player:result').correct, true);
  assert.equal(g.last(g.screen, 'game:state').question.correctIndex, 1);
});

test('a host reveal before the timers fire makes the late timers harmless', () => {
  const g = startedGame();
  g.hub.handle(g.host, 'host:start', g.auth);
  g.hub.handle(g.host, 'host:reveal', g.auth);
  g.hub.handle(g.host, 'host:next', g.auth);
  g.advance(16_000);
  g.timers[0].fn(); // timer belonged to question 0; question 1 must not be touched
  assert.equal(g.last(g.player, 'game:state').phase, 'question');
  assert.equal(g.last(g.player, 'game:state').questionIndex, 1);
});

test('host can recover control on a new connection; a stale connection closing changes nothing', () => {
  const g = startedGame();
  g.hub.onDisconnect(g.host);
  assert.equal(g.last(g.player, 'game:state').hostConnected, false);
  const back = g.socket('h2');
  g.hub.handle(back, 'host:reconnect', g.auth);
  assert.equal(g.last(back, 'host:reconnected').pin, g.created.pin);
  assert.equal(g.last(g.player, 'game:state').hostConnected, true);
  g.hub.onDisconnect(g.host); // the old socket's late disconnect event
  assert.equal(g.last(g.player, 'game:state').hostConnected, true);
  g.hub.handle(back, 'host:start', g.auth);
  assert.equal(g.last(g.player, 'game:state').phase, 'question');
});

test('host recovery needs the real host token and never leaks it to others', () => {
  const g = startedGame();
  const thief = g.socket('t');
  g.hub.handle(thief, 'host:reconnect', { pin: g.created.pin, hostToken: 'guess' });
  assert.match(g.last(thief, 'app:error').message, /host session not found/i);
  g.hub.handle(thief, 'host:start', g.auth);
  assert.equal(g.last(thief, 'app:error').event, 'host:start');
  assert.equal(JSON.stringify(g.player.log).includes(g.created.hostToken), false);
  assert.equal(JSON.stringify(g.screen.log).includes(g.created.hostToken), false);
});

test('host:create accepts a valid custom quiz and rejects an invalid one', () => {
  const e = env();
  const ok = e.socket('a'); const bad = e.socket('b');
  e.hub.handle(ok, 'host:create', { quiz: { title: 'Mine', questions: [{ prompt: 'Q?', options: ['A', 'B'], correctIndex: 0, durationSeconds: 10 }] } });
  assert.equal(e.last(ok, 'host:created').state.title, 'Mine');
  e.hub.handle(bad, 'host:create', { quiz: { title: 'Broken', questions: [] } });
  assert.match(e.last(bad, 'app:error').message, /at least one question/i);
});
