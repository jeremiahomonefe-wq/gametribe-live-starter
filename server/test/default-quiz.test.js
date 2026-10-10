import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_QUIZ } from '../src/default-quiz.js';
import { parseQuizCsv } from '../src/quiz-csv.js';
import { validateQuiz } from '../src/quiz-rules.js';
import { createGameEngine } from '../src/game-engine.js';
import { createHub } from '../src/hub.js';

test('the built-in quiz is valid and has the 40 questions', () => {
  assert.equal(validateQuiz(DEFAULT_QUIZ).ok, true);
  assert.equal(DEFAULT_QUIZ.questions.length, 40);
  assert.ok(DEFAULT_QUIZ.questions.every((q) => q.options.length === 4 && Number.isInteger(q.correctIndex)));
});

test('the built-in quiz matches docs/default-questions.csv (run "npm run default-quiz" after editing the CSV)', () => {
  const csv = fs.readFileSync(new URL('../../docs/default-questions.csv', import.meta.url), 'utf8');
  const parsed = parseQuizCsv(csv, { title: DEFAULT_QUIZ.title });
  assert.equal(parsed.problems.length, 0);
  assert.deepEqual(parsed.quiz.questions, DEFAULT_QUIZ.questions);
});

test('a game started without its own quiz uses the configured default', () => {
  const log = [];
  const hub = createHub({ engine: createGameEngine(), broadcast() {}, sendTo() {}, defaultQuiz: DEFAULT_QUIZ });
  const socket = { id: 's', join() {}, emit: (ev, d) => log.push([ev, d]) };
  hub.handle(socket, 'host:create', {});
  const created = log.find(([ev]) => ev === 'host:created')[1];
  assert.equal(created.state.title, DEFAULT_QUIZ.title);
  assert.equal(created.state.totalQuestions, 40);
});
