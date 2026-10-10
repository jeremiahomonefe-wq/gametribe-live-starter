import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameEngine } from '../src/game-engine.js';

function setup() {
  let t = 1_000_000;
  const engine = createGameEngine({ now: () => t });
  const created = engine.createSession();
  const joined = engine.joinSession({ pin: created.pin, nickname: 'Ada', socketId: 's1' });
  const host = { pin: created.pin, hostToken: created.hostToken };
  return { engine, created, joined, host, advance: (ms) => { t += ms; }, answer: (idx, extra = {}) => engine.submitAnswer({ pin: created.pin, playerId: joined.player.id, socketId: 's1', answerIndex: idx, ...extra }) };
}

test('nicknames: accepts normal names, rejects markup and symbols', () => {
  const { engine, created } = setup();
  assert.equal(engine.joinSession({ pin: created.pin, nickname: "Mary-Ann O'Neil", socketId: 's2' }).ok, true);
  const bad = engine.joinSession({ pin: created.pin, nickname: '<b>hi</b>', socketId: 's3' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /letters, numbers/i);
});

test('rejects an answer aimed at a question that is no longer current', () => {
  const { engine, host, answer } = setup();
  engine.startGame(host);
  const r = answer(1, { questionIndex: 4 });
  assert.equal(r.ok, false);
  assert.match(r.error, /already closed/i);
  assert.equal(answer(1, { questionIndex: 0 }).ok, true);
});

test('deadline locks the question without the host; locked rejects answers; reveal still works', () => {
  const { engine, created, host, advance, answer } = setup();
  engine.startGame(host);
  assert.equal(engine.lockExpired({ pin: created.pin, questionIndex: 0 }).ok, false, 'not before the deadline');
  advance(16_000);
  assert.equal(engine.lockExpired({ pin: created.pin, questionIndex: 1 }).ok, false, 'wrong question index is ignored');
  assert.equal(engine.lockExpired({ pin: created.pin, questionIndex: 0 }).ok, true);
  const state = engine.getPublicState(created.pin);
  assert.equal(state.phase, 'locked');
  assert.equal('correctIndex' in state.question, false, 'answer stays hidden while locked');
  assert.match(answer(1).error, /time is up/i);
  assert.equal(engine.revealAnswer(host).ok, true);
});

test('host can end the game; only the host; answers stop afterwards', () => {
  const { engine, created, host, answer } = setup();
  engine.startGame(host);
  assert.equal(engine.endGame({ pin: created.pin, hostToken: 'wrong' }).ok, false);
  assert.equal(engine.endGame(host).ok, true);
  assert.equal(engine.getPublicState(created.pin).phase, 'finished');
  assert.equal(answer(1).ok, false);
  assert.match(engine.endGame(host).error, /already ended/i);
});

test('private result tells a player if they were right, without touching public state', () => {
  const { engine, created, joined, host, answer } = setup();
  engine.startGame(host);
  answer(1);
  engine.revealAnswer(host);
  const result = engine.getPlayerResult(created.pin, joined.player.id);
  assert.equal(result.answered, true);
  assert.equal(result.correct, true);
  assert.ok(result.points >= 500);
  assert.equal(JSON.stringify(engine.getPublicState(created.pin)).includes('"correct"'), false);
});

test('unanswered question gives a zero result and public state counts answers', () => {
  const { engine, created, joined, host, answer } = setup();
  engine.joinSession({ pin: created.pin, nickname: 'Bola', socketId: 's2' });
  engine.startGame(host);
  assert.equal(engine.getPublicState(created.pin).answeredCount, 0);
  answer(1);
  assert.equal(engine.getPublicState(created.pin).answeredCount, 1);
  assert.deepEqual(engine.getPlayerResult(created.pin, joined.player.id).answered, true);
});

test('revealLocked only reveals a locked question that is still current', () => {
  const { engine, created, host, advance } = setup();
  engine.startGame(host);
  assert.equal(engine.revealLocked({ pin: created.pin, questionIndex: 0 }).ok, false, 'not locked yet');
  advance(16_000);
  engine.lockExpired({ pin: created.pin, questionIndex: 0 });
  assert.equal(engine.revealLocked({ pin: created.pin, questionIndex: 3 }).ok, false, 'wrong question');
  assert.equal(engine.revealLocked({ pin: created.pin, questionIndex: 0 }).ok, true);
  assert.equal(engine.getPublicState(created.pin).phase, 'reveal');
  assert.equal(engine.revealLocked({ pin: created.pin, questionIndex: 0 }).ok, false, 'second call is a no-op');
});
