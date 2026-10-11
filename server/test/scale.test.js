import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameEngine, audienceState } from '../src/game-engine.js';
import { createHub } from '../src/hub.js';

const bytes = (o) => Buffer.byteLength(JSON.stringify(o));

function crowd(n) {
  const engine = createGameEngine();
  const c = engine.createSession();
  for (let i = 0; i < n; i += 1) engine.joinSession({ pin: c.pin, nickname: `Player ${i}`, socketId: `s${i}` });
  engine.startGame({ pin: c.pin, hostToken: c.hostToken });
  return { engine, c };
}

test('each audience gets only what it needs, and the size stays small as the crowd grows', () => {
  const { engine, c } = crowd(500);
  const full = engine.getPublicState(c.pin);
  const phone = audienceState(full, 'player');
  const screen = audienceState(full, 'screen');
  assert.equal(audienceState(full, 'host'), full, 'the host gets everything');
  assert.deepEqual([phone.players, phone.leaderboard], [[], []], 'phones get no roster and no leaderboard');
  assert.equal(phone.playerCount, 500, 'but still know how many are playing');
  assert.ok(screen.players.length <= 40 && screen.leaderboard.length <= 10 && screen.playerCount === 500);
  assert.ok(screen.players.every((p) => Object.keys(p).sort().join() === 'id,nickname'), 'the screen sees names only, no scores or flags');
  console.log(`    sizes at 500 players: host ${(bytes(full) / 1024).toFixed(0)} KB, projector ${(bytes(screen) / 1024).toFixed(1)} KB, phone ${(bytes(phone) / 1024).toFixed(1)} KB`);
  assert.ok(bytes(phone) < 2500, 'a phone message stays about 1 KB however many players there are');
  assert.ok(bytes(screen) < 8000);
});

test('a phone can still learn its own score and rank without the roster', () => {
  const { engine, c } = crowd(5);
  const ids = engine.getPlayerSockets(c.pin).map((p) => p.id);
  engine.submitAnswer({ pin: c.pin, playerId: ids[2], socketId: 's2', answerIndex: 1 });
  engine.revealAnswer({ pin: c.pin, hostToken: c.hostToken });
  const ranking = engine.getRanking(c.pin);
  const winner = engine.getPlayerResult(c.pin, ids[2], ranking);
  assert.equal(winner.rank, 1);
  assert.equal(winner.total, 5);
  assert.ok(winner.score >= 500);
  assert.equal(engine.getPlayerResult(c.pin, ids[0], ranking).score, 0);
  assert.equal(engine.getPlayerMe(c.pin, ids[2]).rank, 1);
});

function throttledEnv(interval = 250) {
  let t = 1_000_000;
  const timers = [];
  const log = { host: 0, screen: 0, players: 0 };
  const rooms = new Map();
  const sockets = new Map();
  const mk = (id) => { const s = { id, join: (r) => (rooms.has(r) || rooms.set(r, new Set())) && rooms.get(r).add(id), emit() {} }; sockets.set(id, s); return s; };
  const broadcast = (room, ev) => { if (ev !== 'game:state') return; const kind = room.split(':')[2]; log[kind] += rooms.get(room)?.size ? 1 : 0; };
  const engine = createGameEngine({ now: () => t });
  const hub = createHub({ engine, broadcast, sendTo() {}, now: () => t, setTimer: (fn, ms) => timers.push({ fn, ms }), stateIntervalMs: interval });
  return { hub, mk, timers, log, engine, advance: (ms) => { t += ms; } };
}

test('a burst of answers is batched instead of re-sent to everyone each time', () => {
  const e = throttledEnv(250);
  const host = e.mk('h'); let created;
  host.emit = (ev, d) => { if (ev === 'host:created') created = d; };
  e.hub.handle(host, 'host:create', {});
  const players = Array.from({ length: 200 }, (_, i) => { const s = e.mk(`p${i}`); e.hub.handle(s, 'player:join', { pin: created.pin, nickname: `P${i}` }); return s; });
  e.hub.handle(host, 'host:start', { pin: created.pin, hostToken: created.hostToken });
  const before = { ...e.log };
  players.forEach((s) => e.hub.handle(s, 'player:answer', { pin: created.pin, answerIndex: 1, questionIndex: 0 }));
  const sent = e.log.players - before.players;
  assert.ok(sent <= 1, `200 answers in the same instant caused ${sent} broadcasts to phones (one leading send at most)`);
  assert.equal(e.timers.filter((t) => t.ms <= 250).length >= 1, true, 'one trailing send is queued, not 200');
  e.advance(300);
  e.timers.filter((t) => t.ms <= 250).forEach((t) => t.fn());
  assert.ok(e.log.players - before.players <= 2, 'after the timer, everything is folded into one more send');
  assert.equal(e.engine.getPublicState(created.pin).answeredCount, 200, 'and no answer was lost');
});

test('phase changes are never delayed by the batching', () => {
  const e = throttledEnv(250);
  const host = e.mk('h'); let created;
  host.emit = (ev, d) => { if (ev === 'host:created') created = d; };
  e.hub.handle(host, 'host:create', {});
  const p = e.mk('p1'); e.hub.handle(p, 'player:join', { pin: created.pin, nickname: 'Ada' });
  const before = e.log.players;
  e.hub.handle(host, 'host:start', { pin: created.pin, hostToken: created.hostToken });
  assert.equal(e.log.players, before + 1, 'start goes out immediately even inside the batching window');
});
