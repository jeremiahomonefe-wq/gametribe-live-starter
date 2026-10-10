import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameEngine } from '../src/game-engine.js';

function setup() {
  let time = 1_000_000;
  const engine = createGameEngine({ now: () => time });
  const created = engine.createSession();
  const joined = engine.joinSession({ pin: created.pin, nickname: 'Player One', socketId: 'socket-player-1' });
  assert.equal(joined.ok, true);
  return { engine, created, joined, advance: (ms) => { time += ms; } };
}

test('creates a lobby and returns a six-digit PIN', () => {
  const { engine, created } = setup();
  assert.match(created.pin, /^\d{6}$/);
  assert.equal(engine.getPublicState(created.pin).phase, 'lobby');
});

test('requires a valid host token to start the game', () => {
  const { engine, created } = setup();
  assert.equal(engine.startGame({ pin: created.pin, hostToken: 'wrong-token' }).ok, false);
  assert.equal(engine.startGame({ pin: created.pin, hostToken: created.hostToken }).ok, true);
});

test('scores correct answers on the server and rejects duplicate answers', () => {
  const { engine, created, joined } = setup();
  engine.startGame({ pin: created.pin, hostToken: created.hostToken });
  const result = engine.submitAnswer({ pin: created.pin, playerId: joined.player.id, socketId: 'socket-player-1', answerIndex: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.state.leaderboard[0].score, 1000);
  const duplicate = engine.submitAnswer({ pin: created.pin, playerId: joined.player.id, socketId: 'socket-player-1', answerIndex: 0 });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /already been submitted/i);
});

test('rejects answers after the deadline', () => {
  const { engine, created, joined, advance } = setup();
  engine.startGame({ pin: created.pin, hostToken: created.hostToken });
  advance(15_001);
  const result = engine.submitAnswer({ pin: created.pin, playerId: joined.player.id, socketId: 'socket-player-1', answerIndex: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /time is up/i);
});

test('does not expose the correct answer until reveal', () => {
  const { engine, created } = setup();
  engine.joinSession({ pin: created.pin, nickname: 'Player Two', socketId: 'socket-player-2' });
  engine.startGame({ pin: created.pin, hostToken: created.hostToken });
  assert.equal('correctIndex' in engine.getPublicState(created.pin).question, false);
  engine.revealAnswer({ pin: created.pin, hostToken: created.hostToken });
  assert.equal(engine.getPublicState(created.pin).question.correctIndex, 1);
});

test('requires reveal before moving to the next question', () => {
  const { engine, created } = setup();
  engine.joinSession({ pin: created.pin, nickname: 'Player Two', socketId: 'socket-player-2' });
  engine.startGame({ pin: created.pin, hostToken: created.hostToken });
  assert.equal(engine.nextQuestion({ pin: created.pin, hostToken: created.hostToken }).ok, false);
  engine.revealAnswer({ pin: created.pin, hostToken: created.hostToken });
  assert.equal(engine.nextQuestion({ pin: created.pin, hostToken: created.hostToken }).ok, true);
  assert.equal(engine.getPublicState(created.pin).questionIndex, 1);
});


test('reconnects a player to the same identity and preserves score and answers', () => {
  const { engine, created, joined } = setup();
  engine.startGame({ pin: created.pin, hostToken: created.hostToken });
  const answer = engine.submitAnswer({ pin: created.pin, playerId: joined.player.id, socketId: 'socket-player-1', answerIndex: 1 });
  assert.equal(answer.ok, true);
  const before = engine.getPublicState(created.pin).leaderboard.find((p) => p.id === joined.player.id).score;

  engine.removePlayer({ pin: created.pin, playerId: joined.player.id, socketId: 'socket-player-1' });
  const reconnected = engine.reconnectPlayer({ pin: created.pin, reconnectToken: joined.player.reconnectToken, socketId: 'socket-player-2' });

  assert.equal(reconnected.ok, true);
  assert.equal(reconnected.player.id, joined.player.id);
  assert.equal(reconnected.player.nickname, joined.player.nickname);
  assert.equal(reconnected.state.leaderboard.find((p) => p.id === joined.player.id).score, before);
  assert.equal(reconnected.state.players.find((p) => p.id === joined.player.id).connected, true);
  const duplicate = engine.submitAnswer({ pin: created.pin, playerId: joined.player.id, socketId: 'socket-player-2', answerIndex: 1 });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /already been submitted/i);
});

test('rejects invalid reconnect tokens and does not expose tokens in public game state', () => {
  const { engine, created, joined } = setup();
  assert.equal(engine.reconnectPlayer({ pin: created.pin, reconnectToken: 'invalid-token', socketId: 'socket-player-2' }).ok, false);
  const state = engine.getPublicState(created.pin);
  assert.equal('reconnectToken' in state.players[0], false);
  assert.equal('reconnectToken' in state.leaderboard[0], false);
  const reconnected = engine.reconnectPlayer({ pin: created.pin, reconnectToken: joined.player.reconnectToken, socketId: 'socket-player-2' });
  assert.equal(reconnected.ok, true);
});

test('a stale socket disconnect cannot mark a reconnected player offline', () => {
  const { engine, created, joined } = setup();
  const reconnected = engine.reconnectPlayer({ pin: created.pin, reconnectToken: joined.player.reconnectToken, socketId: 'socket-player-2' });
  assert.equal(reconnected.ok, true);
  const stateAfterOldDisconnect = engine.removePlayer({ pin: created.pin, playerId: joined.player.id, socketId: 'socket-player-1' });
  assert.equal(stateAfterOldDisconnect.players.find((p) => p.id === joined.player.id).connected, true);
});
