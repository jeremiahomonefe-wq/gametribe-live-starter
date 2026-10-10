import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQuiz, DEMO_QUIZ, QUIZ_LIMITS } from '../src/quiz-rules.js';
import { createGameEngine } from '../src/game-engine.js';

const q = (over = {}) => ({ prompt: 'Capital of Nigeria?', options: ['Lagos', 'Abuja'], correctIndex: 1, durationSeconds: 20, ...over });
const quiz = (questions = [q()], title = 'My quiz') => ({ title, questions });

test('the demo quiz and a normal custom quiz are valid', () => {
  assert.equal(validateQuiz(DEMO_QUIZ).ok, true);
  assert.equal(validateQuiz(quiz()).ok, true);
});

test('cleans whitespace and defaults the time limit', () => {
  const r = validateQuiz(quiz([q({ prompt: '  Hello   world ', durationSeconds: undefined })], '  Spaced   title '));
  assert.equal(r.quiz.title, 'Spaced title');
  assert.equal(r.quiz.questions[0].prompt, 'Hello world');
  assert.equal(r.quiz.questions[0].durationSeconds, QUIZ_LIMITS.defaultSeconds);
});

test('rejects each kind of invalid quiz with a specific, numbered message', () => {
  const cases = [
    [quiz([], 'x'), /at least one question/i],
    [quiz([q()], '  '), /title/i],
    [quiz([q(), q({ prompt: '' })]), /Question 2: write the question/],
    [quiz([q({ options: ['Only one'], correctIndex: 0 })]), /2 to 4 answer options/],
    [quiz([q({ options: ['A', ''], correctIndex: 0 })]), /fill in every answer/],
    [quiz([q({ options: ['Same', 'same'], correctIndex: 0 })]), /different from each other/],
    [quiz([q({ correctIndex: 5 })]), /choose the correct answer/],
    [quiz([q({ correctIndex: undefined })]), /choose the correct answer/],
    [quiz([q({ durationSeconds: 2 })]), /time limit between 5 and 120/],
    [quiz([q({ durationSeconds: 15.5 })]), /time limit/],
    [quiz(Array.from({ length: 51 }, () => q())), /up to 50 questions/],
    [null, /missing/i]
  ];
  for (const [input, pattern] of cases) {
    const r = validateQuiz(input);
    assert.equal(r.ok, false, String(pattern));
    assert.match(r.error, pattern);
  }
});

test('issues point at the question they belong to', () => {
  const r = validateQuiz(quiz([q(), q({ prompt: '' })]));
  assert.equal(r.issues[0].question, 1);
});

test('a live game uses a snapshot and plays the custom questions', () => {
  const engine = createGameEngine();
  const input = quiz([q({ prompt: 'Original?' })]);
  const created = engine.createSession({ quiz: input });
  input.questions[0].prompt = 'Edited after launch';
  engine.joinSession({ pin: created.pin, nickname: 'Ada', socketId: 's1' });
  engine.startGame({ pin: created.pin, hostToken: created.hostToken });
  const state = engine.getPublicState(created.pin);
  assert.equal(state.question.prompt, 'Original?');
  assert.equal(state.totalQuestions, 1);
  assert.equal(state.title, 'My quiz');
});

test('an invalid quiz cannot start a game', () => {
  assert.throws(() => createGameEngine().createSession({ quiz: quiz([q({ correctIndex: 9 })]) }), /correct answer/i);
});
